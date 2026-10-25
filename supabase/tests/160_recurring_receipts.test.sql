-- M7: recurring expense templates, the generator (idempotent, catch-up, month
-- ends), pause/resume/cancel/edit, the pg_cron schedule, and receipt access.
begin;
select plan(80);

-- ---------------------------------------------------------------- setup (as postgres)
select tests.create_user(name) from unnest(array['alice', 'bob', 'carol', 'dave', 'erin']) as name;
select tests.make_group('Flat', 'alice', array['bob', 'carol']);
select tests.make_friends('alice', 'erin');

-- Today in UTC, the zone every template here uses.
create function tests.today() returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'UTC')::date; $$;

-- A ₹ rent split equally between Alice, Bob and Carol, paid by Alice, created through the RPC.
create function tests.flat_template(
  p_key text, p_frequency text, p_start date, p_amount bigint default 30000, p_end date default null
) returns uuid
language plpgsql set search_path = ''
as $$
declare
  v_share text := (p_amount / 3)::text;
begin
  perform tests.authenticate_as('alice');
  return public.create_recurring_expense(
    tests.uid(p_key), tests.group_id('Flat'), 'Rent ' || p_key, p_amount, 'INR', 'equal',
    tests.amounts('alice', p_amount::text), tests.amounts('alice', v_share, 'bob', v_share, 'carol', v_share),
    tests.debts('bob', 'alice', v_share, 'carol', 'alice', v_share), p_frequency, p_start, p_end, 'UTC');
end;
$$;

-- The same rent inserted directly (as postgres), so schedules can start in the past.
create function tests.raw_template(p_key text, p_frequency text, p_start date, p_end date default null,
                                   p_status text default 'active')
returns uuid
language sql set search_path = ''
as $$
  insert into public.recurring_expenses (
    group_id, created_by, updated_by, idempotency_key, description, amount, currency, split_method, frequency,
    start_date, end_date, next_occurrence_date, timezone, status, payers, shares, ledger_entries
  ) values (
    tests.group_id('Flat'), tests.uid('alice'), tests.uid('alice'), tests.uid(p_key), 'Rent ' || p_key, 30000, 'INR',
    'equal', p_frequency, p_start, p_end, p_start, 'UTC', p_status,
    tests.amounts('alice', '30000'), tests.amounts('alice', '10000', 'bob', '10000', 'carol', '10000'),
    tests.debts('bob', 'alice', '10000', 'carol', 'alice', '10000'))
  returning id;
$$;

create function tests.recurring_id(p_key text) returns uuid
language sql stable security definer set search_path = ''
as $$ select id from public.recurring_expenses where idempotency_key = tests.uid(p_key); $$;

create function tests.occurrence_dates(p_key text) returns date[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(o.occurrence_date order by o.occurrence_date), '{}')
    from public.recurring_occurrences o where o.recurring_expense_id = tests.recurring_id(p_key);
$$;

create function tests.occurrence_expenses(p_key text) returns bigint
language sql stable security definer set search_path = ''
as $$
  select count(*) from public.expenses e
    join public.recurring_occurrences o on o.expense_id = e.id
   where o.recurring_expense_id = tests.recurring_id(p_key);
$$;

grant execute on all functions in schema tests to authenticated, anon;

-- ---------------------------------------------------------------- schedule arithmetic
select is(private.recurring_date('2024-01-31', 'monthly', 1), date '2024-02-29', '31 Jan monthly → 29 Feb in a leap year');
select is(private.recurring_date('2023-01-31', 'monthly', 1), date '2023-02-28', '31 Jan monthly → 28 Feb otherwise');
select is(private.recurring_date('2024-01-31', 'monthly', 2), date '2024-03-31', 'the day comes back after a short month');
select is(private.recurring_date('2024-01-31', 'monthly', 3), date '2024-04-30', '31st → 30 Apr');
select is(private.recurring_date('2024-02-29', 'yearly', 1), date '2025-02-28', '29 Feb yearly → 28 Feb');
select is(private.recurring_date('2024-02-29', 'yearly', 4), date '2028-02-29', '29 Feb yearly → 29 Feb in the next leap year');
select is(private.recurring_date('2024-01-01', 'weekly', 2), date '2024-01-15', 'weekly adds 7 days');
select is(private.recurring_next_date('2024-01-31', 'monthly', '2024-03-01'), date '2024-03-31', 'next monthly date after a short month');
select is(private.recurring_next_date('2024-01-31', 'monthly', '2024-02-29'), date '2024-02-29', 'a scheduled date counts as next');
select is(private.recurring_next_date('2024-01-01', 'weekly', '2024-01-09'), date '2024-01-15', 'next weekly date');
select is(private.recurring_next_date('2024-03-10', 'daily', '2024-01-01'), date '2024-03-10', 'nothing comes before the start');
select is(private.recurring_next_date('2023-03-15', 'yearly', '2025-03-16'), date '2026-03-15', 'next yearly date');

