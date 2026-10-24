-- Review M6, batch 1 (docs/reviews/review-M6.md): the `withdrawn` settlement status,
-- no second payment while one is pending (L2), and the other database fixes.
begin;
select plan(46);

select tests.create_user(name) from unnest(array['alice', 'bob', 'carol', 'dave']) as name;
select tests.make_group('Flat', 'alice', array['bob', 'carol']);
select tests.make_group('Duo', 'alice', array['dave']);
select tests.add_equal_expense('dinner', tests.group_id('Flat'), 'alice', 90000, array['alice', 'bob', 'carol']);

-- ---------------------------------------------------------------- withdrawn
select tests.authenticate_as('bob');
select public.create_settlement(tests.uid('w1'), tests.group_id('Flat'), tests.uid('bob'), tests.uid('alice'), 10000, 'INR');
select public.cancel_settlement(tests.settlement_id('w1'));
select is((select status from public.settlements where id = tests.settlement_id('w1')), 'withdrawn',
          'a pending settlement called off by its payer is withdrawn, not cancelled');
select is((select count(*)::int from public.audit_events
            where entity_id = tests.settlement_id('w1') and action = 'settlement.withdrawn'), 1,
          'the withdrawal is audited as settlement.withdrawn');
select is((select count(*)::int from public.my_activity(100, 0) where entity_id = tests.settlement_id('w1')), 2,
          'the activity feed shows the record and its withdrawal');

select tests.authenticate_as('alice');
select public.create_settlement(tests.uid('c1'), tests.group_id('Flat'), tests.uid('carol'), tests.uid('alice'), 5000, 'INR');
select public.cancel_settlement(tests.settlement_id('c1'));
select is((select status from public.settlements where id = tests.settlement_id('c1')), 'cancelled',
          'a completed settlement that is called off is cancelled (and reversed)');

-- Leaving the group withdraws the leaver's pending settlements.
select tests.authenticate_as('dave');
select public.create_settlement(tests.uid('d1'), tests.group_id('Duo'), tests.uid('dave'), tests.uid('alice'), 100, 'INR');
select public.leave_group(tests.group_id('Duo'));
select is((select status from public.settlements where id = tests.settlement_id('d1')), 'withdrawn',
          'a pending settlement is withdrawn when its payer leaves the group');

-- ---------------------------------------------------------------- L2: no second payment while one is pending
select tests.authenticate_as('bob');
select lives_ok(
  format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('l2-a'), tests.uid('alice'),
         jsonb_build_array(jsonb_build_object('group_id', tests.group_id('Flat'), 'currency', 'INR', 'amount', -30000))),
  'bob settles up with alice: his ₹300 waits for her');
select throws_ok(
  format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('l2-b'), tests.uid('alice'),
         jsonb_build_array(jsonb_build_object('group_id', tests.group_id('Flat'), 'currency', 'INR', 'amount', -30000))),
  'SM409', null, 'bob can''t record the same debt again while it is pending');
select tests.authenticate_as('alice');
select throws_ok(
  format($$ select public.settle_up_with_friend(%L, %L, %L) $$, tests.uid('l2-c'), tests.uid('bob'),
         jsonb_build_array(jsonb_build_object('group_id', tests.group_id('Flat'), 'currency', 'INR', 'amount', 30000))),
  'SM409', null, 'alice can''t record it as received while bob''s payment waits for her answer');
select is((select count(*)::int from public.settlements
            where group_id = tests.group_id('Flat') and status = 'pending'), 1,
          'only one pending settlement exists for that debt');

-- ---------------------------------------------------------------- M2: maximum amount and balance range
reset role;
select tests.create_user(name) from unnest(array['erin', 'frank']) as name;
select tests.make_group('Big', 'erin', array['frank']);
select tests.authenticate_as('erin');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Car', 1000000001, 'INR', current_date, 'exact', %L, %L, %L) $$,
         tests.group_id('Big'), tests.amounts('erin', '1000000001'), tests.amounts('frank', '1000000001'),
         tests.debts('frank', 'erin', '1000000001')),
  'SM422', null, 'an INR expense above ₹1,00,00,000 is refused');
