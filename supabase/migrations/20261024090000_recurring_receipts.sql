-- M7: recurring expense templates, the generator and its pg_cron schedule, and
-- receipt checks (SPEC §8, §12).
--
-- A template stores the *resolved* payers, shares, items and pairwise entries
-- computed by src/lib/accounting (the same jsonb shapes as create_expense). SQL
-- validates them by writing them once inside a rolled-back block, and the
-- generator copies them into a new expense; nothing here splits an amount.

create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- Template columns
-- ---------------------------------------------------------------------------

alter table public.recurring_expenses
  add column updated_by uuid references public.profiles (id) on delete restrict,
  add column idempotency_key uuid,
  add column notes text check (notes is null or char_length(notes) <= 2000),
  add column tags text[] not null default '{}' check (private.tags_valid(tags)),
  add column items jsonb check (items is null or jsonb_typeof(items) = 'array'),
  add constraint recurring_expenses_idempotency_unique unique (created_by, idempotency_key);

-- `ended`: the schedule has no dates left before its end date.
alter table public.recurring_expenses drop constraint recurring_expenses_status_check;
alter table public.recurring_expenses add constraint recurring_expenses_status_check
  check (status in ('active', 'paused', 'cancelled', 'ended'));

create index recurring_expenses_updated_by_idx on public.recurring_expenses (updated_by);

-- A generated expense that could not be created tells the template's creator.
alter domain public.notification_type drop constraint notification_type_check;
alter domain public.notification_type add constraint notification_type_check
  check (value in (
    'group_invitation', 'member_joined', 'member_left', 'member_removed',
    'expense_added', 'expense_updated', 'expense_cancelled',
    'settlement_recorded', 'settlement_confirmed', 'settlement_rejected', 'settlement_cancelled',
    'recurring_created', 'recurring_failed', 'friend_request', 'friend_accepted'
  ));

-- ---------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------

-- The n-th date of a schedule (n = 0 is the start date). Months and years are
-- added to the *start date*, never chained, so an end-of-month start keeps its
-- day where it exists: 31 Jan → 29 Feb (2024) → 31 Mar; 29 Feb yearly → 28 Feb,
-- and 29 Feb again in leap years. Mirrors src/lib/recurring/schedule.ts.
create function private.recurring_date(p_start date, p_frequency text, p_index integer) returns date
language sql immutable set search_path = ''
as $$
  select case p_frequency
           when 'daily' then p_start + p_index
           when 'weekly' then p_start + 7 * p_index
           when 'monthly' then (p_start + make_interval(months => p_index))::date
           when 'yearly' then (p_start + make_interval(years => p_index))::date
         end;
$$;

-- The first scheduled date on or after `p_on_or_after`.
create function private.recurring_next_date(p_start date, p_frequency text, p_on_or_after date) returns date
language plpgsql set search_path = ''
as $$
declare
  v_index integer;
begin
  if p_on_or_after <= p_start then
    return p_start;
  end if;
  -- An index at or just below the answer, then step forward.
  v_index := case p_frequency
               when 'daily' then p_on_or_after - p_start
               when 'weekly' then (p_on_or_after - p_start) / 7
               when 'monthly' then greatest(0, (extract(year from p_on_or_after)::integer - extract(year from p_start)::integer) * 12
                                              + extract(month from p_on_or_after)::integer - extract(month from p_start)::integer - 1)
               when 'yearly' then greatest(0, extract(year from p_on_or_after)::integer - extract(year from p_start)::integer - 1)
             end;
  if v_index is null then
    perform private.fail('SM422', 'Unknown frequency');
  end if;
  while private.recurring_date(p_start, p_frequency, v_index) < p_on_or_after loop
    v_index := v_index + 1;
  end loop;
  return private.recurring_date(p_start, p_frequency, v_index);
end;
$$;

