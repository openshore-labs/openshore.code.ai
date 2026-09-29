-- pgTAP coverage for production's two privacy files and what 0026 adds to
-- them (CTO 11, 2026-09-29):
--   0019_account_deletion_and_guardrail_retention.sql: the keyed hash, block
--     rows only and with no name, the legal hold, the client-proof tables;
--   0020_reviews_public_view.sql: the public view, own rows only on the base
--     table, the staff label, block by review;
--   0022: the ladder's warning carries the ruled appeal address;
--   0026: Download my data version 2, and the retention job's tombstone line.
-- Run with `supabase test db` against a database that has every migration
-- applied, whether built from empty or by replaying production (the CI jobs
-- `sql` and `sql-replay`). Its own transaction and its own plan(); every
-- count is scoped to this file's own ids, since a replayed database is not
-- empty.
--
-- Shape follows rls.test.sql: users are seeded straight into auth.users, a
-- caller is impersonated by setting request.jwt.claims and switching role,
-- expected failures go through throws_ok, and the whole run is rolled back.
--
-- The guardrail HMAC key is read from vault.decrypted_secrets inside the test.
-- A database built from empty gets a throwaway key from
-- supabase/scripts/local-vault.sh; without one, 0019 does not apply at all.
--
-- Error codes: 42501 is a missing privilege; P0001 a plpgsql `raise exception`.

begin;
select plan(48);

-- ------------------------------------------------------------ fixtures
--   p1 = one: owns the team, blocks, reviews, exports
--   p2 = two: a member of the team, reviews, carries the staff label
--   p3 = warned: one confirmed Tier 1 block
--   p4 = held: rows for the retention job
insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('9a000000-0000-0000-0000-000000000001', 'priv-one@example.com',    now(), 'authenticated', 'authenticated'),
  ('9a000000-0000-0000-0000-000000000002', 'priv-two@example.com',    now(), 'authenticated', 'authenticated'),
  ('9a000000-0000-0000-0000-000000000003', 'priv-warned@example.com', now(), 'authenticated', 'authenticated'),
  ('9a000000-0000-0000-0000-000000000004', 'priv-held@example.com',   now(), 'authenticated', 'authenticated');

insert into public.orgs (id, name, owner_uid, seat_count, tier_id)
values ('9a000000-0000-0000-0000-00000000000a', 'Privacy', '9a000000-0000-0000-0000-000000000001', 2, 'personal');
insert into public.org_members (org_id, user_id, email, role, status)
values
  ('9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-000000000001', 'priv-one@example.com', 'admin',  'active'),
  ('9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-000000000002', 'priv-two@example.com', 'member', 'active');
insert into public.org_entitlements (org_id, tier_id, seats, status)
values ('9a000000-0000-0000-0000-00000000000a', 'commercial_small', 2, 'active');

create temp table saved (k text primary key, v text) on commit drop;
grant all on saved to anon, authenticated;
create temp table exported (k text primary key, v jsonb) on commit drop;
grant all on exported to authenticated;

-- ------------------------------------------------------------ 0019: the keyed hash
select set_config('request.jwt.claims',
  '{"sub":"9a000000-0000-0000-0000-000000000001","email":"priv-one@example.com","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$ insert into public.guardrail_events
       (user_id, category, tier, request_hash, model_path, action, side, signals, subject)
     values ('9a000000-0000-0000-0000-000000000001', 'likeness', 2, repeat('1', 64),
             'local', 'blocked', 'input', '{likeness}', 'Jane Example') $$,
  'a signed-in person records a block');

select lives_ok(
  $$ insert into public.guardrail_events
       (user_id, category, tier, request_hash, model_path, action, side, signals)
     values ('9a000000-0000-0000-0000-000000000001', 'likeness', 2, repeat('2', 64),
             'local', 'allowed-with-assertion', 'input', '{}') $$,
  'an older build''s allowed-with-assertion row does not raise');
reset role;

select is(
  (select request_hash from public.guardrail_events
    where user_id = '9a000000-0000-0000-0000-000000000001' and category = 'likeness'),
  encode(extensions.hmac(repeat('1', 64),
    (select decrypted_secret from vault.decrypted_secrets where name = 'guardrail_hmac_key'),
    'sha256'), 'hex'),
  'the stored fingerprint is the HMAC-SHA256 of the client''s hash under the Vault key');

select isnt(
  (select request_hash from public.guardrail_events
    where user_id = '9a000000-0000-0000-0000-000000000001' and category = 'likeness'),
  repeat('1', 64),
  'the raw client hash is not stored');

select is(
  (select subject from public.guardrail_events
    where user_id = '9a000000-0000-0000-0000-000000000001' and category = 'likeness'),
  null::text,
  'a block row names no person: the subject is forced to null');

