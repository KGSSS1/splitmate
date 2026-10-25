-- M9: stored exchange rates (fetched by the database, read-only for users) and
-- account deletion with anonymization (SPEC §6, §8, §13).
begin;
select plan(42);

-- ---------------------------------------------------------------- exchange rates
select has_table('public', 'exchange_rates', 'exchange_rates exists');
select ok((select relrowsecurity from pg_class where oid = 'public.exchange_rates'::regclass), 'with RLS');
select is(
  (select array_agg(jobname order by jobname) from cron.job where jobname like 'splitmate-exchange-rates-%'),
  array['splitmate-exchange-rates-collect', 'splitmate-exchange-rates-request'],
  'the daily request and collect jobs are scheduled');

delete from public.exchange_rates;
select is(
  private.store_exchange_rates('{"base": "EUR", "date": "2026-10-23", "rates": {"INR": 106.272, "USD": 1.1193, "HUF": 366.73}}', 'frankfurter'),
  2, 'stores supported currencies only (HUF is not one)');
select is((select rate::text from public.exchange_rates where quote = 'INR'), '106.2720000000', 'the rate is kept exactly');
select is(
  private.store_exchange_rates('{"base": "EUR", "date": "2026-10-23", "rates": {"INR": 106.5}}', 'frankfurter'),
  1, 'the same day again updates instead of duplicating');
select is((select count(*)::int from public.exchange_rates where quote = 'INR'), 1, 'one row per day');
select throws_ok($$ select private.store_exchange_rates('{"base": "EUR", "date": "2026-10-24", "rates": {"INR": -1}}', 'frankfurter') $$,
                 'P0001', 'Unexpected rate for INR', 'non-positive rates are refused');
select throws_ok($$ select private.store_exchange_rates('{"base": "XXX", "rates": {}}', 'frankfurter') $$,
                 'P0001', 'Unexpected exchange-rate response', 'unknown bases are refused');
select throws_ok($$ select private.store_exchange_rates('{"base": "EUR", "date": "2026-10-24", "rates": {"RON": 5}}', 'frankfurter') $$,
                 'P0001', 'No supported rates in the response', 'a response with nothing usable is refused');

-- A response collected from pg_net: one good, one failed, one not back yet.
insert into private.exchange_rate_requests (request_id, url, requested_at) values
  (-1001, 'test', now()), (-1002, 'test', now()), (-1003, 'test', now()), (-1004, 'test', now() - interval '2 hours');
insert into net._http_response (id, status_code, content, created) values
  (-1001, 200, '{"amount":1.0,"base":"EUR","date":"2026-10-24","rates":{"INR":107.1,"JPY":176.2}}', now()),
  (-1002, 503, 'Service Unavailable', now());
select is(private.collect_exchange_rates(), 2, 'collect stores the good response');
select is(
  (select array_agg(request_id || ':' || status order by request_id desc) from private.exchange_rate_requests where request_id < 0),
  array['-1001:done', '-1002:failed', '-1003:pending', '-1004:failed'],
  'and records the failure, waits for the missing one and gives up on an old one');
select is((select error from private.exchange_rate_requests where request_id = -1002), 'HTTP 503', 'with the reason');

select tests.create_user('reader');
select tests.authenticate_as('reader');
select is(
  (select rate || '@' || rate_date from public.latest_exchange_rates() where quote = 'INR'),
  '107.1000000000@2026-10-24', 'users read the newest rate per currency, as exact text');
select throws_ok($$ insert into public.exchange_rates (provider, base, quote, rate, rate_date) values ('frankfurter', 'EUR', 'INR', 1, '2026-10-25') $$,
                 '42501', null, 'users cannot write rates');
select throws_ok($$ update public.exchange_rates set rate = 1 $$, '42501', null, 'or change them');
select throws_ok($$ select private.store_exchange_rates('{}', 'frankfurter') $$, '42501', null,
                 'or call the storing function');
select throws_ok($$ select private.request_exchange_rates() $$, '42501', null, 'or queue requests');
select tests.authenticate_anon();
select throws_ok($$ select * from public.latest_exchange_rates() $$, '42501', null, 'anonymous callers read nothing');
reset role;

-- ---------------------------------------------------------------- account deletion
select tests.create_user('gina');
select tests.create_user('hari');
select tests.create_user('ivy');
select tests.create_user('jai');
select tests.make_group('Deletion G', 'gina', array['hari', 'ivy']);
select tests.make_friends('gina', 'jai');
select tests.add_equal_expense('d1', tests.group_id('Deletion G'), 'gina', 90000, array['gina', 'hari', 'ivy']);
reset role;

select tests.authenticate_as('gina');
select throws_ok($$ select public.delete_my_account('delete') $$, 'SM422', 'Type DELETE to confirm', 'the confirmation must be exact');
select throws_ok($$ select public.delete_my_account('DELETE') $$, 'SM409', 'Settle up first: you still have a balance in a group',
                 'refused while others owe her in a group');

