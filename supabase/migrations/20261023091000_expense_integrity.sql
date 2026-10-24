-- Expense integrity fixes from the M6 review, batch 1 (docs/reviews/review-M6.md).

-- ---------------------------------------------------------------------------
-- M1: an expense change locks the memberships it affects
-- ---------------------------------------------------------------------------

create or replace function private.lock_expense_for_change(p_expense_id uuid, p_expected_version integer, p_actor uuid)
returns public.expenses
language plpgsql security definer set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
begin
  select * into v_expense from public.expenses e where e.id = p_expense_id for update;
  if not found then
    perform private.fail('SM404', 'Expense not found');
  end if;
  -- Hold the memberships of the actor and of everyone in the current version until
  -- this change commits, so nobody it affects can leave the group meanwhile at a
  -- zero balance the change is about to break (review M1). leave_group and
  -- remove_group_member lock the member's row FOR UPDATE, so they wait for us and
  -- then see the new balance. New participants are locked by require_parties.
  if v_expense.group_id is not null then
    perform 1 from public.group_members m
     where m.group_id = v_expense.group_id and m.left_at is null
       and (m.user_id = p_actor or m.user_id = any (private.expense_version_users(v_expense.id, v_expense.version)))
     order by m.user_id
       for share;
  end if;
  if v_expense.group_id is not null then
    if not exists (
      select 1 from public.group_members m
       where m.group_id = v_expense.group_id and m.user_id = p_actor and m.left_at is null
    ) then
      perform private.fail('SM403', 'Only current group members can change this expense');
    end if;
  elsif not (p_actor = any (private.expense_version_users(v_expense.id, v_expense.version))) then
    perform private.fail('SM403', 'Only the two friends involved can change this expense');
  end if;
  if v_expense.status <> 'active' then
    perform private.fail('SM409', 'This expense has been cancelled');
  end if;
  if p_expected_version is null or v_expense.version <> p_expected_version then
    perform private.fail('SM409', 'This expense was changed by someone else; reload and try again');
  end if;
  -- History involving someone who has left is frozen: changing it would give a
  -- former member a balance they can no longer settle.
  if v_expense.group_id is not null and exists (
    select 1 from unnest(private.expense_version_users(v_expense.id, v_expense.version)) as u(user_id)
     where not exists (
       select 1 from public.group_members m
        where m.group_id = v_expense.group_id and m.user_id = u.user_id and m.left_at is null
     )
  ) then
    perform private.fail('SM409', 'Someone in this expense has left the group, so it can no longer be changed');
  end if;
  return v_expense;
end;
$$;

-- ---------------------------------------------------------------------------
-- M2: maximum expense amount per currency, and a balance range
-- ---------------------------------------------------------------------------

-- The largest amount one expense may have, in minor units: about US$100,000, rounded
-- per currency (SPEC §7). Mirrors `maxExpense` in src/lib/money/currencies.ts
-- (tests/unit/money/currency-sync.test.ts compares them).
create function private.currency_max_amount(p_currency text) returns bigint
language sql immutable set search_path = ''
as $$
  select v.max_amount from (values
    ('INR', 1000000000::bigint),
    ('USD', 10000000::bigint),
    ('EUR', 10000000::bigint),
    ('GBP', 10000000::bigint),
    ('AED', 50000000::bigint),
    ('AUD', 20000000::bigint),
    ('BDT', 1000000000::bigint),
    ('BRL', 50000000::bigint),
    ('CAD', 20000000::bigint),
    ('CHF', 10000000::bigint),
    ('CNY', 100000000::bigint),
    ('CZK', 250000000::bigint),
    ('DKK', 100000000::bigint),
    ('EGP', 500000000::bigint),
    ('HKD', 100000000::bigint),
    ('IDR', 200000000000::bigint),
    ('ILS', 50000000::bigint),
    ('KES', 1500000000::bigint),
    ('LKR', 3000000000::bigint),
    ('MXN', 200000000::bigint),
    ('MYR', 50000000::bigint),
    ('NGN', 15000000000::bigint),
    ('NOK', 100000000::bigint),
    ('NPR', 1500000000::bigint),
    ('NZD', 20000000::bigint),
    ('PHP', 500000000::bigint),
    ('PKR', 3000000000::bigint),
    ('PLN', 50000000::bigint),
    ('QAR', 50000000::bigint),
    ('SAR', 50000000::bigint),
    ('SEK', 100000000::bigint),
    ('SGD', 15000000::bigint),
    ('THB', 400000000::bigint),
    ('TRY', 400000000::bigint),
    ('TWD', 300000000::bigint),
    ('ZAR', 200000000::bigint),
    ('CLP', 100000000::bigint),
    ('ISK', 15000000::bigint),
    ('JPY', 15000000::bigint),
    ('KRW', 150000000::bigint),
    ('UGX', 400000000::bigint),
    ('VND', 2500000000::bigint),
    ('BHD', 50000000::bigint),
    ('JOD', 100000000::bigint),
    ('KWD', 50000000::bigint),
    ('OMR', 50000000::bigint),
    ('TND', 300000000::bigint)
  ) as v(code, max_amount)
   where v.code = p_currency;
