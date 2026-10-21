-- Groups, membership and invitations (SPEC §2, §8).

create function public.create_group(
  p_name text,
  p_default_currency text default 'INR',
  p_description text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_group_id uuid;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then
    perform private.fail('SM422', 'Group name must be 1–100 characters');
  end if;
  if p_default_currency is null or p_default_currency !~ '^[A-Z]{3}$' then
    perform private.fail('SM422', 'Unsupported currency');
  end if;

  insert into public.groups (name, description, default_currency, created_by)
  values (btrim(p_name), nullif(btrim(p_description), ''), p_default_currency, v_uid)
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_uid, 'admin');

  perform private.audit(v_uid, 'group.created', 'group', v_group_id, v_group_id, null,
                        jsonb_build_object('name', btrim(p_name), 'default_currency', p_default_currency));
  return v_group_id;
end;
$$;

-- Creates an invitation link. Returns the raw token exactly once; only its
-- SHA-256 hash is stored. Any current member may invite; at most 20 per hour.
create function public.create_invitation(
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
                        jsonb_build_object('invited_email', v_email, 'max_uses', p_max_uses));

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

-- Accepts an invitation by token (link) or, for an invitation addressed to the
-- caller's email, by its ID (in-app notification). Joining makes the new member
-- friends with every current member. Accepting again as a member is a no-op.
create function public.accept_invitation(
  p_token text default null,
  p_invitation_id uuid default null,
  p_group_id uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_email text;
  v_inv public.group_invitations%rowtype;
begin
  if (p_token is null) = (p_invitation_id is null) then
    perform private.fail('SM422', 'Provide an invitation token or an invitation ID');
  end if;
  select p.email into v_email from public.profiles p where p.id = v_uid;

  if p_token is not null then
    select * into v_inv from public.group_invitations i
     where i.token_hash = extensions.digest(p_token, 'sha256')
       for update;
  else
    select * into v_inv from public.group_invitations i
     where i.id = p_invitation_id and i.invited_email is not null and i.invited_email = v_email
       for update;
  end if;
  if not found then
    perform private.fail('SM404', 'Invitation not found');
  end if;
  if p_group_id is not null and p_group_id <> v_inv.group_id then
    perform private.fail('SM403', 'This invitation is for a different group');
  end if;
  if v_inv.invited_email is not null and v_inv.invited_email is distinct from v_email then
    perform private.fail('SM403', 'This invitation was sent to a different email address');
  end if;

  if exists (
    select 1 from public.group_members m
     where m.group_id = v_inv.group_id and m.user_id = v_uid and m.left_at is null
  ) then
    return v_inv.group_id;
  end if;
  if v_inv.revoked_at is not null then
    perform private.fail('SM409', 'This invitation has been revoked');
  end if;
  if v_inv.expires_at <= now() then
    perform private.fail('SM409', 'This invitation has expired');
  end if;
  if v_inv.use_count >= v_inv.max_uses then
    perform private.fail('SM409', 'This invitation has already been used');
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_inv.group_id, v_uid, 'member')
  on conflict (group_id, user_id) do update
     set left_at = null, removed_by = null, role = 'member', joined_at = now();

  update public.group_invitations set use_count = use_count + 1 where id = v_inv.id;

  -- Joining a group makes its members friends (SPEC §2).
  insert into public.friendships (user_low, user_high, requested_by, status, accepted_at)
  select least(v_uid, m.user_id), greatest(v_uid, m.user_id), v_uid, 'accepted', now()
    from public.group_members m
   where m.group_id = v_inv.group_id and m.left_at is null and m.user_id <> v_uid
  on conflict (user_low, user_high) do update
     set status = 'accepted', accepted_at = coalesce(public.friendships.accepted_at, now())
   where public.friendships.status <> 'accepted';

  perform private.audit(v_uid, 'member.joined', 'group_member', v_uid, v_inv.group_id, null,
                        jsonb_build_object('invitation_id', v_inv.id));
  perform private.notify(v_inv.created_by, 'member_joined', v_uid, v_inv.group_id);
  return v_inv.group_id;
end;
$$;

-- The invitation's creator or a group admin can revoke it. Revoking twice is a no-op.
create function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_inv public.group_invitations%rowtype;
begin
  select * into v_inv from public.group_invitations i where i.id = p_invitation_id for update;
  if not found or not exists (
    select 1 from public.group_members m
     where m.group_id = v_inv.group_id and m.user_id = v_uid and m.left_at is null
  ) then
    perform private.fail('SM404', 'Invitation not found');
  end if;
  if v_inv.created_by <> v_uid and not exists (
    select 1 from public.group_members m
     where m.group_id = v_inv.group_id and m.user_id = v_uid and m.left_at is null and m.role = 'admin'
  ) then
    perform private.fail('SM403', 'Only the person who created the invitation or an admin can revoke it');
  end if;
  if v_inv.revoked_at is not null then
    return;
  end if;
  update public.group_invitations set revoked_at = now() where id = v_inv.id;
  perform private.audit(v_uid, 'invitation.revoked', 'group_invitation', v_inv.id, v_inv.group_id, null, null);
end;
$$;

-- Shared by leave_group and remove_group_member: marks the membership as left
-- (balance must be zero in every currency) and keeps the group with an admin.
create function private.end_membership(p_group_id uuid, p_user_id uuid, p_removed_by uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.group_members%rowtype;
  v_successor uuid;
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

  update public.group_members
     set left_at = now(), removed_by = p_removed_by
   where id = v_member.id;

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

create function public.leave_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_member uuid;
begin
  perform private.end_membership(p_group_id, v_uid, null);
  perform private.audit(v_uid, 'member.left', 'group_member', v_uid, p_group_id, null, null);
  for v_member in
    select m.user_id from public.group_members m where m.group_id = p_group_id and m.left_at is null
  loop
    perform private.notify(v_member, 'member_left', v_uid, p_group_id);
  end loop;
end;
$$;

-- Admins can remove a member whose balance is zero in every currency.
create function public.remove_group_member(p_group_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  if not exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.user_id = v_uid and m.left_at is null and m.role = 'admin'
  ) then
    perform private.fail('SM403', 'Only a group admin can remove members');
  end if;
  if p_user_id = v_uid then
    perform private.fail('SM422', 'Use leave_group to leave a group yourself');
  end if;
  perform private.end_membership(p_group_id, p_user_id, v_uid);
  perform private.audit(v_uid, 'member.removed', 'group_member', p_user_id, p_group_id, null, null);
  perform private.notify(p_user_id, 'member_removed', v_uid, p_group_id);
end;
$$;
