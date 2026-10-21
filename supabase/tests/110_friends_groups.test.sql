-- M4: group type and settings, member roles, friend requests by email,
-- invitation preview and invitations addressed to the caller.
begin;
select plan(67);

select tests.create_user(name) from unnest(array['alice', 'bob', 'carol', 'dave', 'erin', 'frank']) as name;
select tests.make_group('Main', 'alice', array['bob']);
select tests.make_group('Other', 'erin');

-- ---------------------------------------------------------------- create_group
select tests.authenticate_as('carol');
create temp table trip as select public.create_group('Goa trip', 'INR', 'Beach week', 'trip', false) as id;
reset role;
select is((select group_type from public.groups where id = (select id from trip)), 'trip', 'create_group stores the group type');
select is((select simplify_debts from public.groups where id = (select id from trip)), false, 'create_group stores the simplify-debts choice');
select is((select role from public.group_members where group_id = (select id from trip) and user_id = tests.uid('carol')),
          'admin', 'the creator becomes admin');
select is((select after ->> 'group_type' from public.audit_events where action = 'group.created' and entity_id = (select id from trip)),
          'trip', 'the creation is audited with the settings');

select tests.authenticate_as('carol');
create temp table defaults_group as select public.create_group('Defaults') as id;
select is((select group_type from public.groups where id = (select id from defaults_group)), 'other',
          'the group type defaults to other');
select throws_ok($$ select public.create_group('Bad', 'INR', null, 'party') $$, 'SM422', 'Unknown group type',
                 'an unknown group type is rejected');
select throws_ok($$ select public.create_group('   ') $$, 'SM422', null, 'a blank name is rejected');
select throws_ok(format($$ select public.create_group('Long', 'INR', %L) $$, repeat('x', 501)), 'SM422', null,
                 'a description over 500 characters is rejected');

-- ---------------------------------------------------------------- update_group
select tests.authenticate_as('alice');
select lives_ok(format($$ select public.update_group(%L, 'Main', 'Rent and bills', 'USD', 'home', false) $$,
                       tests.group_id('Main')), 'an admin updates the group settings');
reset role;
select results_eq(
  format($$ select name, description, default_currency::text, group_type, simplify_debts from public.groups where id = %L $$,
         tests.group_id('Main')),
  $$ values ('Main'::text, 'Rent and bills'::text, 'USD'::text, 'home'::text, false) $$,
  'every setting is saved');
select is((select (before ->> 'group_type') || ' → ' || (after ->> 'group_type') from public.audit_events
            where action = 'group.updated' and entity_id = tests.group_id('Main')),
          'other → home', 'the change is audited with before and after');

select tests.authenticate_as('alice');
select lives_ok(format($$ select public.update_group(%L, 'Main', 'Rent and bills', 'USD', 'home', false) $$,
                       tests.group_id('Main')), 'saving unchanged settings is allowed');
reset role;
select is((select count(*)::int from public.audit_events where action = 'group.updated' and entity_id = tests.group_id('Main')),
          1, 'an unchanged save writes no audit event');

select tests.authenticate_as('bob');
select throws_ok(format($$ select public.update_group(%L, 'Mine', null, 'INR', 'other', true) $$, tests.group_id('Main')),
                 'SM403', null, 'a member who is not admin cannot change the settings');
select tests.authenticate_as('dave');
select throws_ok(format($$ select public.update_group(%L, 'Mine', null, 'INR', 'other', true) $$, tests.group_id('Main')),
                 'SM404', null, 'a non-member cannot find the group');
select tests.authenticate_as('alice');
select throws_ok(format($$ select public.update_group(%L, 'Flat', null, 'ZZZ', 'home', true) $$, tests.group_id('Main')),
                 'SM422', 'Unsupported currency', 'settings are validated');
select throws_ok(format($$ select public.update_group(%L, 'Flat', null, 'INR', 'home', null) $$, tests.group_id('Main')),
                 'SM422', null, 'the simplify-debts flag is required');

-- ---------------------------------------------------------------- set_member_role
select tests.authenticate_as('bob');
select throws_ok(format($$ select public.set_member_role(%L, %L, 'admin') $$, tests.group_id('Main'), tests.uid('bob')),
                 'SM403', null, 'a member cannot promote themselves');
select tests.authenticate_as('alice');
select throws_ok(format($$ select public.set_member_role(%L, %L, 'member') $$, tests.group_id('Main'), tests.uid('alice')),
                 'SM409', 'A group needs at least one admin', 'the last admin cannot be demoted');
select throws_ok(format($$ select public.set_member_role(%L, %L, 'owner') $$, tests.group_id('Main'), tests.uid('bob')),
                 'SM422', null, 'an unknown role is rejected');
select throws_ok(format($$ select public.set_member_role(%L, %L, 'admin') $$, tests.group_id('Main'), tests.uid('dave')),
                 'SM404', null, 'only current members can get a role');
select lives_ok(format($$ select public.set_member_role(%L, %L, 'admin') $$, tests.group_id('Main'), tests.uid('bob')),
                'an admin promotes a member');
