-- M6: balance read functions and friend-level "settle up everything".
begin;
select plan(44);

select tests.create_user(name) from unnest(array['alice', 'bob', 'carol', 'dave']) as name;
select tests.make_group('Flat', 'alice', array['bob', 'carol']);
select tests.add_equal_expense('dinner', tests.group_id('Flat'), 'alice', 90000, array['alice', 'bob', 'carol']);
select tests.add_equal_expense('museum', tests.group_id('Flat'), 'alice', 3000, array['alice', 'bob'], 'USD');
select tests.add_equal_expense('taxi', null, 'bob', 20000, array['bob', 'alice']);
select tests.add_equal_expense('lunch', null, 'carol', 4000, array['carol', 'alice']);

-- ---------------------------------------------------------------- read functions
select tests.authenticate_as('alice');
select set_eq(
  'select group_id, currency, amount from public.my_group_balances()',
  format($$ values (%L::uuid, 'INR'::text, 60000::bigint), (%L::uuid, 'USD', 1500) $$,
         tests.group_id('Flat'), tests.group_id('Flat')),
  'my_group_balances: the caller''s net per group and currency');
select set_eq(
  format('select group_id, currency, amount from public.friend_group_balances(%L)', tests.uid('bob')),
  format($$ values (%L::uuid, 'INR'::text, 30000::bigint), (%L::uuid, 'USD', 1500), (null::uuid, 'INR', -10000) $$,
         tests.group_id('Flat'), tests.group_id('Flat')),
  'friend_group_balances: raw pairwise balance per group (null = direct) and currency, never mixed');
select set_eq(
  format('select debtor_id, creditor_id, currency, amount from public.group_pairwise_balances(%L)', tests.group_id('Flat')),
  format($$ values (%L::uuid, %L::uuid, 'INR'::text, 30000::bigint), (%L, %L, 'INR', 30000), (%L, %L, 'USD', 1500) $$,
         tests.uid('bob'), tests.uid('alice'), tests.uid('carol'), tests.uid('alice'), tests.uid('bob'), tests.uid('alice')),
  'group_pairwise_balances: who owes whom inside the group, per currency');
select is(
  (select sum(amount)::bigint from public.friend_balances() where friend_id = tests.uid('bob') and currency = 'INR'),
  20000::bigint, 'the friend balance is the sum of the group and direct pairwise balances');

select tests.authenticate_as('bob');
select set_eq(
  format('select group_id, currency, amount from public.friend_group_balances(%L)', tests.uid('alice')),
  format($$ values (%L::uuid, 'INR'::text, -30000::bigint), (%L::uuid, 'USD', -1500), (null::uuid, 'INR', 10000) $$,
         tests.group_id('Flat'), tests.group_id('Flat')),
  'the other side sees the same balances with the opposite sign');

select tests.authenticate_as('dave');
select is_empty(format('select * from public.group_pairwise_balances(%L)', tests.group_id('Flat')),
                'an outsider sees no pairwise balances of the group');
select is_empty(format('select * from public.friend_group_balances(%L)', tests.uid('bob')),
                'an outsider sees no balances between other people');
select is_empty('select * from public.my_group_balances()', 'an outsider has no group balances');

-- ---------------------------------------------------------------- settle up everything
-- Items: positive = the friend pays the caller. Flat simplifies debts (the default); its plan
-- (bob → alice ₹300, carol → alice ₹300, bob → alice $15) equals the raw pairwise rows here.
create function pg_temp.items(variadic p_rows text[]) returns jsonb
language plpgsql immutable set search_path = ''
as $f$
declare
  v_result jsonb := '[]'::jsonb;
begin
  for i in 1 .. coalesce(array_length(p_rows, 1), 0) by 3 loop
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'group_id', nullif(p_rows[i], ''), 'currency', p_rows[i + 1], 'amount', p_rows[i + 2]::numeric));
  end loop;
  return v_result;
