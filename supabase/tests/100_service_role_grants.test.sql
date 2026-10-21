-- service_role has explicit access to everything in public, also for objects
-- created by later migrations, while anon and authenticated still get nothing
-- by default. Hosted projects no longer add these grants on their own.
begin;
select plan(5);

select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and not has_table_privilege('service_role', c.oid, 'select, insert, update, delete')),
  0,
  'service_role can read and write every public table');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not has_function_privilege('service_role', p.oid, 'execute')),
  0,
  'service_role can execute every public function');

-- Objects created by a future migration (as postgres) get the same grants.
create table public.grants_probe (id uuid primary key);
create function public.grants_probe_fn() returns int language sql as 'select 1';

select ok(
  has_table_privilege('service_role', 'public.grants_probe', 'select, insert, update, delete'),
  'new tables are granted to service_role by default');
select ok(
  has_function_privilege('service_role', 'public.grants_probe_fn()', 'execute'),
  'new functions are executable by service_role by default');
select ok(
  not has_table_privilege('authenticated', 'public.grants_probe', 'select')
    and not has_table_privilege('anon', 'public.grants_probe', 'select')
    and not has_function_privilege('anon', 'public.grants_probe_fn()', 'execute'),
  'new objects stay closed to anon and authenticated');

select * from finish();
rollback;
