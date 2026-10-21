-- Row Level Security (SPEC §8): enabled on every table, default deny.
--
-- Policies call SECURITY DEFINER helpers with a fixed search_path instead of
-- querying group_members directly, which avoids recursive policies.
-- Financial writes have no policies at all: they happen only inside the
-- SECURITY DEFINER functions in later migrations.

-- ---------------------------------------------------------------------------
-- Helpers (all answer questions about the *calling* user only)
-- ---------------------------------------------------------------------------

create function private.is_group_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.user_id = (select auth.uid()) and m.left_at is null
  );
$$;

-- Current or former member.
create function private.was_group_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.user_id = (select auth.uid())
  );
$$;

create function private.is_group_admin(p_group_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.user_id = (select auth.uid())
       and m.left_at is null and m.role = 'admin'
  );
$$;

create function private.are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
     where f.user_low = least(p_a, p_b) and f.user_high = greatest(p_a, p_b) and f.status = 'accepted'
  );
$$;

-- The caller paid for or shared in any version of the expense.
create function private.is_expense_party(p_expense_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.expense_payers p
     where p.expense_id = p_expense_id and p.user_id = (select auth.uid())
  ) or exists (
    select 1 from public.expense_participants p
     where p.expense_id = p_expense_id and p.user_id = (select auth.uid())
  );
$$;

-- Everyone who paid or shared in one version of an expense, sorted.
create function private.expense_version_users(p_expense_id uuid, p_version integer) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(u.user_id order by u.user_id), '{}')
    from (
      select p.user_id from public.expense_payers p where p.expense_id = p_expense_id and p.version = p_version
      union
      select p.user_id from public.expense_participants p where p.expense_id = p_expense_id and p.version = p_version
    ) u;
$$;

-- Group expenses: current members, plus former members who were involved.
-- Direct expenses: the people involved.
create function private.can_view_expense(p_expense_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.expenses e
     where e.id = p_expense_id
       and ((e.group_id is not null and private.is_group_member(e.group_id))
            or private.is_expense_party(e.id))
  );
$$;

-- Who may comment on or attach receipts to an expense: current group members,
-- or for a direct expense the two friends while they are still friends.
-- A deleted (anonymized) account can no longer write, even with a valid token.
create function private.can_edit_expense(p_expense_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.expenses e
     where e.id = p_expense_id
       and exists (
         select 1 from public.profiles p where p.id = (select auth.uid()) and p.deleted_at is null
       )
       and case
             when e.group_id is not null then private.is_group_member(e.group_id)
             else exists (
                    select 1
                      from unnest(private.expense_version_users(e.id, e.version)) as other(user_id)
                     where (select auth.uid()) = any (private.expense_version_users(e.id, e.version))
                       and other.user_id <> (select auth.uid())
                       and private.are_friends(other.user_id, (select auth.uid()))
                  )
           end
  );
$$;

create function private.can_view_settlement(p_settlement_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.settlements s
     where s.id = p_settlement_id
       and ((select auth.uid()) in (s.payer_id, s.receiver_id)
            or (s.group_id is not null and private.is_group_member(s.group_id)))
  );
$$;

create function private.can_view_recurring(p_recurring_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.recurring_expenses r
     where r.id = p_recurring_id
       and (r.created_by = (select auth.uid())
            or (r.group_id is not null and private.is_group_member(r.group_id))
            or exists (
              select 1 from jsonb_array_elements(r.shares) s
               where s ->> 'user_id' = (select auth.uid())::text
            ))
  );
$$;

-- Another user is visible to the caller if they are friends (or have a pending
-- request) or were in a group at the same time. A former member does not see
-- people who joined after they left.
create function private.shares_context_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user_id = (select auth.uid())
      or exists (
        select 1 from public.friendships f
         where f.user_low = least(p_user_id, (select auth.uid()))
           and f.user_high = greatest(p_user_id, (select auth.uid()))
      )
      or exists (
        select 1 from public.group_members mine
          join public.group_members theirs on theirs.group_id = mine.group_id
         where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
           and mine.joined_at <= coalesce(theirs.left_at, 'infinity')
           and theirs.joined_at <= coalesce(mine.left_at, 'infinity')
      );
$$;

-- {expense_id}/{file} → expense_id, or null for any other path shape.
create function private.receipt_expense_id(p_object_name text) returns uuid
language sql immutable set search_path = ''
as $$
  select case
           when p_object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]{1,200}$'
           then split_part(p_object_name, '/', 1)::uuid
         end;
$$;

