-- What must hold after the pending files land on production's state (CTO 11,
-- 2026-09-29; CI job `sql-replay`). Run after `supabase db push --local` on a
-- database built from supabase/production-history.tsv's files and loaded with
-- supabase/replay/production_rows.sql:
--
--   psql -v ON_ERROR_STOP=1 -v expected_versions="$(node supabase/scripts/replay-split.mjs versions)" \
--     -f supabase/replay/after_push.sql
--
-- Each check raises `REPLAY FAIL n` on a miss. It changes nothing: the checks
-- that call a function run in a transaction that is rolled back.

select set_config('replay.expected_versions', :'expected_versions', false);

begin;

do $check$
declare
  v_want text[] := string_to_array(current_setting('replay.expected_versions'), ',');
  v_got text[];
  n bigint;
  r jsonb;
  v_action text;
begin
  -- 1. The history is production's rows, then the pending files, in order.
  select array_agg(version order by version) into v_got from supabase_migrations.schema_migrations;
  if v_got is distinct from v_want then
    raise exception 'REPLAY FAIL 1: schema_migrations is %, expected %', v_got, v_want;
  end if;

  -- 2. 0021 renamed the older of the two case duplicates, kept its body, and
  --    left a 'renamed' revision row at the old path.
  select count(*) into n from (
    select lower(path) from public.org_vault_notes
     where org_id = '7e000000-0000-0000-0000-0000000000aa' and not deleted
     group by 1 having count(*) > 1) d;
  if n <> 0 then raise exception 'REPLAY FAIL 2: % case duplicate(s) left', n; end if;
  if not exists (select 1 from public.org_vault_notes
                  where org_id = '7e000000-0000-0000-0000-0000000000aa'
                    and path = 'Plans/Roadmap.md' and body = 'The newer roadmap.' and not deleted) then
    raise exception 'REPLAY FAIL 2: the newer duplicate did not keep its path';
  end if;
  if not exists (select 1 from public.org_vault_notes
                  where org_id = '7e000000-0000-0000-0000-0000000000aa'
                    and path like 'plans/roadmap (conflict %).md' and body = 'The older roadmap.'
                    and not deleted and rev >= 1000000000) then
    raise exception 'REPLAY FAIL 2: the older duplicate was not moved to a conflict name with a sequence rev';
  end if;
  if not exists (select 1 from public.org_vault_revisions
                  where org_id = '7e000000-0000-0000-0000-0000000000aa'
                    and path = 'plans/roadmap.md' and reason = 'renamed' and body = 'The older roadmap.') then
    raise exception 'REPLAY FAIL 2: the rename left no revision row';
  end if;

  -- 3. 0022 removed the queued repeat and kept the first report; the submitted
  --    report is kept with its hold.
  select count(*) into n from public.abuse_reports where user_id = '7e000000-0000-0000-0000-000000000003';
  if n <> 1 then raise exception 'REPLAY FAIL 3: r3 has % report(s), expected 1', n; end if;
  if not exists (
    select 1 from public.abuse_reports a
      join replay_snapshot.abuse_reports s using (id)
     where a.user_id = '7e000000-0000-0000-0000-000000000003'
       and s.created_at = (select min(created_at) from replay_snapshot.abuse_reports
                            where user_id = '7e000000-0000-0000-0000-000000000003')) then
    raise exception 'REPLAY FAIL 3: the kept report is not the first one';
  end if;
  if not exists (
    select 1 from public.abuse_reports
     where user_id = '7e000000-0000-0000-0000-000000000004' and status = 'submitted'
       and legal_hold_until > now() + interval '300 days') then
    raise exception 'REPLAY FAIL 3: the submitted report or its hold is gone';
  end if;

  -- 4. 0022's report index and hash check.
  if to_regclass('public.abuse_reports_user_hash_idx') is null then
    raise exception 'REPLAY FAIL 4: abuse_reports_user_hash_idx was not created';
  end if;
  if not (select convalidated from pg_constraint
           where conrelid = 'public.abuse_reports'::regclass
             and conname = 'abuse_reports_request_hash_check') then
    raise exception 'REPLAY FAIL 4: abuse_reports_request_hash_check is not validated';
  end if;

  -- 5. No fingerprint and no hold changed: production's 0019 keyed them once,
  --    and nothing pending may key or hold them again.
  select count(*) into n
    from replay_snapshot.guardrail_events s
    left join public.guardrail_events g using (id)
   where g.id is null
      or g.request_hash is distinct from s.request_hash
      or g.legal_hold_until is distinct from s.legal_hold_until;
  if n <> 0 then raise exception 'REPLAY FAIL 5: % guardrail row(s) lost or changed a fingerprint or hold', n; end if;
  select count(*) into n
    from replay_snapshot.enforcement_actions s
    left join public.enforcement_actions e using (id)
   where e.id is null or e.legal_hold_until is distinct from s.legal_hold_until;
  if n <> 0 then raise exception 'REPLAY FAIL 5: % enforcement action(s) lost or changed a hold', n; end if;
  select count(*) into n
    from public.abuse_reports a
    join replay_snapshot.abuse_reports s using (id)
   where a.request_hash is distinct from s.request_hash
      or a.legal_hold_until is distinct from s.legal_hold_until
      or a.status is distinct from s.status;
  if n <> 0 then raise exception 'REPLAY FAIL 5: % report(s) changed a fingerprint, hold or status', n; end if;

  -- 6. Every author column keys to auth.users on delete set null, validated:
  --    0019's (and 0022's) five and 0025's two.
  select count(*) into n
    from (values ('org_members', 'invited_by'), ('org_vault_notes', 'updated_by'),
                 ('org_projects', 'created_by'), ('org_projects', 'updated_by'),
                 ('org_project_members', 'granted_by'),
                 ('org_vault_revisions', 'updated_by'), ('org_vault_settings', 'updated_by')) t (tbl, col)
   where (select string_agg(c.confdeltype::text || case when c.convalidated then '' else '?' end, ',')
            from pg_constraint c
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
           where c.conrelid = format('public.%I', t.tbl)::regclass
             and c.contype = 'f' and c.confrelid = 'auth.users'::regclass
             and a.attname = t.col) is distinct from 'n';
  if n <> 0 then raise exception 'REPLAY FAIL 6: % author column(s) are not one validated set-null key', n; end if;

  -- 7. The three cron jobs, and the tombstone line in the retention job.
  select count(*) into n from cron.job
   where jobname in ('oscode_ledger_retention', 'oscode_vault_purge', 'oscode_guardrail_retention');
  if n <> 3 then raise exception 'REPLAY FAIL 7: % of the three cron jobs exist', n; end if;
  if not exists (select 1 from cron.job where jobname = 'oscode_guardrail_retention'
                    and command like '%delete from public.enforcement_tombstones%') then
    raise exception 'REPLAY FAIL 7: the retention job has no tombstone delete';
  end if;

  -- 8. 0023's byte counter matches what is stored.
  select count(*) into n
    from (select org_id, sum(bytes) as bytes
            from (select org_id, octet_length(body)::bigint as bytes from public.org_vault_notes
                  union all
                  select org_id, octet_length(body)::bigint from public.org_vault_revisions) s
           group by org_id) stored
    full join public.org_storage_usage u using (org_id)
   where coalesce(stored.bytes, 0) <> coalesce(u.bytes, 0);
  if n <> 0 then raise exception 'REPLAY FAIL 8: % org(s) with a wrong byte total', n; end if;

  -- 9. Download my data works for a fixture person, as version 2.
  perform set_config('request.jwt.claims',
    '{"sub":"7e000000-0000-0000-0000-000000000001","email":"owner@replay.invalid","role":"authenticated"}', true);
  set local role authenticated;
  r := public.export_my_data();
  if r->>'version' is distinct from '2'
     or jsonb_array_length(r->'orgs_owned') <> 1
     or jsonb_array_length(r->'org_memberships') < 1
     or (r->>'review_staff') is distinct from 'true' then
    raise exception 'REPLAY FAIL 9: export_my_data gave %', r;
  end if;

  -- 10. The ladder records on production's rows (it raised on every call
  --     before 0022), and warns with the published address.
  perform set_config('request.jwt.claims',
    '{"sub":"7e000000-0000-0000-0000-000000000003","email":"blocked@replay.invalid","role":"authenticated"}', true);
  select x.action into v_action from public.record_enforcement() x;
  if v_action is distinct from 'warn' then
    raise exception 'REPLAY FAIL 10: record_enforcement gave % for one confirmed block', v_action;
  end if;
  reset role;
  if not exists (select 1 from public.enforcement_actions
                  where user_id = '7e000000-0000-0000-0000-000000000003'
                    and reason like '%write to os-code@openshorellc.com.') then
    raise exception 'REPLAY FAIL 10: the warning does not carry the published address';
  end if;

  raise notice 'REPLAY CHECKS PASSED: 10 checks held on production''s rows.';
end $check$;

rollback;
