-- Read and privacy fixes from the M6 review, batch 1 (docs/reviews/review-M6.md).

-- ---------------------------------------------------------------------------
-- M6: direct expenses with one friend, paged
-- ---------------------------------------------------------------------------

-- Direct (non-group) expenses between the caller and one friend, newest first.
-- Candidates come from the two people's payer and participant rows (indexed by
-- user), so nothing is lost behind newer expenses with other friends, and the
-- cost follows these two people's activity. RLS on expenses still applies.
create function public.direct_expenses_with(p_friend_id uuid, p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid,
  description text,
  amount bigint,
  currency text,
  expense_date date,
  category text,
  status text,
  version integer,
  total_count bigint
)
language sql stable security invoker set search_path = ''
as $$
  select e.id, e.description, e.amount, e.currency::text, e.expense_date, e.category, e.status, e.version,
         count(*) over ()
    from public.expenses e
   where e.group_id is null
     and e.id in (select p.expense_id from public.expense_payers p where p.user_id = p_friend_id
                  union
                  select p.expense_id from public.expense_participants p where p.user_id = p_friend_id)
     and e.id in (select p.expense_id from public.expense_payers p where p.user_id = (select auth.uid())
                  union
                  select p.expense_id from public.expense_participants p where p.user_id = (select auth.uid()))
   order by e.expense_date desc, e.created_at desc, e.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.direct_expenses_with(uuid, integer, integer) from public, anon;
grant execute on function public.direct_expenses_with(uuid, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- L7 + L8: friend requests by email reveal nothing about who has an account
-- ---------------------------------------------------------------------------
-- A request is stored by the address the sender typed, account or not. The reply
-- is the same either way ('sent'), and the sender's list shows the addresses they
-- typed. Where an account exists, the recipient gets a pending friendship as
-- before; where none does, it is created when that address signs up and is
-- confirmed. A pending request shows the sender's name to the recipient only.

create table public.friend_email_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete restrict,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  created_at timestamptz not null default now(),
  constraint friend_email_requests_unique unique (requester_id, email)
);

create index friend_email_requests_email_idx on public.friend_email_requests (email);

alter table public.friend_email_requests enable row level security;
create policy friend_email_requests_select_own on public.friend_email_requests for select to authenticated
  using (requester_id = (select auth.uid()));
grant select on public.friend_email_requests to authenticated;
grant all on public.friend_email_requests to service_role;

-- Public fields are visible for an accepted friendship, or to the recipient of a
-- pending request (from its sender); sending one reveals nothing (review L7).
create or replace function private.shares_context_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user_id = (select auth.uid())
      or exists (
        select 1 from public.friendships f
         where f.user_low = least(p_user_id, (select auth.uid()))
           and f.user_high = greatest(p_user_id, (select auth.uid()))
           and (f.status = 'accepted' or f.requested_by = p_user_id)
      )
      or exists (
        select 1 from public.group_members mine
          join public.group_members theirs on theirs.group_id = mine.group_id
         where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
           and mine.joined_at <= coalesce(theirs.left_at, 'infinity')
           and theirs.joined_at <= coalesce(mine.left_at, 'infinity')
      );
$$;

