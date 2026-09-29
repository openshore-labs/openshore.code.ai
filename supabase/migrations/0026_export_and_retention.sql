-- Download my data and guardrail retention, for the tables that came after
-- them (CTO 11, 2026-09-29). Production applied the privacy branch's 0019
-- (0019_account_deletion_and_guardrail_retention.sql) and 0020 on 2026-09-24,
-- before main's org vault v1 (now 0021), account deletion (0022) and org vault
-- settings (0025) existed. Those two files are applied and are never edited,
-- so the two gaps the overlap opened close here:
--
--   1. export_my_data() is re-created with the same signature, grants and
--      SECURITY DEFINER. It keeps 0019's nineteen keys unchanged, moves
--      'version' to 2 (the new keys only add to the document), and adds:
--        org_vault_revisions_authored  the team history rows the caller wrote
--                                      (0021), matched by updated_by;
--        org_vault_settings_updated    the team settings rows the caller last
--                                      changed (0025), matched by updated_by;
--        enforcement_tombstone         the level and recorded_at of a
--                                      tombstone under the caller's email
--                                      (0022), or null; never the hash;
--        review_staff                  whether the caller carries the
--                                      "OpenShore team" label (0020).
--
--      What it leaves out, and why:
--        org_storage_usage         a team's byte count; it names no person.
--        deletion_holds            rows copied from a deleted account under a
--                                  hash of its id; not linked to any live
--                                  account.
--        abuse_reports             0019 left them out without a stated
--                                  reason. Whether a report prepared under 18
--                                  U.S.C. 2258A is disclosed to its subject is
--                                  a counsel call (founder decision F4); until
--                                  then they stay out, and no copy says the
--                                  export holds everything.
--        push_sends                push delivery bookkeeping (a dedupe key per
--                                  push), service role only, deleted after 30
--                                  days by oscode_ledger_retention (0015);
--                                  0019 left it out.
--        likeness_consents         never written: consent assertions stay on
--                                  the device (0019 section C).
--        org_entitlements          a team's plan, keyed by the team; it names
--                                  no person.
--        apple_notifications_seen  Apple's notification ids for replay
--                                  defence; they name no person.
--        review_moderators, abuse_reviewers
--                                  operator allowlists the service role
--                                  seeds; 0019 left them out.
--      app/test/supabaseMigrations.test.ts classifies every table a migration
--      creates as read here or left out with a reason, so a new table cannot
--      fall out of Download my data unnoticed.
--
--   2. The retention job, re-scheduled under the same name
--      (oscode_guardrail_retention, daily at 03:41 UTC) with the same pg_cron
--      guard as 0019 section B. It keeps 0019's three deletes verbatim and
--      adds one: an enforcement tombstone older than two years. A tombstone
--      re-creates the effect of an enforcement action on a new account, so it
--      may not outlive the two years the 2026-09-24 ruling gives enforcement
--      actions (the founder may record an exemption instead; the default is
--      two years). Because this block unschedules and schedules the whole
--      job, it also schedules it on a project where pg_cron was off when 0019
--      ran.
--
-- Nothing applied is edited: both are `create or replace` or a re-schedule.
-- Deploy ordering: after 0019, 0021, 0022 and 0025 (it reads their tables).

-- ---------------------------------------------------------------- 1. export
create or replace function public.export_my_data ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_created timestamptz;
  v_confirmed text;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select u.email, u.created_at,
         case when u.email_confirmed_at is not null then lower(u.email) end
    into v_email, v_created, v_confirmed
    from auth.users u
   where u.id = v_uid;

  return jsonb_build_object(
    'format', 'openshore-account-export',
    'version', 2,
    'exported_at', now(),
    'account', jsonb_build_object('id', v_uid, 'email', v_email, 'created_at', v_created),
    'user_entitlements', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.user_entitlements t where t.user_id = v_uid
    ), '[]'::jsonb),
    'apple_links', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.apple_links t where t.user_id = v_uid
    ), '[]'::jsonb),
    'org_memberships', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.org_members t
       where t.user_id = v_uid
          or (v_confirmed is not null and lower(t.email) = v_confirmed)
    ), '[]'::jsonb),
    'orgs_owned', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.orgs t where t.owner_uid = v_uid
    ), '[]'::jsonb),
    'org_projects', coalesce((
      select jsonb_agg(to_jsonb(p)) from public.org_projects p
       where p.created_by = v_uid
          or p.updated_by = v_uid
          or exists (
            select 1 from public.org_project_members m
             where m.project_id = p.id
               and (m.user_id = v_uid
                    or (v_confirmed is not null and lower(m.email) = v_confirmed))
          )
    ), '[]'::jsonb),
    'org_project_members', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.org_project_members t
       where t.user_id = v_uid
          or (v_confirmed is not null and lower(t.email) = v_confirmed)
    ), '[]'::jsonb),
    'org_vault_notes_updated', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.org_vault_notes t where t.updated_by = v_uid
    ), '[]'::jsonb),
    'push_devices', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.push_devices t where t.user_id = v_uid
    ), '[]'::jsonb),
    'push_grants', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.push_grants t where t.user_id = v_uid
    ), '[]'::jsonb),
    'model_reviews', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.model_reviews t where t.user_id = v_uid
    ), '[]'::jsonb),
    'review_reports', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.review_reports t where t.reporter_id = v_uid
    ), '[]'::jsonb),
    'user_blocks', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.user_blocks t where t.blocker_id = v_uid
    ), '[]'::jsonb),
    'review_eula_acceptance', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.review_eula_acceptance t where t.user_id = v_uid
    ), '[]'::jsonb),
    'guardrail_events', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.guardrail_events t where t.user_id = v_uid
    ), '[]'::jsonb),
    'enforcement_actions', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.enforcement_actions t where t.user_id = v_uid
    ), '[]'::jsonb),
    -- Added in version 2 (0026).
    'org_vault_revisions_authored', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.id) from public.org_vault_revisions t
       where t.updated_by = v_uid
    ), '[]'::jsonb),
    'org_vault_settings_updated', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.org_vault_settings t where t.updated_by = v_uid
    ), '[]'::jsonb),
    'enforcement_tombstone', (
      select jsonb_build_object('level', t.level, 'recorded_at', t.recorded_at)
        from public.enforcement_tombstones t
       where t.email_sha256 = public.enforcement_email_key(auth.email())
    ),
    'review_staff', exists (
      select 1 from public.review_staff s where s.user_id = v_uid
    )
  );
end;
$$;

revoke execute on function public.export_my_data () from public, anon;
grant execute on function public.export_my_data () to authenticated;

-- ---------------------------------------------------------------- 2. retention
-- 0019 section B's block, with the tombstone delete added. Guarded the same
-- way, so the migration still applies where pg_cron is absent.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be enabled here (%). Enable it in the dashboard, then re-run this block.', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'oscode_guardrail_retention') then
      perform cron.unschedule('oscode_guardrail_retention');
    end if;
    perform cron.schedule(
      'oscode_guardrail_retention',
      '41 3 * * *',
      $job$
        delete from public.guardrail_events
         where created_at < now() - interval '180 days'
           and (legal_hold_until is null or legal_hold_until <= now());
        delete from public.enforcement_actions
         where created_at < now() - interval '2 years'
           and (legal_hold_until is null or legal_hold_until <= now());
        delete from public.deletion_holds where hold_until <= now();
        delete from public.enforcement_tombstones where recorded_at < now() - interval '2 years';
      $job$
    );
  else
    raise notice 'pg_cron is not installed; guardrail retention was not scheduled (see supabase/README.md).';
  end if;
end $$;