-- Frequency, dates and time zone of a template. The first date may be at most
-- 31 days in the past (the generator catches those up) and at most a year ahead;
-- `p_check_start` is false when an edit keeps an older start date.
create function private.validate_recurring_schedule(
  p_frequency text,
  p_start_date date,
  p_end_date date,
  p_timezone text,
  p_check_start boolean
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date;
begin
  if p_frequency is null or p_frequency not in ('daily', 'weekly', 'monthly', 'yearly') then
    perform private.fail('SM422', 'Choose how often it repeats');
  end if;
  if p_timezone is null or char_length(p_timezone) > 64
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    perform private.fail('SM422', 'Choose a valid time zone');
  end if;
  if p_start_date is null then
    perform private.fail('SM422', 'Choose the first date');
  end if;
  v_today := (now() at time zone p_timezone)::date;
  if p_check_start and (p_start_date < v_today - 31 or p_start_date > v_today + 365) then
    perform private.fail('SM422', 'The first date must be within the last 31 days or the next year');
  end if;
  if p_end_date is not null and (p_end_date < p_start_date or p_end_date > date '2100-12-31') then
    perform private.fail('SM422', 'The end date must be on or after the first date');
  end if;
end;
$$;

-- Notes and tags as create_expense stores them.
create function private.validate_notes_tags(p_notes text, p_tags text[]) returns void
language plpgsql set search_path = ''
as $$
begin
  if p_notes is not null and char_length(p_notes) > 2000 then
    perform private.fail('SM422', 'Keep notes under 2,000 characters');
  end if;
  if not private.tags_valid(coalesce(p_tags, '{}')) then
    perform private.fail('SM422', 'Use at most 20 tags of up to 40 characters');
  end if;
end;
$$;

-- Checks an expense payload with exactly the rules create_expense applies, by
-- writing it once and rolling the write back. Failures raise their SM422.
create function private.validate_expense_payload(
  p_actor uuid,
  p_group_id uuid,
  p_description text,
  p_amount bigint,
  p_currency text,
  p_date date,
  p_split_method text,
  p_payers jsonb,
  p_participants jsonb,
  p_items jsonb,
  p_ledger_entries jsonb
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  begin
    insert into public.expenses (
      group_id, created_by, updated_by, description, amount, currency, expense_date, split_method, idempotency_key
    ) values (
      p_group_id, p_actor, p_actor, btrim(p_description), p_amount, p_currency, p_date, p_split_method, gen_random_uuid()
    )
    returning id into v_id;
    perform private.write_expense_version(v_id, 1, p_group_id, p_currency, p_amount, p_split_method,
                                          p_payers, p_participants, p_items, p_ledger_entries);
    raise exception using errcode = 'SM200', message = 'validated';
  exception
    when sqlstate 'SM200' then
      null;
  end;
end;
$$;

create function private.recurring_snapshot(p_recurring_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'version', r.version,
    'status', r.status,
    'description', r.description,
    'amount', r.amount,
    'currency', r.currency,
    'category', r.category,
    'split_method', r.split_method,
    'frequency', r.frequency,
    'start_date', r.start_date,
    'end_date', r.end_date,
    'timezone', r.timezone,
    'next_occurrence_date', r.next_occurrence_date,
    'payers', r.payers,
    'participants', r.shares
  )
  from public.recurring_expenses r
  where r.id = p_recurring_id;
$$;

-- Who may change a template: for a group, its current members (their membership
-- row is locked until the change commits); for a direct template, the two friends.
create function private.require_recurring_manager(p_recurring public.recurring_expenses, p_actor uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_recurring.group_id is not null then
    perform 1 from public.group_members m
     where m.group_id = p_recurring.group_id and m.user_id = p_actor and m.left_at is null
       for share;
    if not found then
      perform private.fail('SM403', 'Only current group members can change this recurring expense');
    end if;
  elsif not (p_actor = any (private.payload_users(p_recurring.payers, p_recurring.shares))) then
    perform private.fail('SM403', 'Only the two friends involved can change this recurring expense');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Generator
-- ---------------------------------------------------------------------------

-- Creates the expense for one occurrence date, as the template's creator.
-- Returns 'created', 'exists' (another run already has this date) or 'failed'
-- (recorded on the occurrence row; the expense is rolled back).
create function private.create_recurring_occurrence(p_recurring public.recurring_expenses, p_date date)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_occurrence uuid;
  v_expense uuid;
  v_users uuid[];
  v_user uuid;
  v_creator uuid := p_recurring.created_by;
  v_error text;
begin
  insert into public.recurring_occurrences (recurring_expense_id, occurrence_date, status)
  values (p_recurring.id, p_date, 'created')
  on conflict (recurring_expense_id, occurrence_date) do nothing
  returning id into v_occurrence;
  if v_occurrence is null then
    return 'exists';
  end if;

  begin
    v_users := private.payload_users(p_recurring.payers, p_recurring.shares);
    if not exists (select 1 from public.profiles p where p.id = v_creator and p.deleted_at is null) then
      perform private.fail('SM409', 'The person who set this up no longer has an account');
    end if;
    if p_recurring.group_id is not null then
      if not exists (
        select 1 from public.group_members m
         where m.group_id = p_recurring.group_id and m.user_id = v_creator and m.left_at is null
      ) then
        perform private.fail('SM409', 'The person who set this up has left the group');
      end if;
      if (
        select count(*) from public.group_members m
         where m.group_id = p_recurring.group_id and m.user_id = any (v_users) and m.left_at is null
      ) <> cardinality(v_users) then
        perform private.fail('SM409', 'Someone in this recurring expense has left the group');
      end if;
    elsif not exists (
      select 1 from unnest(v_users) as u(user_id)
       where u.user_id <> v_creator and private.are_friends(u.user_id, v_creator)
    ) then
      perform private.fail('SM409', 'The two people in this recurring expense are no longer friends');
    end if;
    perform private.require_parties(p_recurring.group_id, v_creator, v_users);
    perform private.validate_expense_fields(p_recurring.description, p_recurring.amount, p_recurring.currency,
                                           p_date, p_recurring.split_method);

    insert into public.expenses (
      group_id, created_by, updated_by, description, amount, currency, expense_date,
      category, notes, tags, split_method, idempotency_key
    ) values (
      p_recurring.group_id, v_creator, v_creator, p_recurring.description, p_recurring.amount, p_recurring.currency,
      p_date, p_recurring.category, p_recurring.notes, p_recurring.tags, p_recurring.split_method,
      -- Deterministic, so even a replayed occurrence could never make a second expense.
      md5('splitmate-recurring:' || p_recurring.id::text || ':' || p_date::text)::uuid
    )
    returning id into v_expense;

    perform private.write_expense_version(v_expense, 1, p_recurring.group_id, p_recurring.currency,
                                          p_recurring.amount, p_recurring.split_method, p_recurring.payers,
                                          p_recurring.shares, p_recurring.items, p_recurring.ledger_entries);
    perform private.audit(v_creator, 'expense.created', 'expense', v_expense, p_recurring.group_id, null,
                          private.expense_snapshot(v_expense)
                            || jsonb_build_object('recurring_expense_id', p_recurring.id));
    -- No actor: the schedule made it, so the creator is told as well.
    foreach v_user in array v_users loop
      perform private.notify(v_user, 'recurring_created', null, p_recurring.group_id, v_expense, null,
        jsonb_build_object('description', p_recurring.description, 'amount', p_recurring.amount,
                           'currency', p_recurring.currency, 'recurring_expense_id', p_recurring.id,
                           'occurrence_date', p_date));
    end loop;

    update public.recurring_occurrences set expense_id = v_expense where id = v_occurrence;
    return 'created';
  exception
    when others then
      -- Our own SM messages are written for users; anything else is not shown.
      v_error := case when sqlstate like 'SM%' then left(sqlerrm, 500)
                      else 'Something went wrong while creating this expense' end;
      update public.recurring_occurrences set status = 'failed', error = v_error where id = v_occurrence;
      perform private.notify(v_creator, 'recurring_failed', null, p_recurring.group_id, null, null,
        jsonb_build_object('description', p_recurring.description, 'recurring_expense_id', p_recurring.id,
                           'occurrence_date', p_date, 'error', v_error));
      return 'failed';
  end;
end;
$$;

-- Creates every due occurrence (catching up missed ones, at most 100 per
-- template per run) and returns how many expenses it created. "Due" means on or
-- before today in the template's time zone at `p_now`. Safe to run any number
-- of times: the template row is locked and (template, date) is unique.
-- A failed occurrence pauses its template so it doesn't fail again every run.
create function private.generate_recurring_expenses(
  p_now timestamptz default now(),
  p_recurring_id uuid default null
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_recurring public.recurring_expenses%rowtype;
  v_today date;
  v_date date;
  v_outcome text;
  v_steps integer;
  v_created integer := 0;
begin
  for v_id in
    select r.id from public.recurring_expenses r
     where r.status = 'active'
       and r.next_occurrence_date is not null
       -- No time zone is more than a day ahead of UTC.
       and r.next_occurrence_date <= (p_now at time zone 'UTC')::date + 1
       and (p_recurring_id is null or r.id = p_recurring_id)
     order by r.next_occurrence_date, r.id
  loop
    select * into v_recurring from public.recurring_expenses r where r.id = v_id for update;
    continue when v_recurring.status <> 'active' or v_recurring.next_occurrence_date is null;
    v_today := (p_now at time zone v_recurring.timezone)::date;
    v_steps := 0;

    while v_recurring.status = 'active' and v_recurring.next_occurrence_date <= v_today and v_steps < 100 loop
      v_date := v_recurring.next_occurrence_date;
      if v_recurring.end_date is not null and v_date > v_recurring.end_date then
        exit;
      end if;
      v_outcome := private.create_recurring_occurrence(v_recurring, v_date);
      if v_outcome = 'created' then
        v_created := v_created + 1;
      elsif v_outcome = 'failed' then
        v_recurring.status := 'paused';
      end if;
      v_recurring.next_occurrence_date := private.recurring_next_date(v_recurring.start_date, v_recurring.frequency, v_date + 1);
      v_steps := v_steps + 1;
    end loop;

    if v_recurring.end_date is not null and v_recurring.next_occurrence_date > v_recurring.end_date
       and v_recurring.status = 'active' then
      v_recurring.status := 'ended';
      v_recurring.next_occurrence_date := null;
    end if;
    update public.recurring_expenses r
       set next_occurrence_date = v_recurring.next_occurrence_date, status = v_recurring.status
     where r.id = v_id;
  end loop;
  return v_created;
end;
$$;

-- The next date of a schedule that continues from `p_from`: never before the
-- start date, and always after the last date already generated.
create function private.recurring_resume_point(p_recurring public.recurring_expenses, p_from date)
returns date
language sql security definer set search_path = ''
as $$
  select private.recurring_next_date(
           p_recurring.start_date, p_recurring.frequency,
           greatest(p_from, p_recurring.start_date,
                    coalesce((select max(o.occurrence_date) + 1 from public.recurring_occurrences o
                               where o.recurring_expense_id = p_recurring.id), p_recurring.start_date)));
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create function public.create_recurring_expense(
  p_idempotency_key uuid,
  p_group_id uuid,
  p_description text,
  p_amount bigint,
  p_currency text,
  p_split_method text,
  p_payers jsonb,
  p_participants jsonb,
  p_ledger_entries jsonb,
  p_frequency text,
  p_start_date date,
  p_end_date date default null,
  p_timezone text default 'Asia/Kolkata',
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
begin
  if p_idempotency_key is null then
    perform private.fail('SM422', 'An idempotency key is required');
  end if;
  select r.id into v_id from public.recurring_expenses r
   where r.created_by = v_uid and r.idempotency_key = p_idempotency_key;
  if found then
    return v_id;
  end if;

  perform private.validate_expense_fields(p_description, p_amount, p_currency, p_start_date, p_split_method);
  perform private.validate_notes_tags(p_notes, p_tags);
  perform private.validate_recurring_schedule(p_frequency, p_start_date, p_end_date, p_timezone, true);
  v_users := private.payload_users(p_payers, p_participants);
  perform private.require_parties(p_group_id, v_uid, v_users);
  perform private.validate_expense_payload(v_uid, p_group_id, p_description, p_amount, p_currency, p_start_date,
                                           p_split_method, p_payers, p_participants, p_items, p_ledger_entries);

  insert into public.recurring_expenses (
    group_id, created_by, updated_by, idempotency_key, description, amount, currency, category, notes, tags,
    split_method, frequency, start_date, end_date, next_occurrence_date, timezone, status,
    payers, shares, ledger_entries, items
  ) values (
    p_group_id, v_uid, v_uid, p_idempotency_key, btrim(p_description), p_amount, p_currency,
    nullif(btrim(p_category), ''), nullif(btrim(p_notes), ''), coalesce(p_tags, '{}'),
    p_split_method, p_frequency, p_start_date, p_end_date, p_start_date, p_timezone, 'active',
    p_payers, p_participants, p_ledger_entries,
    case when p_split_method = 'itemized' then p_items end
  )
  on conflict (created_by, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select r.id into v_id from public.recurring_expenses r
     where r.created_by = v_uid and r.idempotency_key = p_idempotency_key;
    return v_id;
  end if;

  perform private.audit(v_uid, 'recurring.created', 'recurring_expense', v_id, p_group_id, null,
                        private.recurring_snapshot(v_id));
  -- Anything already due (a first date today or in the past) is created now.
  perform private.generate_recurring_expenses(now(), v_id);
  return v_id;
end;
$$;

-- Changes the template for future occurrences only: expenses already created
-- keep their own amounts and history. Returns the new version (unchanged when
-- nothing changed). The group or friend of a template can't change.
create function public.update_recurring_expense(
  p_recurring_id uuid,
  p_expected_version integer,
  p_description text,
  p_amount bigint,
  p_currency text,
  p_split_method text,
  p_payers jsonb,
  p_participants jsonb,
  p_ledger_entries jsonb,
  p_frequency text,
  p_start_date date,
  p_end_date date default null,
  p_timezone text default 'Asia/Kolkata',
  p_items jsonb default null,
  p_category text default null,
  p_notes text default null,
  p_tags text[] default '{}'
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_old public.recurring_expenses%rowtype;
  v_new public.recurring_expenses%rowtype;
  v_before jsonb;
begin
  select * into v_old from public.recurring_expenses r where r.id = p_recurring_id for update;
  if not found or not private.can_view_recurring(p_recurring_id) then
    perform private.fail('SM404', 'Recurring expense not found');
  end if;
  perform private.require_recurring_manager(v_old, v_uid);
  if v_old.status = 'cancelled' then
    perform private.fail('SM409', 'This recurring expense has been cancelled');
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    perform private.fail('SM409', 'This recurring expense was changed by someone else; reload and try again');
  end if;

  perform private.validate_expense_fields(p_description, p_amount, p_currency, p_start_date, p_split_method);
  perform private.validate_notes_tags(p_notes, p_tags);
  perform private.validate_recurring_schedule(p_frequency, p_start_date, p_end_date, p_timezone,
                                              p_start_date is distinct from v_old.start_date);
  perform private.require_parties(v_old.group_id, v_uid, private.payload_users(p_payers, p_participants));
  perform private.validate_expense_payload(v_uid, v_old.group_id, p_description, p_amount, p_currency, p_start_date,
                                           p_split_method, p_payers, p_participants, p_items, p_ledger_entries);

  v_new := v_old;
  v_new.description := btrim(p_description);
  v_new.amount := p_amount;
  v_new.currency := p_currency;
  v_new.category := nullif(btrim(p_category), '');
  v_new.notes := nullif(btrim(p_notes), '');
  v_new.tags := coalesce(p_tags, '{}');
  v_new.split_method := p_split_method;
  v_new.frequency := p_frequency;
  v_new.start_date := p_start_date;
  v_new.end_date := p_end_date;
  v_new.timezone := p_timezone;
  v_new.payers := p_payers;
  v_new.shares := p_participants;
  v_new.ledger_entries := p_ledger_entries;
  v_new.items := case when p_split_method = 'itemized' then p_items end;

  -- Saving without changes keeps the version (as expenses do, SPEC §10).
  if (v_new.description, v_new.amount, v_new.currency, v_new.category, v_new.notes, v_new.tags,
      v_new.split_method, v_new.frequency, v_new.start_date, v_new.end_date, v_new.timezone,
      v_new.payers, v_new.shares, v_new.ledger_entries, v_new.items)
     is not distinct from
     (v_old.description, v_old.amount, v_old.currency, v_old.category, v_old.notes, v_old.tags,
      v_old.split_method, v_old.frequency, v_old.start_date, v_old.end_date, v_old.timezone,
      v_old.payers, v_old.shares, v_old.ledger_entries, v_old.items) then
    return v_old.version;
  end if;

  -- The schedule continues after the last date already generated.
  v_new.next_occurrence_date := private.recurring_resume_point(v_new, v_new.start_date);
  if v_old.status in ('active', 'ended') then
    v_new.status := 'active';
  end if;
  if v_new.end_date is not null and v_new.next_occurrence_date > v_new.end_date then
    v_new.next_occurrence_date := null;
    if v_new.status = 'active' then
      v_new.status := 'ended';
    end if;
  end if;

  v_before := private.recurring_snapshot(p_recurring_id);
  update public.recurring_expenses r
     set description = v_new.description, amount = v_new.amount, currency = v_new.currency,
         category = v_new.category, notes = v_new.notes, tags = v_new.tags, split_method = v_new.split_method,
         frequency = v_new.frequency, start_date = v_new.start_date, end_date = v_new.end_date,
         timezone = v_new.timezone, payers = v_new.payers, shares = v_new.shares,
         ledger_entries = v_new.ledger_entries, items = v_new.items,
         next_occurrence_date = v_new.next_occurrence_date, status = v_new.status,
         version = r.version + 1, updated_by = v_uid
   where r.id = p_recurring_id;
  perform private.audit(v_uid, 'recurring.updated', 'recurring_expense', p_recurring_id, v_old.group_id,
                        v_before, private.recurring_snapshot(p_recurring_id));
  perform private.generate_recurring_expenses(now(), p_recurring_id);
  return v_old.version + 1;
end;
$$;

-- Pause ('paused'), resume ('active') or cancel ('cancelled'). Resuming skips
-- the dates that passed while paused: the schedule continues from today in the
-- template's time zone. Cancelling is final; generated expenses stay.
create function public.set_recurring_expense_status(p_recurring_id uuid, p_status text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_recurring public.recurring_expenses%rowtype;
  v_before jsonb;
  v_next date;
  v_status text := p_status;
begin
  if p_status is null or p_status not in ('active', 'paused', 'cancelled') then
    perform private.fail('SM422', 'Choose pause, resume or cancel');
  end if;
  select * into v_recurring from public.recurring_expenses r where r.id = p_recurring_id for update;
  if not found or not private.can_view_recurring(p_recurring_id) then
    perform private.fail('SM404', 'Recurring expense not found');
  end if;
  perform private.require_recurring_manager(v_recurring, v_uid);
  if v_recurring.status = 'cancelled' then
    perform private.fail('SM409', 'This recurring expense has been cancelled');
  end if;
  if v_recurring.status = p_status then
    return;
  end if;
  if v_recurring.status = 'ended' and p_status <> 'cancelled' then
    perform private.fail('SM409', 'This recurring expense has already ended');
  end if;

  v_next := v_recurring.next_occurrence_date;
  if p_status = 'active' then
    v_next := private.recurring_resume_point(v_recurring, (now() at time zone v_recurring.timezone)::date);
    if v_recurring.end_date is not null and v_next > v_recurring.end_date then
      v_next := null;
      v_status := 'ended';
    end if;
  elsif p_status = 'cancelled' then
    v_next := null;
  end if;

  v_before := private.recurring_snapshot(p_recurring_id);
  update public.recurring_expenses r
     set status = v_status, next_occurrence_date = v_next, version = r.version + 1, updated_by = v_uid
   where r.id = p_recurring_id;
  perform private.audit(v_uid,
                        case p_status when 'active' then 'recurring.resumed'
                                      when 'paused' then 'recurring.paused'
                                      else 'recurring.cancelled' end,
                        'recurring_expense', p_recurring_id, v_recurring.group_id,
                        v_before, private.recurring_snapshot(p_recurring_id));
  if v_status = 'active' then
    perform private.generate_recurring_expenses(now(), p_recurring_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Receipts: at most 10 per expense, and a row must describe the caller's upload
-- ---------------------------------------------------------------------------

alter table public.attachments
  add column file_name text check (file_name is null or char_length(file_name) between 1 and 200);
grant insert (file_name) on public.attachments to authenticated;

create function private.check_attachment() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Serializes uploads to one expense so the limit can't be raced.
  perform pg_advisory_xact_lock(hashtext('splitmate:attachments:' || new.expense_id::text));
  if (select count(*) from public.attachments a where a.expense_id = new.expense_id) >= 10 then
    perform private.fail('SM422', 'An expense can have at most 10 receipts');
  end if;
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'receipts' and o.name = new.storage_path and o.owner_id = new.uploaded_by::text
  ) then
    perform private.fail('SM422', 'Upload the file before attaching it');
  end if;
  return new;
end;
$$;

create trigger attachments_check before insert on public.attachments
  for each row execute function private.check_attachment();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.recurring_date(date, text, integer),
  private.recurring_next_date(date, text, date),
  private.validate_recurring_schedule(text, date, date, text, boolean),
  private.validate_notes_tags(text, text[]),
  private.validate_expense_payload(uuid, uuid, text, bigint, text, date, text, jsonb, jsonb, jsonb, jsonb),
  private.recurring_snapshot(uuid),
  private.require_recurring_manager(public.recurring_expenses, uuid),
  private.create_recurring_occurrence(public.recurring_expenses, date),
  private.generate_recurring_expenses(timestamptz, uuid),
  private.recurring_resume_point(public.recurring_expenses, date),
  private.check_attachment()
from public, anon, authenticated;

revoke all on function
  public.create_recurring_expense(uuid, uuid, text, bigint, text, text, jsonb, jsonb, jsonb, text, date, date, text, jsonb, text, text, text[]),
  public.update_recurring_expense(uuid, integer, text, bigint, text, text, jsonb, jsonb, jsonb, text, date, date, text, jsonb, text, text, text[]),
  public.set_recurring_expense_status(uuid, text)
from public, anon;
grant execute on function
  public.create_recurring_expense(uuid, uuid, text, bigint, text, text, jsonb, jsonb, jsonb, text, date, date, text, jsonb, text, text, text[]),
  public.update_recurring_expense(uuid, integer, text, bigint, text, text, jsonb, jsonb, jsonb, text, date, date, text, jsonb, text, text, text[]),
  public.set_recurring_expense_status(uuid, text)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schedule: hourly, so a template is created soon after midnight in its own
-- time zone (a once-a-day UTC run would be most of a day late west of UTC).
-- Re-running is harmless. Run it by hand with `npm run db:recurring`.
-- ---------------------------------------------------------------------------

select cron.schedule('splitmate-recurring-expenses', '5 * * * *',
                     'select private.generate_recurring_expenses()');