-- ---------------------------------------------------------------- create
select lives_ok($$ select tests.flat_template('rent', 'monthly', tests.today()) $$,
                'a member sets up a monthly rent starting today');
select is(tests.occurrence_dates('rent'), array[tests.today()], 'the first occurrence is created straight away');
select is(tests.occurrence_expenses('rent'), 1::bigint, 'with its expense');
select is(
  (select array_agg(l.debtor_id::text || '>' || l.creditor_id::text || ':' || l.amount order by l.debtor_id)
     from public.ledger_entries l
     join public.recurring_occurrences o on o.expense_id = l.expense_id
    where o.recurring_expense_id = tests.recurring_id('rent')),
  array[tests.uid('bob')::text || '>' || tests.uid('alice')::text || ':10000',
        tests.uid('carol')::text || '>' || tests.uid('alice')::text || ':10000'],
  'the generated expense copies the stored pairwise entries');
select is(
  (select e.created_by from public.expenses e
     join public.recurring_occurrences o on o.expense_id = e.id
    where o.recurring_expense_id = tests.recurring_id('rent')),
  tests.uid('alice'), 'it is created as the template''s creator');
select is((select next_occurrence_date from public.recurring_expenses where id = tests.recurring_id('rent')),
          (tests.today() + interval '1 month')::date, 'the next date is a month on');
select is(tests.flat_template('rent', 'monthly', tests.today()), tests.recurring_id('rent'),
          'a retried submission returns the same template');
select is((select count(*)::int from public.recurring_expenses where created_by = tests.uid('alice')), 1,
          'and creates nothing new');

-- ---------------------------------------------------------------- generator twice → each occurrence once
reset role;
select is(private.generate_recurring_expenses(now(), tests.recurring_id('rent')), 0, 'running the generator again creates nothing');
select is(private.generate_recurring_expenses(now(), tests.recurring_id('rent')), 0, 'nor does a third run');
select is(tests.occurrence_expenses('rent'), 1::bigint, 'still one expense for today');

-- Month ends, caught up in one run.
select tests.raw_template('month-end', 'monthly', '2024-01-31');
select is(private.generate_recurring_expenses('2024-05-01 00:00+00', tests.recurring_id('month-end')), 4,
          'a missed schedule is caught up');
select is(tests.occurrence_dates('month-end'), array[date '2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30'],
          'on the last day of shorter months');
select is(private.generate_recurring_expenses('2024-05-01 00:00+00', tests.recurring_id('month-end')), 0,
          'a second run creates nothing');
select is(tests.occurrence_expenses('month-end'), 4::bigint, 'each occurrence has exactly one expense');
select is((select array_agg(e.expense_date order by e.expense_date) from public.expenses e
             join public.recurring_occurrences o on o.expense_id = e.id
            where o.recurring_expense_id = tests.recurring_id('month-end')),
          array[date '2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30'], 'expenses are dated on the occurrence');
select is((select next_occurrence_date from public.recurring_expenses where id = tests.recurring_id('month-end')),
          date '2024-05-31', 'and the 31st comes back in May');
select is(private.generate_recurring_expenses('2024-05-30 23:59+00', tests.recurring_id('month-end')), 0,
          'nothing is due before the next date');

-- 29 February, yearly, with an end date.
select tests.raw_template('leap', 'yearly', '2024-02-29', '2027-12-31');
select is(private.generate_recurring_expenses('2028-06-01 00:00+00', tests.recurring_id('leap')), 4,
          'a yearly 29 Feb schedule runs up to its end date');
select is(tests.occurrence_dates('leap'), array[date '2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28'],
          'on 28 Feb in common years');
select is((select status || coalesce(next_occurrence_date::text, '/none')
             from public.recurring_expenses where id = tests.recurring_id('leap')),
          'ended/none', 'and then ends');

