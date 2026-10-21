-- Settlement RPCs: state transitions, who may do what, idempotency,
-- "never counted twice", reversals, and the SPEC §17 E2E numbers.
begin;
select plan(33);

select tests.create_user(name) from unnest(array['alice', 'bob', 'carol', 'dave', 'erin', 'frank']) as name;
select tests.make_group('Flat', 'alice', array['bob', 'carol']);
select tests.make_friends('alice', 'erin');
select tests.add_equal_expense('dinner', tests.group_id('Flat'), 'alice', 90000, array['alice', 'bob', 'carol']);

-- ---------------------------------------------------------------- payer records → pending
select tests.authenticate_as('bob');
select lives_ok(
  format($$ select public.create_settlement(%L, %L, %L, %L, 10000, 'INR', 'upi', 'UPI-123') $$,
         tests.uid('s1'), tests.group_id('Flat'), tests.uid('bob'), tests.uid('alice')),
  'the payer records a ₹100 repayment');
select is((select status from public.settlements where id = tests.settlement_id('s1')), 'pending',
          'a settlement recorded by the payer is pending');
select is((select count(*)::int from public.ledger_entries where settlement_id = tests.settlement_id('s1')), 0,
          'a pending settlement has no balance effect');
select throws_ok(format($$ select public.confirm_settlement(%L) $$, tests.settlement_id('s1')), 'SM403', null,
                 'the payer cannot confirm their own settlement');
select throws_ok(format($$ select public.reject_settlement(%L) $$, tests.settlement_id('s1')), 'SM403', null,
                 'the payer cannot reject their own settlement');

select tests.authenticate_as('dave');
select throws_ok(format($$ select public.confirm_settlement(%L) $$, tests.settlement_id('s1')), 'SM404', null,
                 'an outsider cannot confirm a settlement');

-- ---------------------------------------------------------------- receiver confirms
select tests.authenticate_as('alice');
select lives_ok(format($$ select public.confirm_settlement(%L) $$, tests.settlement_id('s1')),
                'the receiver confirms the settlement');
select is((select status from public.settlements where id = tests.settlement_id('s1')), 'completed', 'it is completed');
select set_eq(
  format($$ select user_id, currency, amount from public.group_balances(%L) $$, tests.group_id('Flat')),
  format($$ values (%L::uuid, 'INR'::text, 50000::bigint), (%L::uuid, 'INR', -20000), (%L::uuid, 'INR', -30000) $$,
         tests.uid('alice'), tests.uid('bob'), tests.uid('carol')),
  'SPEC §17: balances update to A +₹500, B −₹200, C −₹300');
select throws_ok(format($$ select public.confirm_settlement(%L) $$, tests.settlement_id('s1')), 'SM409', null,
                 'a settlement cannot be confirmed twice');
select is((select count(*)::int from public.ledger_entries where settlement_id = tests.settlement_id('s1')), 1,
          'a settlement is never counted twice');

-- ---------------------------------------------------------------- receiver records → completed
select lives_ok(
  format($$ select public.create_settlement(%L, %L, %L, %L, 5000, 'INR', 'cash') $$,
         tests.uid('s2'), tests.group_id('Flat'), tests.uid('carol'), tests.uid('alice')),
  'the receiver records a cash repayment');
select is((select status from public.settlements where id = tests.settlement_id('s2')), 'completed',
          'a settlement recorded by the receiver completes immediately');
select is(
  public.create_settlement(tests.uid('s2'), tests.group_id('Flat'), tests.uid('carol'), tests.uid('alice'), 5000, 'INR', 'cash'),
  tests.settlement_id('s2'), 'a retried settlement with the same idempotency key returns the same settlement');
select is((select count(*)::int from public.ledger_entries where settlement_id = tests.settlement_id('s2')), 1,
          'duplicate submissions do not add ledger entries');

-- ---------------------------------------------------------------- cancel a completed settlement
select tests.authenticate_as('carol');
select lives_ok(format($$ select public.cancel_settlement(%L) $$, tests.settlement_id('s2')),
                'either party can cancel a completed settlement');
