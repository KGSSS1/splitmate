-- M4: friends, groups and invitations (SPEC §2, §8, §15).
--
-- - Group type (trip, home, couple, other) and group settings through an
--   audited RPC; admins can promote and demote members.
-- - Friend requests by exact email, with a Postgres-backed rate limit.
-- - Read helpers for the invitation acceptance page and for invitations
--   addressed to the caller's email.

-- ---------------------------------------------------------------------------
-- Group type
-- ---------------------------------------------------------------------------

alter table public.groups
  add column group_type text not null default 'other'
    check (group_type in ('trip', 'home', 'couple', 'other'));

grant update (group_type) on public.groups to authenticated;

drop function public.create_group(text, text, text);

create function public.create_group(
  p_name text,
  p_default_currency text default 'INR',
  p_description text default null,
  p_group_type text default 'other',
  p_simplify_debts boolean default true
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_group_id uuid;
begin
  perform private.validate_group_fields(p_name, p_description, p_default_currency, p_group_type, p_simplify_debts);

  insert into public.groups (name, description, default_currency, group_type, simplify_debts, created_by)
  values (btrim(p_name), nullif(btrim(p_description), ''), p_default_currency, p_group_type, p_simplify_debts, v_uid)
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_uid, 'admin');

  perform private.audit(v_uid, 'group.created', 'group', v_group_id, v_group_id, null,
                        private.group_data(v_group_id));
  return v_group_id;
end;
$$;

create function private.validate_group_fields(
  p_name text,
  p_description text,
  p_default_currency text,
  p_group_type text,
  p_simplify_debts boolean
) returns void
language plpgsql set search_path = ''
as $$
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then
    perform private.fail('SM422', 'Group name must be 1–100 characters');
  end if;
  if p_description is not null and char_length(btrim(p_description)) > 500 then
    perform private.fail('SM422', 'Description must be at most 500 characters');
  end if;
  if not private.is_supported_currency(p_default_currency) then
    perform private.fail('SM422', 'Unsupported currency');
  end if;
  if p_group_type is null or p_group_type not in ('trip', 'home', 'couple', 'other') then
    perform private.fail('SM422', 'Unknown group type');
  end if;
  if p_simplify_debts is null then
    perform private.fail('SM422', 'Choose whether to simplify debts');
  end if;
end;
$$;

-- The settings recorded in audit events.
create function private.group_data(p_group_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', g.name, 'description', g.description,
                            'default_currency', g.default_currency, 'group_type', g.group_type,
                            'simplify_debts', g.simplify_debts)
    from public.groups g
   where g.id = p_group_id;
$$;

-- Admins change the group's settings. The default currency only applies to
-- new expenses; existing expenses and balances keep their own currency.
create function public.update_group(
  p_group_id uuid,
  p_name text,
  p_description text,
  p_default_currency text,
  p_group_type text,
  p_simplify_debts boolean
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_before jsonb;
begin
  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found or not exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.user_id = v_uid and m.left_at is null
  ) then
    perform private.fail('SM404', 'Group not found');
  end if;
  if not exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.user_id = v_uid and m.left_at is null and m.role = 'admin'
  ) then
    perform private.fail('SM403', 'Only a group admin can change the group settings');
  end if;
  perform private.validate_group_fields(p_name, p_description, p_default_currency, p_group_type, p_simplify_debts);

  v_before := private.group_data(p_group_id);
  update public.groups
     set name = btrim(p_name),
         description = nullif(btrim(p_description), ''),
         default_currency = p_default_currency,
         group_type = p_group_type,
         simplify_debts = p_simplify_debts
   where id = p_group_id;

  if v_before is distinct from private.group_data(p_group_id) then
    perform private.audit(v_uid, 'group.updated', 'group', p_group_id, p_group_id, v_before,
                          private.group_data(p_group_id));
  end if;
end;
$$;

-- Admins promote members to admin or demote admins. The group always keeps at
-- least one admin, so the last admin cannot be demoted (they can leave instead,
-- which hands the role on).
create function public.set_member_role(p_group_id uuid, p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_member public.group_members%rowtype;
begin
  if p_role is null or p_role not in ('admin', 'member') then
    perform private.fail('SM422', 'Unknown role');
  end if;
  if not exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.user_id = v_uid and m.left_at is null and m.role = 'admin'
  ) then
    perform private.fail('SM403', 'Only a group admin can change roles');
  end if;
  -- Lock every current membership: two admins demoting each other at once
  -- must not leave the group without an admin.
  perform 1 from public.group_members m where m.group_id = p_group_id and m.left_at is null for update;
  select * into v_member from public.group_members m
   where m.group_id = p_group_id and m.user_id = p_user_id and m.left_at is null;
  if not found then
    perform private.fail('SM404', 'Not a current member of this group');
  end if;
  if v_member.role = p_role then
    return;
  end if;
  if p_role = 'member' and (
    select count(*) from public.group_members m
     where m.group_id = p_group_id and m.left_at is null and m.role = 'admin'
  ) <= 1 then
    perform private.fail('SM409', 'A group needs at least one admin');
  end if;

  update public.group_members set role = p_role where id = v_member.id;
  perform private.audit(v_uid, 'member.role_changed', 'group_member', p_user_id, p_group_id,
                        jsonb_build_object('role', v_member.role), jsonb_build_object('role', p_role));
