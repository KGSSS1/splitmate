-- RLS: what a current member, a non-member, a removed member, a direct-expense
-- friend and an anonymous user can see and do, table by table.
begin;
select plan(70);

-- ---------------------------------------------------------------- setup (as postgres)
select tests.create_user(name) from unnest(array['alice', 'bob', 'carol', 'dave', 'erin']) as name;
select tests.make_group('RLS group', 'alice', array['bob', 'carol']);
select tests.make_friends('alice', 'erin');

select tests.add_equal_expense('rls-e1', tests.group_id('RLS group'), 'alice', 90000, array['alice', 'bob', 'carol']);
-- Carol repays Alice in full (recorded by Alice, the receiver → completed), then Alice removes her.
select public.create_settlement(tests.uid('rls-s1'), tests.group_id('RLS group'),
                                tests.uid('carol'), tests.uid('alice'), 30000, 'INR');
select public.remove_group_member(tests.group_id('RLS group'), tests.uid('carol'));
-- After Carol left: an expense between Alice and Bob only.
select tests.add_equal_expense('rls-e2', tests.group_id('RLS group'), 'alice', 10000, array['alice', 'bob']);
-- A direct (non-group) expense between friends Alice and Erin.
select public.create_expense(tests.uid('rls-d1'), null, 'Taxi', 20000, 'INR', current_date, 'equal',
                             tests.amounts('alice', '20000'), tests.amounts('alice', '10000', 'erin', '10000'),
                             tests.debts('erin', 'alice', '10000'));
select public.create_invitation(tests.group_id('RLS group'));
insert into public.attachments (expense_id, uploaded_by, storage_path, mime_type, size_bytes)
values (tests.expense_id('rls-e1'), tests.uid('alice'), tests.expense_id('rls-e1') || '/receipt.jpg', 'image/jpeg', 1000);
select tests.authenticate_as('bob');
insert into public.comments (expense_id, author_id, body) values (tests.expense_id('rls-e1'), tests.uid('bob'), 'Thanks!');
insert into public.notification_preferences (user_id, type, in_app) values (tests.uid('bob'), 'member_joined', false);
reset role;
insert into public.recurring_expenses (group_id, created_by, description, amount, currency, split_method,
                                       frequency, start_date, payers, shares, ledger_entries)
values (tests.group_id('RLS group'), tests.uid('alice'), 'Rent', 1000, 'INR', 'equal', 'monthly',
        current_date, '[]', '[]', '[]');

-- Review M6 (E2): rows on the less-visited tables, so their policies are actually exercised.
-- Itemized lines on the group expense after Carol left (Alice and Bob) and on the direct expense (Alice and Erin).
with item as (
  insert into public.expense_items (expense_id, version, position, name, amount)
  values (tests.expense_id('rls-e2'), 1, 0, 'Pizza', 10000) returning id
)
insert into public.expense_item_assignments (item_id, user_id)
select item.id, u from item, unnest(array[tests.uid('alice'), tests.uid('bob')]) as u;
with item as (
  insert into public.expense_items (expense_id, version, position, name, amount)
  values (tests.expense_id('rls-d1'), 1, 0, 'Fare', 20000) returning id
)
insert into public.expense_item_assignments (item_id, user_id)
select item.id, u from item, unnest(array[tests.uid('alice'), tests.uid('erin')]) as u;
insert into public.recurring_occurrences (recurring_expense_id, occurrence_date, status)
select id, current_date, 'skipped' from public.recurring_expenses where description = 'Rent';
-- A group settlement between Alice and Bob after Carol left (pending: no ledger effect).
select tests.authenticate_as('bob');
select public.create_settlement(tests.uid('rls-s2'), tests.group_id('RLS group'),
                                tests.uid('bob'), tests.uid('alice'), 500, 'INR');
reset role;

-- Counts every exposed table as the current role, so a new table is covered automatically.
create function tests.visible_rows() returns table (table_name text, row_count bigint)
language plpgsql security invoker set search_path = ''
as $f$
declare
  v_table text;
begin
  for v_table in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind = 'r' order by c.relname loop
    table_name := v_table;
    execute format('select count(*) from public.%I', v_table) into row_count;
    return next;
  end loop;
end;
$f$;
grant execute on function tests.visible_rows() to authenticated;

-- ---------------------------------------------------------------- non-member (dave)
select tests.authenticate_as('dave');
select results_eq(
  $$ select table_name from tests.visible_rows() where row_count > 0 order by 1 $$,
  $$ values ('profiles'::text) $$,
  'non-member: every exposed table is empty except their own profile');
