-- Rows with production's shape, for the production replay (CTO 11,
-- 2026-09-29; CI job `sql-replay`). Loaded with
--
--   psql -v ON_ERROR_STOP=1 -f supabase/replay/production_rows.sql
--
-- on a local database built from exactly the files in
-- supabase/production-history.tsv (0001 to 0020 today), BEFORE the pending
-- files are pushed. CI applies migrations to an empty database, so without
-- these rows nothing the pending files do to existing data (0021's
-- case-duplicate rename, 0022's report dedupe and checks, 0023's byte
-- backfill, 0025's author keys) would ever run against a row.
--
-- Everything here uses its own id range (7e000000-...) and @replay.invalid
-- addresses, so the pgTAP files that run afterwards never meet these rows by
-- accident. It lives outside supabase/tests because `supabase test db` runs
-- every .sql file under tests/ through pg_prove.
--
-- At the end it snapshots every fingerprint and legal hold into the scratch
-- schema replay_snapshot, which supabase/replay/after_push.sql compares
-- against, so a pending file that re-keys or re-holds a row is caught.

begin;

-- ------------------------------------------------------------ people
--   r1 owner of the team; r2 a member; r3 blocked twice, with a queued report
--   and its repeat; r4 reported: a submitted report under legal hold; r5 a
--   reviewer the others read.
insert into auth.users (id, email, email_confirmed_at, aud, role, created_at)
values
  ('7e000000-0000-0000-0000-000000000001', 'owner@replay.invalid',    now() - interval '40 days', 'authenticated', 'authenticated', now() - interval '40 days'),
  ('7e000000-0000-0000-0000-000000000002', 'member@replay.invalid',   now() - interval '30 days', 'authenticated', 'authenticated', now() - interval '30 days'),
  ('7e000000-0000-0000-0000-000000000003', 'blocked@replay.invalid',  now() - interval '20 days', 'authenticated', 'authenticated', now() - interval '20 days'),
  ('7e000000-0000-0000-0000-000000000004', 'reported@replay.invalid', now() - interval '20 days', 'authenticated', 'authenticated', now() - interval '20 days'),
  ('7e000000-0000-0000-0000-000000000005', 'reviewer@replay.invalid', now() - interval '10 days', 'authenticated', 'authenticated', now() - interval '10 days');

-- ------------------------------------------------------------ a team
-- An owner, a member, and a pending invite the owner sent. No entitlement row:
-- a beta team.
insert into public.orgs (id, name, owner_uid, seat_count, tier_id)
values ('7e000000-0000-0000-0000-0000000000aa', 'Replay team', '7e000000-0000-0000-0000-000000000001', 3, 'personal');
insert into public.org_members (org_id, user_id, email, role, status, invited_by)
values
  ('7e000000-0000-0000-0000-0000000000aa', '7e000000-0000-0000-0000-000000000001', 'owner@replay.invalid',   'admin',  'active',  null),
  ('7e000000-0000-0000-0000-0000000000aa', '7e000000-0000-0000-0000-000000000002', 'member@replay.invalid',  'member', 'active',  '7e000000-0000-0000-0000-000000000001'),
  ('7e000000-0000-0000-0000-0000000000aa', null,                                   'invitee@replay.invalid', 'member', 'invited', '7e000000-0000-0000-0000-000000000001');

insert into public.org_projects (id, org_id, name, instructions, created_by, updated_by)
values ('7e000000-0000-0000-0000-0000000000bb', '7e000000-0000-0000-0000-0000000000aa', 'Replay project', 'Ship it',
        '7e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000002');
insert into public.org_project_members (project_id, user_id, email, level, granted_by)
values ('7e000000-0000-0000-0000-0000000000bb', '7e000000-0000-0000-0000-000000000002', 'member@replay.invalid', 'write',
        '7e000000-0000-0000-0000-000000000001');

-- Team notes as 0010 and 0015 left them: small revs, one tombstone, and two
-- live paths that differ only by letter case (0021 renames the older one).
insert into public.org_vault_notes (org_id, path, body, deleted, rev, updated_at, updated_by)
values
  ('7e000000-0000-0000-0000-0000000000aa', 'Welcome.md',       'Hello, team.',        false, 3, now() - interval '9 days', '7e000000-0000-0000-0000-000000000001'),
  ('7e000000-0000-0000-0000-0000000000aa', 'Plans/Roadmap.md', 'The newer roadmap.',  false, 5, now() - interval '1 day',  '7e000000-0000-0000-0000-000000000002'),
  ('7e000000-0000-0000-0000-0000000000aa', 'plans/roadmap.md', 'The older roadmap.',  false, 2, now() - interval '2 days', '7e000000-0000-0000-0000-000000000001'),
  ('7e000000-0000-0000-0000-0000000000aa', 'Old/Gone.md',      '',                    true,  4, now() - interval '5 days', '7e000000-0000-0000-0000-000000000001');

-- ------------------------------------------------------------ the guardrail
-- Block rows as the app sends them: the client's SHA-256. Production's 0019
-- trigger keys each one on insert, so what is stored is already the HMAC.
insert into public.guardrail_events
  (user_id, category, tier, request_hash, model_path, action, side, signals, occurred_at)
values
  ('7e000000-0000-0000-0000-000000000003', 'csam',           1, repeat('3a', 32), 'local', 'blocked', 'input',  '{rule}', now() - interval '5 days'),
  ('7e000000-0000-0000-0000-000000000003', 'check-failed',   1, repeat('3b', 32), 'cloud', 'blocked', 'output', '{}',     now() - interval '4 days'),
  ('7e000000-0000-0000-0000-000000000004', 'weapons-uplift', 1, repeat('4a', 32), 'cloud', 'blocked', 'input',  '{rule}', now() - interval '15 days'),
  ('7e000000-0000-0000-0000-000000000004', 'ncii',           1, repeat('4b', 32), 'local', 'blocked', 'input',  '{rule}', now() - interval '14 days');

-- An operator's termination (0018's admin path writes rows like this).
insert into public.enforcement_actions (user_id, level, action, reason, actor, created_at)
values ('7e000000-0000-0000-0000-000000000004', 2, 'terminate', 'Termination confirmed by an operator.',
        '7e000000-0000-0000-0000-000000000001', now() - interval '13 days');

