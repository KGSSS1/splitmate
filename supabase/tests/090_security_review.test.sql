-- Regression tests for the findings of the independent security review (M2).
-- Each block names the finding it guards against.
begin;
select plan(31);

select tests.create_user(name)
  from unnest(array['xa', 'xb', 'xc', 'xd', 'ra', 'rb', 'rc', 'rn', 'fa', 'fb', 'fc', 'ea', 'eb', 'dz']) as name;
select tests.make_group('Pairwise', 'xa', array['xb', 'xc', 'xd']);
select tests.make_group('Removal', 'ra', array['rb', 'rc']);
select tests.make_group('History', 'fa', array['fb', 'fc']);

-- ---------------------------------------------------------------- 1 (high): pairwise entries must follow the payments
select tests.authenticate_as('xb');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Rewired', 20000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Pairwise'), tests.amounts('xa', '20000'), tests.amounts('xa', '10000', 'xb', '10000', 'xc', '0'),
         tests.debts('xb', 'xc', '10000', 'xc', 'xa', '10000')),
  'SM422', null, '#1 a debt cannot be routed through someone with no stake in the expense');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Both ways', 20000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Pairwise'), tests.amounts('xa', '20000'), tests.amounts('xa', '10000', 'xb', '10000'),
         tests.debts('xb', 'xa', '500000', 'xa', 'xb', '490000')),
  'SM422', null, '#1 the same pair cannot owe in both directions');
-- 1200 shared by four (300 each); xa paid 800 (+500), xb paid 400 (+100).
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Skewed', 1200, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Pairwise'), tests.amounts('xa', '800', 'xb', '400'),
         tests.amounts('xa', '300', 'xb', '300', 'xc', '300', 'xd', '300'),
         tests.debts('xc', 'xa', '300', 'xd', 'xa', '200', 'xd', 'xb', '100')),
  'SM422', null, '#1 a multi-payer allocation that is not proportional is rejected');
select lives_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Proportional', 1200, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Pairwise'), tests.amounts('xa', '800', 'xb', '400'),
         tests.amounts('xa', '300', 'xb', '300', 'xc', '300', 'xd', '300'),
         tests.debts('xc', 'xa', '250', 'xc', 'xb', '50', 'xd', 'xa', '250', 'xd', 'xb', '50')),
  '#1 the proportional allocation from src/lib/accounting is accepted');
-- Rounding: 2 debtors owe 1 each to 2 creditors owed 1 each (exact 0.5 per cell): one unit per row and column.
select lives_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Rounded', 4, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.group_id('Pairwise'), tests.amounts('xa', '2', 'xb', '2'),
         tests.amounts('xa', '1', 'xb', '1', 'xc', '1', 'xd', '1'),
         tests.debts('xc', 'xa', '1', 'xd', 'xb', '1')),
  '#1 entries within one minor unit of the exact proportional value are accepted');

-- ---------------------------------------------------------------- 2 (high): no rejoining through your own old invitation
select tests.authenticate_as('rb');
create temp table rb_invite as select * from public.create_invitation(tests.group_id('Removal'), null, 100, 720);
select tests.authenticate_as('ra');
select public.remove_group_member(tests.group_id('Removal'), tests.uid('rb'));
reset role;
select ok((select revoked_at is not null from public.group_invitations where id = (select invitation_id from rb_invite)),
          '#2 removing a member revokes the invitations they created');
select tests.authenticate_as('rb');
select throws_ok(format($$ select public.accept_invitation(%L) $$, (select token from rb_invite)), 'SM409', null,
                 '#2 a removed member cannot rejoin with their own old invitation');
select tests.authenticate_as('rn');
select throws_ok(format($$ select public.accept_invitation(%L) $$, (select token from rb_invite)), 'SM409', null,
                 '#2 nobody can join through a removed member''s link');
reset role;
update public.group_invitations set revoked_at = null where id = (select invitation_id from rb_invite);
select tests.authenticate_as('rn');
select throws_ok(format($$ select public.accept_invitation(%L) $$, (select token from rb_invite)),
                 'SM409', 'This invitation is no longer valid',
                 '#2/#8 an invitation from someone no longer in the group is refused even if not revoked');