select lives_ok(format($$ select public.set_member_role(%L, %L, 'member') $$, tests.group_id('Main'), tests.uid('alice')),
                'with another admin, an admin can step down');
reset role;
select results_eq(
  format($$ select user_id, role from public.group_members where group_id = %L order by role $$, tests.group_id('Main')),
  format($$ values (%L::uuid, 'admin'::text), (%L::uuid, 'member'::text) $$, tests.uid('bob'), tests.uid('alice')),
  'roles are updated');
select is((select count(*)::int from public.audit_events where action = 'member.role_changed'), 2, 'role changes are audited');

-- ---------------------------------------------------------------- friend requests
select tests.authenticate_as('carol');
select results_eq($$ select status, friend_id from public.send_friend_request('  DAVE@tests.local ') $$,
                  format($$ values ('requested'::text, %L::uuid) $$, tests.uid('dave')),
                  'a request to an exact email (any case) is created');
select results_eq($$ select status from public.send_friend_request('dave@tests.local') $$,
                  $$ values ('already_requested'::text) $$, 'asking again is a no-op');
select is((select status from public.friendships where requested_by = tests.uid('carol')), 'pending', 'the request is pending');
select results_eq($$ select status, friendship_id from public.send_friend_request('nobody@tests.local') $$,
                  $$ values ('not_found'::text, null::uuid) $$, 'an unknown email is reported as not found');
select results_eq($$ select status from public.send_friend_request('carol@tests.local') $$,
                  $$ values ('self'::text) $$, 'your own email is reported');
select throws_ok($$ select * from public.send_friend_request('not-an-email') $$, 'SM422', null, 'an invalid email is rejected');

reset role;
select is((select count(*)::int from public.notifications where user_id = tests.uid('dave') and type = 'friend_request'),
          1, 'the recipient is notified once');

select tests.authenticate_as('carol');
select throws_ok(format($$ select public.accept_friend_request(%L) $$,
                        (select id from public.friendships where requested_by = tests.uid('carol'))),
                 'SM403', null, 'the requester cannot accept their own request');
select tests.authenticate_as('erin');
select throws_ok(format($$ select public.accept_friend_request(%L) $$,
                        (select f.id from public.friendships f where f.requested_by = tests.uid('carol'))),
                 'SM404', null, 'an outsider cannot accept (or see) the request');
reset role;
create temp table carol_dave as select id from public.friendships where requested_by = tests.uid('carol');
grant select on carol_dave to authenticated;
select tests.authenticate_as('dave');
select lives_ok(format($$ select public.accept_friend_request(%L) $$, (select id from carol_dave)),
                'the recipient accepts');
select is((select status from public.friendships where id = (select id from carol_dave)), 'accepted', 'they are now friends');
select lives_ok(format($$ select public.accept_friend_request(%L) $$, (select id from carol_dave)),
                'accepting twice is a no-op');
select results_eq($$ select status from public.send_friend_request('carol@tests.local') $$,
                  $$ values ('already_friends'::text) $$, 'a request to a friend reports already friends');
select throws_ok(format($$ select public.delete_friend_request(%L) $$, (select id from carol_dave)),
                 'SM409', null, 'an accepted friendship cannot be declined');
reset role;
select is((select count(*)::int from public.notifications where user_id = tests.uid('carol') and type = 'friend_accepted'),
          1, 'the requester is notified of the acceptance');
select ok(exists (select 1 from public.audit_events where action = 'friend.accepted' and actor_id = tests.uid('dave')),
          'acceptance is audited');

-- Crossing requests: asking someone who already asked you accepts theirs.
select tests.authenticate_as('frank');
select results_eq($$ select status from public.send_friend_request('erin@tests.local') $$,
                  $$ values ('requested'::text) $$, 'frank asks erin');
select tests.authenticate_as('erin');
select results_eq($$ select status from public.send_friend_request('frank@tests.local') $$,
                  $$ values ('accepted'::text) $$, 'erin asking frank back accepts his request');

-- Decline and withdraw.
select tests.authenticate_as('bob');
create temp table bob_frank as select * from public.send_friend_request('frank@tests.local');
select tests.authenticate_as('frank');
select lives_ok(format($$ select public.delete_friend_request(%L) $$, (select friendship_id from bob_frank)),
                'the recipient declines');
select tests.authenticate_as('bob');
select is((select count(*)::int from public.friendships where tests.uid('frank') in (user_low, user_high) and tests.uid('bob') in (user_low, user_high)),
          0, 'a declined request is gone');
create temp table bob_frank2 as select * from public.send_friend_request('frank@tests.local');
select lives_ok(format($$ select public.delete_friend_request(%L) $$, (select friendship_id from bob_frank2)),
                'the requester withdraws');
select throws_ok(format($$ select public.delete_friend_request(%L) $$, (select friendship_id from bob_frank2)),
                 'SM404', null, 'a withdrawn request no longer exists');