select is((select count(*)::int from public.expense_items), 0, 'non-member: no itemized lines');
select is((select count(*)::int from public.expense_item_assignments), 0, 'non-member: no item assignments');
select is((select count(*)::int from public.recurring_occurrences), 0, 'non-member: no recurring occurrences');
select is((select count(*)::int from public.groups), 0, 'non-member: no groups');
select is((select count(*)::int from public.group_members), 0, 'non-member: no memberships');
select is((select count(*)::int from public.group_invitations), 0, 'non-member: no invitations');
select is((select count(*)::int from public.expenses), 0, 'non-member: no expenses');
select is((select count(*)::int from public.expense_payers), 0, 'non-member: no payers');
select is((select count(*)::int from public.expense_participants), 0, 'non-member: no participants');
select is((select count(*)::int from public.settlements), 0, 'non-member: no settlements');
select is((select count(*)::int from public.ledger_entries), 0, 'non-member: no ledger entries');
select is((select count(*)::int from public.audit_events), 0, 'non-member: no audit events');
select is((select count(*)::int from public.comments), 0, 'non-member: no comments');
select is((select count(*)::int from public.attachments), 0, 'non-member: no attachments');
select is((select count(*)::int from public.recurring_expenses), 0, 'non-member: no recurring expenses');
select is((select count(*)::int from public.notifications), 0, 'non-member: no notifications');
select is((select count(*)::int from public.profiles), 1, 'non-member: only their own profile');
select is((select count(*)::int from public.friendships), 0, 'non-member: no friendships');
select is((select count(*)::int from public.profile_cards(array[tests.uid('alice')])), 0,
          'non-member: cannot look up a stranger''s name');
select is((select count(*)::int from public.group_balances(tests.group_id('RLS group'))), 0,
          'non-member: no group balances');
select throws_ok(format($$ select public.create_invitation(%L) $$, tests.group_id('RLS group')),
                 'SM403', null, 'non-member: cannot create an invitation');
select throws_ok(format($$ select public.create_expense(gen_random_uuid(), %L, 'Sneaky', 100, 'INR', current_date, 'equal', %L, %L, '[]') $$,
                        tests.group_id('RLS group'), tests.amounts('dave', '100'), tests.amounts('dave', '100')),
                 'SM403', null, 'non-member: cannot add an expense to the group');

-- ---------------------------------------------------------------- removed member (carol)
select tests.authenticate_as('carol');
select is((select count(*)::int from public.groups), 1, 'removed member: still sees the group they have history in');
select is((select count(*)::int from public.expenses), 1, 'removed member: sees only the expense they were part of');
select is((select count(*)::int from public.ledger_entries), 2, 'removed member: sees only their own ledger rows');
select is((select count(*)::int from public.group_members), 1, 'removed member: sees only their own membership row');
select is((select count(*)::int from public.group_invitations), 0, 'removed member: no invitations');
select is((select count(*)::int from public.settlements), 1,
          'removed member: sees only their own settlement, not later ones between others');
select is((select count(*)::int from public.expense_items), 0, 'removed member: no itemized lines of later expenses');
select is((select count(*)::int from public.expense_item_assignments), 0, 'removed member: no item assignments of later expenses');
select is((select count(*)::int from public.recurring_occurrences), 0, 'removed member: no recurring occurrences');
select is((select count(*)::int from public.group_balances(tests.group_id('RLS group'))), 0,
          'removed member: their own history nets to zero');
select throws_ok(format($$ insert into public.comments (expense_id, author_id, body) values (%L, %L, 'Hi') $$,
                        tests.expense_id('rls-e1'), tests.uid('carol')),
                 '42501', null, 'removed member: cannot comment');
select is((select count(*)::int from public.audit_events where entity_id = tests.expense_id('rls-e2')), 0,
          'removed member: cannot see the history of later expenses');
select throws_ok(format($$ select public.create_expense(gen_random_uuid(), %L, 'After leaving', 100, 'INR', current_date, 'equal', %L, %L, '[]') $$,
                        tests.group_id('RLS group'), tests.amounts('carol', '100'), tests.amounts('carol', '100')),
                 'SM403', null, 'removed member: cannot add expenses');