-- Time zones: due on the template's own date.
select tests.raw_template('tz', 'daily', '2024-06-02');
update public.recurring_expenses set timezone = 'Asia/Kolkata' where id = tests.recurring_id('tz');
select is(private.generate_recurring_expenses('2024-06-01 18:00+00', tests.recurring_id('tz')), 0,
          '18:00 UTC on 1 June is not yet 2 June… ');
select is(private.generate_recurring_expenses('2024-06-01 19:00+00', tests.recurring_id('tz')), 1,
          '…but 00:30 on 2 June in Kolkata is');

-- ---------------------------------------------------------------- create: validation
select lives_ok($$ select tests.flat_template('weekly', 'weekly', tests.today() - 14) $$,
                'a first date two weeks ago is allowed');
select is(tests.occurrence_dates('weekly'), array[tests.today() - 14, tests.today() - 7, tests.today()],
          'and its missed weeks are caught up at once');
select throws_ok($$ select tests.flat_template('too-old', 'weekly', tests.today() - 40) $$,
                 'SM422', 'The first date must be within the last 31 days or the next year', 'a first date long ago is refused');
select throws_ok($$ select tests.flat_template('bad-end', 'weekly', tests.today(), 30000, tests.today() - 1) $$,
                 'SM422', 'The end date must be on or after the first date', 'an end date before the start is refused');
select throws_ok($$ select tests.flat_template('bad-frequency', 'hourly', tests.today()) $$,
                 'SM422', 'Choose how often it repeats', 'an unknown frequency is refused');
select throws_ok(
  $$ select public.create_recurring_expense(tests.uid('bad-zone'), tests.group_id('Flat'), 'Rent', 30000, 'INR', 'equal',
       tests.amounts('alice', '30000'), tests.amounts('alice', '10000', 'bob', '10000', 'carol', '10000'),
       tests.debts('bob', 'alice', '10000', 'carol', 'alice', '10000'), 'monthly', tests.today(), null, 'Mars/Olympus') $$,
  'SM422', 'Choose a valid time zone', 'an unknown time zone is refused');
select throws_ok(
  $$ select public.create_recurring_expense(tests.uid('bad-split'), tests.group_id('Flat'), 'Rent', 30000, 'INR', 'equal',
       tests.amounts('alice', '30000'), tests.amounts('alice', '10000', 'bob', '10000', 'carol', '9999'),
       tests.debts('bob', 'alice', '10000', 'carol', 'alice', '9999'), 'monthly', tests.today(), null, 'UTC') $$,
  'SM422', 'Shares must add up to the expense amount', 'a split that doesn''t add up is refused, as for expenses');
select throws_ok(
  $$ select public.create_recurring_expense(tests.uid('rerouted'), tests.group_id('Flat'), 'Rent', 30000, 'INR', 'equal',
       tests.amounts('alice', '30000'), tests.amounts('alice', '10000', 'bob', '10000', 'carol', '10000'),
       tests.debts('bob', 'alice', '20000', 'carol', 'bob', '10000'), 'monthly', tests.today(), null, 'UTC') $$,
  'SM422', 'Ledger entries must split each debt between the payers in proportion to what they overpaid',
  'debts rerouted through another member are refused');
select is((select count(*)::int from public.recurring_expenses where idempotency_key in
            (tests.uid('bad-zone'), tests.uid('bad-split'), tests.uid('rerouted'))), 0,
          'refused templates leave nothing behind');
select is((select count(*)::int from public.expenses e where e.description = 'Rent' and e.created_by = tests.uid('alice')), 0,
          'and the validation write is rolled back');
select tests.authenticate_as('dave');
select throws_ok(
  $$ select public.create_recurring_expense(tests.uid('intruder'), tests.group_id('Flat'), 'Rent', 30000, 'INR', 'equal',
       tests.amounts('dave', '30000'), tests.amounts('dave', '30000'), '[]'::jsonb, 'monthly', tests.today(), null, 'UTC') $$,
  'SM403', 'You are not a member of this group', 'a non-member cannot set one up in the group');
select tests.authenticate_anon();
select throws_ok(
  $$ select public.set_recurring_expense_status(tests.recurring_id('rent'), 'paused') $$,
  '42501', 'permission denied for function set_recurring_expense_status', 'anonymous users cannot call the RPCs');

-- ---------------------------------------------------------------- visibility
select tests.authenticate_as('dave');
select is((select count(*)::int from public.recurring_expenses), 0, 'a non-member sees no templates');
select throws_ok($$ select public.set_recurring_expense_status(tests.recurring_id('rent'), 'paused') $$,
                 'SM404', 'Recurring expense not found', 'a non-member cannot pause one');