select lives_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Car', 1000000000, 'INR', current_date, 'exact', %L, %L, %L) $$,
         tests.group_id('Big'), tests.amounts('erin', '1000000000'), tests.amounts('frank', '1000000000'),
         tests.debts('frank', 'erin', '1000000000')),
  'exactly ₹1,00,00,000 is allowed');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Car', 15000001, 'JPY', current_date, 'exact', %L, %L, %L) $$,
         tests.group_id('Big'), tests.amounts('erin', '15000001'), tests.amounts('frank', '15000001'),
         tests.debts('frank', 'erin', '15000001')),
  'SM422', null, 'a JPY expense above ¥15,000,000 is refused (limits are per currency)');

-- Balances near the limit TypeScript can represent: a crafted ledger row (as postgres) puts
-- frank's debt to erin (₹1 crore = 1,000,000,000 paise so far) just under 2^53 − 1;
-- one more ₹1 crore expense would cross it.
reset role;
insert into public.ledger_entries (debtor_id, creditor_id, amount, currency, group_id, expense_id, source_version, entry_type)
select tests.uid('frank'), tests.uid('erin'), 9007198254000000, 'INR', tests.group_id('Big'), e.id, 1, 'charge'
  from public.expenses e where e.group_id = tests.group_id('Big') limit 1;
select tests.authenticate_as('erin');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Lunch', 1000000000, 'INR', current_date, 'exact', %L, %L, %L) $$,
         tests.group_id('Big'), tests.amounts('erin', '1000000000'), tests.amounts('frank', '1000000000'),
         tests.debts('frank', 'erin', '1000000000')),
  'SM422', null, 'a write that would push a balance beyond what the app can represent exactly is refused');
select ok((select sum(amount) from public.ledger_entries where group_id = tests.group_id('Big')) <= 9007199254740991,
          'the refused write left nothing behind');

-- ---------------------------------------------------------------- M3: split details must match the shares
-- Each payload adds up (payers, shares, pairwise rows), but its details contradict the shares.
create function pg_temp.parts(variadic p_rows text[]) returns jsonb
language plpgsql immutable set search_path = ''
as $f$
declare
  v_result jsonb := '[]'::jsonb;
  v_row jsonb;
begin
  -- name, amount, key, value, rounding unit
  for i in 1 .. coalesce(array_length(p_rows, 1), 0) by 5 loop
    v_row := jsonb_build_object('user_id', tests.uid(p_rows[i]), 'amount', p_rows[i + 1]::numeric,
                                'received_rounding_unit', p_rows[i + 4]::boolean);
    if p_rows[i + 2] <> '' then
      v_row := v_row || jsonb_build_object(p_rows[i + 2], p_rows[i + 3]::numeric);
    end if;
    v_result := v_result || jsonb_build_array(v_row);
  end loop;
  return v_result;
end;
$f$;
select tests.authenticate_as('alice');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Equal?', 1000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Flat'), tests.amounts('alice', '1000'),
         pg_temp.parts('alice', '1', '', '', 'false', 'bob', '999', '', '', 'false'), tests.debts('bob', 'alice', '999')),
  'SM422', null, 'an "equal" split of 1 / 999 is refused');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Half?', 1000, 'INR', current_date, 'percentage', %L, %L, %L) $$,
         tests.group_id('Flat'), tests.amounts('alice', '1000'),
         pg_temp.parts('alice', '1', 'basis_points', '5000', 'false', 'bob', '999', 'basis_points', '5000', 'false'),
         tests.debts('bob', 'alice', '999')),
  'SM422', null, 'a 50% / 50% split that charges 0.1% / 99.9% is refused');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Shares?', 1000, 'INR', current_date, 'shares', %L, %L, %L) $$,
         tests.group_id('Flat'), tests.amounts('alice', '1000'),
         pg_temp.parts('alice', '1', 'weight', '1', 'false', 'bob', '999', 'weight', '1', 'false'),
         tests.debts('bob', 'alice', '999')),
  'SM422', null, 'one share each that charges 1 / 999 is refused');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Flags?', 900, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Flat'), tests.amounts('alice', '900'),
         pg_temp.parts('alice', '450', '', '', 'true', 'bob', '450', '', '', 'false'), tests.debts('bob', 'alice', '450')),
  'SM422', null, 'a rounding-unit flag on an even split is refused');
