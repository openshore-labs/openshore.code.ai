-- pgTAP coverage for account deletion (0022) and the free caps on the org
-- tables (0023). Run with `supabase test db` against a database that has every
-- migration applied. Its own transaction and its own plan().
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
select plan(37);

-- ------------------------------------------------------------ fixtures
--   d1 = leaving: an active admin (not the owner) who invites, edits a shared
--        project, grants access and writes team notes, then deletes the account
--   d2 = keeper: owns the team org
--   d4 = returner: signs up again under an email a terminated account used
--   d5 = founder: owns orgs, for the one-free-org cap
--   d6 = warned: an email that only ever carried a warning
insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('d1000000-0000-0000-0000-000000000001', 'leaving@example.com',  now(), 'authenticated', 'authenticated'),
  ('d2000000-0000-0000-0000-000000000002', 'keeper@example.com',   now(), 'authenticated', 'authenticated'),
  ('d4000000-0000-0000-0000-000000000004', 'returner@example.com', now(), 'authenticated', 'authenticated'),
  ('d5000000-0000-0000-0000-000000000005', 'founder@example.com',  now(), 'authenticated', 'authenticated'),
  ('d6000000-0000-0000-0000-000000000006', 'warned@example.com',   now(), 'authenticated', 'authenticated');

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
  public.enforcement_email_key('returner@example.com'),
  '83bac1dc27f294e2dddc84ed4adf8e854e28261f626cf27a129eecf62a0fc361',
  'the tombstone key is the SHA-256 hex the edge function computes');

select is(
  public.enforcement_email_key('Returner@Example.COM'),
  public.enforcement_email_key('returner@example.com'),
  'the tombstone key ignores letter case');

insert into public.enforcement_tombstones (email_sha256, level)
values
  (public.enforcement_email_key('returner@example.com'), 2),
  (public.enforcement_email_key('warned@example.com'), 1);

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
  'a warning does not follow a person to a new account');
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

select * from finish();
rollback;
