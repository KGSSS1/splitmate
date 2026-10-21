-- Smoke test: proves the pgTAP runner works against the local database.
begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

select has_schema('public', 'public schema exists');
select has_schema('auth', 'Supabase auth schema exists');

select * from finish();
rollback;