end;
$$;

-- ---------------------------------------------------------------------------
-- Rate limits for abuse-prone actions that do not leave a row behind
-- ---------------------------------------------------------------------------

-- One row per attempt. Lives in the private schema: never exposed through the API.
create table private.rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null check (char_length(action) between 1 and 64),
  created_at timestamptz not null default now()
);

create index rate_limit_events_lookup_idx on private.rate_limit_events (user_id, action, created_at);

-- Records an attempt, or raises SM429 when `p_limit` attempts were already made
-- within `p_window`. Callers must not raise afterwards for outcomes they want
-- counted: an exception rolls the recorded attempt back.
create function private.consume_rate_limit(p_user_id uuid, p_action text, p_limit integer, p_window interval)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  -- Serialize this user's attempts so parallel requests cannot both pass the count.
  perform pg_advisory_xact_lock(hashtext('splitmate:rate_limit:' || p_action || ':' || p_user_id::text));
  if (
    select count(*) from private.rate_limit_events e
     where e.user_id = p_user_id and e.action = p_action and e.created_at > now() - p_window
  ) >= p_limit then
    perform private.fail('SM429', 'Too many attempts; try again later');
  end if;
  insert into private.rate_limit_events (user_id, action) values (p_user_id, p_action);
  -- Keep the table small: older attempts no longer count towards any limit.
  delete from private.rate_limit_events e
   where e.user_id = p_user_id and e.action = p_action and e.created_at < now() - p_window;
end;
$$;

-- ---------------------------------------------------------------------------
-- Friend requests (SPEC §2: users find each other by exact email only)
-- ---------------------------------------------------------------------------

