-- Auth users deleted outside the app (dashboard, admin API).
--
-- Profiles have no FK to auth.users, so history survives account deletion
-- (SPEC §6). But when an auth user was deleted directly, its profile kept the
-- email, and the unique email then made every new sign-up with that address
-- fail ("Database error creating new user", found on staging 2026-10-24).
-- Such a profile is now anonymized the way account deletion does it.

create function private.anonymize_profile(p_user_id uuid) returns void
language sql security definer set search_path = ''
as $$
  update public.profiles
     set email = null,
         display_name = 'Deleted user',
         avatar_url = null,
         deleted_at = coalesce(deleted_at, now())
   where id = p_user_id;
$$;

create function private.handle_user_deleted() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.anonymize_profile(old.id);
  return old;
end;
$$;

create trigger on_auth_user_deleted after delete on auth.users
  for each row execute function private.handle_user_deleted();

-- Creates the profile when a user signs up. A profile left holding the email
-- without its auth user (deleted before the trigger above existed) gives it up.
create or replace function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orphan uuid;
begin
  for v_orphan in
    select p.id from public.profiles p
     where p.email = lower(new.email) and p.id <> new.id
       and not exists (select 1 from auth.users u where u.id = p.id)
  loop
    perform private.anonymize_profile(v_orphan);
  end loop;

  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    lower(new.email),
    coalesce(
      nullif(left(btrim(new.raw_user_meta_data ->> 'display_name'), 80), ''),
      nullif(left(split_part(coalesce(new.email, ''), '@', 1), 80), ''),
      'User'
    )
  );
  return new;
end;
$$;

-- Profiles already left behind (one on staging) are anonymized now.
select private.anonymize_profile(p.id)
  from public.profiles p
 where p.deleted_at is null
   and not exists (select 1 from auth.users u where u.id = p.id);

revoke all on function private.anonymize_profile(uuid), private.handle_user_deleted()
  from public, anon, authenticated;