select tests.authenticate_as('bob');
select ok((select count(*)::int from public.recurring_occurrences where recurring_expense_id = tests.recurring_id('rent')) = 1,
          'a member sees the group''s occurrences');

-- ---------------------------------------------------------------- edit: future occurrences only
select tests.authenticate_as('bob');
select is(
  public.update_recurring_expense(tests.recurring_id('rent'), 1, 'Rent rent', 60000, 'INR', 'equal',
    tests.amounts('alice', '60000'), tests.amounts('alice', '20000', 'bob', '20000', 'carol', '20000'),
    tests.debts('bob', 'alice', '20000', 'carol', 'alice', '20000'), 'monthly', tests.today(), null, 'UTC'),
  2, 'any group member can edit the template');
select is((select e.amount::bigint from public.expenses e join public.recurring_occurrences o on o.expense_id = e.id
            where o.recurring_expense_id = tests.recurring_id('rent')),
          30000::bigint, 'the expense already created keeps its amount');
select is((select next_occurrence_date from public.recurring_expenses where id = tests.recurring_id('rent')),
          (tests.today() + interval '1 month')::date, 'the schedule continues after today''s occurrence');
select is(
  public.update_recurring_expense(tests.recurring_id('rent'), 2, 'Rent rent', 60000, 'INR', 'equal',
    tests.amounts('alice', '60000'), tests.amounts('alice', '20000', 'bob', '20000', 'carol', '20000'),
    tests.debts('bob', 'alice', '20000', 'carol', 'alice', '20000'), 'monthly', tests.today(), null, 'UTC'),
  2, 'saving without changes keeps the version');
select throws_ok(
  $$ select public.update_recurring_expense(tests.recurring_id('rent'), 1, 'Rent', 30000, 'INR', 'equal',
       tests.amounts('alice', '30000'), tests.amounts('alice', '10000', 'bob', '10000', 'carol', '10000'),
       tests.debts('bob', 'alice', '10000', 'carol', 'alice', '10000'), 'monthly', tests.today(), null, 'UTC') $$,
  'SM409', 'This recurring expense was changed by someone else; reload and try again', 'a stale version is refused');
reset role;
select is(private.generate_recurring_expenses(now() + interval '32 days', tests.recurring_id('rent')), 1,
          'the next month''s occurrence is created…');
select is((select e.amount::bigint from public.expenses e join public.recurring_occurrences o on o.expense_id = e.id
            where o.recurring_expense_id = tests.recurring_id('rent')
            order by o.occurrence_date desc limit 1),
          60000::bigint, '…with the new amount');

-- ---------------------------------------------------------------- pause, resume, cancel
select tests.raw_template('paused', 'daily', tests.today() - 20, null, 'paused');
select is(private.generate_recurring_expenses(now(), tests.recurring_id('paused')), 0, 'the generator skips paused templates');
select tests.authenticate_as('carol');
select lives_ok($$ select public.set_recurring_expense_status(tests.recurring_id('paused'), 'active') $$,
                'a member resumes it');
select is(tests.occurrence_dates('paused'), array[tests.today()],
          'resuming skips the days that passed while paused');
select lives_ok($$ select public.set_recurring_expense_status(tests.recurring_id('paused'), 'paused') $$, 'and pauses it again');
select lives_ok($$ select public.set_recurring_expense_status(tests.recurring_id('paused'), 'cancelled') $$, 'then cancels it');
select is((select status || coalesce(next_occurrence_date::text, '/none')
             from public.recurring_expenses where id = tests.recurring_id('paused')),
          'cancelled/none', 'a cancelled template has no next date');
select throws_ok($$ select public.set_recurring_expense_status(tests.recurring_id('paused'), 'active') $$,
                 'SM409', 'This recurring expense has been cancelled', 'cancelling is final');
select is(tests.occurrence_expenses('paused'), 1::bigint, 'the expense it made stays');
select is((select array_agg(action order by action) from public.audit_events
            where entity_id = tests.recurring_id('paused')),
          array['recurring.cancelled', 'recurring.paused', 'recurring.resumed'], 'every change is in the audit log');

