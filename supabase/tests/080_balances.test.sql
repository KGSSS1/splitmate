-- Balances from the ledger: per group (sums to zero per currency), per friend
-- across groups and direct expenses, currencies kept separate, RLS respected.
begin;
select plan(9);

select tests.create_user(name) from unnest(array['alice', 'bob', 'carol', 'dave', 'erin']) as name;
select tests.make_group('Goa', 'alice', array['bob', 'carol']);
select tests.make_group('Office', 'alice', array['bob']);
select tests.make_friends('alice', 'erin');

select tests.add_equal_expense('goa-1', tests.group_id('Goa'), 'alice', 90000, array['alice', 'bob', 'carol']);
select tests.add_equal_expense('goa-2', tests.group_id('Goa'), 'bob', 30000, array['alice', 'bob']);
select tests.add_equal_expense('goa-usd', tests.group_id('Goa'), 'carol', 3000, array['alice', 'carol'], 'USD');
select tests.add_equal_expense('office', tests.group_id('Office'), 'bob', 10000, array['alice', 'bob']);
select tests.authenticate_as('alice');
select public.create_expense(tests.uid('direct'), null, 'Movie', 20000, 'INR', current_date, 'equal',
                             tests.amounts('alice', '20000'), tests.amounts('alice', '10000', 'erin', '10000'),
                             tests.debts('erin', 'alice', '10000'));

select set_eq(
  format($$ select user_id, currency, amount from public.group_balances(%L) $$, tests.group_id('Goa')),
  format($$ values (%L::uuid, 'INR'::text, 45000::bigint), (%L::uuid, 'INR', -15000), (%L::uuid, 'INR', -30000),
                   (%L::uuid, 'USD', -1500), (%L::uuid, 'USD', 1500) $$,
         tests.uid('alice'), tests.uid('bob'), tests.uid('carol'), tests.uid('alice'), tests.uid('carol')),
  'group balances per member, with INR and USD kept separate');
select is(
  (select count(*)::int from (select currency from public.group_balances(tests.group_id('Goa'))
                               group by currency having sum(amount) <> 0) unbalanced),
  0, 'group balances sum to zero in every currency');
select set_eq(
  $$ select friend_id, currency, amount from public.friend_balances() $$,
  format($$ values (%L::uuid, 'INR'::text, 10000::bigint), (%L::uuid, 'INR', 30000), (%L::uuid, 'USD', -1500),
                   (%L::uuid, 'INR', 10000) $$,
         tests.uid('bob'), tests.uid('carol'), tests.uid('carol'), tests.uid('erin')),
  'friend balances combine every shared group and direct expense, per currency');

select tests.authenticate_as('bob');
select set_eq(
  $$ select friend_id, currency, amount from public.friend_balances() $$,
  format($$ values (%L::uuid, 'INR'::text, -10000::bigint) $$, tests.uid('alice')),
  'the same friend balance seen from the other side has the opposite sign');

select tests.authenticate_as('dave');
select is((select count(*)::int from public.group_balances(tests.group_id('Goa'))), 0,
          'a non-member gets no balances for the group');
select is((select count(*)::int from public.friend_balances()), 0, 'a stranger has no friend balances');

-- Editing and cancelling through the RPCs keeps every ledger balanced.
select tests.authenticate_as('carol');
select public.cancel_expense(tests.expense_id('goa-usd'), 1);
select is((select count(*)::int from public.group_balances(tests.group_id('Goa')) where currency = 'USD'), 0,
          'cancelling the USD expense clears the USD balances');

reset role;
select is(
  (select count(*)::int from (
     select l.group_id, l.currency
       from public.ledger_entries l
      cross join lateral (values (l.creditor_id, l.amount::bigint), (l.debtor_id, -l.amount::bigint)) as u(user_id, delta)
      group by l.group_id, l.currency
     having sum(u.delta) <> 0) unbalanced),
  0, 'the whole ledger sums to zero for every group and currency');
select is(
  (select count(*)::int from public.ledger_entries where group_id is null and expense_id = tests.expense_id('direct')), 1,
  'direct expenses are recorded with no group');

select * from finish();
rollback;
