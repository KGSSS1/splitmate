-- Hosted Supabase projects no longer grant the API roles access to new tables
-- and functions in public by default (Supabase changelog 45329: the default for
-- new projects since 2026-05-30 and for all projects from 2026-10-30). anon and
-- authenticated already get only explicit grants (foundation migration). The
-- local stack still grants service_role everything, so grant it explicitly
-- here and local and hosted databases behave the same. service_role bypasses
-- RLS and is used only by server-only code and test tooling.

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