-- Hari and Ivy repay Gina in full (Gina records them: completed).
select public.create_settlement(tests.uid('s-hari'), tests.group_id('Deletion G'), tests.uid('hari'), tests.uid('gina'), 30000, 'INR');
select public.create_settlement(tests.uid('s-ivy'), tests.group_id('Deletion G'), tests.uid('ivy'), tests.uid('gina'), 30000, 'INR');
-- A direct expense with Jai leaves a balance outside any group.
reset role;
select tests.add_equal_expense('d2', null, 'jai', 2000, array['gina', 'jai']);
select tests.authenticate_as('gina');
select throws_ok($$ select public.delete_my_account('DELETE') $$, 'SM409', 'Settle up first: you still have a balance with a friend',
                 'refused while she owes a friend directly');
-- Jai records receiving ₹10 from Gina: completed, the direct balance is zero.
select tests.authenticate_as('jai');
select public.create_settlement(tests.uid('s-gina-jai'), null, tests.uid('gina'), tests.uid('jai'), 1000, 'INR');

-- Leftovers that deletion must clean up: a pending direct repayment (recorded by
-- its payer, so it has no balance effect), a recurring schedule, settings.
select tests.authenticate_as('gina');
select public.create_settlement(tests.uid('s-pending-direct'), null, tests.uid('gina'), tests.uid('jai'), 500, 'INR');
reset role;
insert into public.recurring_expenses (group_id, created_by, updated_by, description, amount, currency, split_method, frequency,
  start_date, payers, shares, ledger_entries, idempotency_key)
values (tests.group_id('Deletion G'), tests.uid('gina'), tests.uid('gina'), 'Rent', 90000, 'INR', 'equal', 'monthly',
  current_date + 10, '[]', '[]', '[]', tests.uid('r-gina'));
insert into public.notification_preferences (user_id, type, in_app) values (tests.uid('gina'), 'member_left', false);

select tests.authenticate_as('gina');
select lives_ok($$ select public.delete_my_account('DELETE') $$, 'with every balance settled, Gina deletes her account');
reset role;

select is((select row(display_name, email, avatar_url, deleted_at is not null)::text from public.profiles where id = tests.uid('gina')),
          row('Deleted user', null::text, null::text, true)::text, 'her profile is anonymized');
select is((select count(*)::int from auth.users where id = tests.uid('gina')), 0, 'her auth user is gone (sessions with it)');
select is((select count(*)::int from public.group_members where user_id = tests.uid('gina') and left_at is null), 0, 'she left the group');
select ok((select user_id from public.group_members where group_id = tests.group_id('Deletion G') and role = 'admin' and left_at is null)
          in (tests.uid('hari'), tests.uid('ivy')), 'and its admin role passed to a remaining member');
select is((select status from public.settlements where id = tests.settlement_id('s-pending-direct')), 'withdrawn',
          'a pending direct repayment was withdrawn');
select is((select status from public.recurring_expenses where idempotency_key = tests.uid('r-gina')), 'cancelled',
          'her recurring schedule was cancelled');
select is((select count(*)::int from public.friendships where tests.uid('gina') in (user_low, user_high)), 0, 'her friendships are removed');
select is((select count(*)::int from public.notifications where user_id = tests.uid('gina')), 0, 'and her notifications');
select is((select count(*)::int from public.notification_preferences where user_id = tests.uid('gina')), 0, 'and her settings');
select is((select count(*)::int from public.expenses where id in (tests.expense_id('d1'), tests.expense_id('d2'))), 2,
          'shared expenses stay');
select is((select count(*)::int from public.ledger_entries where tests.uid('gina') in (debtor_id, creditor_id)) > 0, true,
          'and so does the ledger');
select ok(private.group_balance_is_zero(tests.group_id('Deletion G'), tests.uid('hari'))
          and private.group_balance_is_zero(tests.group_id('Deletion G'), tests.uid('ivy')),
          'others'' balances are unchanged (settled)');
select is((select count(*)::int from public.audit_events where action = 'account.deleted' and entity_id = tests.uid('gina')), 1,
          'the deletion is audited');
select is((select count(*)::int from public.notifications where user_id = tests.uid('hari') and type = 'member_left'
            and actor_id = tests.uid('gina')), 0, 'leaving does not spam members (end_membership sends no notification)');

-- A token still held by the deleted user can do nothing.
select tests.authenticate_as('gina');
select throws_ok($$ select public.create_group('Again') $$, 'SM401', 'Your account is not active', 'her old token is refused');
select throws_ok($$ select public.delete_my_account('DELETE') $$, 'SM401', 'Your account is not active', 'or delete twice');
select is((select count(*)::int from public.group_members
            where group_id = tests.group_id('Deletion G') and user_id <> tests.uid('gina')), 0,
          'and sees no other group members any more (only her own former membership)');

-- Review M9 L1: with the friendship gone, Jai can no longer change their direct
-- expense with her, which would leave a balance nobody could settle.
select tests.authenticate_as('jai');
select throws_ok(format($$ select public.cancel_expense(%L, 1) $$, tests.expense_id('d2')),
                 'SM409', 'You are no longer friends, so this expense can no longer be changed',
                 'a direct expense with a deleted account is frozen');

select tests.authenticate_anon();
select throws_ok($$ select public.delete_my_account('DELETE') $$, '42501', null, 'anonymous callers cannot call it');

select * from finish();
rollback;
