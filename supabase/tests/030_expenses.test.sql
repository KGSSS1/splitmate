-- Expense RPCs: create / edit / cancel, idempotency, invariant validation,
-- version checks, reversals, audit events and notifications.
begin;
select plan(44);

select tests.create_user(name) from unnest(array['alice', 'bob', 'carol', 'dave', 'erin', 'frank']) as name;
select tests.make_group('Trip', 'alice', array['bob', 'carol']);
select tests.make_group('Checks', 'alice', array['bob', 'carol']);
select tests.make_friends('alice', 'erin');

-- Shorthand used below: the equal ₹900 split among alice, bob, carol.
create temp table payload as
select tests.amounts('alice', '30000', 'bob', '30000', 'carol', '30000') as shares,
       tests.debts('bob', 'alice', '30000', 'carol', 'alice', '30000') as debts;
grant select on payload to authenticated;

-- ---------------------------------------------------------------- create (SPEC §7 mandatory case)
select tests.authenticate_as('alice');
select lives_ok(
  format($$ select public.create_expense(%L, %L, 'Dinner', 90000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.uid('e1'), tests.group_id('Trip'), tests.amounts('alice', '90000'),
         (select shares from payload), (select debts from payload)),
  'a member creates an equal ₹900 expense paid by alice');
select set_eq(
  format($$ select user_id, currency, amount from public.group_balances(%L) $$, tests.group_id('Trip')),
  format($$ values (%L::uuid, 'INR'::text, 60000::bigint), (%L::uuid, 'INR', -30000), (%L::uuid, 'INR', -30000) $$,
         tests.uid('alice'), tests.uid('bob'), tests.uid('carol')),
  'balances: alice +60000, bob −30000, carol −30000 paise');
select is((select count(*)::int from public.ledger_entries where expense_id = tests.expense_id('e1')), 2,
          'two pairwise charge entries are written');
select is((select count(*)::int from public.expense_payers where expense_id = tests.expense_id('e1')), 1, 'payer row written');
select is((select count(*)::int from public.expense_participants where expense_id = tests.expense_id('e1')), 3,
          'participant rows written');

-- ---------------------------------------------------------------- idempotency
select is(
  public.create_expense(tests.uid('e1'), tests.group_id('Trip'), 'Dinner', 90000, 'INR', current_date, 'equal',
                        tests.amounts('alice', '90000'), (select shares from payload), (select debts from payload)),
  tests.expense_id('e1'), 'a retried submission with the same idempotency key returns the same expense');
select is((select count(*)::int from public.expenses where idempotency_key = tests.uid('e1')), 1,
          'duplicate submissions do not create duplicates');

-- ---------------------------------------------------------------- multi-payer (SPEC §7)
select lives_ok(
  format($$ select public.create_expense(%L, %L, 'Hotel', 90000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.uid('multi'), tests.group_id('Checks'), tests.amounts('alice', '60000', 'bob', '30000'),
         (select shares from payload), tests.debts('carol', 'alice', '30000')),
  'multi-payer: A pays ₹600 and B ₹300, the only pairwise debt is C → A ₹300');
select results_eq(
  format($$ select debtor_id, creditor_id, amount::bigint from public.ledger_entries where expense_id = %L $$, tests.expense_id('multi')),
  format($$ values (%L::uuid, %L::uuid, 30000::bigint) $$, tests.uid('carol'), tests.uid('alice')),
  'multi-payer ledger has exactly one entry');

-- ---------------------------------------------------------------- invariant validation
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 90000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Checks'), tests.amounts('alice', '80000'), (select shares from payload), (select debts from payload)),
  'SM422', 'Payers must add up to the expense amount', 'payers must add up to the amount');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 90000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Checks'), tests.amounts('alice', '90000'), tests.amounts('alice', '30000', 'bob', '30000'),
         tests.debts('bob', 'alice', '30000')),
  'SM422', 'Shares must add up to the expense amount', 'shares must add up to the amount');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 90000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Checks'), tests.amounts('alice', '90000'), (select shares from payload), tests.debts('bob', 'alice', '30000')),
  'SM422', 'Ledger entries do not reconcile with the payers and shares', 'pairwise entries must reconcile with the shares');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 90000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Checks'), tests.amounts('alice', '90000'), (select shares from payload),
         tests.debts('bob', 'alice', '30000', 'carol', 'alice', '29999', 'carol', 'bob', '1')),
  'SM422', 'Ledger entries do not reconcile with the payers and shares', 'off-by-one-paisa entries are rejected');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 90000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Checks'), tests.amounts('alice', '90000'), (select shares from payload),
         tests.debts('bob', 'alice', '30000', 'carol', 'alice', '30000', 'dave', 'alice', '1')),
  'SM422', 'Ledger entries may only involve the expense''s payers and participants', 'ledger entries cannot involve outsiders');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 90000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Checks'), tests.amounts('alice', '90000'), tests.amounts('alice', '45000', 'dave', '45000'),
         tests.debts('dave', 'alice', '45000')),
  'SM422', 'Everyone involved must be a current member of the group', 'every participant must be a current member');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 0, 'INR', current_date, 'equal', %L, %L, '[]') $$,
         tests.group_id('Checks'), tests.amounts('alice', '0'), tests.amounts('alice', '0')),
  'SM422', 'Amount must be a positive whole number of minor units', 'zero amounts are rejected');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 9007199254740992, 'INR', current_date, 'equal', %L, %L, '[]') $$,
         tests.group_id('Checks'), tests.amounts('alice', '9007199254740992'), tests.amounts('alice', '9007199254740992')),
  'SM422', 'Amount must be a positive whole number of minor units', 'amounts above the safe-integer limit are rejected');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 100, 'INR', current_date, 'equal', %L, %L, '[]') $$,
         tests.group_id('Checks'), '[{"user_id": "' || tests.uid('alice') || '", "amount": 100.5}]', tests.amounts('alice', '100')),
  'SM422', 'amount must be a whole, positive amount in minor units', 'fractional minor units are rejected');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 100, 'inr', current_date, 'equal', %L, %L, '[]') $$,
         tests.group_id('Checks'), tests.amounts('alice', '100'), tests.amounts('alice', '100')),
  'SM422', 'Unsupported currency', 'currency codes are validated');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 100, 'INR', current_date, 'equal', %L, %L, '[]') $$,
         tests.group_id('Checks'), tests.amounts('alice', '100'), tests.amounts('alice', '50', 'alice', '50')),
  'SM422', 'A participant is listed more than once', 'duplicate participants are rejected');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 100, 'INR', current_date, 'percentage', %L, %L, %L) $$,
         tests.group_id('Checks'), tests.amounts('alice', '100'),
         jsonb_build_array(jsonb_build_object('user_id', tests.uid('alice'), 'amount', 50, 'basis_points', 5000),
                           jsonb_build_object('user_id', tests.uid('bob'), 'amount', 50, 'basis_points', 4999)),
         tests.debts('bob', 'alice', '50')),
  'SM422', 'Percentages must add up to 100%', 'percentages must total 100%');

