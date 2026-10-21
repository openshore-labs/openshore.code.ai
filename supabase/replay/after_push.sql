-- What must hold after the pending files land on production's state (CTO 11,
-- 2026-09-29; CI job `sql-replay`). Run after `supabase db push --local` on a
-- database built from supabase/production-history.tsv's files and loaded with
-- supabase/replay/production_rows.sql:
--
--   psql -v ON_ERROR_STOP=1 -v expected_versions="$(node supabase/scripts/replay-split.mjs versions)" \
--     -f supabase/replay/after_push.sql
--
-- Each check raises `REPLAY FAIL n` on a miss. It changes nothing: every check
-- runs in a transaction that is rolled back. It describes the push of 0032.

select set_config('replay.expected_versions', :'expected_versions', false);

begin;

do $check$
declare
  v_want text[] := string_to_array(current_setting('replay.expected_versions'), ',');
  v_got text[];
  n bigint;
  v_cmd text;
begin
  -- 1. The history is production's rows, then the pending files, in order.
  select array_agg(version order by version) into v_got from supabase_migrations.schema_migrations;
  if v_got is distinct from v_want then
    raise exception 'REPLAY FAIL 1: schema_migrations is %, expected %', v_got, v_want;
  end if;

  -- 2. Every table answers the service role in full; anon holds nothing but
  --    the public reviews view; no client role keeps TRUNCATE, TRIGGER or
  --    REFERENCES anywhere.
  select count(*) into n
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'p', 'v')
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
     and (not (has_table_privilege('service_role', c.oid, 'select')
               and has_table_privilege('service_role', c.oid, 'insert')
               and has_table_privilege('service_role', c.oid, 'update')
               and has_table_privilege('service_role', c.oid, 'delete'))
          or (c.relname <> 'model_reviews_public'
              and has_table_privilege('anon', c.oid, 'select, insert, update, delete'))
          or has_table_privilege('anon', c.oid, 'truncate, trigger, references')
          or has_table_privilege('authenticated', c.oid, 'truncate, trigger, references'));
  if n <> 0 then raise exception 'REPLAY FAIL 2: % table(s) hold the wrong grants after 0032', n; end if;

  -- 3. 0032 changed no row it found: the team, the grants and the ladder are
  --    as they were (clearing happens on the job's clock, never in the push).
  select count(*) into n from (
    select id, user_id, email, role, status from public.org_members where id::text like '7e000000-%'
    except select * from replay_snapshot.org_members
  ) d;
  if n <> 0 or (select count(*) from public.org_members where id::text like '7e000000-%') <> 5 then
    raise exception 'REPLAY FAIL 3: 0032 changed the team''s rows';
  end if;
  if exists (select id, revoked_at, sent_count from public.push_grants where id::text like '7e000000-%'
             except select * from replay_snapshot.push_grants)
     or (select count(*) from public.enforcement_actions where user_id::text like '7e000000-%') <> 4 then
    raise exception 'REPLAY FAIL 3: 0032 changed a push grant or a ladder row';
  end if;

  -- 4. The dead table is gone, and the weekly job no longer names it.
  if to_regclass('public.apple_notifications_seen') is not null then
    raise exception 'REPLAY FAIL 4: apple_notifications_seen is still here';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'oscode_ledger_retention'
                   and command like '%apple_notifications_seen%') then
    raise exception 'REPLAY FAIL 4: oscode_ledger_retention still deletes from a dropped table';
  end if;

  -- 5. The privacy job, run once on these rows: the invite nobody claimed in
  --    120 days goes; last week's invite, the claimed seat, the active owner
  --    and the revoked row stay, and so do the live grant and the phone.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select command into v_cmd from cron.job where jobname = 'oscode_privacy_retention';
    if v_cmd is null then raise exception 'REPLAY FAIL 5: oscode_privacy_retention is missing'; end if;
    execute v_cmd;
    if exists (select 1 from public.org_members where id = '7e000000-0000-0000-0000-0000000000b2') then
      raise exception 'REPLAY FAIL 5: the stale invite outlived the privacy job';
    end if;
    if (select count(*) from public.org_members
         where id in ('7e000000-0000-0000-0000-0000000000b1', '7e000000-0000-0000-0000-0000000000b3',
                      '7e000000-0000-0000-0000-0000000000b4', '7e000000-0000-0000-0000-0000000000b5')) <> 4
       or not exists (select 1 from public.push_grants where id = '7e000000-0000-0000-0000-0000000000c1')
       or not exists (select 1 from public.push_devices where device_token = repeat('ab', 32)) then
      raise exception 'REPLAY FAIL 5: the privacy job cleared a row it must keep';
    end if;
  end if;

  -- 6. The owner cannot un-revoke a grant, and can still revoke a live one.
  perform set_config('request.jwt.claims',
    '{"sub":"7e000000-0000-0000-0000-000000000001","email":"owner@replay.invalid","role":"authenticated"}', true);
  set local role authenticated;
  update public.push_grants set revoked_at = null where id = '7e000000-0000-0000-0000-0000000000c2';
  update public.push_grants set revoked_at = now() where id = '7e000000-0000-0000-0000-0000000000c1';
  reset role;
  if (select count(*) from public.push_grants
       where id in ('7e000000-0000-0000-0000-0000000000c1', '7e000000-0000-0000-0000-0000000000c2')
         and revoked_at is not null) <> 2 then
    raise exception 'REPLAY FAIL 6: a revoked grant was cleared, or a live one could not be revoked';
  end if;

  -- 7. The ladder, on r2's four old rows: the same outcome adds no fifth.
  perform set_config('request.jwt.claims',
    '{"sub":"7e000000-0000-0000-0000-000000000002","email":"laddered@replay.invalid","role":"authenticated"}', true);
  set local role authenticated;
  perform public.record_enforcement();
  reset role;
  if (select count(*) from public.enforcement_actions
       where user_id = '7e000000-0000-0000-0000-000000000002') <> 4 then
    raise exception 'REPLAY FAIL 7: record_enforcement added a row for an outcome that did not move';
  end if;

  raise notice 'REPLAY CHECKS PASSED: 7 checks held on production''s rows.';
end $check$;

rollback;
