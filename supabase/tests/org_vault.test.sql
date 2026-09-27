-- pgTAP coverage for the Org Vault v1 migration (0019, Vault M2 item 2.3, CTO
-- ruling G3). Run with `supabase test db` against a database that has every
-- migration applied. Its own transaction and its own plan(), so its count
-- never collides with rls.test.sql's.
--
-- Shape follows rls.test.sql: users are seeded straight into auth.users, a
-- caller is impersonated by setting request.jwt.claims and switching to the
-- `authenticated` role, expected failures go through throws_ok, and the whole
-- run is rolled back. Revs a later step needs are kept in a temp table.
--
-- Error codes: P0001 is a plpgsql `raise exception`; 42501 is a missing
-- privilege; 23505 is a unique_violation.

begin;
select plan(56);

-- ------------------------------------------------------------ fixtures
--   f1 = author (confirmed, active)
--   f2 = teammate (confirmed, active)
--   f3 = leaver (confirmed, active, revoked near the end)
--   f4 = stranger (confirmed, never a member)
insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('f1000000-0000-0000-0000-000000000001', 'author@example.com',   now(), 'authenticated', 'authenticated'),
  ('f2000000-0000-0000-0000-000000000002', 'mate@example.com',     now(), 'authenticated', 'authenticated'),
  ('f3000000-0000-0000-0000-000000000003', 'leaver@example.com',   now(), 'authenticated', 'authenticated'),
  ('f4000000-0000-0000-0000-000000000004', 'stranger@example.com', now(), 'authenticated', 'authenticated');

insert into public.orgs (id, name, owner_uid, seat_count, tier_id)
values ('0f000000-0000-0000-0000-00000000000f', 'Vaulters', 'f1000000-0000-0000-0000-000000000001', 3, 'personal');

insert into public.org_members (org_id, user_id, email, role, status)
values
  ('0f000000-0000-0000-0000-00000000000f', 'f1000000-0000-0000-0000-000000000001', 'author@example.com', 'admin',  'active'),
  ('0f000000-0000-0000-0000-00000000000f', 'f2000000-0000-0000-0000-000000000002', 'mate@example.com',   'member', 'active'),
  ('0f000000-0000-0000-0000-00000000000f', 'f3000000-0000-0000-0000-000000000003', 'leaver@example.com', 'member', 'active');

create temp table saved (k text primary key, v bigint) on commit drop;
grant all on saved to authenticated;

-- ------------------------------------------------------------ author creates
select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-000000000001","email":"author@example.com","role":"authenticated"}', true);
set local role authenticated;

select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'plan.md', 'v1', null, true)->>'ok',
  'true',
  'if_absent creates a new note');

insert into saved
  select 'plan_v1', rev from public.org_vault_notes
  where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'plan.md';

select ok(
  (select v from saved where k = 'plan_v1') >= 1000000000,
  'revs come from the sequence, above anything 0010 handed out');

select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'plan.md', 'again', null, true)->>'conflict',
  'exists',
  'if_absent on the same path is exists');

select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'PLAN.md', 'again', null, true)->>'conflict',
  'exists',
  'if_absent on a case variant is exists');

select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'PLAN.md', 'again', null, true)#>>'{theirs,path}',
  'plan.md',
  'exists carries theirs under its real path');

select throws_ok(
  $$ select public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'plan.md', 'x', null, false) $$,
  'P0001', null::text,
  'a write with neither guard is refused');

select throws_ok(
  $$ select public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'plan.md', 'x', 5, true) $$,
  'P0001', null::text,
  'a write with both guards is refused');

select throws_ok(
  $$ select public.org_vault_write('0f000000-0000-0000-0000-00000000000f', '../escape.md', 'x', null, true) $$,
  'P0001', null::text,
  'org_vault_write refuses a traversal path');

select throws_ok(
  $$ select public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'big.md', repeat('a', 1048577), null, true) $$,
  'P0001', null::text,
  'a 1 MB + 1 byte body raises P0001 on org_vault_write');

