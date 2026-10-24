-- Leaving and removal (SPEC §2): only at zero balance in every currency;
-- removed members cannot act; the group always keeps an admin.
begin;
select plan(24);

select tests.create_user(name) from unnest(array['alice', 'bob', 'carol', 'dave']) as name;
select tests.make_group('House', 'alice', array['bob', 'carol']);
select tests.make_group('Pair', 'alice', array['bob']);
select tests.add_equal_expense('rent', tests.group_id('House'), 'alice', 90000, array['alice', 'bob', 'carol']);
-- A USD expense too, so "zero in every currency" is exercised.
select tests.add_equal_expense('usd', tests.group_id('House'), 'alice', 2000, array['alice', 'bob'], 'USD');

-- ---------------------------------------------------------------- leaving needs a zero balance
select tests.authenticate_as('bob');
select throws_ok(format($$ select public.leave_group(%L) $$, tests.group_id('House')), 'SM409', null,
                 'a member who owes money cannot leave');
select tests.authenticate_as('alice');
select throws_ok(format($$ select public.remove_group_member(%L, %L) $$, tests.group_id('House'), tests.uid('bob')),
                 'SM409', null, 'an admin cannot remove a member who owes money');
select throws_ok(format($$ select public.remove_group_member(%L, %L) $$, tests.group_id('House'), tests.uid('alice')),
                 'SM422', null, 'admins leave with leave_group, not by removing themselves');

-- Bob settles INR in full; USD is still outstanding.
select public.create_settlement(tests.uid('bob-inr'), tests.group_id('House'), tests.uid('bob'), tests.uid('alice'), 30000, 'INR');
select throws_ok(format($$ select public.remove_group_member(%L, %L) $$, tests.group_id('House'), tests.uid('bob')),
                 'SM409', null, 'a zero INR balance is not enough while USD is outstanding');
select public.create_settlement(tests.uid('bob-usd'), tests.group_id('House'), tests.uid('bob'), tests.uid('alice'), 1000, 'USD');

select tests.authenticate_as('carol');
select throws_ok(format($$ select public.remove_group_member(%L, %L) $$, tests.group_id('House'), tests.uid('bob')),
                 'SM403', null, 'a non-admin cannot remove members');

select tests.authenticate_as('alice');
select lives_ok(format($$ select public.remove_group_member(%L, %L) $$, tests.group_id('House'), tests.uid('bob')),
                'an admin removes a member whose balance is zero in every currency');
reset role;
select ok((select left_at is not null and removed_by = tests.uid('alice') from public.group_members
            where group_id = tests.group_id('House') and user_id = tests.uid('bob')),
          'the membership is ended and records who removed them');
select is((select count(*)::int from public.notifications where user_id = tests.uid('bob') and type = 'member_removed'), 1,
          'the removed member is notified');

-- ---------------------------------------------------------------- removed member cannot act
select tests.authenticate_as('bob');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'After removal', 100, 'INR', current_date, 'equal', %L, %L, '[]') $$,
         tests.group_id('House'), tests.amounts('bob', '100'), tests.amounts('bob', '100')),
  'SM403', null, 'a removed member cannot add expenses');
select throws_ok(
  format($$ select public.update_expense(%L, 1, 'Edit', 90000, 'INR', current_date, 'equal', %L, %L, '[]') $$,
         tests.expense_id('rent'), tests.amounts('alice', '90000'), tests.amounts('alice', '90000')),
  'SM403', null, 'a removed member cannot edit expenses');
select throws_ok(format($$ select public.cancel_expense(%L, 1) $$, tests.expense_id('rent')), 'SM403', null,
                 'a removed member cannot cancel expenses');
select throws_ok(
  format($$ select public.create_settlement(gen_random_uuid(), %L, %L, %L, 100, 'INR') $$,
         tests.group_id('House'), tests.uid('bob'), tests.uid('alice')),
  'SM403', null, 'a removed member cannot record settlements');
select throws_ok(format($$ select public.create_invitation(%L) $$, tests.group_id('House')), 'SM403', null,
                 'a removed member cannot invite people');
select throws_ok(format($$ select public.leave_group(%L) $$, tests.group_id('House')), 'SM404', null,
                 'a removed member cannot leave again');
select is((select count(*)::int from public.expenses where group_id = tests.group_id('House')), 2,
          'a removed member still reads the expenses they were part of');

-- ---------------------------------------------------------------- last admin hands over
select tests.authenticate_as('alice');
select throws_ok(format($$ select public.leave_group(%L) $$, tests.group_id('House')), 'SM409', null,
                 'the admin cannot leave while owed money');
select public.create_settlement(tests.uid('carol-inr'), tests.group_id('House'), tests.uid('carol'), tests.uid('alice'), 30000, 'INR');
select lives_ok(format($$ select public.leave_group(%L) $$, tests.group_id('House')), 'the admin leaves at zero balance');
reset role;
select is((select role from public.group_members where group_id = tests.group_id('House') and user_id = tests.uid('carol')),
          'admin', 'the longest-standing remaining member becomes admin');
select is((select count(*)::int from public.notifications where user_id = tests.uid('carol') and type = 'member_left'), 1,
          'remaining members are notified when someone leaves');

-- ---------------------------------------------------------------- pending settlement after leaving
-- Bob records a pending payment in "Pair" (no balance effect), then leaves; the pending
-- settlement is withdrawn automatically, so it can never be confirmed for a former member.
select tests.authenticate_as('bob');
select public.create_settlement(tests.uid('pair-pending'), tests.group_id('Pair'), tests.uid('bob'), tests.uid('alice'), 500, 'INR');
select lives_ok(format($$ select public.leave_group(%L) $$, tests.group_id('Pair')),
                'a pending settlement does not block leaving (it has no balance effect)');
select tests.authenticate_as('alice');
select throws_ok(format($$ select public.confirm_settlement(%L) $$, tests.settlement_id('pair-pending')), 'SM409', null,
                 'a settlement cannot be confirmed once a party has left the group (it was withdrawn)');

-- ---------------------------------------------------------------- outsiders and rejoining
select tests.authenticate_as('dave');
select throws_ok(format($$ select public.leave_group(%L) $$, tests.group_id('House')), 'SM404', null,
                 'a non-member cannot leave');
select tests.authenticate_as('carol');
create temp table rejoin as select * from public.create_invitation(tests.group_id('House'));
select tests.authenticate_as('bob');
select is(public.accept_invitation((select token from rejoin)), tests.group_id('House'),
          'a former member can rejoin with a new invitation');
reset role;
select ok((select left_at is null and removed_by is null and role = 'member' from public.group_members
            where group_id = tests.group_id('House') and user_id = tests.uid('bob')),
          'rejoining restores a current, ordinary membership');

select * from finish();
rollback;
