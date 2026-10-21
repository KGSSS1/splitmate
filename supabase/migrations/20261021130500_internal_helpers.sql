-- Internal helpers used by the RPC functions. None of these is executable by
-- API roles; they run inside SECURITY DEFINER functions.

-- The signed-in, non-deleted user, or SM401.
create function private.require_uid() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform private.fail('SM401', 'You must be signed in');
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.deleted_at is null) then
    perform private.fail('SM401', 'Your account is not active');
  end if;
  return v_uid;
end;
$$;

-- In-app notification, unless the recipient is the actor or turned this type off.
create function private.notify(
  p_user_id uuid,
  p_type text,
  p_actor_id uuid,
  p_group_id uuid default null,
  p_expense_id uuid default null,
  p_settlement_id uuid default null,
  p_data jsonb default '{}'
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user_id is null or p_user_id = p_actor_id then
    return;
  end if;
  if exists (
    select 1 from public.notification_preferences np
     where np.user_id = p_user_id and np.type = p_type and not np.in_app
  ) then
    return;
  end if;
  insert into public.notifications (user_id, type, actor_id, group_id, expense_id, settlement_id, data)
  values (p_user_id, p_type, p_actor_id, p_group_id, p_expense_id, p_settlement_id, coalesce(p_data, '{}'));
end;
$$;

create function private.audit(
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_group_id uuid,
  p_before jsonb,
  p_after jsonb
) returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_events (actor_id, action, entity_type, entity_id, group_id, before, after)
  values (p_actor_id, p_action, p_entity_type, p_entity_id, p_group_id, p_before, p_after);
$$;

-- ---------------------------------------------------------------------------
-- JSON payload readers (the app sends payers, shares, items and ledger rows as jsonb)
-- ---------------------------------------------------------------------------

create function private.json_uuid(p_obj jsonb, p_key text) returns uuid
language plpgsql set search_path = ''
as $$
declare
  v_text text := case when jsonb_typeof(p_obj) = 'object' then p_obj ->> p_key end;
begin
  if v_text is null or v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform private.fail('SM422', format('%s must be a user ID', p_key));
  end if;
  return v_text::uuid;
end;
$$;

-- A whole number of minor units: 1..2^53−1, or 0..2^53−1 when zero is allowed.
create function private.json_amount(p_obj jsonb, p_key text, p_allow_zero boolean) returns bigint
language plpgsql set search_path = ''
as $$
declare
  v_value numeric;
  v_min integer := 1;
begin
  if p_allow_zero then
    v_min := 0;
  end if;
  if jsonb_typeof(p_obj) is distinct from 'object' or jsonb_typeof(p_obj -> p_key) is distinct from 'number' then
    perform private.fail('SM422', format('%s must be a number', p_key));
  end if;
  v_value := (p_obj ->> p_key)::numeric;
  if v_value <> trunc(v_value) or v_value < v_min or v_value > 9007199254740991 then
    perform private.fail('SM422', format('%s must be a whole, positive amount in minor units', p_key));
  end if;
  return v_value::bigint;
end;
$$;

-- An optional integer within [p_min, p_max]; null when the key is absent or null.
create function private.json_int(p_obj jsonb, p_key text, p_min integer, p_max integer) returns integer
language plpgsql set search_path = ''
as $$
declare
  v_value numeric;
begin
  if p_obj -> p_key is null or jsonb_typeof(p_obj -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_obj -> p_key) <> 'number' then
    perform private.fail('SM422', format('%s must be a number', p_key));
  end if;
  v_value := (p_obj ->> p_key)::numeric;
  if v_value <> trunc(v_value) or v_value < p_min or v_value > p_max then
    perform private.fail('SM422', format('%s must be a whole number from %s to %s', p_key, p_min, p_max));
  end if;
  return v_value::integer;
end;
$$;

create function private.json_bool(p_obj jsonb, p_key text) returns boolean
language plpgsql set search_path = ''
as $$
begin
  if p_obj -> p_key is null or jsonb_typeof(p_obj -> p_key) = 'null' then
    return false;
  end if;
  if jsonb_typeof(p_obj -> p_key) <> 'boolean' then
    perform private.fail('SM422', format('%s must be true or false', p_key));
  end if;
  return (p_obj ->> p_key)::boolean;
end;
$$;

-- Distinct, sorted user IDs of the payers and participants in a payload.
create function private.payload_users(p_payers jsonb, p_participants jsonb) returns uuid[]
language plpgsql set search_path = ''
as $$
declare
  v_users uuid[] := '{}'::uuid[];
  v_row jsonb;
begin
  if jsonb_typeof(p_payers) is distinct from 'array' or jsonb_array_length(p_payers) = 0 then
    perform private.fail('SM422', 'At least one payer is required');
  end if;
  if jsonb_typeof(p_participants) is distinct from 'array' or jsonb_array_length(p_participants) = 0 then
    perform private.fail('SM422', 'At least one participant is required');
  end if;
  for v_row in select value from jsonb_array_elements(p_payers || p_participants) loop
    v_users := v_users || private.json_uuid(v_row, 'user_id');
  end loop;
  return array(select distinct u from unnest(v_users) as u order by u);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may take part
-- ---------------------------------------------------------------------------

-- Group: the actor and every user must be current members; their membership rows
-- are locked (FOR SHARE) so nobody can leave mid-transaction.
-- Direct (group null): exactly the actor and one accepted friend.
create function private.require_parties(p_group_id uuid, p_actor uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_all uuid[];
  v_other uuid;
  v_found integer;
begin
  if p_group_id is null then
    if cardinality(p_users) <> 2 or not (p_actor = any (p_users)) then
      perform private.fail('SM422', 'A direct expense or settlement is between you and one friend');
    end if;
    select u into v_other from unnest(p_users) as u where u <> p_actor;
    perform 1 from public.friendships f
     where f.user_low = least(p_actor, v_other) and f.user_high = greatest(p_actor, v_other)
       and f.status = 'accepted'
       for share;
    if not found then
      perform private.fail('SM403', 'You can only share expenses with friends');
    end if;
    return;
  end if;

  v_all := array(select distinct u from unnest(p_users || p_actor) as u order by u);
  perform 1 from public.group_members m
   where m.group_id = p_group_id and m.user_id = any (v_all) and m.left_at is null
   order by m.user_id
     for share;
  if not exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.user_id = p_actor and m.left_at is null
  ) then
    perform private.fail('SM403', 'You are not a member of this group');
  end if;
  select count(*) into v_found from public.group_members m
   where m.group_id = p_group_id and m.user_id = any (v_all) and m.left_at is null;
  if v_found <> cardinality(v_all) then
    perform private.fail('SM422', 'Everyone involved must be a current member of the group');
  end if;
end;
$$;

-- True when the user's balance in the group is zero in every currency.
create function private.group_balance_is_zero(p_group_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1
      from public.ledger_entries l
     where l.group_id = p_group_id and p_user_id in (l.debtor_id, l.creditor_id)
     group by l.currency
    having sum(case when l.creditor_id = p_user_id then l.amount else -l.amount end) <> 0
  );
$$;

-- ---------------------------------------------------------------------------
-- Expense versions
-- ---------------------------------------------------------------------------

-- Snapshot of the expense's current version, for audit before/after.
create function private.expense_snapshot(p_expense_id uuid) returns jsonb
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
    'payers', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'amount', p.amount) order by p.user_id)
        from public.expense_payers p where p.expense_id = e.id and p.version = e.version
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'amount', p.amount) order by p.user_id)
        from public.expense_participants p where p.expense_id = e.id and p.version = e.version
    ), '[]'::jsonb)
  )
  from public.expenses e
  where e.id = p_expense_id;
