-- M6: balance queries and friend-level "settle up everything" (SPEC §7, §9, §11).
--
-- - Read functions over the pairwise ledger: the caller's net per group, the
--   caller's pairwise balance with one person per group, and the pairwise
--   debts inside one group (suggested transfers when simplify-debts is off).
--   They only sum ledger rows; splitting stays in src/lib/accounting.
-- - create_settlement's body moves to private.record_settlement so that
--   settle_up_with_friend can record one settlement per group and currency
--   inside a single transaction.
-- - settlements.batch_id ties the settlements of one "settle up everything"
--   request together; retrying with the same key returns the same settlements.

-- ---------------------------------------------------------------------------
-- Batches
-- ---------------------------------------------------------------------------

alter table public.settlements add column batch_id uuid;

create index settlements_batch_idx on public.settlements (created_by, batch_id) where batch_id is not null;

-- ---------------------------------------------------------------------------
-- Recording one settlement
-- ---------------------------------------------------------------------------

-- Validates and records one settlement for `p_actor` (the payer or the receiver).
-- Recorded by the receiver → completed (ledger entry now); by the payer → pending.
create function private.record_settlement(
  p_actor uuid,
  p_idempotency_key uuid,
  p_group_id uuid,
  p_payer_id uuid,
  p_receiver_id uuid,
  p_amount bigint,
  p_currency text,
  p_method text,
  p_upi_reference text,
  p_note text,
  p_settled_on date,
  p_batch_id uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_settlement public.settlements%rowtype;
  v_status text;
begin
  if p_idempotency_key is null then
    perform private.fail('SM422', 'An idempotency key is required');
  end if;
  select * into v_settlement from public.settlements s
   where s.created_by = p_actor and s.idempotency_key = p_idempotency_key;
  if found then
    return v_settlement.id;
  end if;

  if p_payer_id is null or p_receiver_id is null or p_payer_id = p_receiver_id then
    perform private.fail('SM422', 'A settlement needs a payer and a different receiver');
  end if;
  if p_actor not in (p_payer_id, p_receiver_id) then
    perform private.fail('SM403', 'Only the payer or the receiver can record a settlement');
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 9007199254740991 then
    perform private.fail('SM422', 'Amount must be a positive whole number of minor units');
  end if;
  if not private.is_supported_currency(p_currency) then
    perform private.fail('SM422', 'Unsupported currency');
  end if;
  if p_method is null or p_method not in ('cash', 'bank_transfer', 'upi', 'other') then
    perform private.fail('SM422', 'Unknown payment method');
  end if;
  if char_length(btrim(p_upi_reference)) > 64 then
    perform private.fail('SM422', 'Keep the UPI reference under 64 characters');
  end if;
  if char_length(btrim(p_note)) > 500 then
    perform private.fail('SM422', 'Keep the note under 500 characters');
  end if;
  if p_settled_on is not null and p_settled_on not between date '2000-01-01' and current_date + 1 then
    perform private.fail('SM422', 'Choose a date from 2000 up to today');
  end if;
  perform private.require_parties(p_group_id, p_actor, array[p_payer_id, p_receiver_id]);

  -- The receiver confirms by recording it; a payer's record waits for the receiver.
  v_status := case when p_actor = p_receiver_id then 'completed' else 'pending' end;

  insert into public.settlements (
    group_id, payer_id, receiver_id, amount, currency, method, upi_reference, note, settled_on,
    status, created_by, idempotency_key, confirmed_at, batch_id
  ) values (
    p_group_id, p_payer_id, p_receiver_id, p_amount, p_currency, p_method,
    nullif(btrim(p_upi_reference), ''), nullif(btrim(p_note), ''), coalesce(p_settled_on, current_date),
    v_status, p_actor, p_idempotency_key, case when v_status = 'completed' then now() end, p_batch_id
  )
  on conflict (created_by, idempotency_key) do nothing
  returning * into v_settlement;

  if v_settlement.id is null then
    select s.id into v_settlement.id from public.settlements s
     where s.created_by = p_actor and s.idempotency_key = p_idempotency_key;
    return v_settlement.id;
  end if;

  if v_status = 'completed' then
    perform private.settlement_ledger_entry(v_settlement, 'charge');
  end if;
  perform private.audit(p_actor, 'settlement.created', 'settlement', v_settlement.id, p_group_id, null,
                        private.settlement_data(v_settlement));
  perform private.notify(case when p_actor = p_payer_id then p_receiver_id else p_payer_id end,
                         'settlement_recorded', p_actor, p_group_id, null, v_settlement.id,
                         private.settlement_data(v_settlement));
  return v_settlement.id;
end;
$$;

-- Same signature and grants as before; the body is now shared.
create or replace function public.create_settlement(
  p_idempotency_key uuid,
  p_group_id uuid,
  p_payer_id uuid,
  p_receiver_id uuid,
  p_amount bigint,
  p_currency text,
  p_method text default 'cash',
  p_upi_reference text default null,
  p_note text default null,
  p_settled_on date default current_date
) returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  return private.record_settlement(private.require_uid(), p_idempotency_key, p_group_id, p_payer_id,
                                   p_receiver_id, p_amount, p_currency, p_method, p_upi_reference, p_note,
                                   p_settled_on, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Settle up everything with one friend
-- ---------------------------------------------------------------------------

-- One idempotency key per settlement of a batch, derived from the batch key.
create function private.batch_settlement_key(p_batch_id uuid, p_group_id uuid, p_currency text) returns uuid
language sql immutable set search_path = ''
as $$
  select md5(p_batch_id::text || ':' || coalesce(p_group_id::text, 'direct') || ':' || p_currency)::uuid;
$$;

-- Records one settlement per group (and the direct relationship) and currency
-- where the caller and the friend have a pairwise balance, in one transaction
-- (SPEC §11). Where the friend owes the caller, the caller is the receiver and
-- the settlement completes; where the caller owes, it waits for the friend.
-- Groups that one of the two has left are skipped: a former member cannot act there.
-- Returns the settlement IDs; a retry with the same key returns the same IDs.
create function public.settle_up_with_friend(
  p_idempotency_key uuid,
  p_friend_id uuid,
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
  v_row record;
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
  -- Serializes batches between the same two people, so balances are read once per batch.
  perform 1 from public.friendships f
   where f.user_low = least(v_uid, p_friend_id) and f.user_high = greatest(v_uid, p_friend_id)
     and f.status = 'accepted'
     for update;
  if not found then
    perform private.fail('SM403', 'You can only settle up with friends');
  end if;

  v_ids := '{}';
  for v_row in
    select l.group_id, l.currency::text as currency,
           sum(case when l.creditor_id = v_uid then l.amount else -l.amount end)::bigint as amount
      from public.ledger_entries l
     where (l.debtor_id = v_uid and l.creditor_id = p_friend_id)
        or (l.debtor_id = p_friend_id and l.creditor_id = v_uid)
     group by l.group_id, l.currency
    having sum(case when l.creditor_id = v_uid then l.amount else -l.amount end) <> 0
     order by l.group_id nulls first, l.currency
  loop
    if v_row.group_id is not null and (
      select count(*) from public.group_members m
       where m.group_id = v_row.group_id and m.user_id in (v_uid, p_friend_id) and m.left_at is null
    ) <> 2 then
      continue;
    end if;
    v_ids := v_ids || private.record_settlement(
      v_uid,
      private.batch_settlement_key(p_idempotency_key, v_row.group_id, v_row.currency),
      v_row.group_id,
      case when v_row.amount > 0 then p_friend_id else v_uid end,
      case when v_row.amount > 0 then v_uid else p_friend_id end,
      abs(v_row.amount),
      v_row.currency,
      p_method,
      p_upi_reference,
      p_note,
      p_settled_on,
      p_idempotency_key
    );
  end loop;

  if cardinality(v_ids) = 0 then
    perform private.fail('SM422', 'There is nothing to settle with this friend');
  end if;
  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- Balance read functions (SECURITY INVOKER: RLS on ledger_entries decides what is visible)
-- ---------------------------------------------------------------------------

-- The caller's net in each group per currency; positive = others in the group owe the caller.
-- Groups the caller has left are included; callers filter by current membership.
create function public.my_group_balances()
returns table (group_id uuid, currency text, amount bigint)
language sql stable security invoker set search_path = ''
as $$
  select l.group_id,
         l.currency::text,
         sum(case when l.creditor_id = (select auth.uid()) then l.amount else -l.amount end)::bigint
    from public.ledger_entries l
   where l.group_id is not null
     and (select auth.uid()) in (l.debtor_id, l.creditor_id)
   group by l.group_id, l.currency
  having sum(case when l.creditor_id = (select auth.uid()) then l.amount else -l.amount end) <> 0
   order by l.group_id, l.currency;
$$;

-- The caller's raw pairwise balance with one person, per group (null = direct) and
-- currency. Positive = that person owes the caller.
create function public.friend_group_balances(p_friend_id uuid)
returns table (group_id uuid, currency text, amount bigint)
language sql stable security invoker set search_path = ''
as $$
  select l.group_id,
         l.currency::text,
         sum(case when l.creditor_id = (select auth.uid()) then l.amount else -l.amount end)::bigint
    from public.ledger_entries l
   where ((l.debtor_id = (select auth.uid()) and l.creditor_id = p_friend_id)
       or (l.debtor_id = p_friend_id and l.creditor_id = (select auth.uid())))
   group by l.group_id, l.currency
  having sum(case when l.creditor_id = (select auth.uid()) then l.amount else -l.amount end) <> 0
   order by l.group_id nulls first, l.currency;
$$;

-- Pairwise debts inside one group, netted per pair and currency: debtor owes creditor.
create function public.group_pairwise_balances(p_group_id uuid)
returns table (debtor_id uuid, creditor_id uuid, currency text, amount bigint)
language sql stable security invoker set search_path = ''
as $$
  with pairs as (
    select least(l.debtor_id, l.creditor_id) as low_id,
           greatest(l.debtor_id, l.creditor_id) as high_id,
           l.currency::text as currency,
           -- Positive: the lower ID owes the higher one.
           sum(case when l.debtor_id < l.creditor_id then l.amount else -l.amount end)::bigint as net
      from public.ledger_entries l
     where l.group_id = p_group_id
     group by 1, 2, 3
  )
  select case when net > 0 then low_id else high_id end,
         case when net > 0 then high_id else low_id end,
         currency,
         abs(net)
    from pairs
   where net <> 0
   order by currency, 1, 2;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE grants
-- ---------------------------------------------------------------------------

revoke all on function
  public.settle_up_with_friend(uuid, uuid, text, text, text, date),
  public.my_group_balances(),
  public.friend_group_balances(uuid),
  public.group_pairwise_balances(uuid)
from public, anon;

grant execute on function
  public.settle_up_with_friend(uuid, uuid, text, text, text, date),
  public.my_group_balances(),
  public.friend_group_balances(uuid),
  public.group_pairwise_balances(uuid)
to authenticated, service_role;

revoke all on function
  private.record_settlement(uuid, uuid, uuid, uuid, uuid, bigint, text, text, text, text, date, uuid),
  private.batch_settlement_key(uuid, uuid, text)
from public, anon, authenticated;