select throws_ok(
  $$ select public.org_vault_put('0f000000-0000-0000-0000-00000000000f', 'big.md', repeat('a', 1048577), null) $$,
  'P0001', null::text,
  'a 1 MB + 1 byte body raises P0001 on the legacy put');

select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'gone.md', 'x', 1000000000, false)->>'conflict',
  'missing',
  'if_match on a note that does not exist is missing');

select is(
  (select count(*) from public.org_vault_notes
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'gone.md'),
  0::bigint,
  'and a missing note is not re-created');

-- Same author, inside ten minutes: the autosave leaves no revision row.
select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'plan.md', 'v2',
    (select v from saved where k = 'plan_v1'), false)->>'ok',
  'true',
  'if_match at the current rev writes');

select is(
  (select count(*) from public.org_vault_revisions
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'plan.md'),
  0::bigint,
  'the same author''s save within 10 minutes leaves no revision row');

insert into saved
  select 'plan_v2', rev from public.org_vault_notes
  where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'plan.md';

select ok(
  (select v from saved where k = 'plan_v2') > (select v from saved where k = 'plan_v1'),
  'a write moves the rev forward');

reset role;

-- ------------------------------------------------------------ teammate
select set_config('request.jwt.claims',
  '{"sub":"f2000000-0000-0000-0000-000000000002","email":"mate@example.com","role":"authenticated"}', true);
set local role authenticated;

select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'plan.md', 'mate',
    (select v from saved where k = 'plan_v2'), false)->>'ok',
  'true',
  'a teammate overwrites at the current rev');

select is(
  (select body from public.org_vault_revisions
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'plan.md' and reason = 'overwritten'),
  'v2',
  'a teammate''s overwrite leaves a revision row holding the displaced body');

-- The author's editor still holds plan_v2: stale.
select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'plan.md', 'stale edit',
    (select v from saved where k = 'plan_v2'), false)->>'conflict',
  'changed',
  'a stale if_match is changed');

select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'plan.md', 'stale edit',
    (select v from saved where k = 'plan_v2'), false)#>>'{theirs,body}',
  'mate',
  'changed carries theirs, so the client needs no second read');

select is(
  (select body from public.org_vault_notes
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'plan.md'),
  'mate',
  'a stale if_match leaves the body untouched');

-- A stale remove is refused and the note stays live.
select is(
  public.org_vault_remove('0f000000-0000-0000-0000-00000000000f', 'plan.md',
    (select v from saved where k = 'plan_v2'))->>'conflict',
  'changed',
  'a stale remove is changed');

select is(
  (select deleted from public.org_vault_notes
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'plan.md'),
  false,
  'and the note stays live');

select throws_ok(
  $$ select public.org_vault_remove('0f000000-0000-0000-0000-00000000000f', 'plan.md', null) $$,
  'P0001', null::text,
  'a remove without if_match is refused');

select is(
  public.org_vault_remove('0f000000-0000-0000-0000-00000000000f', 'never.md', 1000000000)->>'ok',
  'true',
  'removing a note that is not there is ok');

insert into saved
  select 'plan_v3', rev from public.org_vault_notes
  where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'plan.md';

select is(
  public.org_vault_remove('0f000000-0000-0000-0000-00000000000f', 'plan.md',
    (select v from saved where k = 'plan_v3'))->>'ok',
  'true',
  'a remove at the current rev lands');

select is(
  (select deleted from public.org_vault_notes
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'plan.md'),
  true,
  'the removed note is a tombstone');

select is(
  (select count(*) from public.org_vault_revisions
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'plan.md' and reason = 'deleted'
     and body = 'mate'),
  1::bigint,
  'a remove keeps the deleted body as a revision row');

-- Re-create over the tombstone: the old rev never matches the new note.
select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'plan.md', 'reborn', null, true)->>'ok',
  'true',
  'if_absent brings back a tombstone');