-- Sends a friend request to the account with exactly this email. Outcomes are
-- returned rather than raised so every lookup counts towards the rate limit
-- (30 per hour), which keeps email probing slow:
--   requested         a new pending request was created
--   already_requested the caller already has a pending request to them
--   accepted          they had already asked the caller; now friends
--   already_friends   nothing to do
--   not_found         no active account uses that email
--   self              the caller's own email
create function public.send_friend_request(p_email text)
returns table (status text, friendship_id uuid, friend_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_email text := lower(btrim(p_email));
  v_friend uuid;
  v_row public.friendships%rowtype;
begin
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+$' then
    perform private.fail('SM422', 'Invalid email address');
  end if;
  perform private.consume_rate_limit(v_uid, 'friend_request', 30, interval '1 hour');

  select p.id into v_friend from public.profiles p where p.email = v_email and p.deleted_at is null;
  if v_friend is null then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;
  if v_friend = v_uid then
    return query select 'self'::text, null::uuid, null::uuid;
    return;
  end if;

  select * into v_row from public.friendships f
   where f.user_low = least(v_uid, v_friend) and f.user_high = greatest(v_uid, v_friend)
     for update;
  if found then
    if v_row.status = 'accepted' then
      return query select 'already_friends'::text, v_row.id, v_friend;
    elsif v_row.requested_by = v_uid then
      return query select 'already_requested'::text, v_row.id, v_friend;
    else
      update public.friendships set status = 'accepted', accepted_at = now() where id = v_row.id;
      perform private.audit(v_uid, 'friend.accepted', 'profile', v_friend, null, null, null);
      perform private.notify(v_friend, 'friend_accepted', v_uid);
      return query select 'accepted'::text, v_row.id, v_friend;
    end if;
    return;
  end if;

  insert into public.friendships (user_low, user_high, requested_by)
  values (least(v_uid, v_friend), greatest(v_uid, v_friend), v_uid)
  returning * into v_row;
  perform private.audit(v_uid, 'friend.requested', 'profile', v_friend, null, null, null);
  perform private.notify(v_friend, 'friend_request', v_uid, null, null, null,
                         jsonb_build_object('friendship_id', v_row.id));
  return query select 'requested'::text, v_row.id, v_friend;
end;
$$;

-- The person who received a pending request accepts it.
create function public.accept_friend_request(p_friendship_id uuid) returns void
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
  perform private.audit(v_uid, 'friend.accepted', 'profile', v_row.requested_by, null, null, null);
  perform private.notify(v_row.requested_by, 'friend_accepted', v_uid);
end;
$$;

-- Declines (recipient) or withdraws (requester) a pending request. Accepted
-- friendships are kept: removing a friend is not part of v1.
create function public.delete_friend_request(p_friendship_id uuid) returns void
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
  if v_row.status <> 'pending' then
    perform private.fail('SM409', 'You are already friends');
  end if;
  delete from public.friendships where id = v_row.id;
  perform private.audit(v_uid,
                        case when v_row.requested_by = v_uid then 'friend.withdrawn' else 'friend.declined' end,
                        'profile',
                        case when v_row.user_low = v_uid then v_row.user_high else v_row.user_low end,
                        null, null, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitation reads
-- ---------------------------------------------------------------------------

-- What the acceptance page shows for a token, without accepting it. Group
-- details are returned only when the caller could join with this token (or is
-- already a member); otherwise only the reason it cannot be used. The optional
-- group ID comes from the link: a token presented for another group is refused.
--   valid | member | not_found | wrong_group | wrong_email | revoked | expired | used | inactive
create function public.invitation_preview(p_token text, p_group_id uuid default null)
returns table (
  status text,
  group_id uuid,
  group_name text,
  group_type text,
  inviter_name text,
  member_count integer,
  invited_email text,
  expires_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_email text;
  v_inv public.group_invitations%rowtype;
  v_status text;
begin
  if p_token is null or char_length(p_token) > 200 then
    return query select 'not_found'::text, null::uuid, null::text, null::text, null::text, null::integer,
                        null::text, null::timestamptz;
    return;
  end if;
  select * into v_inv from public.group_invitations i where i.token_hash = extensions.digest(p_token, 'sha256');
  select p.email into v_email from public.profiles p where p.id = v_uid;

  v_status := case
    when v_inv.id is null then 'not_found'
    when p_group_id is not null and p_group_id <> v_inv.group_id then 'wrong_group'
    when exists (
      select 1 from public.group_members m
       where m.group_id = v_inv.group_id and m.user_id = v_uid and m.left_at is null
    ) then 'member'
    when v_inv.invited_email is not null and v_inv.invited_email is distinct from v_email then 'wrong_email'
    when v_inv.revoked_at is not null then 'revoked'
    when v_inv.expires_at <= now() then 'expired'
    when v_inv.use_count >= v_inv.max_uses then 'used'
    when not exists (
      select 1 from public.group_members m
       where m.group_id = v_inv.group_id and m.user_id = v_inv.created_by and m.left_at is null
    ) then 'inactive'
    else 'valid'
  end;

  if v_status not in ('valid', 'member') then
    return query select v_status, null::uuid, null::text, null::text, null::text, null::integer,
                        null::text, null::timestamptz;
    return;
  end if;

  return query
    select v_status, g.id, g.name, g.group_type,
           (select case when p.deleted_at is null then p.display_name else 'Deleted user' end
              from public.profiles p where p.id = v_inv.created_by),
           (select count(*)::integer from public.group_members m where m.group_id = g.id and m.left_at is null),
           v_inv.invited_email, v_inv.expires_at
      from public.groups g
     where g.id = v_inv.group_id;
end;
$$;

-- Open invitations addressed to the caller's email (shown in the app so an
-- existing user can join without the link). Same validity rules as accepting.
create function public.my_group_invitations()
returns table (
  invitation_id uuid,
  group_id uuid,
  group_name text,
  group_type text,
  inviter_name text,
  expires_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select i.id, g.id, g.name, g.group_type,
         case when p.deleted_at is null then p.display_name else 'Deleted user' end,
         i.expires_at
    from public.profiles me
    join public.group_invitations i on i.invited_email = me.email
    join public.groups g on g.id = i.group_id
    join public.profiles p on p.id = i.created_by
   where me.id = (select auth.uid())
     and me.deleted_at is null
     and me.email is not null
     and i.revoked_at is null
     and i.expires_at > now()
     and i.use_count < i.max_uses
     and exists (
       select 1 from public.group_members m
        where m.group_id = i.group_id and m.user_id = i.created_by and m.left_at is null
     )
     and not exists (
       select 1 from public.group_members m
        where m.group_id = i.group_id and m.user_id = me.id and m.left_at is null
     )
   order by i.created_at desc
   limit 50;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE grants
-- ---------------------------------------------------------------------------

revoke all on function
  public.create_group(text, text, text, text, boolean),
  public.update_group(uuid, text, text, text, text, boolean),
  public.set_member_role(uuid, uuid, text),
  public.send_friend_request(text),
  public.accept_friend_request(uuid),
  public.delete_friend_request(uuid),
  public.invitation_preview(text, uuid),
  public.my_group_invitations()
from public, anon;

grant execute on function
  public.create_group(text, text, text, text, boolean),
  public.update_group(uuid, text, text, text, text, boolean),
  public.set_member_role(uuid, uuid, text),
  public.send_friend_request(text),
  public.accept_friend_request(uuid),
  public.delete_friend_request(uuid),
  public.invitation_preview(text, uuid),
  public.my_group_invitations()
to authenticated, service_role;

revoke all on function
  private.validate_group_fields(text, text, text, text, boolean),
  private.group_data(uuid),
  private.consume_rate_limit(uuid, text, integer, interval)
from public, anon, authenticated;