select lives_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Fine', 1000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Flat'), tests.amounts('alice', '1000'),
         pg_temp.parts('alice', '334', '', '', 'true', 'bob', '333', '', '', 'false', 'carol', '333', '', '', 'false'),
         tests.debts('bob', 'alice', '333', 'carol', 'alice', '333')),
  'a real equal split with one rounding unit is accepted');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Pizza?', 1000, 'INR', current_date, 'itemized', %L, %L, %L,
                   %L) $$,
         tests.group_id('Flat'), tests.amounts('alice', '1000'),
         pg_temp.parts('alice', '0', '', '', 'false', 'bob', '1000', '', '', 'false'), tests.debts('bob', 'alice', '1000'),
         jsonb_build_array(jsonb_build_object('name', 'Pizza', 'kind', 'item', 'amount', 1000,
                                              'assignments', jsonb_build_array(jsonb_build_object('user_id', tests.uid('alice')))))),
  'SM422', null, 'an itemized share for an item assigned only to someone else is refused');
select is((select count(*)::int from public.expenses where description in ('Equal?', 'Half?', 'Shares?', 'Flags?', 'Pizza?')), 0,
          'none of the contradicting expenses was saved');

-- ---------------------------------------------------------------- M4: full history, no empty versions
select tests.add_equal_expense('m4', tests.group_id('Flat'), 'alice', 9000, array['alice', 'bob', 'carol']);
create function pg_temp.edit_m4(p_notes text, p_tags text[]) returns integer
language sql set search_path = ''
as $f$
  select public.update_expense(
    tests.expense_id('m4'), (select version from public.expenses where id = tests.expense_id('m4')),
    'Expense m4', 9000, 'INR', current_date, 'equal',
    tests.amounts('alice', '9000'), tests.amounts('alice', '3000', 'bob', '3000', 'carol', '3000'),
    tests.debts('bob', 'alice', '3000', 'carol', 'alice', '3000'),
    null, null, p_notes, p_tags);
$f$;
select tests.authenticate_as('alice');
select is(pg_temp.edit_m4(null, '{}'), 1, 'saving without changes keeps version 1');
select is((select count(*)::int from public.audit_events
            where entity_id = tests.expense_id('m4') and action = 'expense.updated'), 0,
          'and writes no history entry');
select is(pg_temp.edit_m4('Bring cash', array['goa']), 2, 'changing only notes and tags is a new version');
select is((select after ->> 'notes' from public.audit_events
            where entity_id = tests.expense_id('m4') and action = 'expense.updated'), 'Bring cash',
          'the history records the new notes');
select is((select (before -> 'tags', after -> 'tags')::text from public.audit_events
            where entity_id = tests.expense_id('m4') and action = 'expense.updated'), '([],"[""goa""]")',
          'and the tags before and after');

-- ---------------------------------------------------------------- L8: neutral friend-request replies; L7: no name leak
reset role;
select tests.create_user(name) from unnest(array['gina', 'hank']) as name;
select tests.authenticate_as('hank');
select is((select status from public.send_friend_request('gina@tests.local')), 'sent',
          'a request to an existing account gets the neutral reply');
select is((select status from public.send_friend_request('nobody@tests.local')), 'sent',
          'a request to an address without an account gets exactly the same reply');
select is((select status from public.send_friend_request('GINA@tests.local')), 'sent',
          'asking again gets the same reply too');
select set_eq($$ select email from public.friend_email_requests $$,
              $$ values ('gina@tests.local'), ('nobody@tests.local') $$,
              'the sender''s sent list shows the addresses they typed, existing or not');
select is((select count(*)::int from public.profile_cards(array[tests.uid('gina')])), 0,
          'sending a request doesn''t reveal the recipient''s name');
select tests.authenticate_as('gina');
select is((select display_name from public.profile_cards(array[tests.uid('hank')])), 'Hank',
          'the recipient sees who asked');