select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'plan.md', 'ghost',
    (select v from saved where k = 'plan_v3'), false)->>'conflict',
  'changed',
  'a rev from before the delete never matches the re-created note');

reset role;

-- ------------------------------------------------------------ 10-minute rule
-- The author's own version, once older than ten minutes, is kept when the
-- author overwrites it.
insert into public.org_vault_notes (org_id, path, body, rev, updated_at, updated_by)
values ('0f000000-0000-0000-0000-00000000000f', 'old.md', 'yesterday', nextval('public.org_vault_rev_seq'),
        now() - interval '11 minutes', 'f1000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-000000000001","email":"author@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(
  public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'old.md', 'today',
    (select rev from public.org_vault_notes
     where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'old.md'), false)->>'ok',
  'true',
  'the author overwrites their own older version');
select is(
  (select body from public.org_vault_revisions
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'old.md'),
  'yesterday',
  'a version older than 10 minutes is kept even for the same author');

-- ------------------------------------------------------------ legacy put
-- Three clashes in one minute make three distinct copies (orgvault-3).
select lives_ok(
  $$ select public.org_vault_put('0f000000-0000-0000-0000-00000000000f', 'legacy.md', 'base', null) $$,
  'the legacy put still creates a note');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"f2000000-0000-0000-0000-000000000002","email":"mate@example.com","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.org_vault_put('0f000000-0000-0000-0000-00000000000f', 'legacy.md', 'clash 1', 1) $$,
  'legacy clash 1 saves');
select lives_ok(
  $$ select public.org_vault_put('0f000000-0000-0000-0000-00000000000f', 'legacy.md', 'clash 2', 1) $$,
  'legacy clash 2 saves');
select lives_ok(
  $$ select public.org_vault_put('0f000000-0000-0000-0000-00000000000f', 'legacy.md', 'clash 3', 1) $$,
  'legacy clash 3 saves');

select is(
  (select count(distinct lower(path)) from public.org_vault_notes
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path like 'legacy (conflict %).md' and not deleted),
  3::bigint,
  'three legacy clashes in one minute make three distinct copies');

select is(
  (select array_agg(body order by body) from public.org_vault_notes
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path like 'legacy (conflict %).md'),
  array['base', 'clash 1', 'clash 2'],
  'each copy holds the body its clash displaced');

select ok(
  (select bool_and(public.org_vault_path_ok(path)) from public.org_vault_notes
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path like 'legacy (conflict %).md'),
  'every conflict copy passes org_vault_path_ok');
reset role;

-- ------------------------------------------------------------ server rules
select is(
  (select size from public.org_vault_notes
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'old.md'),
  octet_length('today'),
  'size is maintained by the server');

select lives_ok(
  $$ insert into public.org_vault_notes (org_id, path, body, rev)
     values ('0f000000-0000-0000-0000-00000000000f', 'bytes.md', 'caf' || chr(233), 1) $$,
  'fixture: a note with a two-byte character');
select is(
  (select size from public.org_vault_notes
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path = 'bytes.md'),
  5,
  'size counts bytes, not characters');

select throws_ok(
  $$ insert into public.org_vault_notes (org_id, path, body, rev)
     values ('0f000000-0000-0000-0000-00000000000f', 'OLD.md', 'dupe', 1) $$,
  '23505', null::text,
  'two live notes cannot differ only by case (unique on lower(path))');

select ok(
  char_length(public.org_vault_conflict_name('0f000000-0000-0000-0000-00000000000f',
    repeat('x', 505) || '.md', now())) <= 512
  and public.org_vault_path_ok(public.org_vault_conflict_name('0f000000-0000-0000-0000-00000000000f',
    repeat('x', 505) || '.md', now())),
  'a conflict name for a long path is trimmed to fit and still passes org_vault_path_ok');