end;
$f$;
create temp table flat as select tests.group_id('Flat')::text as id;
grant select on flat to authenticated;

select tests.authenticate_as('alice');
select throws_ok(format($$ select public.settle_up_with_friend(null, %L, '[]') $$, tests.uid('bob')), 'SM422', 'An idempotency key is required',
                 'an idempotency key is required');
select throws_ok(format($$ select public.settle_up_with_friend(%L, %L, '[]') $$, tests.uid('b0'), tests.uid('alice')),
                 'SM422', 'Choose a friend to settle up with', 'you cannot settle up with yourself');
select throws_ok(format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('b0'), tests.uid('dave'),
                        pg_temp.items('', 'INR', '100')),
                 'SM403', 'You can only settle up with friends', 'you can only settle up with friends');
select throws_ok(format($$ select public.settle_up_with_friend(%L, %L, '[]') $$, tests.uid('b0'), tests.uid('bob')),
                 'SM422', 'There is nothing to settle with this friend', 'an empty list is refused');
select throws_ok(format($$ select public.settle_up_with_friend(%L, %L, %L, 'cheque') $$, tests.uid('b0'), tests.uid('bob'),
                        pg_temp.items((select id from flat), 'INR', '30000')),
                 'SM422', 'Unknown payment method', 'an unknown payment method is refused');
select throws_ok(format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('b0'), tests.uid('bob'),
                        pg_temp.items('', 'INR', '-9999')),
                 'SM409', 'Balances have changed. Reload and try again',
                 'a direct amount must equal the raw pairwise balance');
select throws_ok(format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('b0'), tests.uid('bob'),
                        pg_temp.items((select id from flat), 'INR', '30001')),
                 'SM409', 'Balances have changed. Reload and try again',
                 'a simplified-group amount cannot exceed the payer''s net');
select throws_ok(format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('b0'), tests.uid('bob'),
                        pg_temp.items((select id from flat), 'INR', '-100')),
                 'SM409', 'Balances have changed. Reload and try again',
                 'a simplified-group amount must go from the member who owes to the one who is owed');
select throws_ok(format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('b0'), tests.uid('bob'),
                        pg_temp.items((select id from flat), 'INR', '100', (select id from flat), 'INR', '100')),
                 'SM422', 'Each group and currency can appear only once', 'duplicate items are refused');
select throws_ok(format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('b0'), tests.uid('bob'),
                        pg_temp.items('', 'INR', '0')),
                 'SM422', 'Each balance must be a non-zero whole amount in minor units', 'a zero amount is refused');
select throws_ok(format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('b0'), tests.uid('bob'),
                        pg_temp.items('', 'INR', '-9999.5')),
                 'SM422', 'Each balance must be a non-zero whole amount in minor units', 'a fractional amount is refused');
select is((select count(*)::int from public.settlements where batch_id = tests.uid('b0')), 0,
          'a refused batch records nothing');

select lives_ok(
  format($$ select public.settle_up_with_friend(%L, %L, %L, 'upi', 'UPI-42', 'All square') $$,
         tests.uid('batch1'), tests.uid('bob'),
         pg_temp.items('', 'INR', '-10000', (select id from flat), 'INR', '30000', (select id from flat), 'USD', '1500')),
  'alice settles up everything with bob');
select results_eq(
  format($$ select group_id, currency::text, payer_id, receiver_id, amount::bigint, status, method, upi_reference, note
              from public.settlements where batch_id = %L order by group_id nulls first, currency $$,
         tests.uid('batch1')),
  format($$ values (null::uuid, 'INR'::text, %L::uuid, %L::uuid, 10000::bigint, 'pending'::text, 'upi'::text, 'UPI-42'::text, 'All square'::text),
                   (%L::uuid, 'INR', %L::uuid, %L::uuid, 30000::bigint, 'completed', 'upi', 'UPI-42', 'All square'),
                   (%L::uuid, 'USD', %L::uuid, %L::uuid, 1500::bigint, 'completed', 'upi', 'UPI-42', 'All square') $$,
         tests.uid('alice'), tests.uid('bob'),
         tests.group_id('Flat'), tests.uid('bob'), tests.uid('alice'),
         tests.group_id('Flat'), tests.uid('bob'), tests.uid('alice')),
  'one settlement per item; owed to alice completes, owed by alice waits for bob');