select is((select count(*)::int from public.ledger_entries
            where settlement_id = tests.settlement_id('s2') and entry_type = 'reversal'), 1,
          'cancelling a completed settlement writes a reversal');
select is((select amount from public.group_balances(tests.group_id('Flat')) where user_id = tests.uid('carol')),
          -30000::bigint, 'the cancelled settlement no longer affects balances');
select throws_ok(format($$ select public.cancel_settlement(%L) $$, tests.settlement_id('s2')), 'SM409', null,
                 'a cancelled settlement is final');

-- ---------------------------------------------------------------- withdraw / reject pending
select lives_ok(
  format($$ select public.create_settlement(%L, %L, %L, %L, 1000, 'INR') $$,
         tests.uid('s3'), tests.group_id('Flat'), tests.uid('carol'), tests.uid('alice')),
  'carol records a pending payment');
select tests.authenticate_as('alice');
select throws_ok(format($$ select public.cancel_settlement(%L) $$, tests.settlement_id('s3')), 'SM403', null,
                 'the receiver rejects rather than cancels a pending settlement');
select tests.authenticate_as('carol');
select lives_ok(format($$ select public.cancel_settlement(%L) $$, tests.settlement_id('s3')),
                'the payer can withdraw a pending settlement');
select is((select count(*)::int from public.ledger_entries where settlement_id = tests.settlement_id('s3')), 0,
          'a withdrawn settlement never touched the ledger');

select public.create_settlement(tests.uid('s4'), tests.group_id('Flat'), tests.uid('carol'), tests.uid('alice'), 2000, 'INR');
select tests.authenticate_as('alice');
select lives_ok(format($$ select public.reject_settlement(%L) $$, tests.settlement_id('s4')),
                'the receiver rejects a pending settlement');
select is((select status from public.settlements where id = tests.settlement_id('s4')), 'rejected', 'it is rejected');
select throws_ok(format($$ select public.confirm_settlement(%L) $$, tests.settlement_id('s4')), 'SM409', null,
                 'a rejected settlement cannot be confirmed later');

-- ---------------------------------------------------------------- who may settle
select throws_ok(
  format($$ select public.create_settlement(gen_random_uuid(), %L, %L, %L, 100, 'INR') $$,
         tests.group_id('Flat'), tests.uid('bob'), tests.uid('carol')),
  'SM403', null, 'only the payer or receiver can record a settlement');
select throws_ok(
  format($$ select public.create_settlement(gen_random_uuid(), %L, %L, %L, 100, 'INR') $$,
         tests.group_id('Flat'), tests.uid('alice'), tests.uid('alice')),
  'SM422', null, 'a settlement needs two different people');
select throws_ok(
  format($$ select public.create_settlement(gen_random_uuid(), %L, %L, %L, 100, 'INR') $$,
         tests.group_id('Flat'), tests.uid('dave'), tests.uid('alice')),
  'SM422', null, 'both people must be current members of the group');
select lives_ok(
  format($$ select public.create_settlement(%L, null, %L, %L, 700, 'INR') $$,
         tests.uid('direct'), tests.uid('erin'), tests.uid('alice')),
  'a direct settlement between friends is accepted');
select throws_ok(
  format($$ select public.create_settlement(gen_random_uuid(), null, %L, %L, 700, 'INR') $$,
         tests.uid('frank'), tests.uid('alice')),
  'SM403', null, 'a direct settlement requires friendship');

-- A simplified transfer between members with no direct pairwise debt is valid (SPEC §7).
select tests.authenticate_as('carol');
select lives_ok(
  format($$ select public.create_settlement(%L, %L, %L, %L, 1500, 'INR') $$,
         tests.uid('simplified'), tests.group_id('Flat'), tests.uid('bob'), tests.uid('carol')),
  'a settlement between members without a direct debt is accepted');

-- ---------------------------------------------------------------- notifications & audit
reset role;
select is((select count(*)::int from public.notifications
            where settlement_id = tests.settlement_id('s1') and user_id = tests.uid('bob') and type = 'settlement_confirmed'), 1,
          'the payer is notified when their settlement is confirmed');

select * from finish();
rollback;
