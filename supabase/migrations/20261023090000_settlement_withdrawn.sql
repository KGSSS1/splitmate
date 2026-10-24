-- Settlement status `withdrawn` (SPEC §11) and one open payment per debt (review L2).
--
-- - withdrawn: a pending settlement called off before the receiver answered, by its
--   payer or automatically when either person leaves the group. It never touched the
--   ledger. `cancelled` now only means a completed settlement that was reversed.
-- - settle_up_with_friend refuses an item while a settlement between the two in the
--   same context and currency is still pending (otherwise confirming both overpays).

alter table public.settlements drop constraint settlements_status_check;
alter table public.settlements drop constraint settlements_cancelled_fields;

-- Pending settlements called off before this migration become withdrawn.
update public.settlements set status = 'withdrawn' where status = 'cancelled' and confirmed_at is null;

alter table public.settlements
  add constraint settlements_status_check
    check (status in ('pending', 'completed', 'rejected', 'withdrawn', 'cancelled')),
  add constraint settlements_cancelled_fields check (
    (status in ('cancelled', 'withdrawn')) = (cancelled_at is not null and cancelled_by is not null)
  ),
  add constraint settlements_withdrawn_never_confirmed check (status <> 'withdrawn' or confirmed_at is null);

create or replace function public.cancel_settlement(p_settlement_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_settlement public.settlements%rowtype;
  v_before jsonb;
  v_was_completed boolean;
begin
  v_settlement := private.lock_settlement(p_settlement_id, v_uid);
  if v_settlement.status = 'pending' then
    if v_uid <> v_settlement.payer_id then
      perform private.fail('SM403', 'The receiver rejects a pending settlement instead of cancelling it');
    end if;
  elsif v_settlement.status = 'completed' then
    perform private.require_parties(v_settlement.group_id, v_uid,
                                    array[v_settlement.payer_id, v_settlement.receiver_id]);
  else
    perform private.fail('SM409', format('Cannot cancel a %s settlement', v_settlement.status));
  end if;

  v_was_completed := v_settlement.status = 'completed';
  v_before := private.settlement_data(v_settlement);
  -- Pending → withdrawn (it never counted); completed → cancelled (reversed below).
  update public.settlements
     set status = case when v_was_completed then 'cancelled' else 'withdrawn' end,
         cancelled_at = now(), cancelled_by = v_uid
   where id = v_settlement.id
  returning * into v_settlement;
  if v_was_completed then
    perform private.settlement_ledger_entry(v_settlement, 'reversal');
  end if;

  perform private.audit(v_uid, case when v_was_completed then 'settlement.cancelled' else 'settlement.withdrawn' end,
                        'settlement', v_settlement.id, v_settlement.group_id,
                        v_before, private.settlement_data(v_settlement));
  perform private.notify(case when v_uid = v_settlement.payer_id then v_settlement.receiver_id
                              else v_settlement.payer_id end,
                         'settlement_cancelled', v_uid, v_settlement.group_id, null, v_settlement.id,
                         private.settlement_data(v_settlement));
end;
$$;

create or replace function private.end_membership(p_group_id uuid, p_user_id uuid, p_removed_by uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.group_members%rowtype;
  v_successor uuid;
  v_settlement public.settlements%rowtype;
  v_actor uuid := coalesce(p_removed_by, p_user_id);
begin
  select * into v_member from public.group_members m
   where m.group_id = p_group_id and m.user_id = p_user_id and m.left_at is null
     for update;
  if not found then
    perform private.fail('SM404', 'Not a current member of this group');
  end if;
  if not private.group_balance_is_zero(p_group_id, p_user_id) then
    perform private.fail('SM409', 'The balance in this group must be zero in every currency first');
  end if;

  update public.group_members
     set left_at = now(), removed_by = p_removed_by
   where id = v_member.id;

  update public.group_invitations
     set revoked_at = now()
   where group_id = p_group_id and created_by = p_user_id and revoked_at is null;

  for v_settlement in
    update public.settlements
       set status = 'withdrawn', cancelled_at = now(), cancelled_by = v_actor
     where group_id = p_group_id and status = 'pending' and p_user_id in (payer_id, receiver_id)
    returning *
  loop
    perform private.audit(v_actor, 'settlement.withdrawn', 'settlement', v_settlement.id, p_group_id,
                          jsonb_build_object('status', 'pending'), private.settlement_data(v_settlement));
    -- Both parties are told (notify skips whoever is acting).
    perform private.notify(v_settlement.payer_id, 'settlement_cancelled', v_actor, p_group_id, null,
                           v_settlement.id, private.settlement_data(v_settlement));
    perform private.notify(v_settlement.receiver_id, 'settlement_cancelled', v_actor, p_group_id, null,
                           v_settlement.id, private.settlement_data(v_settlement));
  end loop;

  -- If the last admin left, the longest-standing remaining member becomes admin.
  if v_member.role = 'admin' and not exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.left_at is null and m.role = 'admin'
  ) then
    select m.user_id into v_successor from public.group_members m
     where m.group_id = p_group_id and m.left_at is null
     order by m.joined_at, m.user_id
     limit 1;
    if v_successor is not null then
      update public.group_members set role = 'admin'
       where group_id = p_group_id and user_id = v_successor;
    end if;
  end if;
end;
$$;

create or replace function public.my_activity(p_limit integer default 25, p_offset integer default 0)
returns table (
  id uuid,
  actor_id uuid,
  action text,
  entity_type text,
  entity_id uuid,
  group_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz,
  total_count bigint
)
language sql stable security invoker set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid),
  candidates as (
    -- Events in groups the caller is currently in.
    select e.id from public.audit_events e
      join public.group_members m on m.group_id = e.group_id
     where m.user_id = (select uid from me) and m.left_at is null
    union
    -- Events the caller caused.
    select e.id from public.audit_events e where e.actor_id = (select uid from me)
    union
    -- Events about the caller's settlements (including groups they have left).
    select e.id from public.audit_events e
      join public.settlements s on s.id = e.entity_id and e.entity_type = 'settlement'
     where (select uid from me) in (s.payer_id, s.receiver_id)
    union
    -- Events about expenses the caller took part in (direct ones, and groups they have left).
    select e.id from public.audit_events e
      join public.expense_participants p on p.expense_id = e.entity_id and e.entity_type = 'expense'
     where p.user_id = (select uid from me)
    union
    select e.id from public.audit_events e
      join public.expense_payers p on p.expense_id = e.entity_id and e.entity_type = 'expense'
     where p.user_id = (select uid from me)
  )
  select e.id, e.actor_id, e.action, e.entity_type, e.entity_id, e.group_id, e.before, e.after, e.created_at,
         count(*) over ()
    from public.audit_events e
   where e.id in (select c.id from candidates c)
     and e.entity_type in ('expense', 'settlement')
     and e.action in ('expense.created', 'expense.updated', 'expense.cancelled', 'settlement.created',
                      'settlement.confirmed', 'settlement.rejected', 'settlement.cancelled',
                      'settlement.withdrawn')
   order by e.created_at desc, e.id
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.settle_up_with_friend(
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

    -- One open payment per debt (SPEC §11, review L2): a pending settlement between the
    -- two in this context and currency must be answered or withdrawn first.
    if exists (
      select 1 from public.settlements s
       where s.status = 'pending' and s.currency = v_currency and s.group_id is not distinct from v_group
         and ((s.payer_id = v_uid and s.receiver_id = p_friend_id) or (s.payer_id = p_friend_id and s.receiver_id = v_uid))
    ) then
      perform private.fail('SM409', 'A payment between you two is waiting for confirmation here. Confirm, reject or withdraw it first');
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
