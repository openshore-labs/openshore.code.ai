-- pgTAP coverage for the row-level and column-level rules the 2026-09-05
-- review tightened (P0-4, BE-1, BE-2, BE-5, BE-6, BE-8, BE-10). Run with
-- `supabase test db` against a database that has every migration applied.
--
-- Shape: everything happens inside one transaction that is rolled back at the
-- end, so nothing persists. Users are seeded straight into auth.users; a
-- caller is impersonated by setting request.jwt.claims (what auth.uid() and
-- auth.email() read) and switching to the `authenticated` role. Every
-- expected failure goes through throws_ok, which runs the statement in a
-- savepoint so the outer transaction survives.
--
-- Error codes: 42501 is both "permission denied for column" (a column grant)
-- and "new row violates row-level security policy"; P0001 is a plpgsql
-- `raise exception`; 23514 is a check_violation (the seat triggers).

begin;
select plan(32);

-- ------------------------------------------------------------ fixtures
-- Fixed uuids so the JSON claims below can be written by hand.
--   a1 = org owner and admin (confirmed)
--   b2 = invited member, confirmed
--   c3 = a stranger with a confirmed email, not in the org
--   d4 = an UNCONFIRMED signup carrying an invited address (P0-4 attacker)
--   e5 = a second invited member (confirmed) who will be revoked
insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('a1000000-0000-0000-0000-000000000001', 'owner@example.com',   now(), 'authenticated', 'authenticated'),
  ('b2000000-0000-0000-0000-000000000002', 'member@example.com',  now(), 'authenticated', 'authenticated'),
  ('c3000000-0000-0000-0000-000000000003', 'stranger@example.com', now(), 'authenticated', 'authenticated'),
  ('d4000000-0000-0000-0000-000000000004', 'victim@example.com',  null,  'authenticated', 'authenticated'),
  ('e5000000-0000-0000-0000-000000000005', 'leaver@example.com',  now(), 'authenticated', 'authenticated');

insert into public.orgs (id, name, owner_uid, seat_count, tier_id)
values ('0a000000-0000-0000-0000-00000000000a', 'Acme', 'a1000000-0000-0000-0000-000000000001', 3, 'personal');

-- The owner's own admin row, plus invites for member, victim, and leaver.
insert into public.org_members (org_id, user_id, email, role, status)
values
  ('0a000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'owner@example.com', 'admin', 'active'),
  ('0a000000-0000-0000-0000-00000000000a', null, 'member@example.com', 'member', 'invited'),
  ('0a000000-0000-0000-0000-00000000000a', null, 'victim@example.com', 'admin', 'invited'),
  ('0a000000-0000-0000-0000-00000000000a', null, 'leaver@example.com', 'member', 'invited');

-- ------------------------------------------------------------ P0-4 claim
-- An UNCONFIRMED signup carrying an invited (admin!) address claims nothing.
select set_config('request.jwt.claims',
  '{"sub":"d4000000-0000-0000-0000-000000000004","email":"victim@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(public.claim_membership(), 0, 'P0-4: an unconfirmed email claims no seat');
reset role;
select is(
  (select user_id from public.org_members where email = 'victim@example.com'),
  null::uuid,
  'P0-4: the invited admin seat stays unbound after the unconfirmed attempt');

-- A CONFIRMED member claims exactly their own seat, and only that one.
select set_config('request.jwt.claims',
  '{"sub":"b2000000-0000-0000-0000-000000000002","email":"member@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(public.claim_membership(), 1, 'claim_membership binds one seat for the JWT email');
reset role;
select is(
  (select user_id from public.org_members where email = 'member@example.com'),
  'b2000000-0000-0000-0000-000000000002'::uuid,
  'claim_membership bound the seat to the caller');
select is(
  (select count(*) from public.org_members where user_id is null and email <> 'member@example.com'),
  2::bigint,
  'claim_membership left every other invited seat alone');

-- The leaver claims too (needed for the BE-5 case below).
select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-000000000005","email":"leaver@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(public.claim_membership(), 1, 'the second member claims their seat');
reset role;

-- ------------------------------------------------------------ member limits
select set_config('request.jwt.claims',
  '{"sub":"b2000000-0000-0000-0000-000000000002","email":"member@example.com","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$ update public.orgs set tier_id = 'commercial_large' where id = '0a000000-0000-0000-0000-00000000000a' $$,
  '42501', null::text,
  'a member cannot patch orgs.tier_id (column grant)');

select throws_ok(
  $$ insert into public.org_members (org_id, email, role, status)
     values ('0a000000-0000-0000-0000-00000000000a', 'friend@example.com', 'admin', 'active') $$,
  '42501', null::text,
  'a member cannot write org_members (RLS)');

select throws_ok(
  $$ select public.org_vault_put('0a000000-0000-0000-0000-00000000000a', '../../escape.md', 'x', null) $$,
  'P0001', null::text,
  'BE-10: org_vault_put refuses a traversal path even for a member');

select lives_ok(
  $$ select public.org_vault_put('0a000000-0000-0000-0000-00000000000a', 'notes/hello.md', 'hi', null) $$,
  'a member writes a well-formed vault path');

reset role;

-- ------------------------------------------------------------ admin limits
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-000000000001","email":"owner@example.com","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$ update public.org_members set user_id = 'c3000000-0000-0000-0000-000000000003'
     where email = 'member@example.com' $$,
  '42501', null::text,
  'BE-1: an admin cannot set org_members.user_id (column grant)');

select throws_ok(
  $$ insert into public.org_members (org_id, user_id, email, role, status)
     values ('0a000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000003',
             'stranger@example.com', 'member', 'active') $$,
  '42501', null::text,
  'BE-1: an admin cannot enroll another user_id (RLS WITH CHECK)');

select lives_ok(
  $$ update public.org_members set role = 'admin' where email = 'member@example.com' $$,
  'BE-1: an admin can still change a bound member''s role');

select lives_ok(
  $$ update public.org_members set role = 'member' where email = 'member@example.com' $$,
  'BE-1: and change it back');

-- BE-2 with NO entitlement row: no ceiling today (no_entitlement_max_seats is
-- null), so a fifth invite lands.
select lives_ok(
  $$ insert into public.org_members (org_id, email, role, status)
     values ('0a000000-0000-0000-0000-00000000000a', 'fifth@example.com', 'member', 'invited') $$,
  'BE-2: without an entitlement row the roster is not capped (beta)');

reset role;

-- ------------------------------------------------------------ BE-2 ceilings
-- Give the org a Micro entitlement (5 seats). The roster now holds 5 rows
-- (owner, member, victim, leaver, fifth), so the next invite must be refused,
-- while a revoked row never trips the ceiling.
insert into public.org_entitlements (org_id, tier_id, seats, status)
values ('0a000000-0000-0000-0000-00000000000a', 'commercial_micro', 5, 'active');

select is(public.tier_max_seats('commercial_micro'), 5, 'BE-2: Micro covers 5 seats');
select is(public.tier_max_seats('commercial_large'), null::int, 'BE-2: Scale is unbounded');
select is(public.org_seat_ceiling('0a000000-0000-0000-0000-00000000000a'), 5, 'BE-2: the org ceiling follows the entitled tier');

select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-000000000001","email":"owner@example.com","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$ insert into public.org_members (org_id, email, role, status)
     values ('0a000000-0000-0000-0000-00000000000a', 'sixth@example.com', 'member', 'invited') $$,
  '23514', null::text,
  'BE-2: a sixth member on Micro is refused');

select lives_ok(
  $$ insert into public.org_members (org_id, email, role, status)
     values ('0a000000-0000-0000-0000-00000000000a', 'gone@example.com', 'member', 'revoked') $$,
  'BE-2: a revoked row does not count against the ceiling');

select throws_ok(
  $$ update public.orgs set seat_count = 6 where id = '0a000000-0000-0000-0000-00000000000a' $$,
  '23514', null::text,
  'BE-2: seat_count cannot exceed the entitled band');

select lives_ok(
  $$ update public.orgs set seat_count = 5 where id = '0a000000-0000-0000-0000-00000000000a' $$,
  'BE-2: seat_count within the band still saves');

reset role;

-- ------------------------------------------------------------ BE-5 projects
-- The admin shares a project with the leaver; the leaver can see it; then the
-- admin revokes the leaver's seat and the level drops to null.
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-000000000001","email":"owner@example.com","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.set_org_project_access(
       public.create_org_project('0a000000-0000-0000-0000-00000000000a', 'Shared', '', '{}'),
       'leaver@example.com', 'write') $$,
  'an admin shares a project with an active member');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-000000000005","email":"leaver@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select public.project_level(id) from public.org_projects where name = 'Shared'),
  'write',
  'an active member holds their granted level');
