-- pgTAP coverage for 0032: explicit grants on every table, least privilege for
-- the client roles, and the review's smaller fixes. Run with `supabase test
-- db` against a database that has every migration applied. Its own
-- transaction and its own plan().
--
-- 1. Every table answers the service role in full, anon nothing (the review
--    view and its aggregates excepted), and no client role holds TRUNCATE,
--    TRIGGER or REFERENCES anywhere.
-- 2. The signed-in RPCs no longer answer anon; the review reads still do.
-- 3. A push grant can be marked revoked by its owner, never un-revoked.
-- 4. record_enforcement writes a ledger row only when the outcome moves.
-- 5. push_send_claim holds the ceiling, the cooldown and the dedupe, and only
--    the service role may call it.
-- 6. apple_notifications_seen is gone, and the jobs say what they keep.
--
-- Users are seeded straight into auth.users in their own id range
-- (8e000000-...), and the whole run is rolled back.
--
-- Error codes: 42501 is a missing privilege (or an RLS refusal on a write).
-- Objects an extension owns (pgTAP's own views, wherever it is installed)
-- are not the app's tables and are left out of the table checks.

begin;
select plan(26);

-- ------------------------------------------------------------ 1. tables
select is(
  (select array_agg(c.relname::text order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      and not (has_table_privilege('service_role', c.oid, 'select')
           and has_table_privilege('service_role', c.oid, 'insert')
           and has_table_privilege('service_role', c.oid, 'update')
           and has_table_privilege('service_role', c.oid, 'delete'))),
  null::text[],
  'the service role reads and writes every table and view');

select is(
  (select array_agg(c.relname::text order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      and c.relname <> 'model_reviews_public'
      and (has_table_privilege('anon', c.oid, 'select')
        or has_table_privilege('anon', c.oid, 'insert')
        or has_table_privilege('anon', c.oid, 'update')
        or has_table_privilege('anon', c.oid, 'delete')
        or has_any_column_privilege('anon', c.oid, 'select, insert, update'))),
  null::text[],
  'anon holds nothing on any table');

select is(
  (select array_agg(c.relname::text || ':' || r.rolname order by c.relname, r.rolname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'), ('authenticated')) r(rolname)
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      and (has_table_privilege(r.rolname, c.oid, 'truncate')
        or has_table_privilege(r.rolname, c.oid, 'trigger')
        or has_table_privilege(r.rolname, c.oid, 'references'))),
  null::text[],
  'no client role may truncate, add a trigger to, or reference any table');

select ok(
  has_table_privilege('anon', 'public.model_reviews_public', 'select')
  and not has_table_privilege('anon', 'public.model_reviews_public', 'insert'),
  'anon still reads the public reviews view, and only reads it');

select ok(
  has_column_privilege('authenticated', 'public.orgs', 'name', 'insert')
  and has_column_privilege('authenticated', 'public.orgs', 'seat_count', 'update')
  and not has_column_privilege('authenticated', 'public.orgs', 'tier_id', 'update')
  and not has_table_privilege('authenticated', 'public.orgs', 'delete'),
  'orgs keeps its column grants (0005) and gains no delete');

select ok(
  has_column_privilege('authenticated', 'public.org_members', 'email', 'insert')
  and has_column_privilege('authenticated', 'public.org_members', 'role', 'update')
  and not has_column_privilege('authenticated', 'public.org_members', 'user_id', 'update')
  and has_table_privilege('authenticated', 'public.org_members', 'delete'),
  'org_members keeps its column grants (0015) and its delete');

select ok(
  has_table_privilege('authenticated', 'public.guardrail_events', 'insert')
  and has_table_privilege('authenticated', 'public.guardrail_events', 'select')
  and not has_table_privilege('authenticated', 'public.guardrail_events', 'update')
  and not has_table_privilege('authenticated', 'public.guardrail_events', 'delete'),
  'a guardrail row is uploaded and read back, never edited');

select ok(
  has_table_privilege('authenticated', 'public.review_eula_acceptance', 'insert')
  and has_table_privilege('authenticated', 'public.review_eula_acceptance', 'update')
  and not has_table_privilege('authenticated', 'public.review_eula_acceptance', 'delete'),
  'the EULA acceptance still upserts');

select ok(
  not has_table_privilege('authenticated', 'public.push_sends', 'select')
  and not has_table_privilege('authenticated', 'public.org_entitlements', 'insert')
  and has_table_privilege('authenticated', 'public.org_entitlements', 'select'),
  'the send log is the service role''s; a team plan is read, never written');

-- ------------------------------------------------------------ 2. functions
select ok(
  not has_function_privilege('anon', 'public.claim_membership()', 'execute')
  and not has_function_privilege('anon', 'public.record_enforcement()', 'execute')
  and not has_function_privilege('anon', 'public.org_vault_put(uuid, text, text, bigint)', 'execute')
  and not has_function_privilege('anon', 'public.admin_list_reviews(int)', 'execute')
  and not has_function_privilege('anon', 'public.is_org_admin(uuid)', 'execute'),
  'the signed-in RPCs do not answer anon');

select ok(
  has_function_privilege('authenticated', 'public.claim_membership()', 'execute')
  and has_function_privilege('authenticated', 'public.record_enforcement()', 'execute')
  and has_function_privilege('authenticated', 'public.org_vault_write(uuid, text, text, bigint, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.is_org_admin(uuid)', 'execute'),
  'and still answer a signed-in person');

select ok(
  has_function_privilege('anon', 'public.model_review_summary(text)', 'execute')
  and has_function_privilege('anon', 'public.model_review_summaries(text[])', 'execute')
  and has_function_privilege('anon', 'public.model_review_snapshot()', 'execute')
  and has_function_privilege('anon', 'public.author_blocked(uuid)', 'execute'),
  'the review aggregates still answer anon');

select ok(
  not has_function_privilege('authenticated', 'public.enforce_org_member_ceiling()', 'execute')
  and not has_function_privilege('anon', 'public.guardrail_events_before_insert()', 'execute'),
  'the trigger functions answer no client role');

set local role anon;
select throws_ok($$ select public.claim_membership() $$, '42501', null::text,
  'anon cannot call claim_membership');
reset role;

-- ------------------------------------------------------------ 3. push grants
insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('8e000000-0000-0000-0000-000000000001', 'grants-a@test.invalid', now(), 'authenticated', 'authenticated'),
  ('8e000000-0000-0000-0000-000000000002', 'grants-b@test.invalid', now(), 'authenticated', 'authenticated');

insert into public.push_grants (id, user_id, token_sha256, label)
values
  ('8e000000-0000-0000-0000-0000000000a1', '8e000000-0000-0000-0000-000000000001', repeat('a', 64), 'desk'),
  ('8e000000-0000-0000-0000-0000000000a2', '8e000000-0000-0000-0000-000000000001', repeat('b', 64), 'laptop');
update public.push_grants set revoked_at = now() - interval '1 day'
 where id = '8e000000-0000-0000-0000-0000000000a2';

select set_config('request.jwt.claims',
  '{"sub":"8e000000-0000-0000-0000-000000000001","email":"grants-a@test.invalid","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$ update public.push_grants set revoked_at = now() where id = '8e000000-0000-0000-0000-0000000000a1' $$,
  'the owner marks a grant revoked');
select throws_ok(
  $$ update public.push_grants set label = 'x' where id = '8e000000-0000-0000-0000-0000000000a1' $$,
  '42501', null::text,
  'only revoked_at may change');
update public.push_grants set revoked_at = null where id = '8e000000-0000-0000-0000-0000000000a2';
reset role;

select ok(
  (select revoked_at is not null from public.push_grants where id = '8e000000-0000-0000-0000-0000000000a1')
  and (select revoked_at is not null from public.push_grants where id = '8e000000-0000-0000-0000-0000000000a2'),
  'a revoked grant stays revoked: clearing revoked_at changes nothing');

-- ------------------------------------------------------------ 4. the ladder
insert into public.guardrail_events
  (user_id, category, tier, request_hash, model_path, action, side, signals)
values
  ('8e000000-0000-0000-0000-000000000002', 'weapons-uplift', 2, repeat('4', 64), 'local', 'blocked', 'input', '{}');

select set_config('request.jwt.claims',
  '{"sub":"8e000000-0000-0000-0000-000000000002","email":"grants-b@test.invalid","role":"authenticated"}', true);
set local role authenticated;
select is((select action from public.record_enforcement()), 'log-only', 'one countable block logs');
select is((select action from public.record_enforcement()), 'log-only', 'and says so again');
reset role;

select is(
  (select count(*)::int from public.enforcement_actions where user_id = '8e000000-0000-0000-0000-000000000002'),
  1,
  'the same outcome twice writes one ledger row');

insert into public.guardrail_events
  (user_id, category, tier, request_hash, model_path, action, side, signals)
values
  ('8e000000-0000-0000-0000-000000000002', 'csam', 1, repeat('5', 64), 'local', 'blocked', 'input', '{rule}');

set local role authenticated;
select is((select action from public.record_enforcement()), 'warn', 'a Tier 1 block warns');
reset role;

select is(
  (select array_agg(action order by action) from public.enforcement_actions
    where user_id = '8e000000-0000-0000-0000-000000000002'),
  array['log-only', 'warn'],
  'a moved outcome writes its row');

-- ------------------------------------------------------------ 5. the send ceiling
select is(
  array[
    public.push_send_claim('8e000000-0000-0000-0000-000000000001', repeat('c', 64), 'k1', 'done', 3, 15000),
    public.push_send_claim('8e000000-0000-0000-0000-000000000001', repeat('c', 64), 'k2', 'done', 3, 15000),
    public.push_send_claim('8e000000-0000-0000-0000-000000000001', repeat('d', 64), 'k3', 'approval', 3, 15000),
    public.push_send_claim('8e000000-0000-0000-0000-000000000001', repeat('d', 64), 'k3', 'approval', 3, 15000),
    public.push_send_claim('8e000000-0000-0000-0000-000000000001', repeat('e', 64), 'k4', 'approval', 3, 15000),
    public.push_send_claim('8e000000-0000-0000-0000-000000000001', repeat('f', 64), 'k5', 'approval', 3, 15000)
  ],
  array['sent', 'cooled', 'sent', 'deduped', 'sent', 'throttled'],
  'push_send_claim: a send, a cooled repeat, an approval, its retry, a third send, then the ceiling');

select ok(
  has_function_privilege('service_role', 'public.push_send_claim(uuid, text, text, text, int, int)', 'execute')
  and not has_function_privilege('authenticated', 'public.push_send_claim(uuid, text, text, text, int, int)', 'execute')
  and not has_function_privilege('anon', 'public.push_send_claim(uuid, text, text, text, int, int)', 'execute'),
  'only the service role may claim a send');

-- ------------------------------------------------------------ 6. tables and jobs
select is(to_regclass('public.apple_notifications_seen'), null::regclass,
  'apple_notifications_seen is gone');

select ok(
  not exists (select 1 from pg_extension where extname = 'pg_cron')
  or (
    (select command not like '%apple_notifications_seen%'
        and command like '%delete from public.push_sends where created_at < now() - interval ''30 days'';%'
       from cron.job where jobname = 'oscode_ledger_retention')
    and (select command like '%status = ''invited'' and user_id is null and created_at < now() - interval ''90 days''%'
              and command like '%delete from public.push_devices where updated_at < now() - interval ''180 days'';%'
           from cron.job where jobname = 'oscode_privacy_retention')
  ),
  'the ledger job keeps only the send log, and the privacy job clears unclaimed invites after 90 days');

select * from finish();
rollback;
