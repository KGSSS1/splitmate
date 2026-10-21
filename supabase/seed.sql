-- Local development seed (applied by `npm run db:reset`). Synthetic users and data only;
-- never run this against a hosted or production database.
--
-- Users (local-only password for all: splitmate-local-dev)
--   alice@example.test, bob@example.test, carol@example.test — members of "Flat 4B"
--   dave@example.test — an outsider with no groups or friends

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('splitmate-local-dev', extensions.gen_salt('bf')), now(),
       '{"provider": "email", "providers": ["email"]}', jsonb_build_object('display_name', u.name),
       now(), now(), '', '', '', ''
  from (values
    ('11111111-1111-4111-8111-111111111111'::uuid, 'alice@example.test', 'Alice'),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'bob@example.test', 'Bob'),
    ('33333333-3333-4333-8333-333333333333'::uuid, 'carol@example.test', 'Carol'),
    ('44444444-4444-4444-8444-444444444444'::uuid, 'dave@example.test', 'Dave')
  ) as u(id, email, name);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u
 where u.email like '%@example.test';

-- Data is created through the same RPC functions the app uses, acting as each user.
do $$
declare
  v_alice constant uuid := '11111111-1111-4111-8111-111111111111';
  v_bob constant uuid := '22222222-2222-4222-8222-222222222222';
  v_carol constant uuid := '33333333-3333-4333-8333-333333333333';
  v_group uuid;
  v_invite record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  v_group := public.create_group('Flat 4B', 'INR', 'Rent, groceries and bills', 'home');
  select * into v_invite from public.create_invitation(v_group, null, 5, 720);

  perform set_config('request.jwt.claims', json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  perform public.accept_invitation(v_invite.token);
  perform set_config('request.jwt.claims', json_build_object('sub', v_carol, 'role', 'authenticated')::text, true);
  perform public.accept_invitation(v_invite.token);

  -- Alice pays ₹900 for groceries, split equally (shares and entries as src/lib/accounting computes them).
  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  perform public.create_expense(
    'aaaaaaaa-0000-4000-8000-000000000001', v_group, 'Groceries', 90000, 'INR', current_date - 2, 'equal',
    jsonb_build_array(jsonb_build_object('user_id', v_alice, 'amount', 90000)),
    jsonb_build_array(
      jsonb_build_object('user_id', v_alice, 'amount', 30000),
      jsonb_build_object('user_id', v_bob, 'amount', 30000),
      jsonb_build_object('user_id', v_carol, 'amount', 30000)
    ),
    jsonb_build_array(
      jsonb_build_object('debtor_id', v_bob, 'creditor_id', v_alice, 'amount', 30000),
      jsonb_build_object('debtor_id', v_carol, 'creditor_id', v_alice, 'amount', 30000)
    ),
    p_category => 'Groceries'
  );

  -- Bob records a ₹100 UPI repayment; it stays pending until Alice confirms.
  perform set_config('request.jwt.claims', json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  perform public.create_settlement(
    'aaaaaaaa-0000-4000-8000-000000000002', v_group, v_bob, v_alice, 10000, 'INR', 'upi', 'UPI-SEED-0001'
  );

  perform set_config('request.jwt.claims', '', true);
end;
$$;