-- Creates the pending friendships for requests sent to `p_email` before its account existed.
create function private.apply_email_friend_requests(p_user_id uuid, p_email text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_request public.friend_email_requests%rowtype;
  v_row public.friendships%rowtype;
begin
  for v_request in
    select * from public.friend_email_requests r
     where r.email = lower(p_email) and r.requester_id <> p_user_id
     order by r.created_at
  loop
    select * into v_row from public.friendships f
     where f.user_low = least(p_user_id, v_request.requester_id)
       and f.user_high = greatest(p_user_id, v_request.requester_id);
    if not found then
      insert into public.friendships (user_low, user_high, requested_by)
      values (least(p_user_id, v_request.requester_id), greatest(p_user_id, v_request.requester_id),
              v_request.requester_id)
      returning * into v_row;
      perform private.audit(v_request.requester_id, 'friend.requested', 'profile', p_user_id, null, null, null);
      perform private.notify(p_user_id, 'friend_request', v_request.requester_id, null, null, null,
                             jsonb_build_object('friendship_id', v_row.id));
    elsif v_row.status = 'accepted' then
      delete from public.friend_email_requests where id = v_request.id;
    end if;
  end loop;
end;
$$;

create function private.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null and new.email is not null then
    perform private.apply_email_friend_requests(new.id, new.email);
  end if;
  return new;
end;
$$;

-- Named to sort after on_auth_user_created, which creates the profile first.
create trigger on_auth_user_created_friend_requests after insert on auth.users
  for each row execute function private.handle_user_confirmed();
create trigger on_auth_user_confirmed_friend_requests after update of email_confirmed_at, email on auth.users
  for each row
  when (new.email_confirmed_at is not null
        and (old.email_confirmed_at is null or old.email is distinct from new.email))
  execute function private.handle_user_confirmed();

drop function public.send_friend_request(text);

-- 'sent' whether or not the address has an account (and when asked again).
-- 'accepted' only when that person had already asked the caller; 'already_friends'
-- and 'self' only describe people the caller already knows.
create function public.send_friend_request(p_email text)
returns table (status text, request_id uuid, friend_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_email text := lower(btrim(p_email));
  v_my_email text;
  v_friend uuid;
  v_row public.friendships%rowtype;
  v_request uuid;
begin
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+$' then
    perform private.fail('SM422', 'Invalid email address');
  end if;
  perform private.consume_rate_limit(v_uid, 'friend_request', 30, interval '1 hour');

  select p.email into v_my_email from public.profiles p where p.id = v_uid;
  if v_email = v_my_email then
    return query select 'self'::text, null::uuid, null::uuid;
    return;
  end if;

  select p.id into v_friend from public.profiles p where p.email = v_email and p.deleted_at is null;
  if v_friend is not null then
    select * into v_row from public.friendships f
     where f.user_low = least(v_uid, v_friend) and f.user_high = greatest(v_uid, v_friend)
       for update;
    if found and v_row.status = 'accepted' then
      return query select 'already_friends'::text, null::uuid, v_friend;
      return;
    elsif found and v_row.requested_by = v_friend then
      update public.friendships set status = 'accepted', accepted_at = now() where id = v_row.id;
      delete from public.friend_email_requests r where r.requester_id = v_friend and r.email = v_my_email;
      perform private.audit(v_uid, 'friend.accepted', 'profile', v_friend, null, null, null);
      perform private.notify(v_friend, 'friend_accepted', v_uid);
      return query select 'accepted'::text, null::uuid, v_friend;
      return;
    elsif not found then
      insert into public.friendships (user_low, user_high, requested_by)
      values (least(v_uid, v_friend), greatest(v_uid, v_friend), v_uid)
      returning * into v_row;
      perform private.audit(v_uid, 'friend.requested', 'profile', v_friend, null, null, null);
      perform private.notify(v_friend, 'friend_request', v_uid, null, null, null,
                             jsonb_build_object('friendship_id', v_row.id));
    end if;
  end if;

  insert into public.friend_email_requests (requester_id, email) values (v_uid, v_email)
  on conflict (requester_id, email) do nothing
  returning id into v_request;
  if v_request is null then
    select r.id into v_request from public.friend_email_requests r where r.requester_id = v_uid and r.email = v_email;
  end if;
  return query select 'sent'::text, v_request, null::uuid;
end;
$$;

-- The person who received a pending request accepts it.
create or replace function public.accept_friend_request(p_friendship_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_row public.friendships%rowtype;
begin
  select * into v_row from public.friendships f
   where f.id = p_friendship_id and v_uid in (f.user_low, f.user_high)
     for update;
  if not found then
    perform private.fail('SM404', 'Friend request not found');
  end if;
  if v_row.status = 'accepted' then
    return;
  end if;
  if v_row.requested_by = v_uid then
    perform private.fail('SM403', 'Only the person you asked can accept this request');
  end if;
  update public.friendships set status = 'accepted', accepted_at = now() where id = v_row.id;
  delete from public.friend_email_requests r
   where r.requester_id = v_row.requested_by and r.email = (select p.email from public.profiles p where p.id = v_uid);
  perform private.audit(v_uid, 'friend.accepted', 'profile', v_row.requested_by, null, null, null);
  perform private.notify(v_row.requested_by, 'friend_accepted', v_uid);
end;
$$;

-- Declines a request you received, or withdraws one you sent, by friendship.
create or replace function public.delete_friend_request(p_friendship_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_row public.friendships%rowtype;
  v_recipient uuid;
begin
  select * into v_row from public.friendships f
   where f.id = p_friendship_id and v_uid in (f.user_low, f.user_high)
     for update;
  if not found then
    perform private.fail('SM404', 'Friend request not found');
  end if;
  if v_row.status <> 'pending' then
    perform private.fail('SM409', 'You are already friends');
  end if;
  v_recipient := case when v_row.user_low = v_row.requested_by then v_row.user_high else v_row.user_low end;
  delete from public.friendships where id = v_row.id;
  delete from public.friend_email_requests r
   where r.requester_id = v_row.requested_by
     and r.email = (select p.email from public.profiles p where p.id = v_recipient);
  perform private.audit(v_uid,
                        case when v_row.requested_by = v_uid then 'friend.withdrawn' else 'friend.declined' end,
                        'profile',
                        case when v_row.user_low = v_uid then v_row.user_high else v_row.user_low end,
                        null, null, null);
end;
$$;

-- Withdraws a request from the sender's list (by address), and the pending
-- friendship it created if that address has an account.
create function public.withdraw_friend_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_request public.friend_email_requests%rowtype;
  v_friend uuid;
begin
  delete from public.friend_email_requests r where r.id = p_request_id and r.requester_id = v_uid
  returning * into v_request;
  if not found then
    perform private.fail('SM404', 'Friend request not found');
  end if;
  select p.id into v_friend from public.profiles p where p.email = v_request.email;
  if v_friend is not null then
    delete from public.friendships f
     where f.user_low = least(v_uid, v_friend) and f.user_high = greatest(v_uid, v_friend)
       and f.status = 'pending' and f.requested_by = v_uid;
  end if;
  perform private.audit(v_uid, 'friend.withdrawn', 'profile', coalesce(v_friend, v_uid), null, null, null);
end;
$$;

revoke all on function
  public.send_friend_request(text),
  public.withdraw_friend_request(uuid)
from public, anon;
grant execute on function
  public.send_friend_request(text),
  public.withdraw_friend_request(uuid)
to authenticated, service_role;
revoke all on function
  private.apply_email_friend_requests(uuid, text),
  private.handle_user_confirmed()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- L9: former members don't read the live group record
-- ---------------------------------------------------------------------------
-- SPEC §8: only current members read a group. A former member's history pages
-- show the group's name as it was when they left (group_names()).

alter table public.group_members add column left_group_name text
  check (left_group_name is null or char_length(left_group_name) between 1 and 100);
update public.group_members m set left_group_name = g.name
  from public.groups g where g.id = m.group_id and m.left_at is not null;

drop policy groups_select_members on public.groups;
create policy groups_select_members on public.groups for select to authenticated
  using (private.is_group_member(id));

create or replace function private.end_membership(p_group_id uuid, p_user_id uuid, p_removed_by uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.group_members%rowtype;
  v_successor uuid;
  v_settlement public.settlements%rowtype;
  v_actor uuid := coalesce(p_removed_by, p_user_id);
begin
  select * into v_member from public.group_members m
   where m.group_id = p_group_id and m.user_id = p_user_id and m.left_at is null
     for update;
  if not found then
    perform private.fail('SM404', 'Not a current member of this group');
  end if;
  if not private.group_balance_is_zero(p_group_id, p_user_id) then
    perform private.fail('SM409', 'The balance in this group must be zero in every currency first');
  end if;

  -- The name as it is now is all a former member will see of the group (review L9).
  update public.group_members
     set left_at = now(), removed_by = p_removed_by,
         left_group_name = (select g.name from public.groups g where g.id = p_group_id)
   where id = v_member.id;

  update public.group_invitations
     set revoked_at = now()
   where group_id = p_group_id and created_by = p_user_id and revoked_at is null;

  for v_settlement in
    update public.settlements
       set status = 'withdrawn', cancelled_at = now(), cancelled_by = v_actor
     where group_id = p_group_id and status = 'pending' and p_user_id in (payer_id, receiver_id)
    returning *
  loop
    perform private.audit(v_actor, 'settlement.withdrawn', 'settlement', v_settlement.id, p_group_id,
                          jsonb_build_object('status', 'pending'), private.settlement_data(v_settlement));
    -- Both parties are told (notify skips whoever is acting).
    perform private.notify(v_settlement.payer_id, 'settlement_cancelled', v_actor, p_group_id, null,
                           v_settlement.id, private.settlement_data(v_settlement));
    perform private.notify(v_settlement.receiver_id, 'settlement_cancelled', v_actor, p_group_id, null,
                           v_settlement.id, private.settlement_data(v_settlement));
  end loop;

  -- If the last admin left, the longest-standing remaining member becomes admin.
  if v_member.role = 'admin' and not exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.left_at is null and m.role = 'admin'
  ) then
    select m.user_id into v_successor from public.group_members m
     where m.group_id = p_group_id and m.left_at is null
     order by m.joined_at, m.user_id
     limit 1;
    if v_successor is not null then
      update public.group_members set role = 'admin'
       where group_id = p_group_id and user_id = v_successor;
    end if;
  end if;
end;
$$;

-- Names of groups the caller is or was in: the live name for current members,
-- the name at the time they left for former members, nothing otherwise.
create function public.group_names(p_group_ids uuid[])
returns table (id uuid, name text)
language sql stable security definer set search_path = ''
as $$
  select g.id, case when m.left_at is null then g.name else coalesce(m.left_group_name, g.name) end
    from public.groups g
    join public.group_members m on m.group_id = g.id and m.user_id = (select auth.uid())
   where g.id = any (p_group_ids[1:200]);
$$;

revoke all on function public.group_names(uuid[]) from public, anon;
grant execute on function public.group_names(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- L10: group settings change only through update_group (audited, validated)
-- ---------------------------------------------------------------------------

drop policy groups_update_admins on public.groups;
revoke update on public.groups from authenticated;

-- ---------------------------------------------------------------------------
-- L11: invitee email addresses only for the invitation's creator and admins
-- ---------------------------------------------------------------------------
-- SPEC §8. The column is no longer readable from the table; group_invitation_list()
-- returns it in full to the invitation's creator and to group admins, masked to
-- everyone else. Audit records store it masked.

-- "zed@example.com" → "z•••@example.com".
create function private.mask_email(p_email text) returns text
language sql immutable set search_path = ''
as $$
  select case when p_email is null or position('@' in p_email) = 0 then p_email
              else left(p_email, 1) || '•••@' || split_part(p_email, '@', 2) end;
$$;

revoke select on public.group_invitations from authenticated;
grant select (id, group_id, created_by, max_uses, use_count, expires_at, revoked_at, created_at, updated_at)
  on public.group_invitations to authenticated;

-- A group's invitations for its current members, newest first.
create function public.group_invitation_list(p_group_id uuid)
returns table (
  id uuid,
  created_by uuid,
  invited_email text,
  max_uses integer,
  use_count integer,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.created_by,
         case when i.created_by = (select auth.uid()) or me.role = 'admin' then i.invited_email
              else private.mask_email(i.invited_email) end,
         i.max_uses, i.use_count, i.expires_at, i.revoked_at, i.created_at
    from public.group_invitations i
    join public.group_members me
      on me.group_id = i.group_id and me.user_id = (select auth.uid()) and me.left_at is null
   where i.group_id = p_group_id
   order by i.created_at desc
   limit 200;
$$;

create or replace function public.create_invitation(
  p_group_id uuid,
  p_invited_email text default null,
  p_max_uses integer default 1,
  p_expires_in_hours integer default 168
) returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_email text := nullif(lower(btrim(p_invited_email)), '');
  v_token text;
  v_id uuid;
  v_invitee uuid;
begin
  if not exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.user_id = v_uid and m.left_at is null
  ) then
    perform private.fail('SM403', 'You are not a member of this group');
  end if;
  if p_max_uses is null or p_max_uses not between 1 and 100 then
    perform private.fail('SM422', 'An invitation can be used 1–100 times');
  end if;
  if p_expires_in_hours is null or p_expires_in_hours not between 1 and 720 then
    perform private.fail('SM422', 'An invitation must expire within 1–720 hours');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+$' then
    perform private.fail('SM422', 'Invalid email address');
  end if;
  -- Serialize this user's invitation creation so parallel requests cannot
  -- both pass the rate-limit count below.
  perform pg_advisory_xact_lock(hashtext('splitmate:create_invitation:' || v_uid::text));
  if (
    select count(*) from public.group_invitations i
     where i.created_by = v_uid and i.created_at > now() - interval '1 hour'
  ) >= 20 then
    perform private.fail('SM429', 'Too many invitations; try again later');
  end if;

  -- 256 random bits, URL-safe base64 without padding.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  insert into public.group_invitations (group_id, created_by, token_hash, invited_email, max_uses, expires_at)
  values (p_group_id, v_uid, extensions.digest(v_token, 'sha256'), v_email, p_max_uses,
          now() + make_interval(hours => p_expires_in_hours))
  returning id into v_id;

  perform private.audit(v_uid, 'invitation.created', 'group_invitation', v_id, p_group_id, null,
                        jsonb_build_object('invited_email', private.mask_email(v_email), 'max_uses', p_max_uses));

  -- An existing user invited by email also gets an in-app notification.
  if v_email is not null then
    select p.id into v_invitee from public.profiles p where p.email = v_email and p.deleted_at is null;
    if v_invitee is not null and not exists (
      select 1 from public.group_members m
       where m.group_id = p_group_id and m.user_id = v_invitee and m.left_at is null
    ) then
      perform private.notify(v_invitee, 'group_invitation', v_uid, p_group_id, null, null,
                             jsonb_build_object('invitation_id', v_id,
                               'group_name', (select g.name from public.groups g where g.id = p_group_id)));
    end if;
  end if;

  return query select v_id, v_token;
end;
$$;

-- One-time privacy fix: earlier audit records held invitee addresses in full. The
-- append-only trigger is lifted for this single update inside the migration.
alter table public.audit_events disable trigger audit_events_append_only;
update public.audit_events
   set after = jsonb_set(after, '{invited_email}', to_jsonb(private.mask_email(after ->> 'invited_email')))
 where action = 'invitation.created' and after ->> 'invited_email' is not null
   and after ->> 'invited_email' not like '_•••@%';
alter table public.audit_events enable trigger audit_events_append_only;

revoke all on function public.group_invitation_list(uuid) from public, anon;
grant execute on function public.group_invitation_list(uuid) to authenticated, service_role;
revoke all on function private.mask_email(text) from public, anon, authenticated;