select is(
  (select count(*) from public.guardrail_events
    where user_id = '9a000000-0000-0000-0000-000000000001' and action <> 'blocked'),
  0::bigint,
  'the allowed-with-assertion row was dropped');

select throws_ok(
  $$ update public.guardrail_events set subject = 'Jane Example'
      where user_id = '9a000000-0000-0000-0000-000000000001' $$,
  '23514', null::text,
  'a subject cannot be written back (guardrail_events_subject_null)');

-- ------------------------------------------------------------ 0019: the legal hold
-- A report marked submitted holds the account's block rows for a year.
insert into public.guardrail_events
  (user_id, category, tier, request_hash, model_path, action, side, signals)
values
  ('9a000000-0000-0000-0000-000000000004', 'weapons-uplift', 1, repeat('4', 64), 'cloud', 'blocked', 'output', '{rule}');
insert into public.abuse_reports (user_id, category, request_hash, occurred_at, status, submitted_at)
values ('9a000000-0000-0000-0000-000000000004', 'weapons-uplift', repeat('5', 64), now(), 'submitted', now());

select ok(
  (select legal_hold_until >= now() + interval '364 days' from public.abuse_reports
    where user_id = '9a000000-0000-0000-0000-000000000004'),
  'a submitted report is held for at least a year');
select ok(
  (select bool_and(legal_hold_until >= now() + interval '364 days') from public.guardrail_events
    where user_id = '9a000000-0000-0000-0000-000000000004'),
  'and so are the reporting account''s block rows');

-- ------------------------------------------------------------ client-proof tables
set local role anon;
select throws_ok($$ select count(*) from public.deletion_holds $$, '42501', null::text,
  'anon cannot read deletion_holds');
select throws_ok($$ select count(*) from public.enforcement_tombstones $$, '42501', null::text,
  'anon cannot read enforcement_tombstones');
reset role;
set local role authenticated;
select throws_ok($$ select count(*) from public.deletion_holds $$, '42501', null::text,
  'a signed-in client cannot read deletion_holds');
select throws_ok(
  $$ insert into public.deletion_holds (user_id_sha256, held_rows, hold_until)
     values (repeat('a', 64), '{}'::jsonb, now()) $$,
  '42501', null::text,
  'a signed-in client cannot write deletion_holds');
select throws_ok($$ select count(*) from public.enforcement_tombstones $$, '42501', null::text,
  'a signed-in client cannot read enforcement_tombstones');
reset role;

-- ------------------------------------------------------------ 0022: the ladder's address
insert into public.guardrail_events
  (user_id, category, tier, request_hash, model_path, action, side, signals)
values
  ('9a000000-0000-0000-0000-000000000003', 'csam', 1, repeat('3', 64), 'local', 'blocked', 'input', '{rule}');

select set_config('request.jwt.claims',
  '{"sub":"9a000000-0000-0000-0000-000000000003","email":"priv-warned@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select action from public.record_enforcement()),
  'warn',
  'one confirmed Tier 1 block warns');
reset role;

select matches(
  (select reason from public.enforcement_actions
    where user_id = '9a000000-0000-0000-0000-000000000003' order by created_at desc limit 1),
  'If this was legitimate work, write to os-code@openshorellc\.com\.$',
  'the warning names the published appeal address (the 2026-09-24 contact-inboxes ruling)');

-- ------------------------------------------------------------ 0020: reviews
select set_config('request.jwt.claims',
  '{"sub":"9a000000-0000-0000-0000-000000000001","email":"priv-one@example.com","role":"authenticated"}', true);
set local role authenticated;
insert into public.model_reviews (user_id, model_id, rating, body)
values ('9a000000-0000-0000-0000-000000000001', 'privacy-model', 4, 'mine');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"9a000000-0000-0000-0000-000000000002","email":"priv-two@example.com","role":"authenticated"}', true);
set local role authenticated;
insert into public.model_reviews (user_id, model_id, rating, body)
values ('9a000000-0000-0000-0000-000000000002', 'privacy-model', 2, 'theirs');
reset role;

insert into saved
  select 'two_review', id::text from public.model_reviews
   where user_id = '9a000000-0000-0000-0000-000000000002' and model_id = 'privacy-model';
insert into saved
  select 'one_review', id::text from public.model_reviews
   where user_id = '9a000000-0000-0000-0000-000000000001' and model_id = 'privacy-model';
insert into public.review_staff (user_id) values ('9a000000-0000-0000-0000-000000000002');

select hasnt_column('public', 'model_reviews_public', 'user_id',
  'the public view carries no author id');

select set_config('request.jwt.claims', '', true);
set local role anon;
select is(
  (select count(*) from public.model_reviews_public where model_id = 'privacy-model'),
  2::bigint,
  'anon reads visible reviews through model_reviews_public');
