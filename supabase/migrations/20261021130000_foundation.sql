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

-- Supported ISO 4217 codes. Must match CURRENCIES in src/lib/money/currencies.ts
-- (tests/unit/money/currency-sync.test.ts checks this).
create domain public.currency_code as text
  constraint currency_code_supported check (value in (
    'INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'BDT', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK',
    'DKK', 'EGP', 'HKD', 'IDR', 'ILS', 'KES', 'LKR', 'MXN', 'MYR', 'NGN', 'NOK', 'NPR',
    'NZD', 'PHP', 'PKR', 'PLN', 'QAR', 'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'ZAR',
    'CLP', 'ISK', 'JPY', 'KRW', 'UGX', 'VND', 'BHD', 'JOD', 'KWD', 'OMR', 'TND'
  ));

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

-- True for a code in the currency_code domain's list (single source of the list in SQL).
create function private.is_supported_currency(p_code text) returns boolean
language plpgsql immutable set search_path = ''
as $$
begin
  if p_code is null then
    return false;
  end if;
  perform p_code::public.currency_code;
  return true;
exception
  when check_violation then
    return false;
end;
$$;

-- At most 20 tags of 1–40 characters each.
create function private.tags_valid(p_tags text[]) returns boolean
language sql immutable set search_path = ''
as $$
  select cardinality(p_tags) <= 20
     and not exists (select 1 from unnest(p_tags) as t where t is null or char_length(t) not between 1 and 40);
$$;

-- Nothing in public is readable, writable or executable by API roles unless a
-- later migration grants it explicitly (Supabase's defaults grant everything).
-- The first line removes PostgreSQL's built-in EXECUTE-to-PUBLIC default, which a
-- per-schema statement cannot revoke.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
revoke execute on all functions in schema private from public;
