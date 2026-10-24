-- M8: marking notifications read, per-type preferences, expense search and the
-- analytics/export rows. Each read is checked against the raw tables and
-- against people who must not see the rows.
begin;
select plan(40);

select tests.create_user('ana');
select tests.create_user('ben');
select tests.create_user('cy');
select tests.create_user('dee');
select tests.create_user('eve');
select tests.make_group('Analytics A', 'ana', array['ben', 'cy']);
select tests.make_group('Analytics B', 'dee', array['eve']);

-- x1: Ana pays ₹900 for all three. x2: Ben pays ₹600 for Ben and Cy (Ana not involved).
-- x3: another group. x4: Ana is in version 1 only. x5: cancelled. x6: outside the range.
select tests.add_equal_expense('x1', tests.group_id('Analytics A'), 'ana', 90000, array['ana', 'ben', 'cy']);
select tests.add_equal_expense('x2', tests.group_id('Analytics A'), 'ben', 60000, array['ben', 'cy']);
select tests.add_equal_expense('x3', tests.group_id('Analytics B'), 'dee', 100000, array['dee', 'eve']);
select tests.add_equal_expense('x4', tests.group_id('Analytics A'), 'ana', 40000, array['ana', 'ben']);
select tests.add_equal_expense('x5', tests.group_id('Analytics A'), 'ana', 30000, array['ana', 'cy']);
select tests.add_equal_expense('x6', tests.group_id('Analytics A'), 'ana', 20000, array['ana', 'ben'], 'USD');

select tests.authenticate_as('ben');
select public.update_expense(tests.expense_id('x4'), 1, 'Expense x4', 40000, 'INR', current_date, 'equal',
  tests.amounts('ben', '40000'), tests.amounts('ben', '20000', 'cy', '20000'), tests.debts('cy', 'ben', '20000'));
select tests.authenticate_as('ana');
select public.cancel_expense(tests.expense_id('x5'), 1);
reset role;

update public.expenses set description = 'Goa dinner', notes = 'beach shack', tags = array['trip'], category = 'food'
 where id = tests.expense_id('x1');
update public.expenses set description = 'Taxi to airport', notes = '50% off', category = 'transport'
 where id = tests.expense_id('x2');
update public.expenses set description = 'Goa villa' where id = tests.expense_id('x3');
update public.expenses set expense_date = current_date - 400 where id = tests.expense_id('x6');

-- ---------------------------------------------------------------- my_expense_shares
select tests.authenticate_as('ana');
select is(
  (select array_agg(description order by description) from public.my_expense_shares(current_date - 30, current_date)),
  array['Goa dinner'],
  'only active expenses Ana takes part in now, in the range (not x2, x3, an earlier version, a cancelled one or older ones)');
select is(
  (select row(amount, paid, share)::text from public.my_expense_shares(current_date - 30, current_date)),
  row(90000::bigint, 90000::bigint, 30000::bigint)::text,
  'with the total, what Ana paid and her share');
select is(
  (select count(*)::int from public.my_expense_shares(current_date - 500, current_date)), 2,
  'a wider range brings in the older USD expense');
select is(
  (select currency from public.my_expense_shares(current_date - 500, current_date) where expense_date < current_date - 30),
  'USD', 'in its own currency');

select tests.authenticate_as('ben');
select is(
  (select row(sum(paid), sum(share), count(*))::text from public.my_expense_shares(current_date - 30, current_date)),
  row(100000::numeric, 80000::numeric, 3::bigint)::text,
  'Ben: paid ₹600 + ₹400, share ₹300 + ₹300 + ₹200 (version 2 of x4)');
reset role;
select is(
  (select row(sum(paid), sum(share))::text from (
     select (select coalesce(sum(p.amount), 0) from public.expense_payers p
              where p.expense_id = e.id and p.version = e.version and p.user_id = tests.uid('ben')) as paid,
            (select coalesce(sum(p.amount), 0) from public.expense_participants p
              where p.expense_id = e.id and p.version = e.version and p.user_id = tests.uid('ben')) as share
       from public.expenses e
      where e.status = 'active' and e.expense_date between current_date - 30 and current_date) t),
  row(100000::numeric, 80000::numeric)::text,
  'which matches the raw tables');

select tests.authenticate_as('dee');
select is((select count(*)::int from public.my_expense_shares(current_date - 500, current_date)), 1,
          'Dee sees only her own group''s expense');
select is(
  (select count(*)::int from public.my_expense_shares(current_date - 500, current_date)
    where group_id = tests.group_id('Analytics A')), 0, 'nothing from a group she is not in');

select tests.authenticate_as('ben');
select is((select count(*)::int from public.my_expense_shares(current_date - 30, current_date, 2, 0)), 2, 'pages: first page');
select is((select count(*)::int from public.my_expense_shares(current_date - 30, current_date, 2, 2)), 1, 'pages: second page');
select is((select count(*)::int from public.my_expense_shares(current_date - 30, current_date, 5000, 0)), 3,
          'an oversized page is capped, not refused');

select tests.authenticate_anon();
select throws_ok($$ select * from public.my_expense_shares(current_date - 30, current_date) $$, '42501', null,
                 'anonymous callers cannot read expense shares');