-- Reports: a queued one and its repeat for the same account and fingerprint
-- (0022 keeps the first and removes the repeat), and a submitted one, which
-- 0019's trigger holds for a year along with r4's block rows and actions.
insert into public.abuse_reports (user_id, category, request_hash, occurred_at, status, detail, created_at)
select '7e000000-0000-0000-0000-000000000003', 'csam', g.request_hash, g.occurred_at, 'queued',
       'Prepared and stored for the operator. No submission integration is configured, so nothing has been sent.',
       now() - interval '5 days'
  from public.guardrail_events g
 where g.user_id = '7e000000-0000-0000-0000-000000000003' and g.category = 'csam';
insert into public.abuse_reports (user_id, category, request_hash, occurred_at, status, detail, created_at)
select '7e000000-0000-0000-0000-000000000003', 'csam', g.request_hash, g.occurred_at, 'queued',
       'Prepared and stored for the operator. No submission integration is configured, so nothing has been sent.',
       now() - interval '3 days'
  from public.guardrail_events g
 where g.user_id = '7e000000-0000-0000-0000-000000000003' and g.category = 'csam';
insert into public.abuse_reports (user_id, category, request_hash, occurred_at, status, destination, created_at, submitted_at, submitted_by)
select '7e000000-0000-0000-0000-000000000004', 'weapons-uplift', g.request_hash, g.occurred_at, 'submitted', 'replay hotline',
       now() - interval '12 days', now() - interval '10 days', '7e000000-0000-0000-0000-000000000001'
  from public.guardrail_events g
 where g.user_id = '7e000000-0000-0000-0000-000000000004' and g.category = 'weapons-uplift';

-- ------------------------------------------------------------ reviews
insert into public.model_reviews (user_id, model_id, rating, body, created_at)
values
  ('7e000000-0000-0000-0000-000000000005', 'replay-model', 5, 'Fast on my box.', now() - interval '9 days'),
  ('7e000000-0000-0000-0000-000000000002', 'replay-model', 3, 'Fine.',           now() - interval '8 days');
insert into public.review_eula_acceptance (user_id, version)
values ('7e000000-0000-0000-0000-000000000005', '2026-09-05');
insert into public.user_blocks (blocker_id, blocked_id)
values ('7e000000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-000000000005');
insert into public.review_staff (user_id) values ('7e000000-0000-0000-0000-000000000001');

-- ------------------------------------------------------------ the snapshot
-- What the pending files must never change: every fingerprint and every hold.
drop schema if exists replay_snapshot cascade;
create schema replay_snapshot;
revoke all on schema replay_snapshot from public, anon, authenticated;
create table replay_snapshot.guardrail_events as
  select id, user_id, request_hash, legal_hold_until from public.guardrail_events;
create table replay_snapshot.enforcement_actions as
  select id, user_id, legal_hold_until from public.enforcement_actions;
create table replay_snapshot.abuse_reports as
  select id, user_id, status, request_hash, legal_hold_until, created_at from public.abuse_reports;

do $$
begin
  if (select count(*) from replay_snapshot.guardrail_events where legal_hold_until is not null) <> 2 then
    raise exception 'REPLAY SETUP: expected r4''s two block rows under hold after the submitted report';
  end if;
  if exists (select 1 from public.guardrail_events where request_hash in (repeat('3a', 32), repeat('4a', 32))) then
    raise exception 'REPLAY SETUP: production''s 0019 trigger did not key the fingerprints';
  end if;
end $$;

commit;