-- Only the helpers that policies call directly are executable by clients; they
-- answer questions about the caller only. Helpers that take arbitrary user or
-- expense IDs (expense_version_users, are_friends, is_expense_party,
-- shares_context_with) are used only inside SECURITY DEFINER functions.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_group_member(uuid),
  private.was_group_member(uuid),
  private.is_group_admin(uuid),
  private.can_view_expense(uuid),
  private.can_edit_expense(uuid),
  private.can_view_settlement(uuid),
  private.can_view_recurring(uuid),
  private.receipt_expense_id(text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invitations enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_payers enable row level security;
alter table public.expense_participants enable row level security;
alter table public.expense_items enable row level security;
alter table public.expense_item_assignments enable row level security;
alter table public.settlements enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.recurring_occurrences enable row level security;
alter table public.attachments enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.audit_events enable row level security;

-- ---------------------------------------------------------------------------
-- Grants: anon gets nothing; authenticated may read (RLS filters rows) and
-- write only the specific columns listed. service_role keeps full access.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

-- The token hash is never readable by clients.
revoke select on public.group_invitations from authenticated;
grant select (id, group_id, created_by, invited_email, max_uses, use_count, expires_at, revoked_at, created_at, updated_at)
  on public.group_invitations to authenticated;

grant update (display_name, avatar_url, default_currency, locale, timezone, onboarded_at)
  on public.profiles to authenticated;
grant update (name, description, default_currency, simplify_debts, archived_at)
  on public.groups to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert (user_id, type, in_app, email), update (in_app, email), delete
  on public.notification_preferences to authenticated;
grant insert (expense_id, author_id, body), update (body, deleted_at)
  on public.comments to authenticated;
grant insert (expense_id, uploaded_by, storage_path, mime_type, size_bytes), delete
  on public.attachments to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Own row only; other people's public fields come from public.profile_cards().
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and deleted_at is null)
  with check (id = (select auth.uid()));

create policy friendships_select_own on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));

-- Former members can still see the group they have history in.
create policy groups_select_members on public.groups for select to authenticated
  using (private.was_group_member(id));
create policy groups_update_admins on public.groups for update to authenticated
  using (private.is_group_admin(id))
  with check (private.is_group_admin(id));

create policy group_members_select on public.group_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_group_member(group_id));

create policy group_invitations_select_members on public.group_invitations for select to authenticated
  using (private.is_group_member(group_id));

create policy expenses_select on public.expenses for select to authenticated
  using (private.can_view_expense(id));
create policy expense_payers_select on public.expense_payers for select to authenticated
  using (private.can_view_expense(expense_id));
create policy expense_participants_select on public.expense_participants for select to authenticated
  using (private.can_view_expense(expense_id));
create policy expense_items_select on public.expense_items for select to authenticated
  using (private.can_view_expense(expense_id));
create policy expense_item_assignments_select on public.expense_item_assignments for select to authenticated
  using (exists (
    select 1 from public.expense_items i
     where i.id = item_id and private.can_view_expense(i.expense_id)
  ));

create policy settlements_select on public.settlements for select to authenticated
  using ((select auth.uid()) in (payer_id, receiver_id)
         or (group_id is not null and private.is_group_member(group_id)));

-- Everyone sees their own rows (so former members keep their history);
-- current members see the whole group's ledger.
create policy ledger_entries_select on public.ledger_entries for select to authenticated
  using ((select auth.uid()) in (debtor_id, creditor_id)
         or (group_id is not null and private.is_group_member(group_id)));

create policy recurring_expenses_select on public.recurring_expenses for select to authenticated
  using (private.can_view_recurring(id));
create policy recurring_occurrences_select on public.recurring_occurrences for select to authenticated
  using (private.can_view_recurring(recurring_expense_id));

create policy attachments_select on public.attachments for select to authenticated
  using (private.can_view_expense(expense_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and private.can_edit_expense(expense_id));
create policy attachments_delete_own on public.attachments for delete to authenticated
  using (uploaded_by = (select auth.uid()) and private.can_edit_expense(expense_id));

create policy comments_select on public.comments for select to authenticated
  using (private.can_view_expense(expense_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and private.can_edit_expense(expense_id));
-- Editing or soft-deleting your own comment also requires being able to edit the
-- expense, so removed members cannot change what they wrote.
create policy comments_update_own on public.comments for update to authenticated
  using (author_id = (select auth.uid()) and deleted_at is null and private.can_edit_expense(expense_id))
  with check (author_id = (select auth.uid()) and private.can_edit_expense(expense_id));

create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notification_preferences_select_own on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_preferences_insert_own on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy notification_preferences_update_own on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy notification_preferences_delete_own on public.notification_preferences for delete to authenticated
  using (user_id = (select auth.uid()));

create policy audit_events_select on public.audit_events for select to authenticated
  using (actor_id = (select auth.uid())
         or (group_id is not null and private.is_group_member(group_id))
         or (entity_type = 'expense' and private.can_view_expense(entity_id))
         or (entity_type = 'settlement' and private.can_view_settlement(entity_id)));