reset role;
select is((select count(*)::int from public.notifications where user_id = tests.uid('rb') and type = 'member_joined'), 0,
          '#8 a removed member receives no group notifications');

-- ---------------------------------------------------------------- 3 (high): history involving a former member is frozen
select tests.add_equal_expense('old', tests.group_id('History'), 'fa', 2000, array['fa', 'fb']);
select public.create_settlement(gen_random_uuid(), tests.group_id('History'), tests.uid('fb'), tests.uid('fa'), 1000, 'INR');
select tests.authenticate_as('fb');
select public.leave_group(tests.group_id('History'));
select tests.authenticate_as('fc');
select throws_ok(format($$ select public.cancel_expense(%L, 1) $$, tests.expense_id('old')), 'SM409', null,
                 '#3 an expense involving a former member cannot be cancelled');
select throws_ok(
  format($$ select public.update_expense(%L, 1, 'Changed', 2000, 'INR', current_date, 'equal', %L, %L, %L) $$,
         tests.expense_id('old'), tests.amounts('fa', '2000'), tests.amounts('fa', '1000', 'fc', '1000'),
         tests.debts('fc', 'fa', '1000')),
  'SM409', null, '#3 an expense involving a former member cannot be edited');
select is((select count(*)::int from public.group_balances(tests.group_id('History'))), 0,
          '#3 the former member''s balance stays zero');

-- ---------------------------------------------------------------- 4 (low): removed members cannot edit their comments
select tests.add_equal_expense('chat', tests.group_id('Removal'), 'ra', 300, array['ra', 'rc']);
select tests.authenticate_as('rc');
insert into public.comments (expense_id, author_id, body) values (tests.expense_id('chat'), tests.uid('rc'), 'Original');
select public.create_settlement(gen_random_uuid(), tests.group_id('Removal'), tests.uid('rc'), tests.uid('ra'), 150, 'INR');
create temp table rc_pending as
select public.create_settlement(tests.uid('rc-pending'), tests.group_id('Removal'), tests.uid('rc'), tests.uid('ra'), 50, 'INR') as id;
select tests.authenticate_as('ra');
select public.confirm_settlement(s.id) from public.settlements s
 where s.payer_id = tests.uid('rc') and s.amount = 150;
select public.remove_group_member(tests.group_id('Removal'), tests.uid('rc'));
select tests.authenticate_as('rc');
with u as (update public.comments set body = 'Edited after removal' returning 1)
select is(count(*)::int, 0, '#4 a removed member cannot edit their old comments') from u;

-- ---------------------------------------------------------------- 5 (low): removed members cannot act on settlements
select throws_ok(format($$ select public.cancel_settlement(%L) $$, (select id from rc_pending)), 'SM403', null,
                 '#5 a removed member cannot cancel a group settlement');
reset role;
select is((select status from public.settlements where id = (select id from rc_pending)), 'withdrawn',
          '#5 a member''s pending settlements are withdrawn when they leave the group');
select is((select count(*)::int from public.notifications
            where settlement_id = (select id from rc_pending) and type = 'settlement_cancelled' and user_id = tests.uid('rc')), 1,
          '#5 the removed member is told their pending settlement was cancelled');

-- ---------------------------------------------------------------- 6 (low): the invitation rate limit is serialized
select tests.authenticate_as('xa');
select public.create_invitation(tests.group_id('Pairwise'));
reset role;
select ok(exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted),
          '#6 creating an invitation takes a per-user advisory lock, so parallel requests cannot exceed the limit');

-- ---------------------------------------------------------------- 7 (low): functions added later are not callable by default
create function public.zz_probe() returns int language sql as $$ select 1 $$;
create function private.zz_probe() returns int language sql as $$ select 1 $$;
select ok(not has_function_privilege('anon', 'public.zz_probe()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.zz_probe()', 'EXECUTE'),
          '#7 a new public function is not executable until granted');
select ok(not has_function_privilege('authenticated', 'private.zz_probe()', 'EXECUTE'),
          '#7 a new private function is not executable until granted');

