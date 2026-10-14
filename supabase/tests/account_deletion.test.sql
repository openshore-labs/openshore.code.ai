-- pgTAP coverage for account deletion (0022) and the free caps on the org
-- tables (0023). Run with `supabase test db` against a database that has every
-- migration applied. Its own transaction and its own plan().
--
-- 0022 section 6 holds the deletion's own writes, which delete-account calls
-- as the service role: the legal-hold copy (account_deletion_hold), the
-- owned-team delete (account_deletion_orgs), the tombstone
-- (account_deletion_tombstone) and memberships and grants
-- (account_deletion_memberships). Each is exercised here as service_role.
--
-- Shape follows rls.test.sql: users are seeded straight into auth.users, a
-- caller is impersonated by setting request.jwt.claims and switching to the
-- `authenticated` role, the delete-account function's own writes run as
-- `service_role` (what its admin client is), expected failures go through
-- throws_ok, and the whole run is rolled back. Ids a later step needs are kept
-- in a temp table.
--
-- Error codes: P0001 is a plpgsql `raise exception`; 42501 is a missing
-- privilege; 23503 a foreign key; 23505 a unique_violation; 23514 a
-- check_violation (the caps and the request_hash check).

begin;
select plan(70);

-- ------------------------------------------------------------ fixtures
--   d1 = leaving: an active admin (not the owner) who invites, edits a shared
--        project, grants access and writes team notes, then deletes the account
--   d2 = keeper: owns the team org
--   d4 = returner: signs up again under an email a terminated account used
--   d5 = founder: owns orgs, for the one-free-org cap
--   d6 = warned: warned, then terminated by the ladder alone (actor 'system')
--   d7 = confirmed: terminated by an operator, between two automatic ones
--   d8 = held: block rows and an action under a legal hold
--   d9 = solo: owns two teams, for the all-or-none owned-team delete
--   da = member: a member, an unclaimed invite and grant under their email
--   db = unconfirmed: an unclaimed invite under an address never confirmed
insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('d1000000-0000-0000-0000-000000000001', 'leaving@example.com',  now(), 'authenticated', 'authenticated'),
  ('d2000000-0000-0000-0000-000000000002', 'keeper@example.com',   now(), 'authenticated', 'authenticated'),
  ('d4000000-0000-0000-0000-000000000004', 'returner@example.com', now(), 'authenticated', 'authenticated'),
  ('d5000000-0000-0000-0000-000000000005', 'founder@example.com',  now(), 'authenticated', 'authenticated'),
  ('d6000000-0000-0000-0000-000000000006', 'warned@example.com',   now(), 'authenticated', 'authenticated'),
  ('d7000000-0000-0000-0000-000000000007', 'confirmed@example.com', now(), 'authenticated', 'authenticated'),
  ('d8000000-0000-0000-0000-000000000008', 'held@example.com',     now(), 'authenticated', 'authenticated'),
  ('d9000000-0000-0000-0000-000000000009', 'solo@example.com',     now(), 'authenticated', 'authenticated'),
  ('da000000-0000-0000-0000-00000000000a', 'member@example.com',   now(), 'authenticated', 'authenticated'),
  ('db000000-0000-0000-0000-00000000000b', 'unconfirmed@example.com', null, 'authenticated', 'authenticated');

insert into public.orgs (id, name, owner_uid, seat_count, tier_id)
values ('0d000000-0000-0000-0000-00000000000d', 'Keepers', 'd2000000-0000-0000-0000-000000000002', 5, 'personal');

insert into public.org_members (org_id, user_id, email, role, status)
values
  ('0d000000-0000-0000-0000-00000000000d', 'd2000000-0000-0000-0000-000000000002', 'keeper@example.com',  'admin', 'active'),
  ('0d000000-0000-0000-0000-00000000000d', 'd1000000-0000-0000-0000-000000000001', 'leaving@example.com', 'admin', 'active');

create temp table saved (k text primary key, v text) on commit drop;
grant all on saved to authenticated, service_role;

