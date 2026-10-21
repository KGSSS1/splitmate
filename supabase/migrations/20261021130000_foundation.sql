-- Foundation: shared types, the private schema and the updated_at trigger.
--
-- Error codes raised by SplitMate database functions (mapped to messages in the app):
--   SM401 not signed in · SM403 not allowed · SM404 not found
--   SM409 version or state conflict · SM422 invalid input · SM429 rate limited

-- Money: integer minor units, capped at Number.MAX_SAFE_INTEGER to match src/lib/money.
create domain public.minor_amount as bigint
  check (value > 0 and value <= 9007199254740991);

-- A participant's share may be 0 (excluded member).
create domain public.share_amount as bigint
  check (value >= 0 and value <= 9007199254740991);

-- ISO 4217 code; the supported list lives in src/lib/money/currencies.ts.
create domain public.currency_code as text
  check (value ~ '^[A-Z]{3}$');

create domain public.notification_type as text
  check (value in (
    'group_invitation', 'member_joined', 'member_left', 'member_removed',
    'expense_added', 'expense_updated', 'expense_cancelled',
    'settlement_recorded', 'settlement_confirmed', 'settlement_rejected', 'settlement_cancelled',
    'recurring_created', 'friend_request', 'friend_accepted'
  ));

-- Internal functions live in `private`, which PostgREST does not expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Raises a SplitMate error with one of the codes above.
create function private.fail(p_code text, p_message text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = p_code, message = p_message;
end;
$$;

-- Tables in public are not readable or writable by API roles unless a later
-- migration grants it explicitly (Supabase's defaults grant everything).
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public;