select set_eq(
  format('select group_id, currency, amount from public.friend_group_balances(%L)', tests.uid('bob')),
  $$ values (null::uuid, 'INR'::text, -10000::bigint) $$,
  'only the pending direct settlement is left to confirm');
select is(
  public.settle_up_with_friend(tests.uid('batch1'), tests.uid('bob'), '[]'),
  (select array_agg(id order by group_id nulls first, currency) from public.settlements where batch_id = tests.uid('batch1')),
  'a retry with the same key returns the same settlements, whatever the items');
select is((select count(*)::int from public.settlements where batch_id = tests.uid('batch1')), 3,
          'a retry records nothing new');
select is((select count(*)::int from public.ledger_entries l
            join public.settlements s on s.id = l.settlement_id where s.batch_id = tests.uid('batch1')), 2,
          'each completed settlement has exactly one ledger entry');
reset role; -- notifications are private to their recipient
select is((select count(*)::int from public.notifications
            where type = 'settlement_recorded' and user_id = tests.uid('bob')
              and settlement_id in (select id from public.settlements where batch_id = tests.uid('batch1'))), 3,
          'bob is notified of each settlement');

select tests.authenticate_as('bob');
select lives_ok(
  format($$ select public.confirm_settlement(%L) $$,
         (select id from public.settlements where batch_id = tests.uid('batch1') and group_id is null)),
  'bob confirms the direct settlement');
select is_empty(format('select * from public.friend_group_balances(%L)', tests.uid('alice')),
                'alice and bob are settled up everywhere');
select set_eq(
  format('select user_id, currency, amount from public.group_balances(%L)', tests.group_id('Flat')),
  format($$ values (%L::uuid, 'INR'::text, 30000::bigint), (%L::uuid, 'INR', -30000) $$,
         tests.uid('alice'), tests.uid('carol')),
  'group nets stay correct after the batch (only carol still owes alice)');

-- ---------------------------------------------------------------- the simplified plan, where it differs from raw
-- Trio simplifies: alice pays ₹300 for all three, carol pays ₹600 for bob and carol.
-- Nets: alice +200, bob −400, carol +200. Raw: bob owes alice ₹100 (and carol ₹300);
-- the plan has bob pay alice ₹200 and carol ₹200.
reset role;
select tests.make_group('Trio', 'alice', array['bob', 'carol']);
select tests.add_equal_expense('trio-1', tests.group_id('Trio'), 'alice', 30000, array['alice', 'bob', 'carol']);
select tests.add_equal_expense('trio-2', tests.group_id('Trio'), 'carol', 60000, array['bob', 'carol']);
create temp table trio as select tests.group_id('Trio')::text as id;
grant select on trio to authenticated;

select tests.authenticate_as('alice');
select set_eq(
  $$ select group_id, user_id, currency, amount from public.my_simplified_group_balances() $$,
  format($$ values (%L::uuid, %L::uuid, 'INR'::text, 20000::bigint), (%L, %L, 'INR', -40000), (%L, %L, 'INR', 20000),
                   (%L, %L, 'INR', 30000), (%L, %L, 'INR', -30000) $$,
         tests.group_id('Trio'), tests.uid('alice'), tests.group_id('Trio'), tests.uid('bob'),
         tests.group_id('Trio'), tests.uid('carol'),
         tests.group_id('Flat'), tests.uid('alice'), tests.group_id('Flat'), tests.uid('carol')),
  'my_simplified_group_balances: every member''s net in the caller''s simplifying groups');