-- Itemized: 2 items + 18% tax line; shares as src/lib/accounting computes them.
select lives_ok(
  format($$ select public.create_expense(%L, %L, 'Restaurant', 1180, 'INR', current_date, 'itemized', %L, %L, %L, %L) $$,
         tests.uid('itemized'), tests.group_id('Checks'), tests.amounts('alice', '1180'),
         tests.amounts('alice', '708', 'bob', '472'), tests.debts('bob', 'alice', '472'),
         jsonb_build_array(
           jsonb_build_object('name', 'Biryani', 'amount', 600, 'assignments', jsonb_build_array(jsonb_build_object('user_id', tests.uid('alice')))),
           jsonb_build_object('name', 'Paneer', 'amount', 400, 'assignments', jsonb_build_array(jsonb_build_object('user_id', tests.uid('bob')))),
           jsonb_build_object('name', 'GST', 'kind', 'tax', 'amount', 180))),
  'an itemized bill with tax is accepted');
select is((select count(*)::int from public.expense_items where expense_id = tests.expense_id('itemized')), 3,
          'items and the tax line are stored');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Bad', 1180, 'INR', current_date, 'itemized', %L, %L, %L, %L) $$,
         tests.group_id('Checks'), tests.amounts('alice', '1180'), tests.amounts('alice', '708', 'bob', '472'),
         tests.debts('bob', 'alice', '472'),
         jsonb_build_array(jsonb_build_object('name', 'Biryani', 'amount', 1000,
                           'assignments', jsonb_build_array(jsonb_build_object('user_id', tests.uid('alice')))))),
  'SM422', 'Items, charges and discounts must add up to the expense amount', 'item totals must match the amount');

-- ---------------------------------------------------------------- direct expenses
select lives_ok(
  format($$ select public.create_expense(%L, null, 'Taxi', 20000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.uid('direct'), tests.amounts('alice', '20000'), tests.amounts('alice', '10000', 'erin', '10000'),
         tests.debts('erin', 'alice', '10000')),
  'a direct expense between friends is accepted');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), null, 'Taxi', 20000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.amounts('alice', '20000'), tests.amounts('alice', '10000', 'frank', '10000'), tests.debts('frank', 'alice', '10000')),
  'SM403', 'You can only share expenses with friends', 'a direct expense requires friendship');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), null, 'Taxi', 30000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.amounts('alice', '30000'), tests.amounts('alice', '10000', 'erin', '10000', 'bob', '10000'),
         tests.debts('erin', 'alice', '10000', 'bob', 'alice', '10000')),
  'SM422', 'A direct expense or settlement is between you and one friend', 'a direct expense is between exactly two people');