$$;

create or replace function private.validate_expense_fields(
  p_description text,
  p_amount bigint,
  p_currency text,
  p_expense_date date,
  p_split_method text
) returns void
language plpgsql set search_path = ''
as $$
begin
  if p_description is null or char_length(btrim(p_description)) not between 1 and 200 then
    perform private.fail('SM422', 'Description must be 1–200 characters');
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 9007199254740991 then
    perform private.fail('SM422', 'Amount must be a positive whole number of minor units');
  end if;
  if not private.is_supported_currency(p_currency) then
    perform private.fail('SM422', 'Unsupported currency');
  end if;
  if p_amount > private.currency_max_amount(p_currency) then
    perform private.fail('SM422', format('This is more than one expense in %s can be', p_currency));
  end if;
  if p_expense_date is null then
    perform private.fail('SM422', 'Expense date is required');
  end if;
  if p_expense_date < date '2000-01-01' or p_expense_date > current_date + 366 then
    perform private.fail('SM422', 'Expense date must be between 2000 and one year from today');
  end if;
  if p_split_method is null or p_split_method not in ('equal', 'exact', 'percentage', 'shares', 'itemized') then
    perform private.fail('SM422', 'Unknown split method');
  end if;
end;
$$;

-- No write may push a person's balances beyond what TypeScript represents exactly
-- (SPEC §7): per person and currency, the sum of the absolute values of their
-- pairwise balances (per counterparty and context) stays within 2^53 − 1. Every
-- friend, group, dashboard or simplified figure is bounded by that sum.
create function private.assert_balance_range(p_user uuid, p_currency text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_total numeric;
begin
  select coalesce(sum(abs(p.net)), 0) into v_total
    from (
      select sum(case when l.creditor_id = p_user then l.amount else -l.amount end::numeric) as net
        from public.ledger_entries l
       where l.currency = p_currency and p_user in (l.debtor_id, l.creditor_id)
       group by case when l.creditor_id = p_user then l.debtor_id else l.creditor_id end, l.group_id
    ) p;
  if v_total > 9007199254740991 then
    perform private.fail('SM422', 'This would make a balance too large to keep track of');
  end if;
end;
$$;

create function private.check_ledger_balance_range() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_balance_range(new.debtor_id, new.currency);
  perform private.assert_balance_range(new.creditor_id, new.currency);
  return null;
end;
$$;

create trigger ledger_entries_balance_range after insert on public.ledger_entries
  for each row execute function private.check_ledger_balance_range();

revoke all on function
  private.currency_max_amount(text),
  private.assert_balance_range(uuid, text),
  private.check_ledger_balance_range()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- M3: split details must match the shares
-- ---------------------------------------------------------------------------

-- Validates what src/lib/accounting produced, without splitting anything:
--   equal       every share is floor(total / n) or one unit more;
--   percentage  every share is floor(total × bps / 10000) or one unit more;
--   shares      every share is floor(total × weight / Σ weights) or one unit more;
--   (one unit more only when the exact value isn't whole; the rounding-unit flag
--    must say who got it; exact splits have no rounding units)
--   itemized    nobody pays more than the items assigned to them plus the charges
--               (tax, service, tip), so a share can't be moved to someone else's item.
create function private.check_split_details(p_expense_id uuid, p_version integer, p_split_method text, p_amount bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
  v_weights numeric;
  v_charges numeric;
  v_bad integer;
begin
  select count(*), coalesce(sum(p.weight), 0) into v_count, v_weights
    from public.expense_participants p where p.expense_id = p_expense_id and p.version = p_version;
  if v_count = 0 then
    return;
  end if;

  if p_split_method in ('equal', 'percentage', 'shares') then
    select count(*) into v_bad
      from (
        select p.amount::numeric as amount, p.received_rounding_unit as flagged,
               case p_split_method
                 when 'equal' then p_amount::numeric / v_count
                 when 'percentage' then p_amount::numeric * coalesce(p.basis_points, 0) / 10000
                 else p_amount::numeric * coalesce(p.weight, 0) / nullif(v_weights, 0)
               end as exact
          from public.expense_participants p
         where p.expense_id = p_expense_id and p.version = p_version
      ) s
     where s.exact is null
        or not (
          (s.amount = floor(s.exact) and not s.flagged)
          or (s.amount = floor(s.exact) + 1 and s.exact <> floor(s.exact) and s.flagged)
        );
  elsif p_split_method = 'exact' then
    select count(*) into v_bad from public.expense_participants p
     where p.expense_id = p_expense_id and p.version = p_version and p.received_rounding_unit;
  else
    select coalesce(sum(i.amount), 0) into v_charges from public.expense_items i
     where i.expense_id = p_expense_id and i.version = p_version and i.kind in ('tax', 'service', 'tip');
    select count(*) into v_bad
      from public.expense_participants p
     where p.expense_id = p_expense_id and p.version = p_version
       and p.amount > v_charges + coalesce((
             select sum(i.amount) from public.expense_items i
               join public.expense_item_assignments a on a.item_id = i.id
              where i.expense_id = p_expense_id and i.version = p_version and i.kind = 'item'
                and a.user_id = p.user_id
           ), 0);
  end if;

  if v_bad > 0 then
    perform private.fail('SM422', 'The shares don''t match the split method');
  end if;
end;
$$;

revoke all on function private.check_split_details(uuid, integer, text, bigint) from public, anon, authenticated;

create or replace function private.write_expense_version(
  p_expense_id uuid,
  p_version integer,
  p_group_id uuid,
  p_currency text,
  p_amount bigint,
  p_split_method text,
  p_payers jsonb,
  p_participants jsonb,
  p_items jsonb,
  p_ledger_entries jsonb
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb;
  v_assignment jsonb;
  v_user uuid;
  v_amount bigint;
  v_sum numeric;
  v_payer_users uuid[] := '{}'::uuid[];
  v_participant_users uuid[] := '{}'::uuid[];
  v_involved uuid[];
  v_item_users uuid[];
  v_bps integer;
  v_bps_sum integer := 0;
  v_bps_count integer := 0;
  v_weight integer;
  v_weight_count integer := 0;
  v_position integer;
  v_kind text;
  v_allocation text;
  v_item_id uuid;
  v_items_total numeric := 0;
  v_charges numeric := 0;
  v_discounts numeric := 0;
  v_debtor uuid;
  v_creditor uuid;
  v_pairs text[] := '{}'::text[];
  v_mismatches integer;
begin
  -- Payers: unique, positive, adding up to the amount.
  v_sum := 0;
  for v_row in select value from jsonb_array_elements(p_payers) loop
    v_user := private.json_uuid(v_row, 'user_id');
    v_amount := private.json_amount(v_row, 'amount', false);
    if v_user = any (v_payer_users) then
      perform private.fail('SM422', 'A payer is listed more than once');
    end if;
    v_payer_users := v_payer_users || v_user;
    v_sum := v_sum + v_amount;
    insert into public.expense_payers (expense_id, version, user_id, amount, currency)
    values (p_expense_id, p_version, v_user, v_amount, p_currency);
  end loop;
  if v_sum <> p_amount then
    perform private.fail('SM422', 'Payers must add up to the expense amount');
  end if;

  -- Participants: unique, non-negative shares adding up to the amount.
  v_sum := 0;
  for v_row in select value from jsonb_array_elements(p_participants) loop
    v_user := private.json_uuid(v_row, 'user_id');
    v_amount := private.json_amount(v_row, 'amount', true);
    v_bps := private.json_int(v_row, 'basis_points', 0, 10000);
    v_weight := private.json_int(v_row, 'weight', 1, 1000000);
    if v_user = any (v_participant_users) then
      perform private.fail('SM422', 'A participant is listed more than once');
    end if;
    v_participant_users := v_participant_users || v_user;
    v_sum := v_sum + v_amount;
    if v_bps is not null then
      v_bps_sum := v_bps_sum + v_bps;
      v_bps_count := v_bps_count + 1;
    end if;
    if v_weight is not null then
      v_weight_count := v_weight_count + 1;
    end if;
    insert into public.expense_participants
      (expense_id, version, user_id, amount, currency, basis_points, weight, received_rounding_unit)
    values
      (p_expense_id, p_version, v_user, v_amount, p_currency, v_bps, v_weight,
       private.json_bool(v_row, 'received_rounding_unit'));
  end loop;
  if v_sum <> p_amount then
    perform private.fail('SM422', 'Shares must add up to the expense amount');
  end if;
  if p_split_method = 'percentage'
     and (v_bps_count <> cardinality(v_participant_users) or v_bps_sum <> 10000) then
    perform private.fail('SM422', 'Percentages must add up to 100%');
  end if;
  if p_split_method = 'shares' and v_weight_count <> cardinality(v_participant_users) then
    perform private.fail('SM422', 'Every participant needs a number of shares');
  end if;

  -- Items and adjustments (itemized bills only).
  if p_split_method = 'itemized' then
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
      perform private.fail('SM422', 'An itemized expense needs items');
    end if;
    if jsonb_array_length(p_items) > 200 then
      perform private.fail('SM422', 'An itemized expense can have at most 200 lines');
    end if;
  elsif p_items is not null and jsonb_typeof(p_items) <> 'null' and p_items <> '[]'::jsonb then
    perform private.fail('SM422', 'Only itemized expenses have items');
  end if;

  for v_row, v_position in
    select value, (ordinality - 1)::integer
      from jsonb_array_elements(case when p_split_method = 'itemized' then p_items else '[]'::jsonb end)
      with ordinality
  loop
    if jsonb_typeof(v_row) is distinct from 'object' then
      perform private.fail('SM422', 'Each item must be an object');
    end if;
    v_kind := coalesce(v_row ->> 'kind', 'item');
    if v_kind not in ('item', 'tax', 'service', 'tip', 'discount') then
      perform private.fail('SM422', 'Unknown item kind');
    end if;
    v_amount := private.json_amount(v_row, 'amount', false);
    v_allocation := case when v_kind = 'item' then null else coalesce(v_row ->> 'allocation', 'proportional') end;
    if v_allocation is not null and v_allocation not in ('proportional', 'equal') then
      perform private.fail('SM422', 'Allocation must be proportional or equal');
    end if;

    insert into public.expense_items (expense_id, version, position, kind, name, amount, allocation)
    values (p_expense_id, p_version, v_position, v_kind,
            coalesce(nullif(btrim(v_row ->> 'name'), ''), initcap(v_kind)), v_amount, v_allocation)
    returning id into v_item_id;

    if v_kind = 'item' then
      if jsonb_typeof(v_row -> 'assignments') is distinct from 'array'
         or jsonb_array_length(v_row -> 'assignments') = 0 then
        perform private.fail('SM422', 'Every item must be assigned to someone');
      end if;
      v_item_users := '{}'::uuid[];
      for v_assignment in select value from jsonb_array_elements(v_row -> 'assignments') loop
        v_user := private.json_uuid(v_assignment, 'user_id');
        if not (v_user = any (v_participant_users)) then
          perform private.fail('SM422', 'Items can only be assigned to participants');
        end if;
        if v_user = any (v_item_users) then
          perform private.fail('SM422', 'Someone is assigned to the same item twice');
        end if;
        v_item_users := v_item_users || v_user;
        insert into public.expense_item_assignments (item_id, user_id, weight)
        values (v_item_id, v_user, coalesce(private.json_int(v_assignment, 'weight', 1, 1000000), 1));
      end loop;
      v_items_total := v_items_total + v_amount;
    else
      if jsonb_typeof(v_row -> 'assignments') = 'array' and jsonb_array_length(v_row -> 'assignments') > 0 then
        perform private.fail('SM422', 'Only items can be assigned to people');
      end if;
      if v_kind = 'discount' then
        v_discounts := v_discounts + v_amount;
      else
        v_charges := v_charges + v_amount;
      end if;
    end if;
  end loop;

  if p_split_method = 'itemized' then
    if v_items_total = 0 then
      perform private.fail('SM422', 'An itemized expense needs at least one item');
    end if;
    if v_discounts > v_items_total then
      perform private.fail('SM422', 'Discounts cannot exceed the item total');
    end if;
    if v_items_total + v_charges - v_discounts <> p_amount then
      perform private.fail('SM422', 'Items, charges and discounts must add up to the expense amount');
    end if;
  end if;

  -- The stored split details must match the shares (review M3).
  perform private.check_split_details(p_expense_id, p_version, p_split_method, p_amount);

  -- Pairwise charge entries computed by src/lib/accounting.
  if jsonb_typeof(p_ledger_entries) is distinct from 'array' then
    perform private.fail('SM422', 'Ledger entries are required');
  end if;
  if jsonb_array_length(p_ledger_entries) > 10000 then
    perform private.fail('SM422', 'Too many ledger entries');
  end if;
  v_involved := v_payer_users || v_participant_users;
  for v_row in select value from jsonb_array_elements(p_ledger_entries) loop
    v_debtor := private.json_uuid(v_row, 'debtor_id');
    v_creditor := private.json_uuid(v_row, 'creditor_id');
    v_amount := private.json_amount(v_row, 'amount', false);
    if v_debtor = v_creditor then
      perform private.fail('SM422', 'A ledger entry needs two different people');
    end if;
    if not (v_debtor = any (v_involved) and v_creditor = any (v_involved)) then
      perform private.fail('SM422', 'Ledger entries may only involve the expense''s payers and participants');
    end if;
    if (v_debtor::text || '>' || v_creditor::text) = any (v_pairs) then
      perform private.fail('SM422', 'Duplicate ledger entry');
    end if;
    v_pairs := v_pairs || (v_debtor::text || '>' || v_creditor::text);
    insert into public.ledger_entries
      (debtor_id, creditor_id, amount, currency, group_id, expense_id, source_version, entry_type)
    values
      (v_debtor, v_creditor, v_amount, p_currency, p_group_id, p_expense_id, p_version, 'charge');
  end loop;

  -- Each person's ledger net must equal what they paid minus their share.
  select count(*) into v_mismatches
    from (
      select d.user_id
        from (
          select p.user_id, p.amount::numeric as delta
            from public.expense_payers p where p.expense_id = p_expense_id and p.version = p_version
          union all
          select p.user_id, -p.amount
            from public.expense_participants p where p.expense_id = p_expense_id and p.version = p_version
          union all
          select l.creditor_id, -l.amount
            from public.ledger_entries l
           where l.expense_id = p_expense_id and l.source_version = p_version and l.entry_type = 'charge'
          union all
          select l.debtor_id, l.amount
            from public.ledger_entries l
           where l.expense_id = p_expense_id and l.source_version = p_version and l.entry_type = 'charge'
        ) d
       group by d.user_id
      having sum(d.delta) <> 0
    ) mismatched;
  if v_mismatches > 0 then
    perform private.fail('SM422', 'Ledger entries do not reconcile with the payers and shares');
  end if;

  -- Each entry must run from someone who owes (paid less than their share) to
  -- someone who is owed (paid more), and every debtor × creditor cell must be
  -- within one minor unit of its exact proportional value
  --   |net_debtor| × net_creditor / Σ positive nets
  -- (zero when the pair has no entry). This verifies the allocation made by
  -- src/lib/accounting without re-implementing it, so a client calling the RPC
  -- directly cannot reroute debts through other people.
  with nets as (
    select d.user_id, sum(d.delta) as net
      from (
        select p.user_id, p.amount::numeric as delta
          from public.expense_payers p where p.expense_id = p_expense_id and p.version = p_version
        union all
        select p.user_id, -p.amount
          from public.expense_participants p where p.expense_id = p_expense_id and p.version = p_version
      ) d
     group by d.user_id
  ),
  owed as (
    select sum(n.net) as total from nets n where n.net > 0
  ),
  cells as (
    select debtor.user_id as debtor_id, creditor.user_id as creditor_id,
           -debtor.net as debt, creditor.net as excess
      from nets debtor
     cross join nets creditor
     where debtor.net < 0 and creditor.net > 0
  ),
  entries as (
    select l.debtor_id, l.creditor_id, l.amount::numeric as amount
      from public.ledger_entries l
     where l.expense_id = p_expense_id and l.source_version = p_version and l.entry_type = 'charge'
  )
  select count(*) into v_mismatches
    from (
      select 1
        from entries e
       where not exists (select 1 from cells c where c.debtor_id = e.debtor_id and c.creditor_id = e.creditor_id)
      union all
      select 1
        from cells c
       cross join owed o
        left join entries e on e.debtor_id = c.debtor_id and e.creditor_id = c.creditor_id
       where abs(coalesce(e.amount, 0) * o.total - c.debt * c.excess) >= o.total
    ) wrong;
  if v_mismatches > 0 then
    perform private.fail('SM422',
      'Ledger entries must split each debt between the payers in proportion to what they overpaid');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- M4: the history covers every editable field; no empty versions
-- ---------------------------------------------------------------------------

-- Adds notes, tags, percentages and weights, and itemized lines (with assignees and
-- allocation) to the snapshot that audit events store before and after a change.
create or replace function private.expense_snapshot(p_expense_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'version', e.version,
    'status', e.status,
    'description', e.description,
    'amount', e.amount,
    'currency', e.currency,
    'expense_date', e.expense_date,
    'split_method', e.split_method,
    'category', e.category,
    'notes', e.notes,
    'tags', to_jsonb(e.tags),
    'payers', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'amount', p.amount) order by p.user_id)
        from public.expense_payers p where p.expense_id = e.id and p.version = e.version
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'amount', p.amount,
                                          'basis_points', p.basis_points, 'weight', p.weight) order by p.user_id)
        from public.expense_participants p where p.expense_id = e.id and p.version = e.version
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', i.kind, 'name', i.name, 'amount', i.amount, 'allocation', i.allocation,
               'assignees', coalesce((select jsonb_agg(a.user_id order by a.user_id)
                                        from public.expense_item_assignments a where a.item_id = i.id), '[]'::jsonb))
             order by i.position)
        from public.expense_items i where i.expense_id = e.id and i.version = e.version
    ), '[]'::jsonb)
  )
  from public.expenses e
  where e.id = p_expense_id;
