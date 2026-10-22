-- Friend-level balances follow a group's simplified plan (review M6, H3; SPEC §2, §7, §11).
--
-- In a group with simplify_debts on, what two members owe each other is the
-- transfer between them in the group's simplified plan (src/lib/settlements,
-- computed from members' nets), not their raw pairwise ledger rows. Other
-- groups and direct expenses keep raw pairwise balances. The plan is computed
-- in TypeScript; SQL never re-implements simplification. It only provides the
-- inputs and checks that a settlement stays within both members' nets.
--
-- - my_pairwise_balances(): the caller's raw pairwise balances with everyone,
--   per group (null = direct) and currency, flagged when the group simplifies.
-- - my_simplified_group_balances(): every member's net in the caller's current
--   simplify-on groups (the input to the plan), in one call.
-- - settle_up_with_friend() takes the amounts to settle (computed on the
--   server from the above) and validates each one under a lock: raw contexts
--   must match exactly, simplified groups must stay within both nets.

-- ---------------------------------------------------------------------------
-- Read functions (SECURITY INVOKER: RLS decides what is visible)
-- ---------------------------------------------------------------------------

-- Positive amount = that person owes the caller.
create function public.my_pairwise_balances()
returns table (friend_id uuid, group_id uuid, currency text, amount bigint, simplified boolean)
language sql stable security invoker set search_path = ''
as $$
  select p.friend_id, p.group_id, p.currency, p.amount, coalesce(g.simplify_debts, false)
    from (
      select case when l.creditor_id = (select auth.uid()) then l.debtor_id else l.creditor_id end as friend_id,
             l.group_id,
             l.currency::text as currency,
             sum(case when l.creditor_id = (select auth.uid()) then l.amount else -l.amount end)::bigint as amount
        from public.ledger_entries l
       where (select auth.uid()) in (l.debtor_id, l.creditor_id)
       group by 1, 2, 3
      having sum(case when l.creditor_id = (select auth.uid()) then l.amount else -l.amount end) <> 0
    ) p
    left join public.groups g on g.id = p.group_id
   order by p.friend_id, p.group_id nulls first, p.currency;
$$;

-- Each member's net per currency in the caller's current groups that simplify debts.
create function public.my_simplified_group_balances()
returns table (group_id uuid, user_id uuid, currency text, amount bigint)
language sql stable security invoker set search_path = ''
as $$
  select l.group_id, u.user_id, l.currency::text, sum(u.delta)::bigint
    from public.ledger_entries l
    join public.groups g on g.id = l.group_id and g.simplify_debts
    join public.group_members m
      on m.group_id = l.group_id and m.user_id = (select auth.uid()) and m.left_at is null
   cross join lateral (values (l.creditor_id, l.amount::bigint), (l.debtor_id, -l.amount::bigint)) as u(user_id, delta)
   group by l.group_id, u.user_id, l.currency
  having sum(u.delta) <> 0
   order by l.group_id, l.currency, u.user_id;
$$;

-- ---------------------------------------------------------------------------
-- Settle up everything with one friend, from server-computed amounts
-- ---------------------------------------------------------------------------

drop function public.settle_up_with_friend(uuid, uuid, text, text, text, date);

-- The caller's net in one group and currency, from the ledger.
create function private.member_net(p_group_id uuid, p_user_id uuid, p_currency text) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(case when l.creditor_id = p_user_id then l.amount else -l.amount end), 0)::bigint
    from public.ledger_entries l
   where l.group_id = p_group_id and l.currency = p_currency and p_user_id in (l.debtor_id, l.creditor_id);
$$;

-- `p_items`: [{"group_id": uuid | null, "currency": "INR", "amount": 12345}, …], one per
-- context and currency. Positive amount = the friend pays the caller (recorded by
-- the receiver → completed); negative = the caller pays (pending until the friend
-- confirms). Each item is checked against the ledger under the friendship lock:
--   direct, or a group that doesn't simplify: equal to the raw pairwise balance;
--   a group that simplifies: the right direction and no more than either net.
-- A retry with the same key returns the same settlement IDs.
create function public.settle_up_with_friend(
  p_idempotency_key uuid,
  p_friend_id uuid,
  p_items jsonb,
  p_method text default 'cash',
  p_upi_reference text default null,
  p_note text default null,
  p_settled_on date default current_date
) returns uuid[]
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_ids uuid[];
  v_item jsonb;
  v_group uuid;
  v_currency text;
  v_amount bigint;
  v_simplify boolean;
  v_raw bigint;
  v_mine bigint;
  v_theirs bigint;
  v_seen text[] := '{}'::text[];
  v_key text;
