-- 0032: explicit grants on every table, least privilege for the client roles,
-- and the smaller fixes from the CTO security review of 2026-10-21.
--
-- Why now: from 2026-10-30 Supabase stops granting the Data API roles (anon,
-- authenticated and service_role) anything on a new table in public by
-- default. Production keeps what it has, but a database built from these
-- files afterwards (the CI replay, a branch, `db reset` on a newer CLI) would
-- not: every table whose migration leaned on the defaults would answer the app
-- and the functions with "permission denied". So each table's grants are
-- written here, once, for all three roles, and they are the narrowest the app
-- and the functions actually use (each traced to its caller, below). The
-- defaults also gave anon and authenticated TRUNCATE, TRIGGER and REFERENCES
-- on every table, and anon full write on tables RLS was the only guard of;
-- those go.
--
-- What changes:
--   1. Tables: service_role ALL on every table; anon nothing on any table
--      (the one signed-out read is the model_reviews_public view, kept);
--      authenticated only what an RLS policy and a real call use.
--   2. Functions: EXECUTE is granted by name to the roles that call each one;
--      the signed-in RPCs no longer answer anon (PUBLIC's default goes), and
--      the trigger functions answer no client role.
--   3. push_grants: a person may still mark their own grant revoked, but can
--      never clear revoked_at again (the update policy was user_id only).
--   4. record_enforcement writes a ledger row only when the outcome moves,
--      not on every call. Its answer is unchanged.
--   5. push_send_claim: push-send's daily ceiling, cooldown and dedupe in one
--      locked step, so two sends at once cannot both slip under the ceiling.
--   6. apple_notifications_seen goes: the function that wrote it was removed
--      and nothing reads it. The weekly ledger job stops naming it first.
--      user_entitlements and apple_links stay (delete-account's planner, the
--      export and stripe-portal still read them; DECISIONS 2026-10-21).
--   7. Unclaimed team invites go after 90 days (the daily privacy job), so an
--      invitee's address is not kept for good.
--
-- Caution kept: a table-level REVOKE of INSERT or UPDATE also takes the
-- column grants of the same kind, so orgs and org_members keep their column
-- grants (0005, 0015) restated here and lose only what no policy uses.
--
-- UNAPPLIED. It lands for the founder's push through
-- docs/vault-gate1-runbook.md, after supabase/scripts/push-preflight.mjs; that
-- push appends its history row. It can go before or after the push-send and
-- repo-oauth deploys of the same change: push-send falls back to its old
-- checks while push_send_claim is missing, and nothing else here is called by
-- a function.
--
-- Every statement is safe to run again (CI's sql-replay applies this file a
-- second time on a database stripped of every table grant, and the result
-- must equal the first).

-- ---------------------------------------------------------------- 1. tables
-- Every table: the service role has it all (the functions write through it),
-- and the client roles start from nothing they did not get explicitly below.
do $$
declare
  t text;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
       and c.relname <> 'model_reviews_public'
  loop
    execute format('grant all on public.%I to service_role', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
  end loop;
end $$;

-- The read surface for reviews: anyone may read it, signed in or not. It is
-- an owner-rights view (0020), so its readers need no grant on the tables
-- under it; the one function it calls, author_blocked, is granted below.
revoke all on public.model_reviews_public from anon, authenticated;
grant select on public.model_reviews_public to anon, authenticated;
grant all on public.model_reviews_public to service_role;

-- orgs: the app reads its org, creates one (0005's columns) and edits its
-- seats (0005's columns). No policy deletes an org.
revoke delete on public.orgs from authenticated;
grant select on public.orgs to authenticated;
grant insert (name, owner_uid, seat_count, tier_id, price_year) on public.orgs to authenticated;
grant update (name, seat_count, price_year) on public.orgs to authenticated;

-- org_members: the app reads the roster, invites (0015's columns), changes a
-- role (0015's columns) and removes a member; a member may leave (0018).
grant select, delete on public.org_members to authenticated;
grant insert (org_id, user_id, email, role, status, invited_by) on public.org_members to authenticated;
grant update (email, role, status, invited_by) on public.org_members to authenticated;

-- Read-only to a signed-in person, each through its own select policy.
-- org_entitlements: the store's team plan read. org_vault_notes,
-- org_vault_revisions, org_vault_settings, org_projects, org_project_members:
-- the team vault and projects (writes are RPCs). enforcement_actions: the
-- person's own standing (0016). abuse_reports, abuse_reviewers,
-- review_moderators: the operator allowlists and queue (policies limit them).
-- push_devices: the person's own phones. user_entitlements, apple_links: the
-- person's own row from before OpenShore went free; an older build may still
-- read it, and it is theirs. review_reports: the person's own reports (0027
-- took the insert while the Local Library's reviews are shut).
do $$
declare
  t text;
begin
  foreach t in array array[
    'org_entitlements', 'org_vault_notes', 'org_vault_revisions', 'org_vault_settings',
    'org_projects', 'org_project_members', 'enforcement_actions', 'abuse_reports',
    'abuse_reviewers', 'review_moderators', 'push_devices', 'user_entitlements',
    'apple_links', 'review_reports'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete on public.%I from authenticated', t);
      execute format('grant select on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

-- guardrail_events: the app uploads a counted block and reads the row back
-- (lib/ethics.ts, return=representation). Nothing edits or deletes one.
revoke update, delete on public.guardrail_events from authenticated;
grant select, insert on public.guardrail_events to authenticated;

-- likeness_consents: 0027 took every write but the person's own delete.
revoke insert, update on public.likeness_consents from authenticated;
grant select, delete on public.likeness_consents to authenticated;

-- model_reviews: a person reads and deletes their own review (0020); 0027
-- took insert and update while the Local Library's reviews are shut.
revoke insert, update on public.model_reviews from authenticated;
grant select, delete on public.model_reviews to authenticated;

-- user_blocks: 0011's grants (blocking now runs through block_review_author).
revoke update on public.user_blocks from authenticated;
grant select, insert, delete on public.user_blocks to authenticated;

-- review_eula_acceptance: the app upserts its acceptance (insert, then update
-- on a conflict) and reads it back.
revoke delete on public.review_eula_acceptance from authenticated;
grant select, insert, update on public.review_eula_acceptance to authenticated;

-- push_grants: a person reads their own grants and may mark one revoked;
-- minting, sending and deleting run through the push functions. Only the
-- revoked_at column, and only toward a time (section 3).
revoke insert, update, delete on public.push_grants from authenticated;
grant select on public.push_grants to authenticated;
grant update (revoked_at) on public.push_grants to authenticated;

-- Service role only: no client reads or writes these.
do $$
declare
  t text;
begin
  foreach t in array array[
    'push_sends', 'deletion_holds', 'review_staff', 'enforcement_tombstones',
    'org_storage_usage', 'apple_notifications_seen'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- Sequences: only the SECURITY DEFINER vault functions draw from them, as
-- their owner. The service role keeps them; the client roles get none.
do $$
declare
  s text;
begin
  for s in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('grant all on sequence public.%I to service_role', s);
    execute format('revoke all on sequence public.%I from public, anon, authenticated', s);
  end loop;
end $$;

-- ---------------------------------------------------------------- 2. functions
-- Signed-in RPCs: each refuses or answers nothing without auth.uid(), and no
-- signed-out caller exists in the app (every call site sends the person's
-- token; the review and abuse-queue reads return early without one). The
-- service role keeps them for the functions (stripe-* call is_org_admin as
-- the person; nothing calls these as anon).
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.is_org_admin(uuid) from public, anon;
revoke execute on function public.is_org_owner(uuid) from public, anon;
revoke execute on function public.claim_membership() from public, anon;
revoke execute on function public.org_vault_put(uuid, text, text, bigint) from public, anon;
revoke execute on function public.org_vault_delete(uuid, text) from public, anon;
revoke execute on function public.is_review_moderator() from public, anon;
revoke execute on function public.admin_list_reviews(int) from public, anon;
revoke execute on function public.admin_set_review_status(uuid, text) from public, anon;
revoke execute on function public.project_level(uuid) from public, anon;
revoke execute on function public.list_org_projects() from public, anon;
revoke execute on function public.create_org_project(uuid, text, text, text[]) from public, anon;
revoke execute on function public.update_org_project(uuid, text, text, text[], bigint) from public, anon;
revoke execute on function public.delete_org_project(uuid) from public, anon;
revoke execute on function public.set_org_project_access(uuid, text, text) from public, anon;
revoke execute on function public.revoke_org_project_access(uuid, text) from public, anon;
revoke execute on function public.is_abuse_reviewer() from public, anon;
revoke execute on function public.record_enforcement() from public, anon;
revoke execute on function public.queue_abuse_report(text, text, timestamptz) from public, anon;
revoke execute on function public.admin_list_abuse_reports(int) from public, anon;
revoke execute on function public.admin_mark_report_submitted(uuid, text, text) from public, anon;
revoke execute on function public.admin_confirm_termination(uuid, text) from public, anon;

grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.is_org_admin(uuid) to authenticated, service_role;
grant execute on function public.is_org_owner(uuid) to authenticated, service_role;
grant execute on function public.claim_membership() to authenticated, service_role;
grant execute on function public.org_vault_put(uuid, text, text, bigint) to authenticated, service_role;
grant execute on function public.org_vault_delete(uuid, text) to authenticated, service_role;
grant execute on function public.org_vault_write(uuid, text, text, bigint, boolean) to authenticated, service_role;
grant execute on function public.org_vault_remove(uuid, text, bigint) to authenticated, service_role;
grant execute on function public.org_vault_move(uuid, text, text, bigint) to authenticated, service_role;
grant execute on function public.org_vault_settings_get(uuid) to authenticated, service_role;
grant execute on function public.org_vault_settings_put(uuid, jsonb, text, text, bigint) to authenticated, service_role;
grant execute on function public.org_vault_entitled(uuid) to authenticated, service_role;
grant execute on function public.is_review_moderator() to authenticated, service_role;
grant execute on function public.admin_list_reviews(int) to authenticated, service_role;
grant execute on function public.admin_set_review_status(uuid, text) to authenticated, service_role;
grant execute on function public.block_review_author(uuid) to authenticated, service_role;
grant execute on function public.project_level(uuid) to authenticated, service_role;
grant execute on function public.list_org_projects() to authenticated, service_role;
grant execute on function public.create_org_project(uuid, text, text, text[]) to authenticated, service_role;
grant execute on function public.update_org_project(uuid, text, text, text[], bigint) to authenticated, service_role;
grant execute on function public.delete_org_project(uuid) to authenticated, service_role;
grant execute on function public.set_org_project_access(uuid, text, text) to authenticated, service_role;
grant execute on function public.revoke_org_project_access(uuid, text) to authenticated, service_role;
grant execute on function public.auth_email_confirmed() to authenticated, service_role;
grant execute on function public.org_seat_ceiling(uuid) to authenticated, service_role;
grant execute on function public.is_abuse_reviewer() to authenticated, service_role;
grant execute on function public.record_enforcement() to authenticated, service_role;
grant execute on function public.queue_abuse_report(text, text, timestamptz) to authenticated, service_role;
grant execute on function public.admin_list_abuse_reports(int) to authenticated, service_role;
grant execute on function public.admin_mark_report_submitted(uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_confirm_termination(uuid, text) to authenticated, service_role;
grant execute on function public.export_my_data() to authenticated, service_role;

-- Signed-out reads: the review aggregates (SECURITY DEFINER since 0020, so
-- they need no table grant) and author_blocked, which the public view calls
-- as its reader.
grant execute on function public.model_review_summary(text) to anon, authenticated, service_role;
grant execute on function public.model_review_summaries(text[]) to anon, authenticated, service_role;
grant execute on function public.model_review_snapshot() to anon, authenticated, service_role;
grant execute on function public.author_blocked(uuid) to anon, authenticated, service_role;

-- The service role's own (restated, so they do not lean on a default).
grant execute on function public.account_deletion_hold(uuid) to service_role;
grant execute on function public.account_deletion_orgs(uuid, uuid[]) to service_role;
grant execute on function public.account_deletion_tombstone(uuid) to service_role;
grant execute on function public.account_deletion_memberships(uuid) to service_role;
grant execute on function public.deletion_hold_key(uuid) to service_role;
grant execute on function public.apply_user_entitlement_event(uuid, text, text, timestamptz, timestamptz, text, text, text) to service_role;
grant execute on function public.apply_org_entitlement_event(uuid, text, int, text, timestamptz, text, timestamptz, text) to service_role;

-- Trigger functions run as triggers, never by a call, and a trigger does not
-- check EXECUTE when it fires (0023 and 0031 already work this way).
revoke execute on function public.on_review_reported() from public, anon, authenticated;
revoke execute on function public.enforce_org_member_ceiling() from public, anon, authenticated;
revoke execute on function public.enforce_org_seat_count() from public, anon, authenticated;
revoke execute on function public.hold_on_report_submitted() from public, anon, authenticated;
revoke execute on function public.guardrail_events_before_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. push_grants
-- A grant may be marked revoked by its owner, never un-revoked: the row after
-- the update must still be theirs and still carry revoked_at. (Revoking runs
-- through push-unregister today; this keeps the client path safe if a screen
-- uses it.)
drop policy if exists push_grants_update on public.push_grants;
create policy push_grants_update on public.push_grants for update
  to authenticated
  using (user_id = auth.uid() and revoked_at is null)
  with check (user_id = auth.uid() and revoked_at is not null);

-- ---------------------------------------------------------------- 4. the ladder
-- 0030's record_enforcement, with one change: the ledger row is written only
-- when the level or the action differs from the account's newest row (or
-- there is none). Every call used to add a row, so one person's ledger grew
-- with every block. The answer is the same as before, row for row.
create or replace function public.record_enforcement ()
returns table (level smallint, action text, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_countable int;
  v_tier1 int;
  v_confirmed_recent int;
  v_operator_terminated boolean;
  v_tombstoned boolean;
  v_level smallint;
  v_action text;
  v_reason text;
  v_last_level smallint;
  v_last_action text;
  v_has_last boolean;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- Countable violations: blocked requests, excluding check-failed (the layer
  -- failing closed) and likeness (the non-countable consent gate).
  select
    count(*) filter (where g.category not in ('check-failed', 'likeness')),
    count(*) filter (where g.tier = 1 and g.category <> 'check-failed'),
    count(*) filter (
      where g.tier = 1
        and g.category in ('csam', 'ncii', 'weapons-uplift')
        and cardinality(g.signals) >= 1
        and g.occurred_at >= now() - public.enforcement_window()
    )
    into v_countable, v_tier1, v_confirmed_recent
    from public.guardrail_events g
   where g.user_id = v_uid and g.action = 'blocked';

  -- An operator's own confirmation stands regardless of the window.
  select exists (
    select 1 from public.enforcement_actions e
     where e.user_id = v_uid and e.action = 'terminate' and e.actor <> 'system'
  ) into v_operator_terminated;

  -- A terminated account deleted under this email counts the same way.
  select exists (
    select 1 from public.enforcement_tombstones t
     where t.email_sha256 in (public.enforcement_email_key(auth.email()),
                              public.enforcement_email_legacy_key(auth.email()))
       and t.level = 2
  ) into v_tombstoned;
  v_operator_terminated := v_operator_terminated or v_tombstoned;

  if v_operator_terminated or v_confirmed_recent >= 2 then
    v_level := 2;
    v_action := 'terminate';
    v_reason := case
      when v_tombstoned then 'An earlier account with this email was terminated.'
      when v_operator_terminated then 'Termination confirmed by an operator.'
      else v_confirmed_recent || ' confirmed prohibited requests in hard-blocked categories within '
        || extract(day from public.enforcement_window())::int || ' days.'
    end;
  elsif v_tier1 > 0 then
    v_level := 1;
    v_action := 'warn';
    v_reason := 'A request was blocked in a hard-blocked category. A second confirmed block within '
      || extract(day from public.enforcement_window())::int
      || ' days ends the account. If this was legitimate work, write to support@openshore.ai.';
  else
    v_level := 0;
    v_action := 'log-only';
    v_reason := v_countable || ' blocked request(s) on this account.';
  end if;

  -- The newest row this account has, whoever wrote it. A row goes in only
  -- when the outcome moves, so a ledger holds each change once.
  select e.level, e.action, true
    into v_last_level, v_last_action, v_has_last
    from public.enforcement_actions e
   where e.user_id = v_uid
   order by e.created_at desc, e.id desc
   limit 1;

  if v_has_last is not true
     or v_last_level is distinct from v_level
     or v_last_action is distinct from v_action then
    insert into public.enforcement_actions (user_id, level, action, reason, actor)
    values (v_uid, v_level, v_action, v_reason, 'system');
  end if;

  if v_action = 'terminate' then
    -- Prepare (do not submit) a report for the latest Tier 1 block, deduped by
    -- request hash so re-running does not re-report the same content.
    insert into public.abuse_reports (user_id, category, request_hash, occurred_at, status, detail)
    select v_uid, g.category, g.request_hash, g.occurred_at, 'queued',
      'Prepared and stored for the operator. No submission integration is configured, so nothing has been sent.'
      from public.guardrail_events g
     where g.user_id = v_uid and g.action = 'blocked' and g.tier = 1
       and g.category in ('csam', 'ncii', 'weapons-uplift')
       and not exists (
         select 1 from public.abuse_reports r
          where r.user_id = v_uid and r.request_hash = g.request_hash
       )
     order by g.occurred_at desc
     limit 1;
  end if;

  return query select v_level, v_action, v_reason;
end;
$$;

revoke execute on function public.record_enforcement() from public, anon;
grant execute on function public.record_enforcement() to authenticated, service_role;

-- ---------------------------------------------------------------- 5. push_send_claim
-- push-send's three checks in one step under a per-person lock: the daily
-- ceiling across every session, the cooldown on a session's "done" pushes,
-- and the dedupe row. Counting and then inserting from the function let two
-- sends at once both pass the ceiling. The limits stay in push-send and come
-- in as arguments. Answers 'sent', 'throttled', 'cooled' or 'deduped'.
create or replace function public.push_send_claim(
  p_user uuid,
  p_session_hash text,
  p_dedupe_key text,
  p_kind text,
  p_daily_ceiling int,
  p_cooldown_ms int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent int;
  v_recent int;
  v_rows int;
begin
  if p_user is null or coalesce(p_session_hash, '') = '' or coalesce(p_dedupe_key, '') = ''
     or p_kind not in ('approval', 'done')
     or p_daily_ceiling is null or p_daily_ceiling < 1
     or p_cooldown_ms is null or p_cooldown_ms < 0 then
    raise exception 'push_send_claim: bad arguments' using errcode = '22023';
  end if;

  -- One person's sends queue here; other people's never wait on it.
  perform pg_advisory_xact_lock(hashtextextended('oscode.push_send:' || p_user::text, 0));

  select count(*) into v_sent
    from public.push_sends s
   where s.user_id = p_user and s.created_at >= now() - interval '24 hours';
  if v_sent >= p_daily_ceiling then
    return 'throttled';
  end if;

  if p_kind = 'done' then
    select count(*) into v_recent
      from public.push_sends s
     where s.user_id = p_user and s.session_id = p_session_hash
       and s.created_at >= now() - make_interval(secs => p_cooldown_ms / 1000.0);
    if v_recent > 0 then
      return 'cooled';
    end if;
  end if;

  insert into public.push_sends (user_id, session_id, dedupe_key)
  values (p_user, p_session_hash, p_dedupe_key)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'deduped';
  end if;
  return 'sent';
end;
$$;

revoke execute on function public.push_send_claim(uuid, text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.push_send_claim(uuid, text, text, text, int, int) to service_role;

-- ---------------------------------------------------------------- 6. a dead table
-- The weekly ledger job (0015) deleted from apple_notifications_seen too; it
-- keeps only its push_sends line, at its old time, before the table goes. A
-- job of this name another role owns stops here, as 0026 does.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job
                where jobname = 'oscode_ledger_retention' and username <> current_user) then
      raise exception 'cron job oscode_ledger_retention belongs to %, not to %, so this migration cannot re-schedule it. Stop and see docs/vault-gate1-runbook.md 5.2.',
        (select string_agg(distinct username, ', ' order by username) from cron.job
          where jobname = 'oscode_ledger_retention' and username <> current_user),
        current_user;
    end if;
    if exists (select 1 from cron.job where jobname = 'oscode_ledger_retention') then
      perform cron.unschedule('oscode_ledger_retention');
    end if;
    perform cron.schedule(
      'oscode_ledger_retention',
      '17 3 * * 0',
      $job$
        delete from public.push_sends where created_at < now() - interval '30 days';
      $job$
    );
  else
    raise notice 'pg_cron is not installed; ledger retention was not re-scheduled (see supabase/README.md).';
  end if;
end $$;

drop table if exists public.apple_notifications_seen;

-- ---------------------------------------------------------------- 7. invites
-- 0027's daily privacy job, with one line added: an invite nobody claimed in
-- 90 days goes, and the invitee's address with it. A claimed seat, an active
-- member and a revoked row are untouched. Teams are a later tier; the admin
-- can invite again.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job
                where jobname = 'oscode_privacy_retention' and username <> current_user) then
      raise exception 'cron job oscode_privacy_retention belongs to %, not to %, so this migration cannot re-schedule it. Stop and see docs/vault-gate1-runbook.md 5.2.',
        (select string_agg(distinct username, ', ' order by username) from cron.job
          where jobname = 'oscode_privacy_retention' and username <> current_user),
        current_user;
    end if;
    if exists (select 1 from cron.job where jobname = 'oscode_privacy_retention') then
      perform cron.unschedule('oscode_privacy_retention');
    end if;
    perform cron.schedule('oscode_privacy_retention', '17 4 * * *', $job$
      delete from public.push_sends where created_at < now() - interval '2 days';
      delete from public.push_grants
       where (revoked_at is not null and revoked_at < now() - interval '30 days')
          or coalesce(last_sent_at, created_at) < now() - interval '180 days';
      delete from public.push_devices where updated_at < now() - interval '180 days';
      delete from public.org_members
       where status = 'invited' and user_id is null and created_at < now() - interval '90 days';
    $job$);
  else
    raise notice 'pg_cron is not installed; the privacy retention job was not re-scheduled (see supabase/README.md).';
  end if;
end $$;