-- ---------------------------------------------------------------- 9 (low): former members do not see later joiners
-- now() is frozen inside a transaction, so backdate rc's membership to make "later" real.
reset role;
update public.group_members set joined_at = now() - interval '2 days', left_at = now() - interval '1 hour'
 where group_id = tests.group_id('Removal') and user_id = tests.uid('rc');
select tests.authenticate_as('ra');
create temp table removal_invite as select * from public.create_invitation(tests.group_id('Removal'));
select tests.authenticate_as('rn');
select public.accept_invitation((select token from removal_invite));
select tests.authenticate_as('rc');
select is((select count(*)::int from public.profile_cards(array[tests.uid('rn')])), 0,
          '#9 a former member cannot look up someone who joined after they left');
select is((select count(*)::int from public.profile_cards(array[tests.uid('ra')])), 1,
          '#9 a former member still sees the people they shared the group with');

-- ---------------------------------------------------------------- 10 (low): stricter inputs
select tests.authenticate_as('xa');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Fake currency', 100, 'ZZZ', current_date, 'equal', %L, %L, '[]') $$,
         tests.group_id('Pairwise'), tests.amounts('xa', '100'), tests.amounts('xa', '100')),
  'SM422', 'Unsupported currency', '#10 expenses only accept supported ISO 4217 currencies');
select throws_ok($$ select public.create_group('Fake', 'ZZZ') $$, 'SM422', 'Unsupported currency',
                 '#10 groups only accept supported currencies');
select throws_ok(
  format($$ select public.create_settlement(gen_random_uuid(), %L, %L, %L, 100, 'ZZZ') $$,
         tests.group_id('Pairwise'), tests.uid('xb'), tests.uid('xa')),
  'SM422', 'Unsupported currency', '#10 settlements only accept supported currencies');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Far future', 100, 'INR', '9999-12-31', 'equal', %L, %L, '[]') $$,
         tests.group_id('Pairwise'), tests.amounts('xa', '100'), tests.amounts('xa', '100')),
  'SM422', null, '#10 expense dates must be plausible');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Long tag', 100, 'INR', current_date, 'equal', %L, %L, '[]', p_tags => array[repeat('x', 41)]) $$,
         tests.group_id('Pairwise'), tests.amounts('xa', '100'), tests.amounts('xa', '100')),
  '23514', null, '#10 tags are limited to 40 characters each');
select throws_ok(
  format($$ select public.create_expense(gen_random_uuid(), %L, 'Crowd', 101, 'INR', current_date, 'equal', %L, %L, '[]') $$,
         tests.group_id('Pairwise'), tests.amounts('xa', '101'),
         (select jsonb_agg(jsonb_build_object('user_id', gen_random_uuid(), 'amount', 1)) from generate_series(1, 101))),
  'SM422', 'An expense can have at most 100 payers and 100 participants',
  'hardening: payloads are capped at 100 participants');

-- ---------------------------------------------------------------- plausible concerns
-- Email invitations require a confirmed email address.
reset role;
update auth.users set email_confirmed_at = null where id = tests.uid('eb');
select tests.authenticate_as('xa');
create temp table email_invite as select * from public.create_invitation(tests.group_id('Pairwise'), 'eb@tests.local');
select tests.authenticate_as('eb');
select throws_ok(format($$ select public.accept_invitation(%L) $$, (select token from email_invite)), 'SM403', null,
                 'an email invitation cannot be claimed before the email address is confirmed');
-- A deleted (anonymized) account cannot keep writing with a still-valid token.
reset role;
update public.profiles set deleted_at = now(), email = null where id = tests.uid('xd');
select tests.authenticate_as('xd');
select throws_ok(
  format($$ insert into public.comments (expense_id, author_id, body) values (%L, %L, 'Ghost') $$,
         (select id from public.expenses where description = 'Proportional'), tests.uid('xd')),
  '42501', null, 'a deleted account cannot comment');

-- ---------------------------------------------------------------- hardening: internal helpers
reset role;
select ok(not has_function_privilege('authenticated', 'private.expense_version_users(uuid, integer)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'private.are_friends(uuid, uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'private.is_expense_party(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'private.shares_context_with(uuid)', 'EXECUTE'),
          'helpers that accept arbitrary IDs are not directly callable by clients');

select * from finish();
rollback;
