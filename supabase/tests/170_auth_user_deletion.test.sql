-- Auth users deleted outside the app: the profile is anonymized and its email
-- freed, so the address can sign up again (found on staging 2026-10-24).
begin;
select plan(9);

select tests.create_user('gone');
select tests.create_user('kept');
select tests.make_group('Leftovers', 'kept', array['gone']);
select tests.add_equal_expense('leftover', tests.group_id('Leftovers'), 'kept', 1000, array['kept', 'gone']);
reset role;

-- ---------------------------------------------------------------- deleted from the dashboard
delete from auth.users where id = tests.uid('gone');
select is(
  (select row(email, display_name, avatar_url, deleted_at is not null)::text from public.profiles where id = tests.uid('gone')),
  row(null::text, 'Deleted user', null::text, true)::text,
  'deleting the auth user anonymizes its profile');
select is((select count(*)::int from public.expense_participants where user_id = tests.uid('gone')), 1,
          'its expense history stays');
select is((select sum(amount)::bigint from public.ledger_entries where debtor_id = tests.uid('gone')), 500::bigint,
          'and so does the ledger');
select lives_ok($$ select tests.create_user('gone-again', 'gone@tests.local') $$,
                'the same email can sign up again');
select is((select email from public.profiles where id = tests.uid('gone-again')), 'gone@tests.local',
          'and gets a fresh profile');

-- ---------------------------------------------------------------- a profile already orphaned
insert into public.profiles (id, email, display_name) values (tests.uid('orphan'), 'orphan@tests.local', 'Orphan');
select lives_ok($$ select tests.create_user('newcomer', 'orphan@tests.local') $$,
                'an email held by a profile without an auth user is freed at sign-up');
select is((select row(email, display_name)::text from public.profiles where id = tests.uid('orphan')),
          row(null::text, 'Deleted user')::text, 'that profile is anonymized');

-- ---------------------------------------------------------------- live accounts are untouched
select throws_ok($$ select tests.create_user('impostor', 'kept@tests.local') $$,
                 '23505', 'duplicate key value violates unique constraint "users_email_partial_key"',
                 'an email of a live account is still refused');
select is((select row(email, deleted_at)::text from public.profiles where id = tests.uid('kept')),
          row('kept@tests.local', null::timestamptz)::text, 'and that account keeps its profile');

select * from finish();
rollback;