-- ---------------------------------------------------------------- direct templates and failures
select tests.authenticate_as('alice');
select public.create_recurring_expense(
  tests.uid('gym'), null, 'Gym', 20000, 'INR', 'equal',
  tests.amounts('alice', '20000'), tests.amounts('alice', '10000', 'erin', '10000'),
  tests.debts('erin', 'alice', '10000'), 'monthly', tests.today() + 1, null, 'UTC');
select tests.authenticate_as('carol');
select throws_ok($$ select public.set_recurring_expense_status(tests.recurring_id('gym'), 'paused') $$,
                 'SM404', 'Recurring expense not found', 'someone outside a direct template cannot change it');
select tests.authenticate_as('erin');
select is((select count(*)::int from public.recurring_expenses where id = tests.recurring_id('gym')), 1,
          'the friend sees the direct template');
reset role;
delete from public.friendships where user_low = least(tests.uid('alice'), tests.uid('erin'))
                                 and user_high = greatest(tests.uid('alice'), tests.uid('erin'));
select is(private.generate_recurring_expenses(now() + interval '1 day', tests.recurring_id('gym')), 0,
          'an occurrence that can''t be created…');
select is((select status || ': ' || error from public.recurring_occurrences
            where recurring_expense_id = tests.recurring_id('gym')),
          'failed: The two people in this recurring expense are no longer friends', '…is recorded as failed with the reason');
select is((select status from public.recurring_expenses where id = tests.recurring_id('gym')), 'paused',
          'and pauses its template');
select is((select count(*)::int from public.notifications
            where user_id = tests.uid('alice') and type = 'recurring_failed'), 1, 'the creator is told');
select is((select count(*)::int from public.notifications
            where user_id = tests.uid('bob') and type = 'recurring_created'),
          (select count(*)::int from public.recurring_occurrences o
             join public.recurring_expenses r on r.id = o.recurring_expense_id
            where r.group_id = tests.group_id('Flat') and o.status = 'created'),
          'members are told about each expense a group schedule creates for them');

-- ---------------------------------------------------------------- privileges and schedule
select ok(not has_function_privilege('authenticated', 'private.generate_recurring_expenses(timestamptz, uuid)', 'execute'),
          'clients cannot run the generator');
select is((select schedule || ' ' || command from cron.job where jobname = 'splitmate-recurring-expenses'),
          '5 * * * * select private.generate_recurring_expenses()', 'pg_cron runs the generator every hour');

-- ---------------------------------------------------------------- receipts
select tests.authenticate_as('alice');
select tests.add_equal_expense('dinner', tests.group_id('Flat'), 'alice', 3000, array['alice', 'bob', 'carol']);
insert into storage.objects (bucket_id, name, owner_id)
select 'receipts', tests.expense_id('dinner') || '/' || tests.uid('r' || n) || '.pdf', tests.uid('alice') from generate_series(1, 11) n;
select tests.authenticate_as('bob');
select throws_ok(
  format($$ insert into public.attachments (expense_id, uploaded_by, storage_path, mime_type, size_bytes)
            values (%L, %L, %L, 'application/pdf', 1000) $$,
         tests.expense_id('dinner'), tests.uid('bob'), tests.expense_id('dinner') || '/' || tests.uid('r11') || '.pdf'),
  'SM422', 'Upload the file before attaching it', 'nobody can attach a file someone else uploaded');

select tests.authenticate_as('alice');
insert into public.attachments (expense_id, uploaded_by, storage_path, mime_type, size_bytes, file_name)
select tests.expense_id('dinner'), tests.uid('alice'), tests.expense_id('dinner') || '/' || tests.uid('r' || n) || '.pdf',
       'application/pdf', 1000, 'r' || n || '.pdf'
  from generate_series(1, 10) n;
select throws_ok(
  format($$ insert into public.attachments (expense_id, uploaded_by, storage_path, mime_type, size_bytes)
            values (%L, %L, %L, 'application/pdf', 1000) $$,
         tests.expense_id('dinner'), tests.uid('alice'), tests.expense_id('dinner') || '/' || tests.uid('r11') || '.pdf'),
  'SM422', 'An expense can have at most 10 receipts', 'an expense has at most 10 receipts');
select tests.authenticate_as('dave');
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0,
          'a non-member cannot fetch any receipt object');
select is((select count(*)::int from public.attachments), 0, 'nor see the attachment rows');
select tests.authenticate_as('carol');
select is((select count(*)::int from public.attachments where expense_id = tests.expense_id('dinner')), 10,
          'a member sees the expense''s receipts');

reset role;
select * from finish();
rollback;
