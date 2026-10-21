-- Create, edit and cancel expenses (SPEC §6 "Transactions").
--
-- Payload shapes (computed by src/lib/accounting on the server, never in the browser):
--   p_payers         [{ "user_id": uuid, "amount": int }]
--   p_participants   [{ "user_id": uuid, "amount": int, "basis_points"?: int, "weight"?: int,
--                       "received_rounding_unit"?: bool }]
--   p_items          [{ "name": text, "kind": "item"|"tax"|"service"|"tip"|"discount", "amount": int,
--                       "allocation"?: "proportional"|"equal", "assignments"?: [{ "user_id", "weight"? }] }]
--   p_ledger_entries [{ "debtor_id": uuid, "creditor_id": uuid, "amount": int }]
-- Amounts are minor units of the expense currency.

create function private.validate_expense_fields(
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

create function public.create_expense(
  p_idempotency_key uuid,
  p_group_id uuid,
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
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid;
  v_users uuid[];
  v_user uuid;
begin
  if p_idempotency_key is null then
    perform private.fail('SM422', 'An idempotency key is required');
  end if;
  -- A retried submission returns the expense that was already created.
  select e.id into v_id from public.expenses e
   where e.created_by = v_uid and e.idempotency_key = p_idempotency_key;
  if found then
    return v_id;
  end if;

  perform private.validate_expense_fields(p_description, p_amount, p_currency, p_expense_date, p_split_method);
  v_users := private.payload_users(p_payers, p_participants);
  perform private.require_parties(p_group_id, v_uid, v_users);

  insert into public.expenses (
    group_id, created_by, updated_by, description, amount, currency, expense_date,
    category, notes, tags, split_method, idempotency_key
  ) values (
    p_group_id, v_uid, v_uid, btrim(p_description), p_amount, p_currency, p_expense_date,
    nullif(btrim(p_category), ''), nullif(btrim(p_notes), ''), coalesce(p_tags, '{}'), p_split_method, p_idempotency_key
  )
  on conflict (created_by, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- A concurrent request with the same key won the race.
    select e.id into v_id from public.expenses e
     where e.created_by = v_uid and e.idempotency_key = p_idempotency_key;
    return v_id;
  end if;

  perform private.write_expense_version(v_id, 1, p_group_id, p_currency, p_amount, p_split_method,
                                        p_payers, p_participants, p_items, p_ledger_entries);
  perform private.audit(v_uid, 'expense.created', 'expense', v_id, p_group_id, null, private.expense_snapshot(v_id));
  foreach v_user in array v_users loop
    perform private.notify(v_user, 'expense_added', v_uid, p_group_id, v_id, null,
      jsonb_build_object('description', btrim(p_description), 'amount', p_amount, 'currency', p_currency));
  end loop;
  return v_id;
end;
$$;

-- Locks the expense, checks the caller may change it and that the expected
-- version is current. Returns the locked row.
create function private.lock_expense_for_change(p_expense_id uuid, p_expected_version integer, p_actor uuid)
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

-- Edits an expense: reverses every charge of the current version (copied from the
-- stored ledger rows) and writes the next version. Returns the new version number.
create function public.update_expense(
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
  perform private.audit(v_uid, 'expense.updated', 'expense', v_expense.id, v_expense.group_id,
                        v_before, private.expense_snapshot(v_expense.id));

  for v_user in select distinct u from unnest(v_old_users || v_users) as u loop
    perform private.notify(v_user, 'expense_updated', v_uid, v_expense.group_id, v_expense.id, null,
      jsonb_build_object('description', btrim(p_description), 'amount', p_amount, 'currency', p_currency,
                         'previous_amount', v_expense.amount, 'previous_currency', v_expense.currency));
  end loop;
  return v_version;
end;
$$;

-- Cancels an expense: reversal entries only; the expense and its history stay.
create function public.cancel_expense(p_expense_id uuid, p_expected_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_expense public.expenses%rowtype;
  v_before jsonb;
  v_user uuid;
begin
  v_expense := private.lock_expense_for_change(p_expense_id, p_expected_version, v_uid);
  v_before := private.expense_snapshot(v_expense.id);

  perform private.reverse_expense_version(v_expense.id, v_expense.version);
  update public.expenses
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, updated_by = v_uid
   where id = v_expense.id;

  perform private.audit(v_uid, 'expense.cancelled', 'expense', v_expense.id, v_expense.group_id,
                        v_before, private.expense_snapshot(v_expense.id));
  foreach v_user in array private.expense_version_users(v_expense.id, v_expense.version) loop
    perform private.notify(v_user, 'expense_cancelled', v_uid, v_expense.group_id, v_expense.id, null,
      jsonb_build_object('description', v_expense.description, 'amount', v_expense.amount,
                         'currency', v_expense.currency));
  end loop;
end;
$$;