select throws_ok(
  $$ select count(*) from public.model_reviews $$,
  '42501', null::text,
  'anon cannot read the base table');
select is(
  (select array_agg(is_staff order by rating) from public.model_reviews_public
    where model_id = 'privacy-model'),
  array[true, false],
  'the server sets the staff label from review_staff');
select throws_ok(
  $$ select public.block_review_author('00000000-0000-0000-0000-000000000000') $$,
  '42501', null::text,
  'anon cannot block');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"9a000000-0000-0000-0000-000000000001","email":"priv-one@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select array_agg(user_id::text) from public.model_reviews where model_id = 'privacy-model'),
  array['9a000000-0000-0000-0000-000000000001'],
  'a signed-in person reads only their own rows on the base table');
select is(
  (select array_agg(is_mine order by rating) from public.model_reviews_public
    where model_id = 'privacy-model'),
  array[false, true],
  'is_mine marks the reader''s own review and no other');
select lives_ok(
  $$ select public.block_review_author((select v::uuid from saved where k = 'two_review')) $$,
  'block_review_author blocks by review id');
select is(
  (select count(*) from public.model_reviews_public where model_id = 'privacy-model'),
  1::bigint,
  'the blocked author''s review leaves the reader''s view');
select throws_ok(
  $$ select public.block_review_author((select v::uuid from saved where k = 'one_review')) $$,
  'P0001', null::text,
  'nobody blocks themselves');
reset role;

select is(
  (select count(*) from public.user_blocks
    where blocker_id = '9a000000-0000-0000-0000-000000000001'
      and blocked_id = '9a000000-0000-0000-0000-000000000002'),
  1::bigint,
  'the block is recorded against the author the server looked up');

-- ------------------------------------------------------------ 0026: Download my data
-- History by each of them: two overwrites a note one wrote (a row authored by
-- one), one overwrites a note two wrote (a row authored by two). Then one
-- changes the team settings.
select set_config('request.jwt.claims',
  '{"sub":"9a000000-0000-0000-0000-000000000001","email":"priv-one@example.com","role":"authenticated"}', true);
set local role authenticated;
insert into saved
  select 'one_note', (public.org_vault_write('9a000000-0000-0000-0000-00000000000a', 'one.md', 'by one', null, true)->>'rev');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"9a000000-0000-0000-0000-000000000002","email":"priv-two@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(
  public.org_vault_write('9a000000-0000-0000-0000-00000000000a', 'one.md', 'over one',
    (select v::bigint from saved where k = 'one_note'), false)->>'ok',
  'true',
  'two overwrites a note one wrote');
insert into saved
  select 'two_note', (public.org_vault_write('9a000000-0000-0000-0000-00000000000a', 'two.md', 'by two', null, true)->>'rev');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"9a000000-0000-0000-0000-000000000001","email":"priv-one@example.com","role":"authenticated"}', true);
set local role authenticated;
select is(
  public.org_vault_write('9a000000-0000-0000-0000-00000000000a', 'two.md', 'over two',
    (select v::bigint from saved where k = 'two_note'), false)->>'ok',
  'true',
  'one overwrites a note two wrote');
select is(
  public.org_vault_settings_put('9a000000-0000-0000-0000-00000000000a', '{}'::jsonb, 'member', null, 0)->>'ok',
  'true',
  'one changes the team settings');
reset role;

insert into public.enforcement_tombstones (email_sha256, level)
values (public.enforcement_email_key('priv-one@example.com'), 1);

select set_config('request.jwt.claims',
  '{"sub":"9a000000-0000-0000-0000-000000000001","email":"priv-one@example.com","role":"authenticated"}', true);
set local role authenticated;
insert into exported select 'one', public.export_my_data();
reset role;
select set_config('request.jwt.claims',
  '{"sub":"9a000000-0000-0000-0000-000000000002","email":"priv-two@example.com","role":"authenticated"}', true);
set local role authenticated;
insert into exported select 'two', public.export_my_data();
reset role;

select is(
  (select v->'version' from exported where k = 'one'),
  '2'::jsonb,
  'export_my_data is version 2');
select is(
  (select array_agg(key order by key collate "C") from exported, jsonb_object_keys(v) as key where k = 'one'),
  array['account', 'apple_links', 'enforcement_actions', 'enforcement_tombstone', 'exported_at',
        'format', 'guardrail_events', 'model_reviews', 'org_memberships', 'org_project_members',
        'org_projects', 'org_vault_notes_updated', 'org_vault_revisions_authored',
        'org_vault_settings_updated', 'orgs_owned', 'push_devices', 'push_grants',
        'review_eula_acceptance', 'review_reports', 'review_staff', 'user_blocks',
        'user_entitlements', 'version'],
  'it carries 0019''s nineteen keys and the four 0026 adds');