$$;

create or replace function public.update_expense(
  p_expense_id uuid,
  p_expected_version integer,
  p_description text,
  p_amount bigint,
  p_currency text,
  p_expense_date date,
  p_split_method text,
  p_payers jsonb,
  p_participants jsonb,
  p_ledger_entries jsonb,
  p_items jsonb default null,
  p_category text default null,
  p_notes text default null,
  p_tags text[] default '{}'
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_expense public.expenses%rowtype;
  v_old_users uuid[];
  v_users uuid[];
  v_before jsonb;
  v_version integer;
  v_user uuid;
begin
  v_expense := private.lock_expense_for_change(p_expense_id, p_expected_version, v_uid);
  perform private.validate_expense_fields(p_description, p_amount, p_currency, p_expense_date, p_split_method);

  v_old_users := private.expense_version_users(v_expense.id, v_expense.version);
  v_users := private.payload_users(p_payers, p_participants);
  if v_expense.group_id is null and v_users <> v_old_users then
    perform private.fail('SM422', 'A direct expense stays between the same two friends');
  end if;
  perform private.require_parties(v_expense.group_id, v_uid, v_users);

  v_before := private.expense_snapshot(v_expense.id);
  v_version := v_expense.version + 1;

  begin
    perform private.reverse_expense_version(v_expense.id, v_expense.version);

    update public.expenses
       set version = v_version,
           description = btrim(p_description),
           amount = p_amount,
           currency = p_currency,
           expense_date = p_expense_date,
           split_method = p_split_method,
           category = nullif(btrim(p_category), ''),
           notes = nullif(btrim(p_notes), ''),
           tags = coalesce(p_tags, '{}'),
           updated_by = v_uid
     where id = v_expense.id;

    perform private.write_expense_version(v_expense.id, v_version, v_expense.group_id, p_currency, p_amount,
                                          p_split_method, p_payers, p_participants, p_items, p_ledger_entries);
    -- Saving without changes creates no version and no history entry (SPEC §10):
    -- the savepoint of this block undoes the write.
    if (private.expense_snapshot(v_expense.id) - 'version') = (v_before - 'version') then
      raise exception using errcode = 'SM204', message = 'Nothing changed';
    end if;
    perform private.audit(v_uid, 'expense.updated', 'expense', v_expense.id, v_expense.group_id,
                          v_before, private.expense_snapshot(v_expense.id));
  exception
    when sqlstate 'SM204' then
      return v_expense.version;
  end;

  for v_user in select distinct u from unnest(v_old_users || v_users) as u loop
    perform private.notify(v_user, 'expense_updated', v_uid, v_expense.group_id, v_expense.id, null,
      jsonb_build_object('description', btrim(p_description), 'amount', p_amount, 'currency', p_currency,
                         'previous_amount', v_expense.amount, 'previous_currency', v_expense.currency));
  end loop;
  return v_version;
end;
$$;