-- ------------------------------------------------------------ the leaver's footprint
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-0000-0000-000000000001","email":"leaving@example.com","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$ insert into public.org_members (org_id, email, role, status, invited_by)
     values ('0d000000-0000-0000-0000-00000000000d', 'invitee@example.com', 'member', 'invited',
             'd1000000-0000-0000-0000-000000000001') $$,
  'the leaver invites a teammate');

insert into saved
  select 'project', public.create_org_project(
    '0d000000-0000-0000-0000-00000000000d', 'Roadmap', 'Plan the year', '{}')::text;

select lives_ok(
  $$ select public.update_org_project((select v::uuid from saved where k = 'project'),
       'Roadmap 2027', null, null, 1) $$,
  'the leaver edits the shared project');

select lives_ok(
  $$ select public.set_org_project_access((select v::uuid from saved where k = 'project'),
       'keeper@example.com', 'write') $$,
  'the leaver grants access to it');

select is(
  public.org_vault_write('0d000000-0000-0000-0000-00000000000d', 'mine.md', 'my note', null, true)->>'ok',
  'true',
  'the leaver writes a team note');

select is(
  public.org_vault_write('0d000000-0000-0000-0000-00000000000d', 'shared.md', 'first draft', null, true)->>'ok',
  'true',
  'the leaver writes a note a teammate will overwrite');

reset role;
insert into saved
  select 'shared_rev', rev::text from public.org_vault_notes
   where org_id = '0d000000-0000-0000-0000-00000000000d' and path = 'shared.md';

-- The keeper overwrites it, which keeps the leaver's version as a revision.
select set_config('request.jwt.claims',
  '{"sub":"d2000000-0000-0000-0000-000000000002","email":"keeper@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(
  public.org_vault_write('0d000000-0000-0000-0000-00000000000d', 'shared.md', 'second draft',
    (select v::bigint from saved where k = 'shared_rev'), false)->>'ok',
  'true',
  'a teammate overwrites the leaver''s note');
reset role;

select is(
  (select count(*) from public.org_vault_revisions
    where updated_by = 'd1000000-0000-0000-0000-000000000001'),
  1::bigint,
  'the team history names the leaver as the author of the displaced version');

-- ------------------------------------------------------------ what the function does
-- As the function's admin client: clear the leaver from team history, drop
-- their memberships, then delete the account.
set local role service_role;

select throws_ok(
  $$ update public.org_vault_revisions set updated_by = 'd2000000-0000-0000-0000-000000000002'
     where updated_by = 'd1000000-0000-0000-0000-000000000001' $$,
  'P0001', null::text,
  'history stays append-only: an author cannot be rewritten to someone else');

select lives_ok(
  $$ update public.org_vault_revisions set updated_by = null
     where updated_by = 'd1000000-0000-0000-0000-000000000001' $$,
  'the one update history allows: clearing a departing author');

select lives_ok(
  $$ delete from public.org_members where user_id = 'd1000000-0000-0000-0000-000000000001' $$,
  'the leaver''s memberships go');

reset role;

select throws_ok(
  $$ delete from auth.users where id = 'd2000000-0000-0000-0000-000000000002' $$,
  '23503', null::text,
  'an org owner cannot be deleted while the org stands (the function deletes a sole-member org first)');

select lives_ok(
  $$ delete from auth.users where id = 'd1000000-0000-0000-0000-000000000001' $$,
  'the leaver''s account deletes with no foreign key error');

select is(
  (select invited_by from public.org_members where email = 'invitee@example.com'),
  null::uuid,
  'the invite stays, with no inviter');

select is(
  (select row(created_by, updated_by)::text from public.org_projects
    where id = (select v::uuid from saved where k = 'project')),
  row(null::uuid, null::uuid)::text,
  'the shared project stays, with no author');

select is(
  (select granted_by from public.org_project_members
    where project_id = (select v::uuid from saved where k = 'project')),
  null::uuid,
  'the grant stays, with no grantor');

select is(
  (select updated_by from public.org_vault_notes
    where org_id = '0d000000-0000-0000-0000-00000000000d' and path = 'mine.md'),
  null::uuid,
  'the team note stays, with no author');

select is(
  (select count(*) from public.org_vault_revisions
    where org_id = '0d000000-0000-0000-0000-00000000000d' and updated_by is null),
  1::bigint,
  'the team history stays, with no author');

