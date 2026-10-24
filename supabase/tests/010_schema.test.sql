-- Schema: RLS coverage, privileges, constraints, deletion rules, triggers, append-only tables.
begin;
select plan(30);

-- ---------------------------------------------------------------- coverage & privileges
select is(
  (select count(*)::int from pg_tables where schemaname = 'public'),
  20, 'all 19 SPEC §6 tables (exchange_rates deferred) and friend_email_requests exist');
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0, 'RLS is enabled on every public table');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  0, 'anon has no privileges on any public table');
select is(
  (select count(*)::int
     from unnest(array['expenses', 'expense_payers', 'expense_participants', 'expense_items',
                       'expense_item_assignments', 'settlements', 'ledger_entries', 'audit_events',
                       'groups', 'group_members', 'group_invitations', 'friendships', 'profiles',
                       'recurring_expenses', 'recurring_occurrences']) as t(name)
     cross join unnest(array['INSERT', 'DELETE']) as p(priv)
    where has_table_privilege('authenticated', 'public.' || t.name, p.priv)),
  0, 'clients cannot insert or delete financial, membership or profile rows directly');
select is(
  (select count(*)::int
     from unnest(array['expenses', 'expense_payers', 'expense_participants', 'settlements',
                       'ledger_entries', 'audit_events', 'group_members', 'friendships']) as t(name)
    where has_table_privilege('authenticated', 'public.' || t.name, 'UPDATE')),
  0, 'clients cannot update financial or membership rows directly');
select ok(
  not has_column_privilege('authenticated', 'public.group_invitations', 'token_hash', 'SELECT'),
  'clients cannot read invitation token hashes');
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'deleted_at', 'UPDATE'),
  'clients cannot change their profile email or deletion state');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0, 'anon cannot execute any SplitMate function');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c in ('search_path=""', 'search_path='))),
  0, 'every SECURITY DEFINER function pins search_path to empty');
select ok(
  not has_function_privilege('authenticated', 'private.write_expense_version(uuid, integer, uuid, text, bigint, text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.notify(uuid, text, uuid, uuid, uuid, uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.audit(uuid, text, text, uuid, uuid, jsonb, jsonb)', 'EXECUTE'),
  'internal write helpers are not callable by clients');

-- ---------------------------------------------------------------- profile triggers
select tests.create_user('mixed', 'MiXeD@Tests.Local');
select is((select email from public.profiles where id = tests.uid('mixed')), 'mixed@tests.local',
          'signup trigger creates a profile with a lower-cased email');
select is((select display_name from public.profiles where id = tests.uid('mixed')), 'Mixed',
          'display name comes from signup metadata');
select is((select default_currency::text from public.profiles where id = tests.uid('mixed')), 'INR',
          'default currency is INR');
update auth.users set email = 'renamed@tests.local' where id = tests.uid('mixed');
select is((select email from public.profiles where id = tests.uid('mixed')), 'renamed@tests.local',
          'changing the auth email updates the profile copy');

-- ---------------------------------------------------------------- domains & constraints
select throws_ok($$ select 0::public.minor_amount $$, '23514', null, 'amounts must be positive');
select throws_ok($$ select 9007199254740992::public.minor_amount $$, '23514', null,
                 'amounts above Number.MAX_SAFE_INTEGER are rejected');
select lives_ok($$ select 9007199254740991::public.minor_amount $$, 'the maximum safe amount is accepted');
select throws_ok($$ select 'inr'::public.currency_code $$, '23514', null, 'currency codes are 3 upper-case letters');

select tests.create_user('alice');
select tests.create_user('bob');
select tests.make_group('Schema group', 'alice', array['bob']);
select tests.add_equal_expense('schema-e1', tests.group_id('Schema group'), 'alice', 1000, array['alice', 'bob']);
reset role;

select throws_ok(
  format($$ insert into public.ledger_entries (debtor_id, creditor_id, amount, currency, expense_id, source_version, entry_type)
            values (%L, %L, 1, 'INR', %L, 1, 'charge') $$, tests.uid('alice'), tests.uid('alice'), tests.expense_id('schema-e1')),
  '23514', null, 'a ledger entry needs two different people');
select throws_ok(
  format($$ insert into public.ledger_entries (debtor_id, creditor_id, amount, currency, source_version, entry_type)
            values (%L, %L, 1, 'INR', 1, 'charge') $$, tests.uid('alice'), tests.uid('bob')),
  '23514', null, 'a ledger entry is linked to exactly one expense or settlement');
select throws_ok(
  format($$ insert into public.settlements (payer_id, receiver_id, amount, currency, status, created_by, idempotency_key)
            values (%L, %L, 1, 'INR', 'pending', %L, gen_random_uuid()) $$, tests.uid('bob'), tests.uid('bob'), tests.uid('bob')),
  '23514', null, 'a settlement needs two different people');
select throws_ok(
  format($$ insert into public.expenses (created_by, updated_by, description, amount, currency, expense_date, split_method, idempotency_key)
            values (%L, %L, 'Dup', 1, 'INR', current_date, 'equal', %L) $$, tests.uid('alice'), tests.uid('alice'), tests.uid('schema-e1')),
  '23505', null, 'idempotency keys are unique per creator');

-- ---------------------------------------------------------------- append-only tables
select throws_ok($$ update public.ledger_entries set amount = 1 $$, 'SM403', null,
                 'ledger entries cannot be updated, even by the owner role');
select throws_ok($$ delete from public.ledger_entries $$, 'SM403', null,
                 'ledger entries cannot be deleted, even by the owner role');
select throws_ok($$ delete from public.audit_events $$, 'SM403', null, 'audit events cannot be deleted');

-- ---------------------------------------------------------------- deletion rules
select throws_ok(format($$ delete from public.profiles where id = %L $$, tests.uid('bob')),
                 '23503', null, 'a profile with financial history cannot be deleted');
select throws_ok(format($$ delete from public.groups where id = %L $$, tests.group_id('Schema group')),
                 '23503', null, 'a group with expenses cannot be deleted');
delete from auth.users where id = tests.uid('bob');
select ok(exists (select 1 from public.profiles where id = tests.uid('bob')),
          'deleting the auth user keeps the profile, so history and balances survive');

-- ---------------------------------------------------------------- storage bucket
select is((select public from storage.buckets where id = 'receipts'), false, 'the receipts bucket is private');
select is((select file_size_limit from storage.buckets where id = 'receipts'), 5242880::bigint,
          'receipts are limited to 5 MB');

select * from finish();
rollback;