select throws_ok(
  $$ update public.org_vault_revisions set body = 'rewritten' $$,
  'P0001', null::text,
  'a revision row cannot be updated, even by the owner');

-- ------------------------------------------------------------ roles
set local role anon;
select throws_ok(
  $$ select public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'a.md', 'x', null, true) $$,
  '42501', null::text,
  'anon cannot call org_vault_write');
reset role;

-- ------------------------------------------------------------ removed member
select set_config('request.jwt.claims',
  '{"sub":"f3000000-0000-0000-0000-000000000003","email":"leaver@example.com","role":"authenticated"}', true);
set local role authenticated;
select ok(
  (select count(*) from public.org_vault_revisions
   where org_id = '0f000000-0000-0000-0000-00000000000f') > 0,
  'an active member reads the org''s revisions');
select throws_ok(
  $$ select public.org_vault_purge() $$,
  '42501', null::text,
  'a member cannot call org_vault_purge');
select throws_ok(
  $$ insert into public.org_vault_revisions (org_id, path, rev, body, deleted, updated_at, reason)
     values ('0f000000-0000-0000-0000-00000000000f', 'forged.md', 1, 'x', false, now(), 'overwritten') $$,
  '42501', null::text,
  'a member cannot write a revision row directly');
reset role;

update public.org_members set status = 'revoked' where user_id = 'f3000000-0000-0000-0000-000000000003';

set local role authenticated;
select is(
  (select count(*) from public.org_vault_notes
   where org_id = '0f000000-0000-0000-0000-00000000000f'),
  0::bigint,
  'a removed member reads 0 notes');
select is(
  (select count(*) from public.org_vault_revisions
   where org_id = '0f000000-0000-0000-0000-00000000000f'),
  0::bigint,
  'a removed member reads 0 revision rows');
select throws_ok(
  $$ select public.org_vault_write('0f000000-0000-0000-0000-00000000000f', 'mine.md', 'x', null, true) $$,
  'P0001', null::text,
  'a removed member''s org_vault_write is refused');
select throws_ok(
  $$ select public.org_vault_remove('0f000000-0000-0000-0000-00000000000f', 'old.md', 1) $$,
  'P0001', null::text,
  'a removed member''s org_vault_remove is refused');
reset role;

-- ------------------------------------------------------------ purge
-- One tombstone and one revision row past the window, one of each inside it.
-- The purge removes exactly the two old rows.
insert into public.org_vault_notes (org_id, path, body, deleted, rev, updated_at)
values
  ('0f000000-0000-0000-0000-00000000000f', 'ancient.md', '', true, nextval('public.org_vault_rev_seq'), now() - interval '31 days'),
  ('0f000000-0000-0000-0000-00000000000f', 'recent.md',  '', true, nextval('public.org_vault_rev_seq'), now() - interval '2 days');
insert into public.org_vault_revisions (org_id, path, rev, body, deleted, updated_at, reason, recorded_at)
values
  ('0f000000-0000-0000-0000-00000000000f', 'ancient.md', 1, 'old', false, now() - interval '40 days', 'deleted', now() - interval '31 days'),
  ('0f000000-0000-0000-0000-00000000000f', 'recent.md',  1, 'new', false, now() - interval '3 days',  'deleted', now() - interval '2 days');

select ok(public.org_vault_purge() >= 2, 'org_vault_purge reports the backdated tombstone and revision row');
select is(
  (select count(*) from public.org_vault_notes
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path in ('ancient.md', 'recent.md')),
  1::bigint,
  'a tombstone inside the window survives the purge');
select is(
  (select count(*) from public.org_vault_revisions
   where org_id = '0f000000-0000-0000-0000-00000000000f' and path in ('ancient.md', 'recent.md')),
  1::bigint,
  'a revision row inside the window survives the purge');
select throws_ok(
  $$ select public.org_vault_purge(interval '1 hour') $$,
  'P0001', null::text,
  'a purge window under a day is refused');

select * from finish();
rollback;