-- A request to an address without an account applies once that address signs up.
select tests.authenticate_as('hank');
select public.send_friend_request('ivy@tests.local');
reset role;
select tests.create_user('ivy');
select is((select count(*)::int from public.friendships
            where status = 'pending' and requested_by = tests.uid('hank')
              and tests.uid('ivy') in (user_low, user_high)), 1,
          'ivy, signing up later, receives hank''s request');

-- Accepting clears the sender's entry; withdrawing removes it.
select tests.authenticate_as('gina');
select public.accept_friend_request((select id from public.friendships
                                      where requested_by = tests.uid('hank') and tests.uid('gina') in (user_low, user_high)));
select tests.authenticate_as('hank');
select public.withdraw_friend_request((select id from public.friend_email_requests where email = 'nobody@tests.local'));
select set_eq($$ select email from public.friend_email_requests $$, $$ values ('ivy@tests.local') $$,
              'accepted and withdrawn requests leave the sent list');

-- ---------------------------------------------------------------- L9: former members don't read the live group
-- dave left Duo earlier in this file; the group is renamed afterwards.
reset role;
create temp table duo as select tests.group_id('Duo') as id;
grant select on duo to authenticated;
update public.groups set name = 'Renamed after dave left' where id = (select id from duo);
select tests.authenticate_as('dave');
select is((select count(*)::int from public.groups where id = (select id from duo)), 0,
          'a former member can''t read the group record');
select is((select name from public.group_names(array[(select id from duo)])), 'Duo',
          'for their history, a former member gets the name as it was when they left');
select tests.authenticate_as('alice');
select is((select name from public.group_names(array[(select id from duo)])), 'Renamed after dave left',
          'a current member gets the live name');
select tests.authenticate_as('hank');
select is((select count(*)::int from public.group_names(array[(select id from duo)])), 0,
          'someone who was never a member gets nothing');

-- ---------------------------------------------------------------- L11: invitee emails only for creator and admins
-- alice is Flat's admin; bob and carol are members.
select tests.authenticate_as('alice');
select public.create_invitation(tests.group_id('Flat'), 'zed@tests.local');
select tests.authenticate_as('bob');
select public.create_invitation(tests.group_id('Flat'), 'yan@tests.local');

select tests.authenticate_as('carol');
select throws_ok($$ select invited_email from public.group_invitations $$, '42501', null,
                 'a member can''t read invitees'' email addresses from the table');
select set_eq(format($$ select invited_email from public.group_invitation_list(%L) $$, tests.group_id('Flat')),
              $$ values ('z•••@tests.local'), ('y•••@tests.local') $$,
              'a member who didn''t send them sees them masked');
select tests.authenticate_as('bob');
select set_eq(format($$ select invited_email from public.group_invitation_list(%L) $$, tests.group_id('Flat')),
              $$ values ('z•••@tests.local'), ('yan@tests.local') $$,
              'the creator sees their own invitee''s address');
select tests.authenticate_as('alice');
select set_eq(format($$ select invited_email from public.group_invitation_list(%L) $$, tests.group_id('Flat')),
              $$ values ('zed@tests.local'), ('yan@tests.local') $$,
              'an admin sees all of them');
reset role;
select is((select count(*)::int from public.audit_events
            where action = 'invitation.created' and after ->> 'invited_email' in ('zed@tests.local', 'yan@tests.local')), 0,
          'the audit log stores invitee addresses masked');
select tests.authenticate_as('dave');
select is((select count(*)::int from public.group_invitation_list(tests.group_id('Flat'))), 0,
          'an outsider gets nothing');

-- ---------------------------------------------------------------- L10: group settings only through update_group
select tests.authenticate_as('alice');
select throws_ok(format($$ update public.groups set name = 'Sneaky', archived_at = now() where id = %L $$, tests.group_id('Flat')),
                 '42501', null, 'an admin can''t update the group row directly (no audit, no validation)');
select lives_ok(format($$ select public.update_group(%L, 'Flat renamed', '', 'INR', 'home', true) $$, tests.group_id('Flat')),
                'update_group still works, audited');

select * from finish();
rollback;