-- ---------------------------------------------------------------- search_expenses
select tests.authenticate_as('ana');
select is((select array_agg(description) from public.search_expenses('goa')), array['Goa dinner'],
          'Ana finds her group''s expense, not the other group''s');
select is((select count(*)::int from public.search_expenses('GOA beach')), 1, 'every word must match, in any case, notes included');
select is((select count(*)::int from public.search_expenses('trip goa')), 1, 'tags count, in any order');
select is((select count(*)::int from public.search_expenses('goa villa')), 0, 'all words must match one expense');
select is((select array_agg(description) from public.search_expenses('taxi')), array['Taxi to airport'],
          'members find group expenses they are not part of');
select is((select array_agg(description) from public.search_expenses('%')), array['Taxi to airport'],
          '% is a character, not a wildcard');
select is((select array_agg(description) from public.search_expenses('zzz', array['transport'])), array['Taxi to airport'],
          'categories the app matched by label are found');
select is((select count(*)::int from public.search_expenses('   ')), 0, 'a blank query finds nothing');
select is((select count(*)::int from public.search_expenses('expense')), 3,
          'cancelled expenses are found (and labelled by the app)');
select is((select total_count from public.search_expenses('expense', '{}', 1, 0)), 3::bigint,
          'with the total for paging');
select throws_ok($$ select * from public.search_expenses(repeat('a', 101)) $$, 'SM422',
                 'Search for at most 100 characters', 'overlong queries are refused');

select tests.authenticate_as('dee');
select is((select array_agg(description) from public.search_expenses('goa')), array['Goa villa'],
          'Dee finds only her group''s expense');

select tests.authenticate_anon();
select throws_ok($$ select * from public.search_expenses('goa') $$, '42501', null, 'anonymous callers cannot search');

-- ---------------------------------------------------------------- mark_notifications_read
reset role;
delete from public.notifications where user_id in (tests.uid('ana'), tests.uid('ben'));
insert into public.notifications (id, user_id, type, actor_id) values
  (tests.uid('n-ana-1'), tests.uid('ana'), 'member_joined', tests.uid('ben')),
  (tests.uid('n-ana-2'), tests.uid('ana'), 'member_joined', tests.uid('cy')),
  (tests.uid('n-ana-3'), tests.uid('ana'), 'friend_accepted', tests.uid('cy')),
  (tests.uid('n-ben-1'), tests.uid('ben'), 'member_joined', tests.uid('cy'));

select tests.authenticate_as('ana');
select is(public.mark_notifications_read(array[tests.uid('n-ana-1')]), 1, 'marks the chosen notification');
select is(public.mark_notifications_read(array[tests.uid('n-ana-1')]), 0, 'a read one is not marked again');
select is(public.mark_notifications_read(array[tests.uid('n-ben-1')]), 0, 'someone else''s ID changes nothing');
select is(public.mark_notifications_read(), 2, 'no IDs marks every unread one');
select throws_ok(
  format($$ select public.mark_notifications_read(%L::uuid[]) $$,
         (select array_agg(gen_random_uuid()) from generate_series(1, 101))),
  'SM422', 'Mark at most 100 notifications at a time', 'at most 100 at a time');
update public.notifications set read_at = null where id = tests.uid('n-ben-1');
reset role;
select is((select count(*)::int from public.notifications where user_id = tests.uid('ben') and read_at is null), 1,
          'Ben''s notification stays unread, even after a direct update by Ana');

select tests.authenticate_anon();
select throws_ok($$ select public.mark_notifications_read() $$, '42501', null, 'anonymous callers cannot mark');

-- ---------------------------------------------------------------- set_notification_preferences
select tests.authenticate_as('ben');
select lives_ok($$ select public.set_notification_preferences('{"expense_added": false, "member_left": true}') $$,
                'Ben turns off new-expense notifications');
select is((select array_agg(type || '=' || in_app order by type) from public.notification_preferences),
          array['expense_added=false', 'member_left=true'], 'saved as rows of his own');
select tests.add_equal_expense('x7', tests.group_id('Analytics A'), 'ana', 60000, array['ana', 'ben']);
reset role;
select is((select count(*)::int from public.notifications
            where user_id = tests.uid('ben') and type = 'expense_added' and expense_id = tests.expense_id('x7')), 0,
          'so the next expense does not notify him');
select tests.authenticate_as('ben');
select public.set_notification_preferences('{"expense_added": true}');
select tests.add_equal_expense('x8', tests.group_id('Analytics A'), 'ana', 60000, array['ana', 'ben']);
reset role;
select is((select count(*)::int from public.notifications
            where user_id = tests.uid('ben') and type = 'expense_added' and expense_id = tests.expense_id('x8')), 1,
          'turning it back on works');

select tests.authenticate_as('ben');
select throws_ok($$ select public.set_notification_preferences('{"nope": false}') $$, 'SM422', 'Unknown notification type',
                 'unknown types are refused');
select throws_ok($$ select public.set_notification_preferences('{"expense_added": "no"}') $$, 'SM422',
                 'Each preference must be true or false', 'values must be booleans');
select throws_ok($$ select public.set_notification_preferences('[]') $$, 'SM422', 'Preferences must be an object',
                 'the argument must be an object');

select tests.authenticate_as('ana');
select is((select count(*)::int from public.notification_preferences), 0, 'Ana cannot see Ben''s preferences');

select * from finish();
rollback;