select is((select simplified from public.my_pairwise_balances()
            where friend_id = tests.uid('bob') and group_id = tests.group_id('Trio')), true,
          'my_pairwise_balances flags rows of groups that simplify');
select lives_ok(
  format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('trio-batch'), tests.uid('bob'),
         pg_temp.items((select id from trio), 'INR', '20000')),
  'the plan''s ₹200 is accepted although the raw pairwise balance is ₹100');
select set_eq(
  format('select user_id, currency, amount from public.group_balances(%L)', tests.group_id('Trio')),
  format($$ values (%L::uuid, 'INR'::text, -20000::bigint), (%L::uuid, 'INR', 20000) $$,
         tests.uid('bob'), tests.uid('carol')),
  'alice is settled; bob now owes only carol, as the plan says');

-- A group either person has left can't be settled from here.
reset role;
update public.group_members set left_at = now()
 where group_id = tests.group_id('Flat') and user_id = tests.uid('carol');
select tests.authenticate_as('alice');
select throws_ok(format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('batch3'), tests.uid('carol'),
                        pg_temp.items((select id from flat), 'INR', '30000')),
                 'SM403', 'Both of you must be current members of the group',
                 'a group carol has left is refused');
select lives_ok(format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('batch4'), tests.uid('carol'),
                       pg_temp.items('', 'INR', '-2000')),
                'the direct balance with carol is still settled');
select results_eq(
  format($$ select group_id, payer_id, receiver_id, amount::bigint, status
              from public.settlements where batch_id = %L $$, tests.uid('batch4')),
  format($$ values (null::uuid, %L::uuid, %L::uuid, 2000::bigint, 'pending'::text) $$,
         tests.uid('alice'), tests.uid('carol')),
  'alice pays carol directly, waiting for carol');

-- ---------------------------------------------------------------- create_settlement after the refactor
select is((select batch_id from public.settlements where id = public.create_settlement(
            tests.uid('single'), tests.group_id('Flat'), tests.uid('bob'), tests.uid('alice'), 100, 'INR')),
          null, 'a single settlement has no batch');
select throws_ok(
  format($$ select public.create_settlement(%L, %L, %L, %L, 100, 'INR', 'upi', repeat('x', 65)) $$,
         tests.uid('long-ref'), tests.group_id('Flat'), tests.uid('bob'), tests.uid('alice')),
  'SM422', 'Keep the UPI reference under 64 characters', 'a UPI reference over 64 characters is refused with a readable error');
select throws_ok(
  format($$ select public.create_settlement(%L, %L, %L, %L, 100, 'INR', 'cash', null, null, current_date + 30) $$,
         tests.uid('future'), tests.group_id('Flat'), tests.uid('bob'), tests.uid('alice')),
  'SM422', 'Choose a date from 2000 up to today', 'a settlement dated in the future is refused');

-- ---------------------------------------------------------------- privileges
reset role;
select ok(has_function_privilege('authenticated', 'public.settle_up_with_friend(uuid, uuid, jsonb, text, text, text, date)', 'execute')
          and has_function_privilege('authenticated', 'public.group_pairwise_balances(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.friend_group_balances(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.my_group_balances()', 'execute'),
          'signed-in users can call the new functions');
select ok(not has_function_privilege('anon', 'public.settle_up_with_friend(uuid, uuid, jsonb, text, text, text, date)', 'execute')
          and not has_function_privilege('anon', 'public.group_pairwise_balances(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.my_group_balances()', 'execute'),
          'anonymous visitors cannot call them');
select ok(not has_function_privilege('authenticated',
            'private.record_settlement(uuid, uuid, uuid, uuid, uuid, bigint, text, text, text, text, date, uuid)', 'execute'),
          'the internal recorder is not callable by clients');
select ok(has_function_privilege('service_role', 'public.settle_up_with_friend(uuid, uuid, jsonb, text, text, text, date)', 'execute'),
          'service_role keeps access');

select * from finish();
rollback;
