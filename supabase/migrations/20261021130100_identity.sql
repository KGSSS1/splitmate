-- Identity and social tables: profiles, friendships, groups, members, invitations.

-- profiles.id equals auth.users.id but deliberately has NO foreign key: account
-- deletion anonymizes the profile and deletes the auth user, while expenses and
-- ledger rows keep pointing at the profile (SPEC §6 "Deletion and history").
create table public.profiles (
  id uuid primary key,
  email text,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  default_currency public.currency_code not null default 'INR',
  locale text not null default 'en-IN' check (char_length(locale) between 2 and 35),
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  onboarded_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_lowercase check (email = lower(email)),
  constraint profiles_email_unique unique (email),
  constraint profiles_deleted_has_no_email check (deleted_at is null or email is null)
);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- Creates the profile when a user signs up.
create function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keeps the private email copy in sync when a user changes their email.
create function private.handle_user_email_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = lower(new.email)
   where id = new.id and deleted_at is null;
  return new;
end;
$$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.profiles (id) on delete restrict,
  user_high uuid not null references public.profiles (id) on delete restrict,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_pair_unique unique (user_low, user_high),
  constraint friendships_ordered check (user_low < user_high),
  constraint friendships_requester check (requested_by in (user_low, user_high)),
  constraint friendships_accepted_at check ((status = 'accepted') = (accepted_at is not null))
);

create index friendships_user_high_idx on public.friendships (user_high);
create index friendships_requested_by_idx on public.friendships (requested_by);
create trigger friendships_set_updated_at before update on public.friendships
  for each row execute function private.set_updated_at();

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 500),
  default_currency public.currency_code not null default 'INR',
  simplify_debts boolean not null default true,
  created_by uuid not null references public.profiles (id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index groups_created_by_idx on public.groups (created_by);
create trigger groups_set_updated_at before update on public.groups
  for each row execute function private.set_updated_at();

-- One row per person per group. left_at is null for current members; former
-- members keep their row (and their history). Rejoining clears left_at.
create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  removed_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_members_unique unique (group_id, user_id),
  constraint group_members_removed_has_left check (removed_by is null or left_at is not null)
);

create index group_members_user_id_idx on public.group_members (user_id);
create index group_members_removed_by_idx on public.group_members (removed_by);
create index group_members_current_idx on public.group_members (group_id) where left_at is null;
create trigger group_members_set_updated_at before update on public.group_members
  for each row execute function private.set_updated_at();

-- Only a SHA-256 hash of the invitation token is stored (SPEC §8).
create table public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  token_hash bytea not null check (octet_length(token_hash) = 32),
  invited_email text check (
    invited_email is null or (invited_email = lower(invited_email) and invited_email ~ '^[^@\s]+@[^@\s]+$')
  ),
  max_uses integer not null default 1 check (max_uses between 1 and 100),
  use_count integer not null default 0,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_invitations_token_hash_unique unique (token_hash),
  constraint group_invitations_use_count check (use_count >= 0 and use_count <= max_uses)
);

create index group_invitations_group_id_idx on public.group_invitations (group_id);
create index group_invitations_created_by_idx on public.group_invitations (created_by, created_at);
create trigger group_invitations_set_updated_at before update on public.group_invitations
  for each row execute function private.set_updated_at();