select is(
  (select array_agg(distinct x->>'updated_by') from exported,
     jsonb_array_elements(v->'org_vault_revisions_authored') x where k = 'one'),
  array['9a000000-0000-0000-0000-000000000001'],
  'one''s export holds the history rows one wrote and no one else''s');
select is(
  (select array_agg(distinct x->>'updated_by') from exported,
     jsonb_array_elements(v->'org_vault_revisions_authored') x where k = 'two'),
  array['9a000000-0000-0000-0000-000000000002'],
  'two''s export holds the history rows two wrote and no one else''s');
select is(
  (select jsonb_array_length(v->'org_vault_settings_updated') from exported where k = 'one'),
  1,
  'one''s export holds the settings row one changed');
select is(
  (select v->'org_vault_settings_updated' from exported where k = 'two'),
  '[]'::jsonb,
  'two''s export holds no settings row');
select is(
  (select v->'enforcement_tombstone'->>'level' from exported where k = 'one'),
  '1',
  'a tombstone under the caller''s email shows its level');
select ok(
  (select position(public.enforcement_email_key('priv-one@example.com') in v::text) = 0
     from exported where k = 'one'),
  'the export never carries the tombstone''s hash');
select is(
  (select jsonb_typeof(v->'enforcement_tombstone') from exported where k = 'two'),
  'null',
  'no tombstone reads as null');
select is(
  (select array[v->>'review_staff', (select v->>'review_staff' from exported where k = 'two')]
     from exported where k = 'one'),
  array['false', 'true'],
  'review_staff says whether the caller carries the OpenShore team label');

set local role anon;
select throws_ok($$ select public.export_my_data() $$, '42501', null::text,
  'anon cannot call export_my_data');
reset role;

-- ------------------------------------------------------------ 0026: retention
select is(
  (select schedule from cron.job where jobname = 'oscode_guardrail_retention'),
  '41 3 * * *',
  'the guardrail retention job runs daily at 03:41 UTC');
select ok(
  (select command like '%delete from public.guardrail_events%'
      and command like '%delete from public.enforcement_actions%'
      and command like '%delete from public.deletion_holds where hold_until <= now();%'
      and command like '%delete from public.enforcement_tombstones where recorded_at < now() - interval ''2 years'';%'
     from cron.job where jobname = 'oscode_guardrail_retention'),
  'it keeps 0019''s three deletes and adds the tombstone delete');

-- Rows the job must delete and rows it must keep. The insert trigger stamps
-- created_at with the server clock, so the age is set afterwards.
insert into public.guardrail_events
  (user_id, category, tier, request_hash, model_path, action, side, signals)
values
  ('9a000000-0000-0000-0000-000000000004', 'ncii', 1, repeat('6', 64), 'local', 'blocked', 'input', '{old}'),
  ('9a000000-0000-0000-0000-000000000004', 'ncii', 1, repeat('7', 64), 'local', 'blocked', 'input', '{held}');
update public.guardrail_events
   set created_at = now() - interval '181 days',
       legal_hold_until = case when signals = '{held}' then now() + interval '1 year' else null end
 where user_id = '9a000000-0000-0000-0000-000000000004' and signals in ('{old}', '{held}');
insert into public.enforcement_tombstones (email_sha256, level, recorded_at)
values
  (public.enforcement_email_key('old-tombstone@example.com'), 2, now() - interval '2 years 1 day'),
  (public.enforcement_email_key('new-tombstone@example.com'), 2, now() - interval '1 year');
insert into public.deletion_holds (user_id_sha256, held_rows, hold_until)
values (repeat('d', 64), '{}'::jsonb, now() - interval '1 day');

select lives_ok(
  (select command from cron.job where jobname = 'oscode_guardrail_retention'),
  'the stored retention command runs');
select is(
  (select array_agg(signals[1] order by signals[1]) from public.guardrail_events
    where user_id = '9a000000-0000-0000-0000-000000000004' and signals in ('{old}', '{held}')),
  array['held'],
  'a 181-day block row goes, and one under legal hold stays');
select is(
  (select count(*) from public.enforcement_tombstones
    where email_sha256 = public.enforcement_email_key('old-tombstone@example.com')),
  0::bigint,
  'a tombstone older than two years goes');
select is(
  (select count(*) from public.enforcement_tombstones
    where email_sha256 = public.enforcement_email_key('new-tombstone@example.com')),
  1::bigint,
  'a younger tombstone stays');
select is(
  (select count(*) from public.deletion_holds where user_id_sha256 = repeat('d', 64)),
  0::bigint,
  'a deletion hold whose hold has ended goes');

select * from finish();
rollback;
