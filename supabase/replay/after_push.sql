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
begin
  -- 1. The history is production's rows, then the pending files, in order.
  select array_agg(version order by version) into v_got from supabase_migrations.schema_migrations;
  if v_got is distinct from v_want then
    raise exception 'REPLAY FAIL 1: schema_migrations is %, expected %', v_got, v_want;
  end if;

  -- 2. 0028 cleared every stored password hash, the null one included in
  --    the count of none (GoTrue reads a null as no password too).
  select count(*) into n from auth.users where coalesce(encrypted_password, '') <> '';
  if n <> 0 then raise exception 'REPLAY FAIL 2: % account(s) still hold a password hash', n; end if;
  if not exists (select 1 from auth.users
                  where id = '7e000000-0000-0000-0000-000000000001'
                    and email = 'password-in@replay.invalid'
                    and email_confirmed_at is not null) then
    raise exception 'REPLAY FAIL 2: clearing the password changed the rest of r1''s row';
  end if;

  -- 3. Nobody was signed out: every session is still there, unchanged.
  select count(*) into n
    from replay_snapshot.sessions s
    left join auth.sessions a using (id)
   where a.id is null or a.user_id is distinct from s.user_id or a.not_after is distinct from s.not_after;
  if n <> 0 then raise exception 'REPLAY FAIL 3: % session(s) lost or changed', n; end if;

  -- 4. The column stays empty for good: a password written afterwards (the
  --    way /signup or PUT /user would) is never stored.
  update auth.users set encrypted_password = '$2a$10$after.the.push.this.must.not.land.00000000000000000'
   where id = '7e000000-0000-0000-0000-000000000002';
  if (select encrypted_password from auth.users where id = '7e000000-0000-0000-0000-000000000002') <> '' then
    raise exception 'REPLAY FAIL 4: a password written after the push was stored';
  end if;

  -- 5. The passkey step-up trigger is on GoTrue's table (the runbook's gate
  --    before passkeys go on).
  if to_regclass('auth.webauthn_credentials') is null
     or not exists (select 1 from pg_trigger
                     where tgname = 'oscode_passkey_step_up'
                       and tgrelid = 'auth.webauthn_credentials'::regclass) then
    raise exception 'REPLAY FAIL 5: the passkey step-up trigger is not on auth.webauthn_credentials';
  end if;

  raise notice 'REPLAY CHECKS PASSED: 5 checks held on production''s rows.';
end $check$;

rollback;
