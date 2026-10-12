-- Rows with production's shape, for the production replay (CTO 11,
-- 2026-09-29; CI job `sql-replay`). Loaded with
--
--   psql -v ON_ERROR_STOP=1 -f supabase/replay/production_rows.sql
--
-- on a local database built from exactly the files in
-- supabase/production-history.tsv (0001 to 0027 when it was written), BEFORE
-- the pending files are pushed. It describes the push of 0028 (passwordless
-- sign-in, 2026-10-12); CI skips it while nothing is pending, and the next
-- push that adds a file replaces it with rows shaped like production then.
-- CI applies migrations to an empty database, so without these rows nothing
-- 0028 does to existing data (clearing every stored password hash, and
-- leaving every live session alone) would ever run against a row.
--
-- Everything here uses its own id range (7e000000-...) and @replay.invalid
-- addresses, so the pgTAP files that run afterwards never meet these rows by
-- accident. It lives outside supabase/tests because `supabase test db` runs
-- every .sql file under tests/ through pg_prove.
--
-- At the end it snapshots every session into the scratch schema
-- replay_snapshot, which supabase/replay/after_push.sql compares against, so
-- a pending file that signs anyone out is caught.

begin;

-- ------------------------------------------------------------ people
--   r1 made an account with a password and is signed in on two devices;
--   r2 made one with a password and is signed out; r3 only ever used the
--   email link, so it has no password (GoTrue stores '' for none); r4 is a
--   row from before GoTrue stored '' (a null).
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role, created_at)
values
  ('7e000000-0000-0000-0000-000000000001', 'password-in@replay.invalid',
   '$2a$10$replayreplayreplayreplayuR4nD0mHaSh0000000000000000001', now() - interval '40 days',
   'authenticated', 'authenticated', now() - interval '40 days'),
  ('7e000000-0000-0000-0000-000000000002', 'password-out@replay.invalid',
   '$2a$10$replayreplayreplayreplayuR4nD0mHaSh0000000000000000002', now() - interval '30 days',
   'authenticated', 'authenticated', now() - interval '30 days'),
  ('7e000000-0000-0000-0000-000000000003', 'link-only@replay.invalid',
   '', now() - interval '20 days', 'authenticated', 'authenticated', now() - interval '20 days'),
  ('7e000000-0000-0000-0000-000000000004', 'old-null@replay.invalid',
   null, now() - interval '10 days', 'authenticated', 'authenticated', now() - interval '10 days');

-- ------------------------------------------------------------ sessions
-- r1's two live sign-ins, each from a password, and r3's from a link.
insert into auth.sessions (id, user_id, created_at, updated_at)
values
  ('7e000000-0000-0000-0000-0000000000c1', '7e000000-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '1 hour'),
  ('7e000000-0000-0000-0000-0000000000c2', '7e000000-0000-0000-0000-000000000001', now() - interval '2 days', now() - interval '2 hours'),
  ('7e000000-0000-0000-0000-0000000000c3', '7e000000-0000-0000-0000-000000000003', now() - interval '1 day',  now() - interval '3 hours');

-- ------------------------------------------------------------ the snapshot
-- What 0028 must never change: who is signed in.
drop schema if exists replay_snapshot cascade;
create schema replay_snapshot;
revoke all on schema replay_snapshot from public, anon, authenticated;
create table replay_snapshot.sessions as
  select id, user_id, not_after from auth.sessions;

do $$
begin
  if (select count(*) from auth.users
       where id::text like '7e000000-%' and coalesce(encrypted_password, '') <> '') <> 2 then
    raise exception 'REPLAY SETUP: expected r1 and r2 to hold a password hash before the push';
  end if;
end $$;

commit;
