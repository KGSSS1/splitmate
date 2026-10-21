-- Read functions (balances, public profile fields), the receipts bucket, and
-- EXECUTE grants for the API.

-- Net balance per member and currency in one group, computed from the ledger
-- (never stored). SECURITY INVOKER: RLS on ledger_entries decides what is visible
-- (current members see the whole group; former members only their own rows).
create function public.group_balances(p_group_id uuid)
returns table (user_id uuid, currency text, amount bigint)
language sql stable security invoker set search_path = ''
as $$
  select u.user_id, l.currency::text, sum(u.delta)::bigint
    from public.ledger_entries l
   cross join lateral (values (l.creditor_id, l.amount::bigint), (l.debtor_id, -l.amount::bigint)) as u(user_id, delta)
   where l.group_id = p_group_id
   group by u.user_id, l.currency
  having sum(u.delta) <> 0
   order by l.currency, u.user_id;
$$;

-- The caller's balance with each friend per currency, across all groups and
-- direct expenses (raw pairwise totals). Positive = the friend owes the caller.
create function public.friend_balances()
returns table (friend_id uuid, currency text, amount bigint)
language sql stable security invoker set search_path = ''
as $$
  select case when l.creditor_id = (select auth.uid()) then l.debtor_id else l.creditor_id end,
         l.currency::text,
         sum(case when l.creditor_id = (select auth.uid()) then l.amount else -l.amount end)::bigint
    from public.ledger_entries l
   where (select auth.uid()) in (l.debtor_id, l.creditor_id)
   group by 1, 2
  having sum(case when l.creditor_id = (select auth.uid()) then l.amount else -l.amount end) <> 0
   order by 1, 2;
$$;

-- Public fields (name, avatar) of people the caller shares a group or friendship with.
-- Deleted accounts appear as "Deleted user".
create function public.profile_cards(p_user_ids uuid[])
returns table (id uuid, display_name text, avatar_url text)
language sql stable security definer set search_path = ''
as $$
  select p.id,
         case when p.deleted_at is null then p.display_name else 'Deleted user' end,
         case when p.deleted_at is null then p.avatar_url end
    from public.profiles p
   where p.id = any (p_user_ids)
     and (select auth.uid()) is not null
     and private.shares_context_with(p.id)
   order by p.id;
$$;

-- ---------------------------------------------------------------------------
-- Receipts: private bucket, objects at {expense_id}/{file} (SPEC §8)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and private.can_view_expense(private.receipt_expense_id(name)));

create policy receipts_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and owner_id = (select auth.uid())::text
    and private.can_edit_expense(private.receipt_expense_id(name))
  );

create policy receipts_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and owner_id = (select auth.uid())::text
    and private.can_edit_expense(private.receipt_expense_id(name))
  );

-- ---------------------------------------------------------------------------
-- EXECUTE: only these functions are callable by signed-in users; nothing by anon.
-- ---------------------------------------------------------------------------

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.create_group(text, text, text),
  public.create_invitation(uuid, text, integer, integer),
  public.accept_invitation(text, uuid, uuid),
  public.revoke_invitation(uuid),
  public.leave_group(uuid),
  public.remove_group_member(uuid, uuid),
  public.create_expense(uuid, uuid, text, bigint, text, date, text, jsonb, jsonb, jsonb, jsonb, text, text, text[]),
  public.update_expense(uuid, integer, text, bigint, text, date, text, jsonb, jsonb, jsonb, jsonb, text, text, text[]),
  public.cancel_expense(uuid, integer),
  public.create_settlement(uuid, uuid, uuid, uuid, bigint, text, text, text, text, date),
  public.confirm_settlement(uuid),
  public.reject_settlement(uuid),
  public.cancel_settlement(uuid),
  public.group_balances(uuid),
  public.friend_balances(),
  public.profile_cards(uuid[])
to authenticated;

-- Internal helpers stay private (the policy helpers were granted in earlier migrations).
revoke all on function
  private.validate_expense_fields(text, bigint, text, date, text),
  private.lock_expense_for_change(uuid, integer, uuid),
  private.settlement_ledger_entry(public.settlements, text),
  private.settlement_data(public.settlements),
  private.lock_settlement(uuid, uuid),
  private.end_membership(uuid, uuid, uuid)
from public, anon, authenticated;
