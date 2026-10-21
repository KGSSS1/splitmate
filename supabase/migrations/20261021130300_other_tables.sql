-- Recurring expenses, attachments, comments, notifications, preferences and the audit log.
-- (exchange_rates is added only when currency conversion is implemented, M9.)

-- The template stores *resolved* payers, shares and pairwise entries computed by
-- src/lib/accounting; the scheduled generator (M7) only copies them.
create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  amount public.minor_amount not null,
  currency public.currency_code not null,
  category text check (category is null or char_length(category) between 1 and 40),
  split_method text not null check (split_method in ('equal', 'exact', 'percentage', 'shares', 'itemized')),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  start_date date not null,
  end_date date,
  next_occurrence_date date,
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  payers jsonb not null check (jsonb_typeof(payers) = 'array'),
  shares jsonb not null check (jsonb_typeof(shares) = 'array'),
  ledger_entries jsonb not null check (jsonb_typeof(ledger_entries) = 'array'),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_expenses_dates check (end_date is null or end_date >= start_date)
);

create index recurring_expenses_group_id_idx on public.recurring_expenses (group_id);
create index recurring_expenses_created_by_idx on public.recurring_expenses (created_by);
create index recurring_expenses_due_idx on public.recurring_expenses (next_occurrence_date) where status = 'active';
create trigger recurring_expenses_set_updated_at before update on public.recurring_expenses
  for each row execute function private.set_updated_at();

create table public.recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  recurring_expense_id uuid not null references public.recurring_expenses (id) on delete restrict,
  occurrence_date date not null,
  expense_id uuid references public.expenses (id) on delete restrict,
  status text not null check (status in ('created', 'skipped', 'failed')),
  error text check (error is null or char_length(error) <= 500),
  created_at timestamptz not null default now(),
  constraint recurring_occurrences_unique unique (recurring_expense_id, occurrence_date)
);

create index recurring_occurrences_expense_id_idx on public.recurring_occurrences (expense_id);

-- Receipt metadata; the file lives in the private `receipts` bucket at {expense_id}/{file}.
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete restrict,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  storage_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  constraint attachments_storage_path_unique unique (storage_path),
  constraint attachments_path_matches_expense check (
    storage_path ~ '^[0-9a-f-]{36}/[^/]{1,200}$' and split_part(storage_path, '/', 1) = expense_id::text
  )
);

create index attachments_expense_id_idx on public.attachments (expense_id);
create index attachments_uploaded_by_idx on public.attachments (uploaded_by);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete restrict,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_expense_id_idx on public.comments (expense_id, created_at);
create index comments_author_id_idx on public.comments (author_id);
create trigger comments_set_updated_at before update on public.comments
  for each row execute function private.set_updated_at();

-- Written only inside the database functions that perform the action (SPEC §15).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  type public.notification_type not null,
  actor_id uuid references public.profiles (id) on delete restrict,
  group_id uuid references public.groups (id) on delete restrict,
  expense_id uuid references public.expenses (id) on delete restrict,
  settlement_id uuid references public.settlements (id) on delete restrict,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_actor_id_idx on public.notifications (actor_id);
create index notifications_group_id_idx on public.notifications (group_id);
create index notifications_expense_id_idx on public.notifications (expense_id);
create index notifications_settlement_id_idx on public.notifications (settlement_id);

-- No row = default (in-app on, email off).
create table public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete restrict,
  type public.notification_type not null,
  in_app boolean not null default true,
  email boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, type)
);

create trigger notification_preferences_set_updated_at before update on public.notification_preferences
  for each row execute function private.set_updated_at();

-- Append-only audit log, written only by database functions.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete restrict,
  action text not null check (char_length(action) between 1 and 64),
  entity_type text not null check (
    entity_type in ('profile', 'group', 'group_member', 'group_invitation', 'expense', 'settlement', 'recurring_expense')
  ),
  entity_id uuid not null,
  group_id uuid references public.groups (id) on delete restrict,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at);
create index audit_events_group_id_idx on public.audit_events (group_id, created_at);
create index audit_events_actor_id_idx on public.audit_events (actor_id);

create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function private.prevent_mutation();
