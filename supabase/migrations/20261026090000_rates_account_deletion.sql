-- M9: stored exchange rates for an approximate converted total (SPEC §13) and
-- account deletion with anonymization (SPEC §6, §8).
--
-- Rates come from Frankfurter (ECB reference rates, free, no key) and are
-- fetched by the database itself: pg_cron queues a request through pg_net, and
-- a second job stores the answer. Nothing the app or a user sends can write a
-- rate, and nothing in expense tracking reads one.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- exchange_rates
-- ---------------------------------------------------------------------------

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('frankfurter')),
  base public.currency_code not null,
  quote public.currency_code not null,
  -- Units of `quote` per one unit of `base`, exactly as the provider sent it.
  rate numeric(24, 10) not null check (rate > 0),
  rate_date date not null check (rate_date between date '2000-01-01' and date '2100-12-31'),
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint exchange_rates_unique unique (provider, base, quote, rate_date),
  constraint exchange_rates_distinct check (base <> quote)
);

create index exchange_rates_quote_date_idx on public.exchange_rates (quote, rate_date desc);

alter table public.exchange_rates enable row level security;
-- Reference rates are public information; signed-in users may read them. No
-- client writes: only the private functions below insert.
create policy exchange_rates_select on public.exchange_rates for select to authenticated using (true);
grant select on public.exchange_rates to authenticated;
grant all on public.exchange_rates to service_role;

