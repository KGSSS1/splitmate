-- Expenses, versioned payer/participant/item rows, settlements and the pairwise ledger.
-- Child rows are stored per expense version and never overwritten, so the full
-- before/after history of every edit is kept. They are insert-only and have no updated_at.

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups (id) on delete restrict, -- null = direct friend expense
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid not null references public.profiles (id) on delete restrict,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  amount public.minor_amount not null,
  currency public.currency_code not null,
  expense_date date not null check (expense_date between date '2000-01-01' and date '2100-12-31'),
  category text check (category is null or char_length(category) between 1 and 40),
  notes text check (notes is null or char_length(notes) <= 2000),
  tags text[] not null default '{}' check (private.tags_valid(tags)),
  split_method text not null check (split_method in ('equal', 'exact', 'percentage', 'shares', 'itemized')),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  version integer not null default 1 check (version >= 1),
  idempotency_key uuid not null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_idempotency_unique unique (created_by, idempotency_key),
  constraint expenses_cancelled_fields check (
    (status = 'cancelled') = (cancelled_at is not null and cancelled_by is not null)
  )
);

create index expenses_group_date_idx on public.expenses (group_id, expense_date desc);
create index expenses_updated_by_idx on public.expenses (updated_by);
create index expenses_cancelled_by_idx on public.expenses (cancelled_by);
create trigger expenses_set_updated_at before update on public.expenses
  for each row execute function private.set_updated_at();

create table public.expense_payers (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete restrict,
  version integer not null check (version >= 1),
  user_id uuid not null references public.profiles (id) on delete restrict,
  amount public.minor_amount not null,
  currency public.currency_code not null,
  created_at timestamptz not null default now(),
  constraint expense_payers_unique unique (expense_id, version, user_id)
);

create index expense_payers_user_id_idx on public.expense_payers (user_id);

create table public.expense_participants (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete restrict,
  version integer not null check (version >= 1),
  user_id uuid not null references public.profiles (id) on delete restrict,
  amount public.share_amount not null,
  currency public.currency_code not null,
  basis_points integer check (basis_points between 0 and 10000), -- percentage splits
  weight integer check (weight >= 1),                             -- shares splits
  received_rounding_unit boolean not null default false,
  created_at timestamptz not null default now(),
  constraint expense_participants_unique unique (expense_id, version, user_id)
);

create index expense_participants_user_id_idx on public.expense_participants (user_id);

-- Items, plus tax / service / tip / discount lines of an itemized bill.
create table public.expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete restrict,
  version integer not null check (version >= 1),
  position integer not null check (position >= 0),
  kind text not null default 'item' check (kind in ('item', 'tax', 'service', 'tip', 'discount')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  amount public.minor_amount not null,
  allocation text check (allocation in ('proportional', 'equal')),
  created_at timestamptz not null default now(),
  constraint expense_items_position_unique unique (expense_id, version, position),
  constraint expense_items_allocation check ((kind = 'item') = (allocation is null))
);

create table public.expense_item_assignments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.expense_items (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  weight integer not null default 1 check (weight >= 1),
  created_at timestamptz not null default now(),
  constraint expense_item_assignments_unique unique (item_id, user_id)
);

create index expense_item_assignments_user_id_idx on public.expense_item_assignments (user_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups (id) on delete restrict, -- null = direct friend settlement
  payer_id uuid not null references public.profiles (id) on delete restrict,
  receiver_id uuid not null references public.profiles (id) on delete restrict,
  amount public.minor_amount not null,
  currency public.currency_code not null,
  method text not null default 'cash' check (method in ('cash', 'bank_transfer', 'upi', 'other')),
  upi_reference text check (upi_reference is null or char_length(upi_reference) between 1 and 64),
  note text check (note is null or char_length(note) <= 500),
  settled_on date not null default current_date check (settled_on between date '2000-01-01' and date '2100-12-31'),
  status text not null check (status in ('pending', 'completed', 'cancelled', 'rejected')),
  created_by uuid not null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settlements_idempotency_unique unique (created_by, idempotency_key),
  constraint settlements_two_people check (payer_id <> receiver_id),
  constraint settlements_created_by_party check (created_by in (payer_id, receiver_id)),
  constraint settlements_rejected_fields check ((status = 'rejected') = (rejected_at is not null)),
  constraint settlements_cancelled_fields check (
    (status = 'cancelled') = (cancelled_at is not null and cancelled_by is not null)
  )
);

create index settlements_group_id_idx on public.settlements (group_id);
create index settlements_payer_id_idx on public.settlements (payer_id);
create index settlements_receiver_id_idx on public.settlements (receiver_id);
create index settlements_cancelled_by_idx on public.settlements (cancelled_by);
create index settlements_status_idx on public.settlements (status);
create trigger settlements_set_updated_at before update on public.settlements
  for each row execute function private.set_updated_at();

-- The source of truth for balances (SPEC §6): pairwise, append-only rows.
-- debtor owes creditor `amount`. A reversal is the same row in the opposite direction.
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  debtor_id uuid not null references public.profiles (id) on delete restrict,
  creditor_id uuid not null references public.profiles (id) on delete restrict,
  amount public.minor_amount not null,
  currency public.currency_code not null,
  group_id uuid references public.groups (id) on delete restrict,
  expense_id uuid references public.expenses (id) on delete restrict,
  settlement_id uuid references public.settlements (id) on delete restrict,
  source_version integer not null check (source_version >= 1),
  entry_type text not null check (entry_type in ('charge', 'reversal')),
  created_at timestamptz not null default now(),
  constraint ledger_entries_two_people check (debtor_id <> creditor_id),
  constraint ledger_entries_one_source check (num_nonnulls(expense_id, settlement_id) = 1)
);

create index ledger_entries_debtor_id_idx on public.ledger_entries (debtor_id);
create index ledger_entries_creditor_id_idx on public.ledger_entries (creditor_id);
create index ledger_entries_group_currency_idx on public.ledger_entries (group_id, currency);
create index ledger_entries_expense_idx on public.ledger_entries (expense_id, source_version);
create index ledger_entries_settlement_id_idx on public.ledger_entries (settlement_id);

-- Append-only, for every role: corrections are reversing entries, never edits.
create function private.prevent_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'SM403', message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger ledger_entries_append_only before update or delete on public.ledger_entries
  for each row execute function private.prevent_mutation();
