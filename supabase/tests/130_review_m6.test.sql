-- Regression tests for the Critical/High findings of the M6 independent review
-- (docs/reviews/review-M6.md) that live in the database.
begin;
select plan(12);

select tests.create_user(name) from unnest(array['alice', 'bob', 'mallory', 'lena']) as name;
select tests.make_group('Flat', 'alice', array['bob']);

-- ---------------------------------------------------------------- B1: a removed member rejoining
-- Alice's multi-use link, created before anyone is removed.
select tests.authenticate_as('alice');
create temp table old_link as select * from public.create_invitation(tests.group_id('Flat'), null, 10, 720);
grant select on old_link to authenticated;
-- Every statement here shares one transaction timestamp; the link predates the removal in real life.
reset role;
update public.group_invitations set created_at = now() - interval '1 day'
 where id = (select invitation_id from old_link);

select tests.authenticate_as('mallory');
select is(public.accept_invitation((select token from old_link)), tests.group_id('Flat'), 'mallory joins with the link');
select tests.authenticate_as('lena');
select is(public.accept_invitation((select token from old_link)), tests.group_id('Flat'), 'lena joins with the link');

select tests.authenticate_as('alice');
select public.remove_group_member(tests.group_id('Flat'), tests.uid('mallory'));
select tests.authenticate_as('lena');
select public.leave_group(tests.group_id('Flat'));

select tests.authenticate_as('mallory');
select throws_ok(format($$ select public.accept_invitation(%L) $$, (select token from old_link)),
                 'SM403', null, 'a removed member cannot rejoin with a link created before the removal');
reset role;
select ok((select removed_by is not null and left_at is not null from public.group_members
            where group_id = tests.group_id('Flat') and user_id = tests.uid('mallory')),
          'the removal stays on record');

select tests.authenticate_as('lena');
select is(public.accept_invitation((select token from old_link)), tests.group_id('Flat'),
          'someone who left on their own can rejoin with a link they can still use');

-- An invitation created after the removal is a deliberate re-invite.
select tests.authenticate_as('alice');
create temp table new_link as select * from public.create_invitation(tests.group_id('Flat'), null, 1, 24);
grant select on new_link to authenticated;
select tests.authenticate_as('mallory');
select is(public.accept_invitation((select token from new_link)), tests.group_id('Flat'),
          'a removed member can rejoin with an invitation created after the removal');
reset role;
select ok((select left_at is null and removed_by is null from public.group_members
            where group_id = tests.group_id('Flat') and user_id = tests.uid('mallory')),
          'after a deliberate re-invite she is a current member again');

-- ---------------------------------------------------------------- F1: activity cost follows the caller
-- 1,500 events in a group Alice isn't in, and one expense of hers.
reset role;
select tests.make_group('Noise', 'bob', array['mallory']);
insert into public.audit_events (actor_id, action, entity_type, entity_id, group_id, after)
select tests.uid('bob'), 'expense.created', 'expense', gen_random_uuid(), tests.group_id('Noise'), '{}'::jsonb
  from generate_series(1, 1500);
select tests.add_equal_expense('alice-dinner', tests.group_id('Flat'), 'alice', 10000, array['alice', 'bob']);
-- Up-to-date statistics, as autovacuum keeps them in a real database; without them the
-- planner assumes the tables are tiny and scans everything.
reset role;
analyze public.audit_events, public.group_members, public.settlements, public.expense_participants,
        public.expense_payers;

-- How many times the RLS visibility helpers run while `p_sql` executes.
reset role;
set local track_functions = 'all';
create function tests.visibility_checks(p_sql text) returns bigint
language plpgsql security invoker set search_path = ''
as $f$
declare
  v_before bigint;
  v_after bigint;
  v_sum text := $q$ select coalesce(sum(pg_catalog.pg_stat_get_xact_function_calls(p.oid)), 0)
                     from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'private'
                      and p.proname in ('is_group_member', 'can_view_expense', 'can_view_settlement') $q$;
begin
  execute v_sum into v_before;
  execute p_sql;
  execute v_sum into v_after;
  return v_after - v_before;
end;
$f$;
grant execute on function tests.visibility_checks(text) to authenticated;

select tests.authenticate_as('alice');
select ok(tests.visibility_checks($$ select * from public.audit_events
                                      where entity_type in ('expense', 'settlement')
                                      order by created_at desc limit 25 $$) >= 1500,
          'a plain RLS select checks visibility for every event in the system (why my_activity exists)');
select ok(tests.visibility_checks($$ select * from public.my_activity(25, 0) $$) < 100,
          'my_activity only checks the caller''s own candidate events');
select set_eq(
  $$ select id from public.my_activity(100, 0) $$,
  $$ select id from public.audit_events
      where entity_type in ('expense', 'settlement')
        and action in ('expense.created', 'expense.updated', 'expense.cancelled', 'settlement.created',
                       'settlement.confirmed', 'settlement.rejected', 'settlement.cancelled',
                       'settlement.withdrawn') $$,
  'my_activity shows exactly what RLS lets the caller see');
select ok((select count(*) from public.my_activity(25, 0) where group_id = tests.group_id('Noise')) = 0
          and (select count(*) from public.my_activity(25, 0) where entity_id = tests.expense_id('alice-dinner')) = 1,
          'it includes her expense and nothing from a group she is not in');
select is((select max(total_count) from public.my_activity(1, 0)),
          (select count(*) from public.my_activity(100, 0)), 'total_count counts every matching event, not just the page');

select * from finish();
rollback;
