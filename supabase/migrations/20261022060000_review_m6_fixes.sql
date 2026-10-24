-- Fixes for the Critical/High findings of the M6 independent review
-- (docs/reviews/review-M6.md). Tests: supabase/tests/130_review_m6.test.sql.
--
-- B1: a removed member could rejoin through a multi-use link created by someone
--     else before the removal, and rejoining erased the removal from the row.
-- F1: the activity feed relied on RLS alone, so every query evaluated the
--     visibility functions for every expense and settlement event of every user.
--     my_activity() starts from the caller's own groups, settlements and
--     expenses, so its cost follows the caller's activity. RLS still applies.

-- ---------------------------------------------------------------------------
-- B1: accept_invitation refuses invitations older than the caller's removal
-- ---------------------------------------------------------------------------

create or replace function public.accept_invitation(
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
  -- An invitation is only as valid as its creator's membership: a member who
  -- leaves or is removed cannot bring anyone in, including themselves.
  if not exists (
    select 1 from public.group_members m
     where m.group_id = v_inv.group_id and m.user_id = v_inv.created_by and m.left_at is null
  ) then
    perform private.fail('SM409', 'This invitation is no longer valid');
  end if;
  -- A removed member can't come back through an invitation that existed before
  -- the removal (SPEC §8: removed members cannot perform any future action).
  -- An invitation created afterwards is a deliberate re-invite. Leaving on your
  -- own is not a removal.
  if exists (
    select 1 from public.group_members m
     where m.group_id = v_inv.group_id and m.user_id = v_uid
       and m.removed_by is not null and v_inv.created_at < m.left_at
  ) then
    perform private.fail('SM403', 'You were removed from this group. Ask a member for a new invitation');
  end if;
  -- An invitation addressed to an email proves nothing until that email is confirmed.
  if v_inv.invited_email is not null and not exists (
    select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null
  ) then
    perform private.fail('SM403', 'Confirm your email address before accepting this invitation');
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

-- ---------------------------------------------------------------------------
-- F1: the caller's activity feed
-- ---------------------------------------------------------------------------

-- Expense and settlement events the caller can see, newest first. Candidate rows
-- come from indexed lookups on the caller's own data; RLS on audit_events then
-- decides visibility as before, so this never shows more than a plain select.
-- `total_count` is the number of matching events (for paging).
create function public.my_activity(p_limit integer default 25, p_offset integer default 0)
returns table (
  id uuid,
  actor_id uuid,
  action text,
  entity_type text,
  entity_id uuid,
  group_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz,
  total_count bigint
)
language sql stable security invoker set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid),
  candidates as (
    -- Events in groups the caller is currently in.
    select e.id from public.audit_events e
      join public.group_members m on m.group_id = e.group_id
     where m.user_id = (select uid from me) and m.left_at is null
    union
    -- Events the caller caused.
    select e.id from public.audit_events e where e.actor_id = (select uid from me)
    union
    -- Events about the caller's settlements (including groups they have left).
    select e.id from public.audit_events e
      join public.settlements s on s.id = e.entity_id and e.entity_type = 'settlement'
     where (select uid from me) in (s.payer_id, s.receiver_id)
    union
    -- Events about expenses the caller took part in (direct ones, and groups they have left).
    select e.id from public.audit_events e
      join public.expense_participants p on p.expense_id = e.entity_id and e.entity_type = 'expense'
     where p.user_id = (select uid from me)
    union
    select e.id from public.audit_events e
      join public.expense_payers p on p.expense_id = e.entity_id and e.entity_type = 'expense'
     where p.user_id = (select uid from me)
  )
  select e.id, e.actor_id, e.action, e.entity_type, e.entity_id, e.group_id, e.before, e.after, e.created_at,
         count(*) over ()
    from public.audit_events e
   where e.id in (select c.id from candidates c)
     and e.entity_type in ('expense', 'settlement')
     and e.action in ('expense.created', 'expense.updated', 'expense.cancelled', 'settlement.created',
                      'settlement.confirmed', 'settlement.rejected', 'settlement.cancelled')
   order by e.created_at desc, e.id
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create index audit_events_actor_created_idx on public.audit_events (actor_id, created_at);
drop index public.audit_events_actor_id_idx;

revoke all on function public.my_activity(integer, integer) from public, anon;
grant execute on function public.my_activity(integer, integer) to authenticated, service_role;
