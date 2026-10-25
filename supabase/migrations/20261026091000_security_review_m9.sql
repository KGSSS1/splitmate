-- M9 security review (docs/reviews/review-M9.md): fixes M1, L1, L2 and some
-- hardening. L3 (/auth/confirm) is an app change.

-- ---------------------------------------------------------------------------
-- M1: a friend request by email must not reveal whether the address has an
-- account (SPEC §2, §8). The sender could see their own pending friendship row
-- (with the recipient's ID) and the friend.requested / friend.withdrawn audit
-- rows naming the recipient, both only when the address had an account.
-- ---------------------------------------------------------------------------

-- Pending requests are visible to their recipient only; the sender sees the
-- address they typed in friend_email_requests, account or not.
drop policy friendships_select_own on public.friendships;
create policy friendships_select_own on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_low, user_high)
         and (status = 'accepted' or requested_by <> (select auth.uid())));

-- Your own audit rows stay readable, except the ones that would name someone
-- you only typed an email address for.
drop policy audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select to authenticated
  using ((actor_id = (select auth.uid()) and action not in ('friend.requested', 'friend.withdrawn'))
         or (group_id is not null and private.is_group_member(group_id))
         or (entity_type = 'expense' and private.can_view_expense(entity_id))
         or (entity_type = 'settlement' and private.can_view_settlement(entity_id)));

-- ---------------------------------------------------------------------------
-- L1: a direct expense could still be edited or cancelled after the two stopped
-- being friends (for example after one deleted their account), leaving a
-- balance nobody can settle. Changes now need a current friendship, which is
-- also locked so it can't end while the change commits.
-- ---------------------------------------------------------------------------

create or replace function private.lock_expense_for_change(p_expense_id uuid, p_expected_version integer, p_actor uuid)
returns public.expenses
language plpgsql security definer set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
  v_users uuid[];
begin
  select * into v_expense from public.expenses e where e.id = p_expense_id for update;
  if not found then
    perform private.fail('SM404', 'Expense not found');
  end if;
  v_users := private.expense_version_users(v_expense.id, v_expense.version);
  -- Hold the memberships of the actor and of everyone in the current version until
  -- this change commits, so nobody it affects can leave the group meanwhile at a
  -- zero balance the change is about to break (review M1). leave_group and
  -- remove_group_member lock the member's row FOR UPDATE, so they wait for us and
  -- then see the new balance. New participants are locked by require_parties.
  if v_expense.group_id is not null then
    perform 1 from public.group_members m
     where m.group_id = v_expense.group_id and m.left_at is null
       and (m.user_id = p_actor or m.user_id = any (v_users))
     order by m.user_id
       for share;
  else
    -- The same for direct expenses: delete_my_account locks the friendship FOR
    -- UPDATE before checking balances (review M9 L1).
    perform 1 from public.friendships f
     where f.status = 'accepted' and p_actor in (f.user_low, f.user_high)
       and (case when f.user_low = p_actor then f.user_high else f.user_low end) = any (v_users)
     order by f.id
       for share;
  end if;
  if v_expense.group_id is not null then
    if not exists (
      select 1 from public.group_members m
       where m.group_id = v_expense.group_id and m.user_id = p_actor and m.left_at is null
    ) then
      perform private.fail('SM403', 'Only current group members can change this expense');
    end if;
  elsif not (p_actor = any (v_users)) then
    perform private.fail('SM403', 'Only the two friends involved can change this expense');
  end if;
  if v_expense.status <> 'active' then
    perform private.fail('SM409', 'This expense has been cancelled');
  end if;
  if p_expected_version is null or v_expense.version <> p_expected_version then
    perform private.fail('SM409', 'This expense was changed by someone else; reload and try again');
  end if;
  -- History involving someone who has left is frozen: changing it would give a
  -- former member a balance they can no longer settle.
  if v_expense.group_id is not null and exists (
    select 1 from unnest(v_users) as u(user_id)
     where not exists (
       select 1 from public.group_members m
        where m.group_id = v_expense.group_id and m.user_id = u.user_id and m.left_at is null
     )
  ) then
    perform private.fail('SM409', 'Someone in this expense has left the group, so it can no longer be changed');
  end if;
  -- Likewise for direct expenses once the two are no longer friends.
  if v_expense.group_id is null and exists (
    select 1 from unnest(v_users) as u(user_id)
     where u.user_id <> p_actor
       and not exists (
         select 1 from public.friendships f
          where f.status = 'accepted'
            and f.user_low = least(p_actor, u.user_id) and f.user_high = greatest(p_actor, u.user_id)
       )
  ) then
    perform private.fail('SM409', 'You are no longer friends, so this expense can no longer be changed');
  end if;
  return v_expense;
end;
$$;

-- ---------------------------------------------------------------------------
-- L2: receipts. Objects must be named the way the app names them
-- (<expense id>/<random id>.<jpg|png|webp|pdf>). Other members see an object
-- only once its attachment row exists (after the content check); the uploader
-- sees their own pending upload so the check can read it. A recorded receipt
-- can't be deleted (and so swapped for other bytes) while its row exists.
-- ---------------------------------------------------------------------------

create function private.is_receipt_object_name(p_name text) returns boolean
language sql immutable set search_path = ''
as $$
  select p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$';
$$;

create function private.receipt_is_attached(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.attachments a where a.storage_path = p_name);
$$;

revoke all on function private.is_receipt_object_name(text) from public;
revoke all on function private.receipt_is_attached(text) from public;
grant execute on function private.is_receipt_object_name(text) to authenticated;
grant execute on function private.receipt_is_attached(text) to authenticated;

drop policy receipts_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and private.can_view_expense(private.receipt_expense_id(name))
    and (owner_id = (select auth.uid())::text or private.receipt_is_attached(name))
  );

drop policy receipts_insert on storage.objects;
create policy receipts_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and private.is_receipt_object_name(name)
    and owner_id = (select auth.uid())::text
    and private.can_edit_expense(private.receipt_expense_id(name))
  );

drop policy receipts_delete on storage.objects;
create policy receipts_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and owner_id = (select auth.uid())::text
    and private.can_edit_expense(private.receipt_expense_id(name))
    and not private.receipt_is_attached(name)
  );

-- ---------------------------------------------------------------------------
-- Hardening
-- ---------------------------------------------------------------------------

-- avatar_url is client-writable but not shown yet: only https URLs, before it is.
alter table public.profiles
  add constraint profiles_avatar_url_https
  check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 2048));

-- pg_net is only for the database's own jobs; API roles never call it.
revoke all on all functions in schema net from anon, authenticated;
revoke all on all tables in schema net from anon, authenticated;