-- Clients cannot write friendships directly or read the rate-limit table.
select throws_ok(format($$ insert into public.friendships (user_low, user_high, requested_by, status, accepted_at)
                           values (least(%1$L::uuid, %2$L::uuid), greatest(%1$L::uuid, %2$L::uuid), %1$L, 'accepted', now()) $$,
                        tests.uid('bob'), tests.uid('dave')),
                 '42501', null, 'clients cannot create friendships directly');
select throws_ok($$ select count(*) from private.rate_limit_events $$, '42501', null,
                 'the rate-limit table is not readable by clients');

-- Joining a group turns a pending request between members into a friendship.
select tests.authenticate_as('dave');
create temp table dave_erin as select * from public.send_friend_request('erin@tests.local');
select tests.authenticate_as('erin');
create temp table inv_other as select * from public.create_invitation(tests.group_id('Other'));
select tests.authenticate_as('dave');
select is(public.accept_invitation((select token from inv_other)), tests.group_id('Other'), 'dave joins erin''s group');
select is((select status from public.friendships where id = (select friendship_id from dave_erin)), 'accepted',
          'joining a group accepts a pending request between members');

-- Rate limit: 30 lookups per hour, misses included.
select tests.authenticate_as('alice');
select lives_ok($$ select count(*) from generate_series(1, 30) as n, lateral public.send_friend_request('ghost' || n || '@tests.local') $$,
                '30 lookups in an hour are allowed');
select throws_ok($$ select * from public.send_friend_request('ghost31@tests.local') $$, 'SM429', null,
                 'the 31st lookup in an hour is rate limited');

-- ---------------------------------------------------------------- invitation_preview
select tests.authenticate_as('bob');
create temp table inv_main as select * from public.create_invitation(tests.group_id('Main'), null, 2, 24);
create temp table inv_frank as select * from public.create_invitation(tests.group_id('Main'), 'frank@tests.local');
create temp table inv_rev as select * from public.create_invitation(tests.group_id('Main'));
select public.revoke_invitation((select invitation_id from inv_rev));

select tests.authenticate_as('carol');
select results_eq(format($$ select status, group_name, group_type, inviter_name, member_count from public.invitation_preview(%L, %L) $$,
                         (select token from inv_main), tests.group_id('Main')),
                  $$ values ('valid'::text, 'Main'::text, 'home'::text, 'Bob'::text, 2) $$,
                  'a valid token shows the group, its type, the inviter and the member count');
select results_eq(format($$ select status, group_name from public.invitation_preview(%L, %L) $$,
                         (select token from inv_main), tests.group_id('Other')),
                  $$ values ('wrong_group'::text, null::text) $$,
                  'a token presented for another group reveals nothing');
select results_eq($$ select status, group_name from public.invitation_preview('nope') $$,
                  $$ values ('not_found'::text, null::text) $$, 'an unknown token is not found');
select results_eq(format($$ select status, group_name from public.invitation_preview(%L) $$, (select token from inv_rev)),
                  $$ values ('revoked'::text, null::text) $$, 'a revoked token is reported without details');
select results_eq(format($$ select status from public.invitation_preview(%L) $$, (select token from inv_frank)),
                  $$ values ('wrong_email'::text) $$, 'an invitation for someone else''s email is reported');
select tests.authenticate_as('alice');
select results_eq(format($$ select status, group_id from public.invitation_preview(%L) $$, (select token from inv_main)),
                  format($$ values ('member'::text, %L::uuid) $$, tests.group_id('Main')),
                  'a current member is told they are already in the group');
select is((select count(*)::int from public.invitation_preview((select token from inv_main))), 1,
          'previewing does not consume a use');

reset role;
update public.group_invitations set expires_at = now() - interval '1 minute' where id = (select invitation_id from inv_main);
select tests.authenticate_as('carol');
select results_eq(format($$ select status from public.invitation_preview(%L) $$, (select token from inv_main)),
                  $$ values ('expired'::text) $$, 'an expired token is reported');

-- ---------------------------------------------------------------- my_group_invitations
select tests.authenticate_as('frank');
select results_eq($$ select group_name, inviter_name from public.my_group_invitations() $$,
                  $$ values ('Main'::text, 'Bob'::text) $$, 'invitations addressed to my email are listed');
select tests.authenticate_as('carol');
select is((select count(*)::int from public.my_group_invitations()), 0, 'other people''s email invitations are not listed');
select tests.authenticate_as('frank');
select lives_ok(format($$ select public.accept_invitation(null, %L) $$, (select invitation_id from inv_frank)),
                'frank accepts from the list');
select is((select count(*)::int from public.my_group_invitations()), 0, 'an accepted invitation leaves the list');

-- ---------------------------------------------------------------- anon
select tests.authenticate_anon();
select throws_ok($$ select * from public.invitation_preview('x') $$, '42501', null, 'anon cannot preview invitations');
select throws_ok($$ select * from public.send_friend_request('a@b.c') $$, '42501', null, 'anon cannot send friend requests');

select * from finish();
rollback;
