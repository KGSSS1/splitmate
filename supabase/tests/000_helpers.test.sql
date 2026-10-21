-- Test helpers for the pgTAP suite. This file COMMITS so later files can use the
-- `tests` schema; it only ever exists in the local database (`supabase test db`).
begin;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- Deterministic user IDs from readable names.
create or replace function tests.uid(p_name text) returns uuid
language sql immutable
as $$
  select md5('splitmate-test:' || p_name)::uuid;
$$;

-- Creates an auth user (the signup trigger creates the profile). Email defaults to <name>@tests.local.
create or replace function tests.create_user(p_name text, p_email text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', tests.uid(p_name), 'authenticated', 'authenticated',
    coalesce(p_email, p_name || '@tests.local'), '', now(),
    '{"provider": "email", "providers": ["email"]}', jsonb_build_object('display_name', initcap(p_name)),
    now(), now()
  );
  return tests.uid(p_name);
end;
$$;

-- Act as a signed-in user for the rest of the transaction (like a request with their JWT).
-- Use `reset role;` to return to postgres.
create or replace function tests.authenticate_as(p_name text) returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', tests.uid(p_name), 'role', 'authenticated')::text, true);
end;
$$;

create or replace function tests.authenticate_anon() returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
end;
$$;

create or replace function tests.make_friends(p_a text, p_b text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.friendships (user_low, user_high, requested_by, status, accepted_at)
  values (least(tests.uid(p_a), tests.uid(p_b)), greatest(tests.uid(p_a), tests.uid(p_b)),
          tests.uid(p_a), 'accepted', now())
  on conflict (user_low, user_high) do update set status = 'accepted', accepted_at = now();
$$;

-- Group with `p_owner` as admin and `p_members` as members, all friends with each other.
create or replace function tests.make_group(p_name text, p_owner text, p_members text[] default '{}')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_group uuid;
  v_all text[] := array[p_owner] || p_members;
  v_a text;
  v_b text;
begin
  insert into public.groups (name, created_by) values (p_name, tests.uid(p_owner)) returning id into v_group;
  insert into public.group_members (group_id, user_id, role) values (v_group, tests.uid(p_owner), 'admin');
  insert into public.group_members (group_id, user_id, role)
  select v_group, tests.uid(m), 'member' from unnest(p_members) as m;
  foreach v_a in array v_all loop
    foreach v_b in array v_all loop
      if v_a < v_b then
        perform tests.make_friends(v_a, v_b);
      end if;
    end loop;
  end loop;
  return v_group;
end;
$$;

create or replace function tests.group_id(p_name text) returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from public.groups where name = p_name;
$$;

-- Expenses and settlements are looked up by the idempotency key tests.uid(key).
create or replace function tests.expense_id(p_key text) returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from public.expenses where idempotency_key = tests.uid(p_key);
$$;

create or replace function tests.settlement_id(p_key text) returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from public.settlements where idempotency_key = tests.uid(p_key);
$$;

-- tests.amounts('alice', '90000', 'bob', '0') → [{"user_id": …, "amount": 90000}, …]
create or replace function tests.amounts(variadic p_pairs text[]) returns jsonb
language plpgsql stable
as $$
declare
  v_result jsonb := '[]'::jsonb;
begin
  for i in 1 .. coalesce(array_length(p_pairs, 1), 0) by 2 loop
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('user_id', tests.uid(p_pairs[i]), 'amount', p_pairs[i + 1]::numeric));
  end loop;
  return v_result;
end;
$$;

-- tests.debts('bob', 'alice', '30000', …) → [{"debtor_id": bob, "creditor_id": alice, "amount": 30000}, …]
create or replace function tests.debts(variadic p_triples text[]) returns jsonb
language plpgsql stable
as $$
declare
  v_result jsonb := '[]'::jsonb;
begin
  for i in 1 .. coalesce(array_length(p_triples, 1), 0) by 3 loop
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'debtor_id', tests.uid(p_triples[i]), 'creditor_id', tests.uid(p_triples[i + 1]),
      'amount', p_triples[i + 2]::numeric));
  end loop;
  return v_result;
end;
$$;

-- Equal ₹/$ expense paid by one person (amount divisible by the number of people),
-- created through public.create_expense as the payer.
create or replace function tests.add_equal_expense(
  p_key text, p_group uuid, p_payer text, p_amount bigint, p_people text[], p_currency text default 'INR'
) returns uuid
language plpgsql
as $$
declare
  v_share bigint := p_amount / cardinality(p_people);
  v_participants jsonb := '[]'::jsonb;
  v_ledger jsonb := '[]'::jsonb;
  v_person text;
begin
  foreach v_person in array p_people loop
    v_participants := v_participants || jsonb_build_array(
      jsonb_build_object('user_id', tests.uid(v_person), 'amount', v_share));
    if v_person <> p_payer then
      v_ledger := v_ledger || jsonb_build_array(jsonb_build_object(
        'debtor_id', tests.uid(v_person), 'creditor_id', tests.uid(p_payer), 'amount', v_share));
    end if;
  end loop;
  perform tests.authenticate_as(p_payer);
  return public.create_expense(
    tests.uid(p_key), p_group, 'Expense ' || p_key, p_amount, p_currency, current_date, 'equal',
    tests.amounts(p_payer, p_amount::text), v_participants, v_ledger);
end;
$$;

-- Simulates the Storage API's delete permission for direct SQL deletes in tests.
create or replace function tests.allow_storage_delete() returns void
language sql
as $$
  select set_config('storage.allow_delete_query', 'true', true);
$$;

grant execute on all functions in schema tests to anon, authenticated;

select plan(1);
select ok(to_regnamespace('tests') is not null, 'test helpers are installed');
select * from finish();

commit;