-- ------------------------------------------------------------ tombstones
select is(
  public.enforcement_email_legacy_key('returner@example.com'),
  '83bac1dc27f294e2dddc84ed4adf8e854e28261f626cf27a129eecf62a0fc361',
  'the old tombstone key is the SHA-256 hex of the lowercased address');

select ok(
  public.enforcement_email_key('returner@example.com') ~ '^[0-9a-f]{64}$'
    and public.enforcement_email_key('returner@example.com')
      <> public.enforcement_email_legacy_key('returner@example.com'),
  'the tombstone key is keyed now, not a plain hash of the address (0030)');

select is(
  public.enforcement_email_key('Returner@Example.COM'),
  public.enforcement_email_key('returner@example.com'),
  'the tombstone key ignores letter case');

select throws_ok(
  $$ insert into public.enforcement_tombstones (email_sha256, level, terminated_at)
     values (public.enforcement_email_key('warned@example.com'), 1, now()) $$,
  '23514', null::text,
  'a tombstone is level 2 or nothing: a warning never leaves one (CTO 11)');

insert into public.enforcement_tombstones (email_sha256, terminated_at)
values (public.enforcement_email_key('returner@example.com'), now() - interval '30 days');

select set_config('request.jwt.claims',
  '{"sub":"d4000000-0000-0000-0000-000000000004","email":"returner@example.com","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select action from public.record_enforcement()),
  'terminate',
  'a new account under a terminated email resolves to terminate');

select is(
  (select reason from public.enforcement_actions
    where user_id = 'd4000000-0000-0000-0000-000000000004' order by created_at desc limit 1),
  'An earlier account with this email was terminated.',
  'and says why');

select throws_ok(
  $$ select count(*) from public.enforcement_tombstones $$,
  '42501', null::text,
  'a signed-in client cannot read the tombstones');

reset role;

select set_config('request.jwt.claims',
  '{"sub":"d6000000-0000-0000-0000-000000000006","email":"warned@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select action from public.record_enforcement()),
  'log-only',
  'an email with no tombstone starts on a clean ladder');
reset role;