reset role;

update public.org_members set status = 'revoked' where email = 'leaver@example.com';

select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-000000000005","email":"leaver@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select public.project_level(id) from public.org_projects where name = 'Shared'),
  null::text,
  'BE-5: a removed member gets project_level null');
select is(
  (select count(*) from public.list_org_projects()),
  0::bigint,
  'BE-5: a removed member lists no shared projects');
reset role;

-- A non-member: no vault write, whatever the path.
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-0000-0000-000000000003","email":"stranger@example.com","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.org_vault_put('0a000000-0000-0000-0000-00000000000a', 'notes/x.md', 'x', null) $$,
  'P0001', null::text,
  'a non-member''s org_vault_put is refused');
reset role;

-- ------------------------------------------------------------ BE-6 reviews
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-0000-0000-000000000003","email":"stranger@example.com","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$ insert into public.model_reviews (user_id, model_id, rating, flag_count)
     values ('c3000000-0000-0000-0000-000000000003', 'qwen', 5, -1000000) $$,
  '42501', null::text,
  'BE-6: an author cannot write flag_count');

select throws_ok(
  $$ insert into public.model_reviews (user_id, model_id, rating, status)
     values ('c3000000-0000-0000-0000-000000000003', 'qwen', 5, 'visible') $$,
  '42501', null::text,
  'BE-6: an author cannot write status, even to its default');

select lives_ok(
  $$ insert into public.model_reviews (user_id, model_id, rating, body)
     values ('c3000000-0000-0000-0000-000000000003', 'qwen', 5, 'fast') $$,
  'BE-6: a plain review still inserts');

reset role;

-- ------------------------------------------------------------ BE-8 ordering
-- The apply RPC writes only when the event is newer than the row's last event.
select is(
  public.apply_user_entitlement_event('c3000000-0000-0000-0000-000000000003', 'active', 'apple',
    now() + interval '1 year', '2026-09-05T12:00:00Z'::timestamptz, null, null, 'txn-1'),
  true,
  'BE-8: the first event applies');
select is(
  public.apply_user_entitlement_event('c3000000-0000-0000-0000-000000000003', 'canceled', 'apple',
    null, '2026-09-05T11:00:00Z'::timestamptz, null, null, 'txn-1'),
  false,
  'BE-8: an older event is dropped inside the write');

select * from finish();
rollback;