-- ---------------------------------------------------------------- current member (bob)
select tests.authenticate_as('bob');
select is((select count(*)::int from public.expenses), 2, 'member: sees both group expenses but not the direct one');
select is((select count(*)::int from public.ledger_entries), 4, 'member: sees the whole group ledger');
select is((select count(*)::int from public.group_members), 3, 'member: sees current and former members');
select is((select count(*)::int from public.group_invitations), 1, 'member: sees the group''s invitations');
select throws_ok($$ select token_hash from public.group_invitations $$, '42501', null,
                 'member: cannot read invitation token hashes');
select is((select count(*)::int from public.comments), 1, 'member: sees comments');
select is((select count(*)::int from public.attachments), 1, 'member: sees attachments');
select is((select count(*)::int from public.recurring_expenses), 1, 'member: sees recurring expenses');
select is((select count(*)::int from public.recurring_occurrences), 1, 'member: sees the group''s recurring occurrences');
select is((select count(*)::int from public.expense_items), 1, 'member: sees the group''s itemized lines, not other people''s direct ones');
select is((select count(*)::int from public.expense_item_assignments), 2, 'member: sees the group''s item assignments only');
select is((select count(*)::int from public.settlements), 2, 'member: sees the group''s settlements');
select is((select count(*)::int from public.profiles), 1, 'member: profiles table shows only their own row');
select is((select count(*)::int from public.profile_cards(array[tests.uid('alice'), tests.uid('dave')])), 1,
          'member: public fields of group-mates only');
select ok((select count(*) from public.notifications) > 0, 'member: sees their notifications');
select is((select count(*)::int from public.notifications where user_id <> tests.uid('bob')), 0,
          'member: sees nobody else''s notifications');
select is((select count(*)::int from public.notification_preferences), 1, 'member: sees their own preferences');
select is((select count(*)::int from public.friendships), 2, 'member: sees their own friendships');
select throws_ok(format($$ insert into public.expenses (created_by, updated_by, description, amount, currency, expense_date, split_method, idempotency_key)
                           values (%L, %L, 'Direct insert', 1, 'INR', current_date, 'equal', gen_random_uuid()) $$,
                        tests.uid('bob'), tests.uid('bob')),
                 '42501', null, 'member: cannot insert expenses directly');
select throws_ok($$ delete from public.ledger_entries $$, '42501', null, 'member: cannot delete ledger entries');
with u as (update public.groups set name = 'Hacked' returning 1)
select is(count(*)::int, 0, 'member: non-admins cannot rename the group') from u;
with u as (update public.profiles set display_name = 'Bobby' returning 1)
select is(count(*)::int, 1, 'member: can update their own profile') from u;
with u as (update public.profiles set display_name = 'Hacked' where id = tests.uid('alice') returning 1)
select is(count(*)::int, 0, 'member: cannot update someone else''s profile') from u;
select throws_ok($$ update public.profiles set email = 'x@tests.local' $$, '42501', null,
                 'member: cannot change their email column directly');
with u as (update public.notifications set read_at = now() returning 1)
select ok(count(*) > 0, 'member: can mark their notifications as read') from u;

-- ---------------------------------------------------------------- direct-expense friend (erin)
select tests.authenticate_as('erin');
select is((select count(*)::int from public.expenses), 1, 'friend: sees only the direct expense they share');
select is((select count(*)::int from public.ledger_entries), 1, 'friend: sees only their direct ledger row');
select is((select count(*)::int from public.groups), 0, 'friend: sees no groups they are not in');

-- ---------------------------------------------------------------- admin (alice)
select tests.authenticate_as('alice');
with u as (update public.groups set simplify_debts = false returning 1)
select is(count(*)::int, 1, 'admin: can change group settings') from u;
select lives_ok(format($$ insert into public.comments (expense_id, author_id, body) values (%L, %L, 'Paid by cash') $$,
                       tests.expense_id('rls-d1'), tests.uid('alice')),
                'friend in a direct expense: can comment on it');

-- ---------------------------------------------------------------- anonymous
select tests.authenticate_anon();
select throws_ok($$ select count(*) from public.expenses $$, '42501', null, 'anon: cannot read expenses');
select throws_ok($$ select count(*) from public.profiles $$, '42501', null, 'anon: cannot read profiles');
select throws_ok($$ select public.create_group('Anon group') $$, '42501', null, 'anon: cannot call RPC functions');
select throws_ok(format($$ select * from public.group_balances(%L) $$, tests.group_id('RLS group')),
                 '42501', null, 'anon: cannot read balances');

reset role;
select * from finish();
rollback;
