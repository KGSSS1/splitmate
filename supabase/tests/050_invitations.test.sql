-- Invitations: hashed tokens, acceptance, auto-friendship, and token misuse
-- (expired, revoked, reused, wrong group, wrong email), revocation rights, rate limit.
begin;
select plan(29);

select tests.create_user(name) from unnest(array['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'gina']) as name;
select tests.make_group('Main', 'alice', array['bob']);
select tests.make_group('Other', 'erin');

-- Temp tables created while authenticated are owned by that role, so every test
-- user (all `authenticated`) can read the tokens they hold.
select tests.authenticate_as('alice');
create temp table inv_single as select * from public.create_invitation(tests.group_id('Main'), null, 1, 24);
create temp table inv_multi as select * from public.create_invitation(tests.group_id('Main'), null, 5, 24);
create temp table inv_expired as select * from public.create_invitation(tests.group_id('Main'));
create temp table inv_revoked as select * from public.create_invitation(tests.group_id('Main'));
create temp table inv_email as select * from public.create_invitation(tests.group_id('Main'), 'Frank@Tests.Local');

-- ---------------------------------------------------------------- tokens
select is(length((select token from inv_single)), 43, 'tokens are 256 random bits, URL-safe base64');
reset role;
select is(
  (select token_hash from public.group_invitations where id = (select invitation_id from inv_single)),
  extensions.digest((select token from inv_single), 'sha256'),
  'only the SHA-256 hash of the token is stored');
select isnt((select token from inv_single), (select token from inv_multi), 'tokens are unique');

-- ---------------------------------------------------------------- accept
select tests.authenticate_as('carol');
select is(public.accept_invitation((select token from inv_single)), tests.group_id('Main'),
          'accepting a valid token returns the group');
select ok(exists (select 1 from public.group_members where user_id = tests.uid('carol') and left_at is null),
          'the accepting user becomes a current member');
select is((select count(*)::int from public.friendships where status = 'accepted'), 2,
          'joining makes the new member friends with every current member');
select is(public.accept_invitation((select token from inv_single)), tests.group_id('Main'),
          'accepting again as a member is a harmless no-op');
reset role;
select is((select use_count from public.group_invitations where id = (select invitation_id from inv_single)), 1,
          'the no-op does not consume a use');

-- ---------------------------------------------------------------- misuse
select tests.authenticate_as('dave');
select throws_ok(format($$ select public.accept_invitation(%L) $$, (select token from inv_single)),
                 'SM409', 'This invitation has already been used', 'a single-use token cannot be reused');
select throws_ok($$ select public.accept_invitation('not-a-real-token') $$, 'SM404', 'Invitation not found', 'an unknown token is rejected');
select throws_ok(format($$ select public.accept_invitation(%L, null, %L) $$, (select token from inv_multi), tests.group_id('Other')),
                 'SM403', 'This invitation is for a different group', 'a token cannot be used for another group');
select throws_ok(format($$ select public.accept_invitation(%L) $$, (select token from inv_email)),
                 'SM403', 'This invitation was sent to a different email address', 'an invitation sent to an email cannot be used by someone else');
select throws_ok(format($$ select public.accept_invitation(null, %L) $$, (select invitation_id from inv_single)),
                 'SM404', 'Invitation not found', 'accepting by ID only works for an invitation addressed to you');

reset role;
update public.group_invitations set expires_at = now() - interval '1 minute'
 where id = (select invitation_id from inv_expired);
select tests.authenticate_as('dave');
select throws_ok(format($$ select public.accept_invitation(%L) $$, (select token from inv_expired)),
                 'SM409', 'This invitation has expired', 'an expired token is rejected');

-- ---------------------------------------------------------------- revoke
select tests.authenticate_as('bob');
select throws_ok(format($$ select public.revoke_invitation(%L) $$, (select invitation_id from inv_revoked)),
                 'SM403', 'Only the person who created the invitation or an admin can revoke it', 'a member who did not create the invitation cannot revoke it');
select tests.authenticate_as('alice');
select lives_ok(format($$ select public.revoke_invitation(%L) $$, (select invitation_id from inv_revoked)),
                'the creator revokes the invitation');
select tests.authenticate_as('dave');
select throws_ok(format($$ select public.accept_invitation(%L) $$, (select token from inv_revoked)),
                 'SM409', 'This invitation has been revoked', 'a revoked token is rejected');
select throws_ok(format($$ select public.revoke_invitation(%L) $$, (select invitation_id from inv_multi)),
                 'SM404', 'Invitation not found', 'a non-member cannot revoke (or even find) an invitation');

select tests.authenticate_as('bob');
create temp table inv_bob as select * from public.create_invitation(tests.group_id('Main'));
select tests.authenticate_as('alice');
select lives_ok(format($$ select public.revoke_invitation(%L) $$, (select invitation_id from inv_bob)),
                'an admin can revoke an invitation another member created');

-- ---------------------------------------------------------------- email invitations
reset role;
select is((select count(*)::int from public.notifications where user_id = tests.uid('frank') and type = 'group_invitation'), 1,
          'an existing user invited by email gets an in-app notification');
select is((select invited_email from public.group_invitations where id = (select invitation_id from inv_email)),
          'frank@tests.local', 'invited emails are stored lower-cased');
select tests.authenticate_as('frank');
select is(public.accept_invitation(null, (select invitation_id from inv_email)), tests.group_id('Main'),
          'the invitee accepts from the notification by invitation ID');

-- ---------------------------------------------------------------- multi-use
select tests.authenticate_as('dave');
select is(public.accept_invitation((select token from inv_multi)), tests.group_id('Main'), 'a multi-use token admits several people');
select tests.authenticate_as('gina');
select is(public.accept_invitation((select token from inv_multi), null, tests.group_id('Main')), tests.group_id('Main'),
          'the matching group ID is accepted');
reset role;
select is((select use_count from public.group_invitations where id = (select invitation_id from inv_multi)), 2,
          'each acceptance consumes one use');

-- ---------------------------------------------------------------- creation rules
select tests.authenticate_as('erin');
select throws_ok(format($$ select public.create_invitation(%L) $$, tests.group_id('Main')), 'SM403', 'You are not a member of this group',
                 'a non-member cannot create invitations');
select throws_ok(format($$ select public.create_invitation(%L, null, 0) $$, tests.group_id('Other')), 'SM422', 'An invitation can be used 1–100 times',
                 'max uses must be at least 1');
select lives_ok(format($$ select count(*) from (select public.create_invitation(%L) from generate_series(1, 20)) x $$,
                       tests.group_id('Other')),
                'up to 20 invitations per hour are allowed');
select throws_ok(format($$ select public.create_invitation(%L) $$, tests.group_id('Other')), 'SM429', 'Too many invitations; try again later',
                 'the 21st invitation within an hour is rate limited');

reset role;
select * from finish();
rollback;
