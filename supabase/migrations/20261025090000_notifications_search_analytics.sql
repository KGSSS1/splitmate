-- M8: notifications (mark read, per-type preferences), search and analytics reads.
--
-- Notifications themselves are already written inside the functions that perform
-- each action (private.notify, SPEC §15); this adds the reads and writes the
-- notifications page needs. Search and analytics are SECURITY INVOKER reads, so
-- RLS decides which expenses a caller sees; nothing here bypasses it.

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

-- Marks the caller's notifications read: the given IDs, or every unread one when
-- p_ids is null. Returns how many changed; rows already read keep their time.
-- RLS limits the update to the caller's own rows as well.
create function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then
    raise exception using errcode = 'SM401', message = 'You must be signed in';
  end if;
  if p_ids is not null and cardinality(p_ids) > 100 then
    raise exception using errcode = 'SM422', message = 'Mark at most 100 notifications at a time';
  end if;
  update public.notifications n
     set read_at = now()
   where n.user_id = v_uid
     and n.read_at is null
     and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated, service_role;

-- Saves in-app preferences for several types at once: {"expense_added": false, ...}.
-- A missing type keeps its current setting (no row = on). private.notify reads them.
create function public.set_notification_preferences(p_preferences jsonb) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_type text;
  v_value jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'SM401', message = 'You must be signed in';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
    raise exception using errcode = 'SM422', message = 'Preferences must be an object';
  end if;
  for v_type, v_value in select key, value from jsonb_each(p_preferences) loop
    if jsonb_typeof(v_value) <> 'boolean' then
      raise exception using errcode = 'SM422', message = 'Each preference must be true or false';
    end if;
    begin
      insert into public.notification_preferences (user_id, type, in_app)
      values (v_uid, v_type::public.notification_type, v_value::boolean)
      on conflict (user_id, type) do update set in_app = excluded.in_app;
    exception when check_violation then
      raise exception using errcode = 'SM422', message = 'Unknown notification type';
    end;
  end loop;
end;
$$;

revoke all on function public.set_notification_preferences(jsonb) from public, anon;
grant execute on function public.set_notification_preferences(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------

-- Expenses the caller can see (RLS) whose description, notes, category or tags
-- contain every word of p_query (case-insensitive substring match, so no LIKE
-- escaping is needed), or whose category is one of p_categories (the app passes
-- the categories whose label matches). Newest first, one page at a time.
create function public.search_expenses(
  p_query text,
  p_categories text[] default '{}',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  description text,
  amount bigint,
  currency text,
  expense_date date,
  category text,
  status text,
  version integer,
  group_id uuid,
  total_count bigint
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_words text[];
begin
  if char_length(coalesce(p_query, '')) > 100 then
    raise exception using errcode = 'SM422', message = 'Search for at most 100 characters';
  end if;
  v_words := array(
    select w from unnest(regexp_split_to_array(lower(btrim(coalesce(p_query, ''))), '\s+')) as w where w <> ''
  );
  if cardinality(v_words) = 0 then
    return;
  end if;

  return query
  select e.id, e.description, e.amount::bigint, e.currency::text, e.expense_date, e.category, e.status, e.version,
         e.group_id, count(*) over ()
    from public.expenses e
   where e.category = any (coalesce(p_categories, '{}'))
      or not exists (
        select 1 from unnest(v_words) as w
         where position(w in lower(concat_ws(' ', e.description, e.notes, e.category,
                                             array_to_string(e.tags, ' ')))) = 0
      )
   order by e.expense_date desc, e.created_at desc, e.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.search_expenses(text, text[], integer, integer) from public, anon;
grant execute on function public.search_expenses(text, text[], integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Analytics and exports
-- ---------------------------------------------------------------------------

-- The caller's part in each active expense dated p_from..p_to: what they paid and
-- their share of the current version (SPEC §14: "spending" is the share). Only
-- expenses the caller took part in; RLS applies to every table read. Pages of at
-- most 1000 rows (the Data API's row cap) in a stable order, so the app can read
-- them all without silently losing rows.
create function public.my_expense_shares(
  p_from date,
  p_to date,
  p_limit integer default 1000,
  p_offset integer default 0
)
returns table (
  expense_id uuid,
  expense_date date,
  description text,
  category text,
  group_id uuid,
  currency text,
  amount bigint,
  paid bigint,
  share bigint,
  recurring_expense_id uuid
)
language sql stable security invoker set search_path = ''
as $$
  with mine as (
    select p.expense_id from public.expense_payers p where p.user_id = (select auth.uid())
    union
    select p.expense_id from public.expense_participants p where p.user_id = (select auth.uid())
  )
  select e.id, e.expense_date, e.description, e.category, e.group_id, e.currency::text, e.amount::bigint,
         coalesce(pay.amount, 0)::bigint, coalesce(part.amount, 0)::bigint, occ.recurring_expense_id
    from public.expenses e
    join mine on mine.expense_id = e.id
    left join public.expense_payers pay
      on pay.expense_id = e.id and pay.version = e.version and pay.user_id = (select auth.uid())
    left join public.expense_participants part
      on part.expense_id = e.id and part.version = e.version and part.user_id = (select auth.uid())
    left join lateral (
      select o.recurring_expense_id from public.recurring_occurrences o where o.expense_id = e.id limit 1
    ) occ on true
   where e.status = 'active'
     and e.expense_date between p_from and p_to
     -- Taking part in an earlier version only does not count.
     and (pay.id is not null or part.id is not null)
   order by e.expense_date, e.created_at, e.id
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.my_expense_shares(date, date, integer, integer) from public, anon;
grant execute on function public.my_expense_shares(date, date, integer, integer) to authenticated, service_role;

-- Settlements filtered by date need an index on the date the payment was made.
create index settlements_settled_on_idx on public.settlements (settled_on);