-- The ladder itself runs (0016 to 0018's version raised on every call).
insert into public.guardrail_events
  (user_id, category, tier, request_hash, model_path, action, side, signals)
values
  ('d6000000-0000-0000-0000-000000000006', 'csam', 1, repeat('b', 64), 'local', 'blocked', 'input', '{rule}');
set local role authenticated;
select is(
  (select action from public.record_enforcement()),
  'warn',
  'one confirmed Tier 1 block warns');
reset role;

insert into public.guardrail_events
  (user_id, category, tier, request_hash, model_path, action, side, signals)
values
  ('d6000000-0000-0000-0000-000000000006', 'csam', 1, repeat('c', 64), 'local', 'blocked', 'input', '{rule}');
set local role authenticated;
select is(
  (select action from public.record_enforcement()),
  'terminate',
  'a second within the window terminates');
reset role;

select is(
  (select count(*) from public.abuse_reports where user_id = 'd6000000-0000-0000-0000-000000000006'),
  1::bigint,
  'and prepares one report for the operator');

-- ------------------------------------------------------------ the tombstone (6c)
-- The ladder's own termination is actor 'system': deleting that account
-- leaves no tombstone, so an automatic decision never becomes a lasting ban.
set local role service_role;
select is(
  public.account_deletion_tombstone('d6000000-0000-0000-0000-000000000006'),
  false,
  'an automatic termination (actor system) leaves no tombstone');
reset role;
select is(
  (select count(*) from public.enforcement_tombstones
    where email_sha256 = public.enforcement_email_key('warned@example.com')),
  0::bigint,
  'so the email is not banned when that account is deleted');

insert into public.enforcement_actions (user_id, level, action, reason, actor, created_at)
values
  ('d7000000-0000-0000-0000-000000000007', 2, 'terminate', 'The ladder, first.', 'system',
   now() - interval '300 days'),
  ('d7000000-0000-0000-0000-000000000007', 2, 'terminate', 'Confirmed on review.',
   'd5000000-0000-0000-0000-000000000005', now() - interval '200 days'),
  ('d7000000-0000-0000-0000-000000000007', 2, 'terminate', 'The ladder, again.', 'system',
   now() - interval '10 days');
insert into saved
  select 'operator_at', created_at::text from public.enforcement_actions
   where user_id = 'd7000000-0000-0000-0000-000000000007' and actor <> 'system';

-- A tombstone from before 0030 for the same address, older than the
-- operator's decision: the write folds it into the keyed row.
insert into public.enforcement_tombstones (email_sha256, terminated_at)
values (public.enforcement_email_legacy_key('confirmed@example.com'), now() - interval '400 days');

set local role service_role;
select is(
  public.account_deletion_tombstone('d7000000-0000-0000-0000-000000000007'),
  true,
  'an operator''s confirmed termination leaves a tombstone');
reset role;
select is(
  (select count(*) from public.enforcement_tombstones
    where email_sha256 = public.enforcement_email_legacy_key('confirmed@example.com')),
  0::bigint,
  'and an old row under the plain key for that address is folded in (0030)');
select is(
  (select row(level, terminated_at)::text from public.enforcement_tombstones
    where email_sha256 = public.enforcement_email_key('confirmed@example.com')),
  row(2::smallint, (select v::timestamptz from saved where k = 'operator_at'))::text,
  'at level 2, carrying the operator''s own time, not the ladder''s later one or the deletion''s');

set local role service_role;
select is(
  public.account_deletion_tombstone('d7000000-0000-0000-0000-000000000007'),
  true,
  'a retry writes again without failing');
reset role;
select is(
  (select terminated_at from public.enforcement_tombstones
    where email_sha256 = public.enforcement_email_key('confirmed@example.com')),
  (select v::timestamptz from saved where k = 'operator_at'),
  'and never moves the tombstone''s time to the time of the write');

-- ------------------------------------------------------------ the legal-hold copy (6a)
-- Two block rows and an action, then a submitted report holds all three for a
-- year (0019's trigger); a block after the report is not held.
insert into public.guardrail_events
  (user_id, category, tier, request_hash, model_path, action, side, signals)
values
  ('d8000000-0000-0000-0000-000000000008', 'csam', 1, repeat('8', 64), 'local', 'blocked', 'input', '{rule}'),
  ('d8000000-0000-0000-0000-000000000008', 'ncii', 1, repeat('9', 64), 'local', 'blocked', 'input', '{rule}');
insert into public.enforcement_actions (user_id, level, action, reason, actor)
values ('d8000000-0000-0000-0000-000000000008', 1, 'warn', 'Held.', 'system');
insert into public.abuse_reports (user_id, category, request_hash, occurred_at, status, submitted_at)
values ('d8000000-0000-0000-0000-000000000008', 'csam', repeat('e', 64), now(), 'submitted', now());
insert into public.guardrail_events
  (user_id, category, tier, request_hash, model_path, action, side, signals)
values
  ('d8000000-0000-0000-0000-000000000008', 'likeness', 2, repeat('f', 64), 'local', 'blocked', 'input', '{later}');
insert into saved
  values ('held_key', public.deletion_hold_key('d8000000-0000-0000-0000-000000000008'));

set local role service_role;
select is(
  public.account_deletion_hold('d8000000-0000-0000-0000-000000000008'),
  3,
  'the rows under a legal hold are copied: two block rows and the action');
select is(
  public.account_deletion_hold('d8000000-0000-0000-0000-000000000008'),
  3,
  'a retry reads the same three');
select is(
  public.account_deletion_hold('d2000000-0000-0000-0000-000000000002'),
  0,
  'an account with nothing on hold copies nothing');
reset role;

select is(
  (select count(*) from public.deletion_holds
    where user_id_sha256 = (select v from saved where k = 'held_key')),
  1::bigint,
  'one copy under a SHA-256 of the user id, however many times it runs');
select is(
  (select array[jsonb_array_length(held_rows->'guardrail_events'),
                jsonb_array_length(held_rows->'enforcement_actions')]
     from public.deletion_holds where user_id_sha256 = (select v from saved where k = 'held_key')),
  array[2, 1],
  'in the 2026-09-24 function''s shape');
select ok(
  (select position('d8000000-0000-0000-0000-000000000008' in held_rows::text) = 0
      and hold_until = (select max(legal_hold_until) from public.guardrail_events
                         where user_id = 'd8000000-0000-0000-0000-000000000008')
     from public.deletion_holds where user_id_sha256 = (select v from saved where k = 'held_key')),
  'with no user id in it, held until the latest hold ends');

select lives_ok(
  $$ delete from auth.users where id = 'd8000000-0000-0000-0000-000000000008' $$,
  'the held account deletes');
select is(
  (select count(*) from public.deletion_holds
    where user_id_sha256 = (select v from saved where k = 'held_key')),
  1::bigint,
  'and its held rows outlive it');

-- ------------------------------------------------------------ the owned-team delete (6b)
-- solo owns two teams (one on a plan, so the one-free-org cap allows the
-- second). A has an unclaimed invite and an orphaned active row; B has a
-- teammate.
insert into public.orgs (id, name, owner_uid, seat_count, tier_id)
values ('0e000000-0000-0000-0000-00000000000a', 'Solo A', 'd9000000-0000-0000-0000-000000000009', 5, 'personal');
insert into public.org_entitlements (org_id, tier_id, seats, status)
values ('0e000000-0000-0000-0000-00000000000a', 'commercial_micro', 5, 'active');
insert into public.orgs (id, name, owner_uid, seat_count, tier_id)
values ('0e000000-0000-0000-0000-00000000000b', 'Solo B', 'd9000000-0000-0000-0000-000000000009', 5, 'personal');
insert into public.org_members (org_id, user_id, email, role, status)
values
  ('0e000000-0000-0000-0000-00000000000a', 'd9000000-0000-0000-0000-000000000009', 'solo@example.com', 'admin', 'active'),
  ('0e000000-0000-0000-0000-00000000000a', null, 'pending@example.com', 'member', 'invited'),
  ('0e000000-0000-0000-0000-00000000000a', null, 'ghost@example.com', 'member', 'active'),
  ('0e000000-0000-0000-0000-00000000000b', 'd9000000-0000-0000-0000-000000000009', 'solo@example.com', 'admin', 'active'),
  ('0e000000-0000-0000-0000-00000000000b', 'd2000000-0000-0000-0000-000000000002', 'keeper@example.com', 'member', 'active');

set local role service_role;
select is(
  public.account_deletion_orgs('d9000000-0000-0000-0000-000000000009',
    array['0e000000-0000-0000-0000-00000000000a', '0e000000-0000-0000-0000-00000000000b']::uuid[]),
  '{}'::uuid[],
  'a teammate active in one team keeps both: all or none');
select is(
  public.account_deletion_orgs('d2000000-0000-0000-0000-000000000002',
    array['0e000000-0000-0000-0000-00000000000a']::uuid[]),
  '{}'::uuid[],
  'a team someone else owns is never deleted');
reset role;
select is(
  (select count(*) from public.orgs where owner_uid = 'd9000000-0000-0000-0000-000000000009'),
  2::bigint,
  'both teams stand');

update public.org_members set status = 'revoked'
 where org_id = '0e000000-0000-0000-0000-00000000000b'
   and user_id = 'd2000000-0000-0000-0000-000000000002';

-- Support hands team A over (the service role moves owner_uid) after
-- delete-account read its plan: all or none covers every team named, so B
-- stays too, and nothing was deleted when fewer come back.
update public.orgs set owner_uid = 'd2000000-0000-0000-0000-000000000002'
 where id = '0e000000-0000-0000-0000-00000000000a';
set local role service_role;
select is(
  public.account_deletion_orgs('d9000000-0000-0000-0000-000000000009',
    array['0e000000-0000-0000-0000-00000000000a', '0e000000-0000-0000-0000-00000000000b']::uuid[]),
  '{}'::uuid[],
  'a named team handed to someone else keeps both: all or none');
reset role;
select is(
  (select count(*) from public.orgs
    where id in ('0e000000-0000-0000-0000-00000000000a', '0e000000-0000-0000-0000-00000000000b')),
  2::bigint,
  'both teams still stand');
update public.orgs set owner_uid = 'd9000000-0000-0000-0000-000000000009'
 where id = '0e000000-0000-0000-0000-00000000000a';

set local role service_role;
select is(
  public.account_deletion_orgs('d9000000-0000-0000-0000-000000000009',
    array['0e000000-0000-0000-0000-00000000000b', '0e000000-0000-0000-0000-00000000000a']::uuid[]),
  array['0e000000-0000-0000-0000-00000000000a', '0e000000-0000-0000-0000-00000000000b']::uuid[],
  'with nobody else active (an orphaned active row is nobody), both go and their ids come back');
reset role;
select is(
  (select count(*) from public.org_members
    where org_id in ('0e000000-0000-0000-0000-00000000000a', '0e000000-0000-0000-0000-00000000000b')),
  0::bigint,
  'and their member rows go with them');

set local role authenticated;
select throws_ok(
  $$ select public.account_deletion_hold('d1000000-0000-0000-0000-000000000001') $$,
  '42501', null::text, 'a client cannot call the legal-hold copy');
select throws_ok(
  $$ select public.account_deletion_orgs('d2000000-0000-0000-0000-000000000002',
       array['0d000000-0000-0000-0000-00000000000d']::uuid[]) $$,
  '42501', null::text, 'a client cannot call the owned-team delete');
select throws_ok(
  $$ select public.account_deletion_tombstone('d1000000-0000-0000-0000-000000000001') $$,
  '42501', null::text, 'a client cannot call the tombstone');
select throws_ok(
  $$ select public.account_deletion_memberships('d1000000-0000-0000-0000-000000000001') $$,
  '42501', null::text, 'a client cannot call the memberships delete');
reset role;

-- ------------------------------------------------------------ abuse_reports
select throws_ok(
  $$ insert into public.abuse_reports (user_id, category, request_hash, occurred_at)
     values ('d4000000-0000-0000-0000-000000000004', 'csam', 'not-a-hash', now()) $$,
  '23514', null::text,
  'a report needs a 64-hex request hash');

insert into public.abuse_reports (user_id, category, request_hash, occurred_at)
values ('d4000000-0000-0000-0000-000000000004', 'csam', repeat('a', 64), now());

select throws_ok(
  $$ insert into public.abuse_reports (user_id, category, request_hash, occurred_at)
     values ('d4000000-0000-0000-0000-000000000004', 'csam', repeat('a', 64), now()) $$,
  '23505', null::text,
  'one report per account and request hash');

-- ------------------------------------------------------------ one free org
select set_config('request.jwt.claims',
  '{"sub":"d5000000-0000-0000-0000-000000000005","email":"founder@example.com","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$ insert into public.orgs (name, owner_uid) values ('First', 'd5000000-0000-0000-0000-000000000005') $$,
  'an account without a plan owns one org');

select throws_ok(
  $$ insert into public.orgs (name, owner_uid) values ('Second', 'd5000000-0000-0000-0000-000000000005') $$,
  '23514', null::text,
  'a second org without a plan is refused');

reset role;
insert into public.org_entitlements (org_id, tier_id, seats, status)
select id, 'commercial_micro', 5, 'active' from public.orgs
 where owner_uid = 'd5000000-0000-0000-0000-000000000005';
set local role authenticated;

select lives_ok(
  $$ insert into public.orgs (name, owner_uid) values ('Second', 'd5000000-0000-0000-0000-000000000005') $$,
  'an org on a live plan does not count, so a second org can start');

select throws_ok(
  $$ insert into public.orgs (name, owner_uid) values ('Third', 'd5000000-0000-0000-0000-000000000005') $$,
  '23514', null::text,
  'but only one free org stands beside it');

reset role;

-- ------------------------------------------------------------ 25 MiB per free org
select is(
  (select bytes from public.org_storage_usage where org_id = '0d000000-0000-0000-0000-00000000000d'),
  (select sum(b)::bigint from (
     select octet_length(body) as b from public.org_vault_notes
      where org_id = '0d000000-0000-0000-0000-00000000000d'
     union all
     select octet_length(body) from public.org_vault_revisions
      where org_id = '0d000000-0000-0000-0000-00000000000d') s),
  'the counter holds the note and revision bytes the org stores');

-- Park the counter three bytes under the cap rather than write 25 MiB here.
update public.org_storage_usage
   set bytes = public.no_entitlement_max_org_bytes() - 3
 where org_id = '0d000000-0000-0000-0000-00000000000d';

select set_config('request.jwt.claims',
  '{"sub":"d2000000-0000-0000-0000-000000000002","email":"keeper@example.com","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$ select public.org_vault_write('0d000000-0000-0000-0000-00000000000d', 'big.md', 'abcd', null, true) $$,
  '23514', null::text,
  'a write past 25 MiB in an org without a plan is refused');

select is(
  public.org_vault_write('0d000000-0000-0000-0000-00000000000d', 'fits.md', 'abc', null, true)->>'ok',
  'true',
  'a write that lands exactly on the cap goes through');

reset role;
insert into saved
  select 'fits_rev', rev::text from public.org_vault_notes
   where org_id = '0d000000-0000-0000-0000-00000000000d' and path = 'fits.md';
set local role authenticated;

select is(
  public.org_vault_remove('0d000000-0000-0000-0000-00000000000d', 'fits.md',
    (select v::bigint from saved where k = 'fits_rev'))->>'ok',
  'true',
  'a delete at the cap always goes through, so there is a way to make room');

reset role;
insert into public.org_entitlements (org_id, tier_id, seats, status)
values ('0d000000-0000-0000-0000-00000000000d', 'commercial_micro', 5, 'active');
set local role authenticated;

select is(
  public.org_vault_write('0d000000-0000-0000-0000-00000000000d', 'big.md', 'abcd', null, true)->>'ok',
  'true',
  'an org on a live plan is not capped');

reset role;

-- ------------------------------------------------------------ memberships and grants (6d)
-- keeper's team is on a plan now, so keeper may start a second, free one for
-- the invites. member is bound in Keepers; an invite and a project grant wait
-- under their confirmed email in another spelling; a row bound to returner
-- carries the same email; an invite waits under an address never confirmed.
insert into public.orgs (id, name, owner_uid, seat_count, tier_id)
values ('0f000000-0000-0000-0000-00000000000f', 'Invites', 'd2000000-0000-0000-0000-000000000002', 5, 'personal');
insert into public.org_members (org_id, user_id, email, role, status)
values
  ('0d000000-0000-0000-0000-00000000000d', 'da000000-0000-0000-0000-00000000000a', 'member@example.com', 'member', 'active'),
  ('0f000000-0000-0000-0000-00000000000f', null, 'Member@Example.com', 'member', 'invited'),
  ('0f000000-0000-0000-0000-00000000000f', null, 'unconfirmed@example.com', 'member', 'invited');
insert into public.org_members (org_id, user_id, email, role, status)
select id, 'd4000000-0000-0000-0000-000000000004', 'member@example.com', 'member', 'active'
  from public.orgs where name = 'First' and owner_uid = 'd5000000-0000-0000-0000-000000000005';
insert into public.org_project_members (project_id, user_id, email, level)
values ((select v::uuid from saved where k = 'project'), null, 'MEMBER@example.com', 'read');

set local role service_role;
select is(
  public.account_deletion_memberships('da000000-0000-0000-0000-00000000000a'),
  3,
  'the bound membership, and the unclaimed invite and grant under the confirmed email, go');
select is(
  public.account_deletion_memberships('db000000-0000-0000-0000-00000000000b'),
  0,
  'an address never confirmed matches nothing');
reset role;
select is(
  (select count(*) from public.org_members where lower(email) = 'member@example.com'),
  1::bigint,
  'a row bound to someone else stays, whatever its email says');
select is(
  (select count(*) from public.org_members where email = 'unconfirmed@example.com'),
  1::bigint,
  'and the unconfirmed address''s invite stays');
select is(
  (select count(*) from public.org_project_members where lower(email) = 'member@example.com'),
  0::bigint,
  'no grant under the email is left');

select * from finish();
rollback;