$$;

-- Validates one version's payload and writes its payers, participants, items and
-- charge entries. Split math is NOT done here (SPEC §6): the shares and pairwise
-- entries come from src/lib/accounting; this only checks the invariants.
create function private.write_expense_version(
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

  -- Pairwise charge entries computed by src/lib/accounting.
  if jsonb_typeof(p_ledger_entries) is distinct from 'array' then
    perform private.fail('SM422', 'Ledger entries are required');
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
end;
$$;

-- Reversal rows for every charge of one expense version (opposite direction, same amount).
create function private.reverse_expense_version(p_expense_id uuid, p_version integer) returns void
language sql security definer set search_path = ''
as $$
  insert into public.ledger_entries
    (debtor_id, creditor_id, amount, currency, group_id, expense_id, source_version, entry_type)
  select l.creditor_id, l.debtor_id, l.amount, l.currency, l.group_id, l.expense_id, l.source_version, 'reversal'
    from public.ledger_entries l
   where l.expense_id = p_expense_id and l.source_version = p_version and l.entry_type = 'charge'
   order by l.created_at, l.id;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
-- Re-grant the policy helpers revoked by the line above.
grant execute on function
  private.expense_version_users(uuid, integer),
  private.is_group_member(uuid),
  private.was_group_member(uuid),
  private.is_group_admin(uuid),
  private.are_friends(uuid, uuid),
  private.is_expense_party(uuid),
  private.can_view_expense(uuid),
  private.can_edit_expense(uuid),
  private.can_view_settlement(uuid),
  private.can_view_recurring(uuid),
  private.shares_context_with(uuid),
  private.receipt_expense_id(text)
to authenticated;
