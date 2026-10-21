-- Rows with production's shape, for the production replay (CTO 11,
-- 2026-09-29; CI job `sql-replay`). Loaded with
--
--   psql -v ON_ERROR_STOP=1 -f supabase/replay/production_rows.sql
--
-- on a local database built from exactly the files in
-- supabase/production-history.tsv (0001 to 0031 when it was written), BEFORE
-- the pending files are pushed. It describes the push of 0032 (explicit
-- grants and the 2026-10-21 security review); CI skips it while nothing is
-- pending, and the next push that adds a file replaces it with rows shaped
-- like production then. CI applies migrations to an empty database, so
-- without these rows nothing 0032 does to existing data, or the jobs it
-- re-schedules, would ever run against a row.
--
-- Everything here uses its own id range (7e000000-...) and @replay.invalid
-- addresses, so the pgTAP files that run afterwards never meet these rows by
-- accident. It lives outside supabase/tests because `supabase test db` runs
-- every .sql file under tests/ through pg_prove.
--
-- At the end it snapshots what 0032 must leave alone into the scratch schema
-- replay_snapshot, which supabase/replay/after_push.sql compares against.

begin;

-- ------------------------------------------------------------ people
--   r1 owns a team and has a phone and two push grants (one revoked);
--   r2 was blocked twice by the ladder under the old one-row-per-call rule;
--   r3 claimed a seat on r1's team.
insert into auth.users (id, email, email_confirmed_at, aud, role, created_at)
values
  ('7e000000-0000-0000-0000-000000000001', 'owner@replay.invalid', now() - interval '200 days',
   'authenticated', 'authenticated', now() - interval '200 days'),
  ('7e000000-0000-0000-0000-000000000002', 'laddered@replay.invalid', now() - interval '60 days',
   'authenticated', 'authenticated', now() - interval '60 days'),
  ('7e000000-0000-0000-0000-000000000003', 'claimed@replay.invalid', now() - interval '150 days',
   'authenticated', 'authenticated', now() - interval '150 days');

-- ------------------------------------------------------------ a team
-- An invite nobody claimed in 120 days, one from last week, a claimed seat,
-- and an old revoked row: only the first is the privacy job's to clear.
insert into public.orgs (id, name, owner_uid, seat_count, tier_id, created_at)
values ('7e000000-0000-0000-0000-0000000000a1', 'Replay team', '7e000000-0000-0000-0000-000000000001',
        5, 'personal', now() - interval '200 days');

insert into public.org_members (id, org_id, user_id, email, role, status, invited_by, created_at)
values
  ('7e000000-0000-0000-0000-0000000000b1', '7e000000-0000-0000-0000-0000000000a1',
   '7e000000-0000-0000-0000-000000000001', 'owner@replay.invalid', 'admin', 'active',
   '7e000000-0000-0000-0000-000000000001', now() - interval '200 days'),
  ('7e000000-0000-0000-0000-0000000000b2', '7e000000-0000-0000-0000-0000000000a1',
   null, 'stale-invite@replay.invalid', 'member', 'invited',
   '7e000000-0000-0000-0000-000000000001', now() - interval '120 days'),
  ('7e000000-0000-0000-0000-0000000000b3', '7e000000-0000-0000-0000-0000000000a1',
   null, 'fresh-invite@replay.invalid', 'member', 'invited',
   '7e000000-0000-0000-0000-000000000001', now() - interval '7 days'),
  ('7e000000-0000-0000-0000-0000000000b4', '7e000000-0000-0000-0000-0000000000a1',
   '7e000000-0000-0000-0000-000000000003', 'claimed@replay.invalid', 'member', 'active',
   '7e000000-0000-0000-0000-000000000001', now() - interval '150 days'),
  ('7e000000-0000-0000-0000-0000000000b5', '7e000000-0000-0000-0000-0000000000a1',
   null, 'removed@replay.invalid', 'member', 'revoked',
   '7e000000-0000-0000-0000-000000000001', now() - interval '140 days');

-- ------------------------------------------------------------ push
insert into public.push_devices (device_token, user_id, aps_environment, updated_at)
values (repeat('ab', 32), '7e000000-0000-0000-0000-000000000001', 'production', now() - interval '3 days');

insert into public.push_grants (id, user_id, token_sha256, label, created_at, revoked_at, last_sent_at, sent_count)
values
  ('7e000000-0000-0000-0000-0000000000c1', '7e000000-0000-0000-0000-000000000001', repeat('1', 64),
   'desk', now() - interval '40 days', null, now() - interval '1 day', 12),
  ('7e000000-0000-0000-0000-0000000000c2', '7e000000-0000-0000-0000-000000000001', repeat('2', 64),
   'old laptop', now() - interval '40 days', now() - interval '5 days', null, 0);

-- ------------------------------------------------------------ the ladder
-- One countable block, and the four identical rows the old rule wrote for it.
insert into public.guardrail_events
  (user_id, category, tier, request_hash, model_path, action, side, signals, occurred_at)
values
  ('7e000000-0000-0000-0000-000000000002', 'weapons-uplift', 2, repeat('7', 64), 'local', 'blocked',
   'input', '{}', now() - interval '20 days');

insert into public.enforcement_actions (user_id, level, action, reason, actor, created_at)
select '7e000000-0000-0000-0000-000000000002', 0, 'log-only', '1 blocked request(s) on this account.',
       'system', now() - interval '20 days' + make_interval(mins => g)
  from generate_series(1, 4) g;

-- ------------------------------------------------------------ the dead table
insert into public.apple_notifications_seen (notification_uuid, received_at)
values ('7e000000-replay-notification-0001', now() - interval '3 days');

-- ------------------------------------------------------------ the snapshot
drop schema if exists replay_snapshot cascade;
create schema replay_snapshot;
revoke all on schema replay_snapshot from public, anon, authenticated;
create table replay_snapshot.org_members as
  select id, user_id, email, role, status from public.org_members where id::text like '7e000000-%';
create table replay_snapshot.push_grants as
  select id, revoked_at, sent_count from public.push_grants where id::text like '7e000000-%';
create table replay_snapshot.enforcement_actions as
  select id, level, action from public.enforcement_actions where user_id::text like '7e000000-%';

do $$
begin
  if (select count(*) from replay_snapshot.org_members) <> 5
     or (select count(*) from replay_snapshot.enforcement_actions) <> 4 then
    raise exception 'REPLAY SETUP: the team or the ladder rows did not load';
  end if;
end $$;

commit;