-- ---------------------------------------------------------------- non-member caller
select tests.authenticate_as('dave');
select throws_ok(
  format($$ select public.update_expense(%L, 1, 'Mine now', 90000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.expense_id('e1'), tests.amounts('alice', '90000'), (select shares from payload), (select debts from payload)),
  'SM403', 'Only current group members can change this expense', 'a non-member cannot edit a group expense');

-- ---------------------------------------------------------------- edit (by bob, any member may edit)
select tests.authenticate_as('bob');
select is(
  public.update_expense(tests.expense_id('e1'), 1, 'Dinner (50/25/25)', 90000, 'INR', current_date, 'percentage',
    tests.amounts('alice', '90000'),
    jsonb_build_array(jsonb_build_object('user_id', tests.uid('alice'), 'amount', 45000, 'basis_points', 5000),
                      jsonb_build_object('user_id', tests.uid('bob'), 'amount', 22500, 'basis_points', 2500),
                      jsonb_build_object('user_id', tests.uid('carol'), 'amount', 22500, 'basis_points', 2500)),
    tests.debts('bob', 'alice', '22500', 'carol', 'alice', '22500')),
  2, 'an edit returns the new version');
select set_eq(
  format($$ select user_id, currency, amount from public.group_balances(%L) $$, tests.group_id('Trip')),
  format($$ values (%L::uuid, 'INR'::text, 45000::bigint), (%L::uuid, 'INR', -22500), (%L::uuid, 'INR', -22500) $$,
         tests.uid('alice'), tests.uid('bob'), tests.uid('carol')),
  'after the edit, balances reflect only the new version');
select is((select count(*)::int from public.ledger_entries
            where expense_id = tests.expense_id('e1') and entry_type = 'reversal' and source_version = 1), 2,
          'the edit reversed both charges of version 1');
select is((select count(*)::int from public.expense_participants where expense_id = tests.expense_id('e1')), 6,
          'participant rows of both versions are kept for history');
select throws_ok(
  format($$ select public.update_expense(%L, 1, 'Stale', 90000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.expense_id('e1'), tests.amounts('alice', '90000'), (select shares from payload), (select debts from payload)),
  'SM409', 'This expense was changed by someone else; reload and try again', 'an edit based on a stale version is rejected (concurrent edit)');

-- ---------------------------------------------------------------- audit & notifications
reset role;
select is((select (p ->> 'amount')::bigint
             from public.audit_events a, jsonb_array_elements(a.after -> 'participants') p
            where a.entity_id = tests.expense_id('e1') and a.action = 'expense.updated'
              and p ->> 'user_id' = tests.uid('alice')::text),
          45000::bigint, 'the audit event records the after state');
select ok((select before is not null from public.audit_events
            where entity_id = tests.expense_id('e1') and action = 'expense.updated'),
          'the audit event records the before state');
select is((select count(*)::int from public.notifications
            where expense_id = tests.expense_id('e1') and type = 'expense_added' and user_id in (tests.uid('bob'), tests.uid('carol'))), 2,
          'participants are notified of a new expense');
select is((select count(*)::int from public.notifications
            where expense_id = tests.expense_id('e1') and user_id = tests.uid('alice') and type = 'expense_added'), 0,
          'the actor is not notified of their own action');
select is((select count(*)::int from public.notifications
            where expense_id = tests.expense_id('e1') and type = 'expense_updated'), 2,
          'everyone else involved is notified of an edit');

-- ---------------------------------------------------------------- cancel
select tests.authenticate_as('carol');
select throws_ok(format($$ select public.cancel_expense(%L, 1) $$, tests.expense_id('e1')), 'SM409', 'This expense was changed by someone else; reload and try again',
                 'cancelling with a stale version is rejected');
select lives_ok(format($$ select public.cancel_expense(%L, 2) $$, tests.expense_id('e1')), 'a member cancels the expense');
select is((select count(*)::int from public.group_balances(tests.group_id('Trip'))), 0,
          'cancelling fully reverses the expense: all balances are zero');
select throws_ok(format($$ select public.cancel_expense(%L, 2) $$, tests.expense_id('e1')), 'SM409', 'This expense has been cancelled',
                 'a cancelled expense cannot be cancelled again');
select throws_ok(
  format($$ select public.update_expense(%L, 2, 'Revive', 90000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.expense_id('e1'), tests.amounts('alice', '90000'), (select shares from payload), (select debts from payload)),
  'SM409', 'This expense has been cancelled', 'a cancelled expense cannot be edited');

-- ---------------------------------------------------------------- notification preferences
insert into public.notification_preferences (user_id, type, in_app) values (tests.uid('carol'), 'expense_added', false);
select tests.add_equal_expense('quiet', tests.group_id('Trip'), 'alice', 300, array['alice', 'bob', 'carol']);
reset role;
select is((select count(*)::int from public.notifications
            where expense_id = tests.expense_id('quiet') and user_id = tests.uid('carol')), 0,
          'a disabled notification type is not delivered');

select * from finish();
rollback;