begin
  if p_idempotency_key is null then
    perform private.fail('SM422', 'An idempotency key is required');
  end if;
  select coalesce(array_agg(s.id order by s.group_id nulls first, s.currency), '{}') into v_ids
    from public.settlements s
   where s.created_by = v_uid and s.batch_id = p_idempotency_key;
  if cardinality(v_ids) > 0 then
    return v_ids;
  end if;

  if p_friend_id is null or p_friend_id = v_uid then
    perform private.fail('SM422', 'Choose a friend to settle up with');
  end if;
  -- Serializes batches between the same two people.
  perform 1 from public.friendships f
   where f.user_low = least(v_uid, p_friend_id) and f.user_high = greatest(v_uid, p_friend_id)
     and f.status = 'accepted'
     for update;
  if not found then
    perform private.fail('SM403', 'You can only settle up with friends');
  end if;
  -- A concurrent retry that waited for the lock returns what the first one recorded.
  select coalesce(array_agg(s.id order by s.group_id nulls first, s.currency), '{}') into v_ids
    from public.settlements s
   where s.created_by = v_uid and s.batch_id = p_idempotency_key;
  if cardinality(v_ids) > 0 then
    return v_ids;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform private.fail('SM422', 'There is nothing to settle with this friend');
  end if;
  if jsonb_array_length(p_items) > 200 then
    perform private.fail('SM422', 'Too many balances to settle at once');
  end if;

  v_ids := '{}';
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      perform private.fail('SM422', 'Each balance must be an object');
    end if;
    v_group := case when v_item ->> 'group_id' is null then null else private.json_uuid(v_item, 'group_id') end;
    v_currency := v_item ->> 'currency';
    if not private.is_supported_currency(v_currency) then
      perform private.fail('SM422', 'Unsupported currency');
    end if;
    -- Signed: whole minor units, non-zero, within ±(2^53 − 1).
    if jsonb_typeof(v_item -> 'amount') is distinct from 'number'
       or (v_item ->> 'amount')::numeric <> trunc((v_item ->> 'amount')::numeric)
       or abs((v_item ->> 'amount')::numeric) > 9007199254740991
       or (v_item ->> 'amount')::numeric = 0 then
      perform private.fail('SM422', 'Each balance must be a non-zero whole amount in minor units');
    end if;
    v_amount := (v_item ->> 'amount')::bigint;
    v_key := coalesce(v_group::text, 'direct') || ':' || v_currency;
    if v_key = any (v_seen) then
      perform private.fail('SM422', 'Each group and currency can appear only once');
    end if;
    v_seen := v_seen || v_key;

    if v_group is not null then
      if (
        select count(*) from public.group_members m
         where m.group_id = v_group and m.user_id in (v_uid, p_friend_id) and m.left_at is null
      ) <> 2 then
        perform private.fail('SM403', 'Both of you must be current members of the group');
      end if;
      select g.simplify_debts into v_simplify from public.groups g where g.id = v_group;
    else
      v_simplify := false;
    end if;

    if v_simplify then
      v_mine := private.member_net(v_group, v_uid, v_currency);
      v_theirs := private.member_net(v_group, p_friend_id, v_currency);
      if not (
        (v_amount > 0 and v_theirs < 0 and v_mine > 0 and v_amount <= least(-v_theirs, v_mine))
        or (v_amount < 0 and v_mine < 0 and v_theirs > 0 and -v_amount <= least(-v_mine, v_theirs))
      ) then
        perform private.fail('SM409', 'Balances have changed. Reload and try again');
      end if;
    else
      select coalesce(sum(case when l.creditor_id = v_uid then l.amount else -l.amount end), 0)::bigint
        into v_raw
        from public.ledger_entries l
       where l.group_id is not distinct from v_group and l.currency = v_currency
         and ((l.debtor_id = v_uid and l.creditor_id = p_friend_id)
           or (l.debtor_id = p_friend_id and l.creditor_id = v_uid));
      if v_raw <> v_amount then
        perform private.fail('SM409', 'Balances have changed. Reload and try again');
      end if;
    end if;

    v_ids := v_ids || private.record_settlement(
      v_uid,
      private.batch_settlement_key(p_idempotency_key, v_group, v_currency),
      v_group,
      case when v_amount > 0 then p_friend_id else v_uid end,
      case when v_amount > 0 then v_uid else p_friend_id end,
      abs(v_amount),
      v_currency,
      p_method,
      p_upi_reference,
      p_note,
      p_settled_on,
      p_idempotency_key
    );
  end loop;

  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE grants
-- ---------------------------------------------------------------------------

revoke all on function
  public.my_pairwise_balances(),
  public.my_simplified_group_balances(),
  public.settle_up_with_friend(uuid, uuid, jsonb, text, text, text, date)
from public, anon;

grant execute on function
  public.my_pairwise_balances(),
  public.my_simplified_group_balances(),
  public.settle_up_with_friend(uuid, uuid, jsonb, text, text, text, date)
to authenticated, service_role;

revoke all on function private.member_net(uuid, uuid, text) from public, anon, authenticated;
