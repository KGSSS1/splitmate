-- Review M6, batch 2 (docs/reviews/review-M6.md): idempotency keys are scoped to their
-- creator (M12) and pairwise balances net debts in both directions (M16).
begin;
select plan(13);

select tests.create_user(name) from unnest(array['alice', 'bob', 'carol']) as name;
select tests.make_group('Flat', 'alice', array['bob', 'carol']);
select tests.make_friends('alice', 'bob');
select tests.make_friends('carol', 'bob');

-- ---------------------------------------------------------------- M12: one key, two people
create temp table seen (label text primary key, id uuid);
grant all on seen to authenticated;

select tests.authenticate_as('alice');
insert into seen select 'alice-expense', public.create_expense(
  tests.uid('shared'), tests.group_id('Flat'), 'Alice''s dinner', 90000, 'INR', current_date, 'equal',
  tests.amounts('alice', '90000'), tests.amounts('alice', '30000', 'bob', '30000', 'carol', '30000'),
  tests.debts('bob', 'alice', '30000', 'carol', 'alice', '30000'));

select tests.authenticate_as('bob');
insert into seen select 'bob-expense', public.create_expense(
  tests.uid('shared'), tests.group_id('Flat'), 'Bob''s taxi', 12000, 'INR', current_date, 'equal',
  tests.amounts('bob', '12000'), tests.amounts('bob', '6000', 'alice', '6000'),
  tests.debts('alice', 'bob', '6000'));
select isnt((select id from seen where label = 'bob-expense'), (select id from seen where label = 'alice-expense'),
            'the same key from another person creates their own expense, not a replay of alice''s');
select is((select created_by from public.expenses where id = (select id from seen where label = 'bob-expense')),
          tests.uid('bob'), 'the new expense belongs to bob');
select is((select description from public.expenses where id = (select id from seen where label = 'bob-expense')),
          'Bob''s taxi', 'with bob''s own details');
select is(public.create_expense(
            tests.uid('shared'), tests.group_id('Flat'), 'Bob''s taxi', 12000, 'INR', current_date, 'equal',
            tests.amounts('bob', '12000'), tests.amounts('bob', '6000', 'alice', '6000'),
            tests.debts('alice', 'bob', '6000')),
          (select id from seen where label = 'bob-expense'), 'bob''s retry still returns bob''s expense');

select tests.authenticate_as('carol');
insert into seen select 'carol-settlement', public.create_settlement(
  tests.uid('pay'), tests.group_id('Flat'), tests.uid('carol'), tests.uid('alice'), 10000, 'INR');
select tests.authenticate_as('bob');
insert into seen select 'bob-settlement', public.create_settlement(
  tests.uid('pay'), tests.group_id('Flat'), tests.uid('bob'), tests.uid('alice'), 20000, 'INR');
select isnt((select id from seen where label = 'bob-settlement'), (select id from seen where label = 'carol-settlement'),
            'a settlement key reused by another person records their own settlement');
select is((select (payer_id, amount)::text from public.settlements
            where id = (select id from seen where label = 'bob-settlement')),
          (tests.uid('bob'), 20000)::text, 'with bob as payer and bob''s amount');

-- settle_up_with_friend: batch ids are scoped to their creator too.
select tests.add_equal_expense('carol-lunch', null, 'bob', 8000, array['bob', 'carol']);
select tests.authenticate_as('carol');
insert into seen select 'carol-batch', (public.settle_up_with_friend(
  tests.uid('batch'), tests.uid('bob'),
  jsonb_build_array(jsonb_build_object('group_id', null, 'currency', 'INR', 'amount', -4000))))[1];
select tests.add_equal_expense('alice-lunch', null, 'bob', 6000, array['bob', 'alice']);
select tests.authenticate_as('alice');
insert into seen select 'alice-batch', (public.settle_up_with_friend(
  tests.uid('batch'), tests.uid('bob'),
  jsonb_build_array(jsonb_build_object('group_id', null, 'currency', 'INR', 'amount', -3000))))[1];
select isnt((select id from seen where label = 'alice-batch'), (select id from seen where label = 'carol-batch'),
            'a settle-up batch key reused by another person settles their own balance');
select is((select (payer_id, receiver_id, amount)::text from public.settlements
            where id = (select id from seen where label = 'alice-batch')),
          (tests.uid('alice'), tests.uid('bob'), 3000)::text, 'alice''s batch pays bob alice''s ₹30');
reset role;  -- carol's batch isn't visible to alice
select is((select count(*)::int from public.settlements where batch_id = tests.uid('batch')), 2,
          'two batches exist under the one key, one per person');

-- ---------------------------------------------------------------- M16: debts both ways net to one row
-- In Flat: bob owes alice ₹300 (dinner) and alice owes bob ₹60 (taxi); the two settlements above
-- are pending and change nothing yet. Carol owes alice ₹300 (her ₹100 settlement is pending too).
select tests.authenticate_as('alice');
select set_eq(
  format('select debtor_id, creditor_id, currency, amount from public.group_pairwise_balances(%L)', tests.group_id('Flat')),
  format($$ values (%L::uuid, %L::uuid, 'INR'::text, 24000::bigint), (%L, %L, 'INR', 30000) $$,
         tests.uid('bob'), tests.uid('alice'), tests.uid('carol'), tests.uid('alice')),
  'group_pairwise_balances nets debts in both directions into one row per pair');
select is(
  (select amount from public.friend_group_balances(tests.uid('bob')) where group_id = tests.group_id('Flat')),
  24000::bigint, 'friend_group_balances: bob owes alice the net ₹240 in Flat');
select is(
  (select amount from public.my_pairwise_balances()
    where friend_id = tests.uid('bob') and group_id = tests.group_id('Flat')),
  24000::bigint, 'my_pairwise_balances: one netted ₹240 row for bob in Flat');
select tests.authenticate_as('bob');
select is(
  (select amount from public.my_group_balances() where group_id = tests.group_id('Flat') and currency = 'INR'),
  -24000::bigint, 'bob''s group balance is the net −₹240');

select * from finish();
rollback;