-- Requests queued through pg_net, so the collector knows which responses are ours.
create table private.exchange_rate_requests (
  id uuid primary key default gen_random_uuid(),
  request_id bigint not null unique,
  url text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  rates_stored integer,
  error text check (error is null or char_length(error) <= 500),
  requested_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Stores one provider response: {"base": "EUR", "date": "YYYY-MM-DD", "rates": {"INR": 106.272, ...}}.
-- Only supported currencies are kept; anything malformed raises, and the caller
-- records the failure. Returns how many rates were stored.
create function private.store_exchange_rates(p_body jsonb, p_provider text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_base text := p_body ->> 'base';
  v_date date;
  v_quote text;
  v_value jsonb;
  v_count integer := 0;
begin
  if jsonb_typeof(p_body -> 'rates') <> 'object' or v_base is null or not private.is_supported_currency(v_base) then
    raise exception 'Unexpected exchange-rate response';
  end if;
  v_date := (p_body ->> 'date')::date;
  for v_quote, v_value in select key, value from jsonb_each(p_body -> 'rates') loop
    continue when not private.is_supported_currency(v_quote) or v_quote = v_base;
    if jsonb_typeof(v_value) <> 'number' or (v_value #>> '{}')::numeric <= 0 then
      raise exception 'Unexpected rate for %', v_quote;
    end if;
    insert into public.exchange_rates (provider, base, quote, rate, rate_date)
    values (p_provider, v_base, v_quote, (v_value #>> '{}')::numeric, v_date)
    on conflict (provider, base, quote, rate_date)
      do update set rate = excluded.rate, retrieved_at = now();
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    raise exception 'No supported rates in the response';
  end if;
  return v_count;
end;
$$;

-- Queues today's request to Frankfurter. The response arrives asynchronously
-- (pg_net sends it after this transaction commits).
create function private.request_exchange_rates() returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_url constant text := 'https://api.frankfurter.dev/v1/latest?base=EUR';
  v_request bigint;
begin
  v_request := net.http_get(url := v_url, timeout_milliseconds := 10000);
  insert into private.exchange_rate_requests (request_id, url) values (v_request, v_url);
  return v_request;
end;
$$;

-- Stores the answers to pending requests. A failure (provider down, bad JSON)
-- is recorded and changes nothing else: the app keeps the last stored rates,
-- and expense tracking never depends on them. Returns how many rates were stored.
create function private.collect_exchange_rates() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_request private.exchange_rate_requests%rowtype;
  v_status integer;
  v_content text;
  v_error text;
  v_stored integer;
  v_total integer := 0;
begin
  for v_request in
    select * from private.exchange_rate_requests where status = 'pending' order by requested_at for update skip locked
  loop
    select r.status_code, r.content, coalesce(r.error_msg, case when r.timed_out then 'Timed out' end)
      into v_status, v_content, v_error
      from net._http_response r where r.id = v_request.request_id;
    if not found then
      if v_request.requested_at < now() - interval '1 hour' then
        update private.exchange_rate_requests
           set status = 'failed', error = 'No response', finished_at = now()
         where id = v_request.id;
      end if;
      continue;
    end if;
    begin
      if v_status is distinct from 200 or v_content is null then
        raise exception '%', coalesce(v_error, 'HTTP ' || coalesce(v_status::text, 'error'));
      end if;
      v_stored := private.store_exchange_rates(v_content::jsonb, 'frankfurter');
      update private.exchange_rate_requests
         set status = 'done', rates_stored = v_stored, finished_at = now()
       where id = v_request.id;
      v_total := v_total + v_stored;
    exception when others then
      update private.exchange_rate_requests
         set status = 'failed', error = left(sqlerrm, 500), finished_at = now()
       where id = v_request.id;
    end;
  end loop;
  -- Rates older than about a year and old request rows are no longer useful.
  delete from public.exchange_rates where rate_date < current_date - 400;
  delete from private.exchange_rate_requests where requested_at < now() - interval '30 days';
  return v_total;
end;
$$;

revoke all on function private.store_exchange_rates(jsonb, text) from public;
revoke all on function private.request_exchange_rates() from public;
revoke all on function private.collect_exchange_rates() from public;

-- ECB publishes reference rates around 16:00 CET on working days.
select cron.schedule('splitmate-exchange-rates-request', '20 15 * * *', 'select private.request_exchange_rates()');
select cron.schedule('splitmate-exchange-rates-collect', '25 15 * * *', 'select private.collect_exchange_rates()');

-- The newest stored rate for each currency, with the rate as exact text (the
-- Data API would turn numeric into a float).
create function public.latest_exchange_rates()
returns table (provider text, base text, quote text, rate text, rate_date date, retrieved_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select distinct on (r.base, r.quote)
         r.provider, r.base::text, r.quote::text, r.rate::text, r.rate_date, r.retrieved_at
    from public.exchange_rates r
   order by r.base, r.quote, r.rate_date desc, r.retrieved_at desc;
$$;

revoke all on function public.latest_exchange_rates() from public, anon;
grant execute on function public.latest_exchange_rates() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Account deletion (SPEC §6: anonymize, keep financial history)
-- ---------------------------------------------------------------------------

-- Deletes the caller's account in one transaction:
-- 1. refuses while they owe or are owed anything (a group net or a direct
--    balance with a friend, in any currency), so nobody is left with a debt to
--    "Deleted user";
-- 2. leaves every group (end_membership: revokes their invitations, withdraws
--    pending repayments there, hands over admin), withdraws direct pending
--    repayments and cancels their recurring schedules;
-- 3. removes personal data that isn't anyone's history: friendships, friend
--    requests they sent, their notifications and preferences;
-- 4. anonymizes the profile ("Deleted user", no email or avatar) and deletes
--    the auth user, which also ends every session.
-- Expenses, settlements, comments, receipts and the ledger stay as they are, so
-- other people's balances and history are unchanged.
create function public.delete_my_account(p_confirmation text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_email text;
  v_group uuid;
  v_settlement public.settlements%rowtype;
  v_groups integer := 0;
begin
  if p_confirmation is distinct from 'DELETE' then
    perform private.fail('SM422', 'Type DELETE to confirm');
  end if;
  -- One deletion at a time per account, and no new writes from it meanwhile.
  select p.email into v_email from public.profiles p where p.id = v_uid for update;
  -- A friend's direct expense change holds the friendship FOR SHARE; waiting for
  -- it here means the balance check below sees its result (review M9 L1).
  perform 1 from public.friendships f where v_uid in (f.user_low, f.user_high) order by f.id for update;

  if exists (
    select 1 from public.group_members m
     where m.user_id = v_uid and m.left_at is null
       and not private.group_balance_is_zero(m.group_id, v_uid)
  ) then
    perform private.fail('SM409', 'Settle up first: you still have a balance in a group');
  end if;
  if exists (
    select 1 from public.ledger_entries l
     where l.group_id is null and v_uid in (l.debtor_id, l.creditor_id)
     group by case when l.debtor_id = v_uid then l.creditor_id else l.debtor_id end, l.currency
    having sum(case when l.creditor_id = v_uid then l.amount else -l.amount end) <> 0
  ) then
    perform private.fail('SM409', 'Settle up first: you still have a balance with a friend');
  end if;

  for v_group in
    select m.group_id from public.group_members m where m.user_id = v_uid and m.left_at is null order by m.joined_at
  loop
    perform private.end_membership(v_group, v_uid, null);
    v_groups := v_groups + 1;
  end loop;

  for v_settlement in
    update public.settlements
       set status = 'withdrawn', cancelled_at = now(), cancelled_by = v_uid
     where group_id is null and status = 'pending' and v_uid in (payer_id, receiver_id)
    returning *
  loop
    perform private.audit(v_uid, 'settlement.withdrawn', 'settlement', v_settlement.id, null,
                          jsonb_build_object('status', 'pending'), private.settlement_data(v_settlement));
    perform private.notify(case when v_settlement.payer_id = v_uid then v_settlement.receiver_id
                                else v_settlement.payer_id end,
                           'settlement_cancelled', v_uid, null, null, v_settlement.id,
                           private.settlement_data(v_settlement));
  end loop;

  update public.recurring_expenses
     set status = 'cancelled', updated_by = v_uid
   where created_by = v_uid and status in ('active', 'paused');

  if v_email is not null then
    update public.group_invitations
       set revoked_at = now()
     where lower(invited_email) = lower(v_email) and revoked_at is null;
  end if;

  delete from public.friendships where v_uid in (user_low, user_high);
  delete from public.friend_email_requests where requester_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  delete from public.notification_preferences where user_id = v_uid;

  perform private.audit(v_uid, 'account.deleted', 'profile', v_uid, null, null,
                        jsonb_build_object('groups_left', v_groups));
  perform private.anonymize_profile(v_uid);
  -- Ends every session and refresh token; the trigger anonymizes again (no-op).
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated, service_role;
