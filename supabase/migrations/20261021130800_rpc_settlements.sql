-- Settlements (SPEC §2, §11). Only `completed` settlements touch the ledger:
-- one entry receiver → payer (the payer's debt shrinks), reversed on cancellation.
--   recorded by receiver → completed      recorded by payer → pending
--   pending --confirm/reject (receiver)--> completed / rejected
--   pending --cancel (payer withdraws)---> cancelled
--   completed --cancel (either)----------> cancelled + reversal

create function private.settlement_ledger_entry(p_settlement public.settlements, p_entry_type text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.ledger_entries
    (debtor_id, creditor_id, amount, currency, group_id, settlement_id, source_version, entry_type)
  values (
    case when p_entry_type = 'charge' then p_settlement.receiver_id else p_settlement.payer_id end,
    case when p_entry_type = 'charge' then p_settlement.payer_id else p_settlement.receiver_id end,
    p_settlement.amount, p_settlement.currency, p_settlement.group_id, p_settlement.id, 1, p_entry_type
  );
$$;

create function private.settlement_data(p_settlement public.settlements) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'status', p_settlement.status,
    'payer_id', p_settlement.payer_id,
    'receiver_id', p_settlement.receiver_id,
    'amount', p_settlement.amount,
    'currency', p_settlement.currency,
    'method', p_settlement.method
  );
$$;

create function public.create_settlement(
  p_idempotency_key uuid,
  p_group_id uuid,
  p_payer_id uuid,
  p_receiver_id uuid,
  p_amount bigint,
  p_currency text,
  p_method text default 'cash',
  p_upi_reference text default null,
  p_note text default null,
  p_settled_on date default current_date
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_settlement public.settlements%rowtype;
  v_status text;
begin
  if p_idempotency_key is null then
    perform private.fail('SM422', 'An idempotency key is required');
  end if;
  select * into v_settlement from public.settlements s
   where s.created_by = v_uid and s.idempotency_key = p_idempotency_key;
  if found then
    return v_settlement.id;
  end if;

  if p_payer_id is null or p_receiver_id is null or p_payer_id = p_receiver_id then
    perform private.fail('SM422', 'A settlement needs a payer and a different receiver');
  end if;
  if v_uid not in (p_payer_id, p_receiver_id) then
    perform private.fail('SM403', 'Only the payer or the receiver can record a settlement');
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 9007199254740991 then
    perform private.fail('SM422', 'Amount must be a positive whole number of minor units');
  end if;
  if not private.is_supported_currency(p_currency) then
    perform private.fail('SM422', 'Unsupported currency');
  end if;
  if p_method is null or p_method not in ('cash', 'bank_transfer', 'upi', 'other') then
    perform private.fail('SM422', 'Unknown payment method');
  end if;
  perform private.require_parties(p_group_id, v_uid, array[p_payer_id, p_receiver_id]);

  -- The receiver confirms by recording it; a payer's record waits for the receiver.
  v_status := case when v_uid = p_receiver_id then 'completed' else 'pending' end;

  insert into public.settlements (
    group_id, payer_id, receiver_id, amount, currency, method, upi_reference, note, settled_on,
    status, created_by, idempotency_key, confirmed_at
  ) values (
    p_group_id, p_payer_id, p_receiver_id, p_amount, p_currency, p_method,
    nullif(btrim(p_upi_reference), ''), nullif(btrim(p_note), ''), coalesce(p_settled_on, current_date),
    v_status, v_uid, p_idempotency_key, case when v_status = 'completed' then now() end
  )
  on conflict (created_by, idempotency_key) do nothing
  returning * into v_settlement;

  if v_settlement.id is null then
    select s.id into v_settlement.id from public.settlements s
     where s.created_by = v_uid and s.idempotency_key = p_idempotency_key;
    return v_settlement.id;
  end if;

  if v_status = 'completed' then
    perform private.settlement_ledger_entry(v_settlement, 'charge');
  end if;
  perform private.audit(v_uid, 'settlement.created', 'settlement', v_settlement.id, p_group_id, null,
                        private.settlement_data(v_settlement));
  perform private.notify(case when v_uid = p_payer_id then p_receiver_id else p_payer_id end,
                         'settlement_recorded', v_uid, p_group_id, null, v_settlement.id,
                         private.settlement_data(v_settlement));
  return v_settlement.id;
end;
$$;

-- Locks a settlement the caller is a party to.
create function private.lock_settlement(p_settlement_id uuid, p_actor uuid) returns public.settlements
language plpgsql security definer set search_path = ''
as $$
declare
  v_settlement public.settlements%rowtype;
begin
  select * into v_settlement from public.settlements s where s.id = p_settlement_id for update;
  if not found or p_actor not in (v_settlement.payer_id, v_settlement.receiver_id) then
    perform private.fail('SM404', 'Settlement not found');
  end if;
  -- Former members cannot act on the group's settlements (SPEC §8).
  if v_settlement.group_id is not null and not exists (
    select 1 from public.group_members m
     where m.group_id = v_settlement.group_id and m.user_id = p_actor and m.left_at is null
  ) then
    perform private.fail('SM403', 'You are no longer a member of this group');
  end if;
  return v_settlement;
end;
$$;

create function public.confirm_settlement(p_settlement_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_settlement public.settlements%rowtype;
  v_before jsonb;
begin
  v_settlement := private.lock_settlement(p_settlement_id, v_uid);
  if v_uid <> v_settlement.receiver_id then
    perform private.fail('SM403', 'Only the receiver can confirm a settlement');
  end if;
  if v_settlement.status <> 'pending' then
    perform private.fail('SM409', format('Cannot confirm a %s settlement', v_settlement.status));
  end if;
  -- Both people must still be in the group (or still friends) so balances stay valid.
  perform private.require_parties(v_settlement.group_id, v_uid, array[v_settlement.payer_id, v_settlement.receiver_id]);

  v_before := private.settlement_data(v_settlement);
  update public.settlements set status = 'completed', confirmed_at = now()
   where id = v_settlement.id
  returning * into v_settlement;
  perform private.settlement_ledger_entry(v_settlement, 'charge');

  perform private.audit(v_uid, 'settlement.confirmed', 'settlement', v_settlement.id, v_settlement.group_id,
                        v_before, private.settlement_data(v_settlement));
  perform private.notify(v_settlement.payer_id, 'settlement_confirmed', v_uid, v_settlement.group_id, null,
                         v_settlement.id, private.settlement_data(v_settlement));
end;
$$;

create function public.reject_settlement(p_settlement_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_settlement public.settlements%rowtype;
  v_before jsonb;
begin
  v_settlement := private.lock_settlement(p_settlement_id, v_uid);
  if v_uid <> v_settlement.receiver_id then
    perform private.fail('SM403', 'Only the receiver can reject a settlement');
  end if;
  if v_settlement.status <> 'pending' then
    perform private.fail('SM409', format('Cannot reject a %s settlement', v_settlement.status));
  end if;

  v_before := private.settlement_data(v_settlement);
  update public.settlements set status = 'rejected', rejected_at = now()
   where id = v_settlement.id
  returning * into v_settlement;

  perform private.audit(v_uid, 'settlement.rejected', 'settlement', v_settlement.id, v_settlement.group_id,
                        v_before, private.settlement_data(v_settlement));
  perform private.notify(v_settlement.payer_id, 'settlement_rejected', v_uid, v_settlement.group_id, null,
                         v_settlement.id, private.settlement_data(v_settlement));
end;
$$;

create function public.cancel_settlement(p_settlement_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_settlement public.settlements%rowtype;
  v_before jsonb;
  v_was_completed boolean;
begin
  v_settlement := private.lock_settlement(p_settlement_id, v_uid);
  if v_settlement.status = 'pending' then
    if v_uid <> v_settlement.payer_id then
      perform private.fail('SM403', 'The receiver rejects a pending settlement instead of cancelling it');
    end if;
  elsif v_settlement.status = 'completed' then
    perform private.require_parties(v_settlement.group_id, v_uid,
                                    array[v_settlement.payer_id, v_settlement.receiver_id]);
  else
    perform private.fail('SM409', format('Cannot cancel a %s settlement', v_settlement.status));
  end if;

  v_was_completed := v_settlement.status = 'completed';
  v_before := private.settlement_data(v_settlement);
  update public.settlements set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid
   where id = v_settlement.id
  returning * into v_settlement;
  if v_was_completed then
    perform private.settlement_ledger_entry(v_settlement, 'reversal');
  end if;

  perform private.audit(v_uid, 'settlement.cancelled', 'settlement', v_settlement.id, v_settlement.group_id,
                        v_before, private.settlement_data(v_settlement));
  perform private.notify(case when v_uid = v_settlement.payer_id then v_settlement.receiver_id
                              else v_settlement.payer_id end,
                         'settlement_cancelled', v_uid, v_settlement.group_id, null, v_settlement.id,
                         private.settlement_data(v_settlement));
end;
$$;
