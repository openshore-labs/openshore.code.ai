-- Account deletion, Download my data, and guardrail retention (compliance pass
-- two, part A). Implements the advisory org's 2026-09-24 rulings recorded in
-- os-code/DECISIONS.md: "Guardrail data has retention limits and a keyed hash"
-- and "Account deletion ships with Download my data".
--
-- Sections:
--   A. Foreign keys that name a person as an actor (invited_by, updated_by,
--      created_by, granted_by) become ON DELETE SET NULL, so
--      auth.admin.deleteUser no longer fails for anyone who ever invited a
--      teammate or edited a shared note. orgs.owner_uid stays RESTRICT on
--      purpose: the delete-account function must settle org ownership first.
--   B. Legal hold and retention. legal_hold_until on the three enforcement
--      tables; a submitted report holds its records for at least one year
--      (18 U.S.C. 2258A(h)); a pg_cron job deletes block rows after 180 days
--      and enforcement actions after two years, skipping anything on hold; and
--      deletion_holds keeps held rows past an account deletion, under a hash.
--   C. Block rows only, and no names. Allowed-with-assertion rows are purged
--      and refused; subject is cleared and must stay null. likeness_consents is
--      left in place (the app never writes it, and this pass does not start).
--   D. A keyed fingerprint. request_hash becomes an HMAC-SHA256 under a key
--      held in Supabase Vault, computed on the server at insert time.
--   E. record_enforcement, recreated with the one published contact address.
--   F. export_my_data(): every row the server holds for the caller, as JSON.
--   G. Billing events for a deleted account or team are dropped, not retried.
--
-- ============================================================================
-- FOUNDER PREREQUISITE: CREATE THE VAULT SECRET BEFORE APPLYING THIS FILE.
-- ============================================================================
-- Section D reads the HMAC key from Supabase Vault by name. Create it once, in
-- the SQL editor, with a long random value, and never commit the value:
--
--   select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'guardrail_hmac_key');
--
-- This migration re-keys the existing rows as it runs, so it stops with a clear
-- error if the secret is missing. After it is applied, a missing or deleted
-- secret makes the insert fail with the same message; the app already tolerates
-- a failed insert, and the block itself never depends on it (the refusal
-- happens on the device before any network call). Rotating the key breaks the
-- link between old and new fingerprints of the same text, so rotate only on a
-- suspected leak.
--
-- pg_cron: section B schedules through pg_cron and is guarded exactly like
-- 0015's BE-13 block, so it prints a NOTICE and still applies where the
-- extension is absent. Enable pg_cron (Dashboard, Database, Extensions) and
-- re-run that block if it did not schedule.
--
-- Deploy ordering: apply after 0018, BEFORE deploying the delete-account edge
-- function (it writes deletion_holds) and before the app build that calls
-- export_my_data. Nothing here depends on 0020.

-- ---------------------------------------------------------------------------
-- A. Actor foreign keys: ON DELETE SET NULL
-- ---------------------------------------------------------------------------

-- The constraint names are Postgres's defaults for the inline `references`
-- clauses in 0001, 0010, and 0014 (<table>_<column>_fkey). Drop and re-add, so
-- the rule changes and nothing else does.
alter table public.org_members drop constraint if exists org_members_invited_by_fkey;
alter table public.org_members
  add constraint org_members_invited_by_fkey
  foreign key (invited_by) references auth.users (id) on delete set null;

alter table public.org_vault_notes drop constraint if exists org_vault_notes_updated_by_fkey;
alter table public.org_vault_notes
  add constraint org_vault_notes_updated_by_fkey
  foreign key (updated_by) references auth.users (id) on delete set null;

alter table public.org_projects drop constraint if exists org_projects_created_by_fkey;
alter table public.org_projects
  add constraint org_projects_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.org_projects drop constraint if exists org_projects_updated_by_fkey;
alter table public.org_projects
  add constraint org_projects_updated_by_fkey
  foreign key (updated_by) references auth.users (id) on delete set null;

alter table public.org_project_members drop constraint if exists org_project_members_granted_by_fkey;
alter table public.org_project_members
  add constraint org_project_members_granted_by_fkey
  foreign key (granted_by) references auth.users (id) on delete set null;

-- orgs.owner_uid is deliberately NOT changed: it stays ON DELETE RESTRICT (0001),
-- so an account that still owns an org cannot vanish and orphan the team. The
-- delete-account function deletes owned orgs (with the person's say-so) first.

-- ---------------------------------------------------------------------------
-- B. Legal hold, retention, and deletion holds
-- ---------------------------------------------------------------------------

alter table public.guardrail_events add column if not exists legal_hold_until timestamptz;
alter table public.enforcement_actions add column if not exists legal_hold_until timestamptz;
alter table public.abuse_reports add column if not exists legal_hold_until timestamptz;

-- When a report is marked submitted (admin_mark_report_submitted, 0016, is the
-- one place that does it, but a service-role write is covered too), the report
-- and the reporting account's block rows and enforcement actions are held for
-- at least one year from the submission. An existing longer hold is kept.
create or replace function public.hold_on_report_submitted ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
begin
  if new.status is distinct from 'submitted' then
    return new;
  end if;
  -- Only the transition into submitted sets a hold; a later edit of a report
  -- that is already submitted leaves the hold where it is.
  if tg_op = 'UPDATE' then
    if old.status = 'submitted' then
      return new;
    end if;
  end if;
  new.submitted_at := coalesce(new.submitted_at, now());
  v_until := new.submitted_at + interval '1 year';
  new.legal_hold_until := greatest(coalesce(new.legal_hold_until, v_until), v_until);
  if new.user_id is not null then
    update public.guardrail_events
       set legal_hold_until = greatest(coalesce(legal_hold_until, v_until), v_until)
     where user_id = new.user_id;
    update public.enforcement_actions
       set legal_hold_until = greatest(coalesce(legal_hold_until, v_until), v_until)
     where user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists abuse_report_submitted_hold on public.abuse_reports;
create trigger abuse_report_submitted_hold
  before insert or update of status on public.abuse_reports
  for each row execute function public.hold_on_report_submitted ();

-- Backfill: a report already marked submitted before this migration gets the
-- same hold, counted from when it was submitted.
update public.abuse_reports r
   set legal_hold_until = greatest(
         coalesce(r.legal_hold_until, coalesce(r.submitted_at, now()) + interval '1 year'),
         coalesce(r.submitted_at, now()) + interval '1 year')
 where r.status = 'submitted';
update public.guardrail_events g
   set legal_hold_until = h.hold_until
  from (
    select user_id, max(legal_hold_until) as hold_until
      from public.abuse_reports
     where status = 'submitted' and user_id is not null
     group by user_id
  ) h
 where h.user_id = g.user_id
   and (g.legal_hold_until is null or g.legal_hold_until < h.hold_until);
update public.enforcement_actions e
   set legal_hold_until = h.hold_until
  from (
    select user_id, max(legal_hold_until) as hold_until
      from public.abuse_reports
     where status = 'submitted' and user_id is not null
     group by user_id
  ) h
 where h.user_id = e.user_id
   and (e.legal_hold_until is null or e.legal_hold_until < h.hold_until);

-- Rows that must outlive an account deletion. The delete-account edge function
-- (service role) copies any guardrail_events and enforcement_actions still
-- under hold here, keyed by a SHA-256 of the deleted user id rather than the id
-- itself, then deletes the account. The copied rows carry no user_id. Nobody
-- reads or writes this table from a client; the retention job below removes a
-- row once its hold ends.
create table if not exists public.deletion_holds (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 hex of the deleted account's user id.
  user_id_sha256 text not null check (user_id_sha256 ~ '^[0-9a-f]{64}$'),
  -- { "guardrail_events": [...], "enforcement_actions": [...] }
  held_rows jsonb not null,
  hold_until timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists deletion_holds_until_idx on public.deletion_holds (hold_until);

alter table public.deletion_holds enable row level security;
-- No policies: with RLS on and none defined, every client read and write is
-- denied. Strip the grants too, so this never rests on the policy alone.
revoke all on public.deletion_holds from anon, authenticated;
grant all on public.deletion_holds to service_role;

-- The retention job. Block rows: 180 days. Enforcement actions: two years.
-- Deletion holds: until the hold ends. Anything with legal_hold_until in the
-- future is skipped. Daily, guarded the same way as 0015's BE-13 block, so the
-- migration still applies where pg_cron is absent.
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
      $job$
    );
  else
    raise notice 'pg_cron is not installed; guardrail retention was not scheduled (see supabase/README.md).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- C. Block rows only, and block rows carry no name
-- ---------------------------------------------------------------------------

-- Consent assertions already stay on the device; the allowed-with-assertion
-- rows that reached the server are purged, and a check refuses any new one.
delete from public.guardrail_events where action = 'allowed-with-assertion';
alter table public.guardrail_events drop constraint if exists guardrail_events_blocked_only;
alter table public.guardrail_events
  add constraint guardrail_events_blocked_only check (action = 'blocked');

-- A block row names no person. Clear what exists, then hold the line.
update public.guardrail_events set subject = null where subject is not null;
alter table public.guardrail_events drop constraint if exists guardrail_events_subject_null;
alter table public.guardrail_events
  add constraint guardrail_events_subject_null check (subject is null);

-- ---------------------------------------------------------------------------
-- D. The keyed fingerprint (HMAC-SHA256 under a Vault key)
-- ---------------------------------------------------------------------------

-- The key, read from Supabase Vault. SECURITY DEFINER so the insert trigger can
-- read vault.decrypted_secrets on a signed-in person's behalf; execute is
-- revoked from every client role, so nobody can call it to learn fingerprints.
-- pgcrypto (0001) lives in the extensions schema on Supabase, hence the path.
create or replace function public.guardrail_hmac (p_hash text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'guardrail_hmac_key'
   limit 1;
  if v_key is null or length(v_key) = 0 then
    raise exception 'guardrail_hmac_key is missing from Supabase Vault. Create it (see migration 0019) before recording guardrail events.';
  end if;
  return encode(hmac(p_hash, v_key, 'sha256'), 'hex');
end;
$$;
revoke execute on function public.guardrail_hmac (text) from public, anon, authenticated;

-- Every insert: refuse a malformed fingerprint, quietly drop a row that is not a
-- block (an older app build still sends allowed-with-assertion rows; the check
-- above is the backstop), clear any subject an older build sends, stamp the
-- server's own clock for retention, and replace the client's SHA-256 with the
-- keyed HMAC of it. The 64-hex check on the column (0016) still holds, since an
-- HMAC-SHA256 in hex is 64 characters.
create or replace function public.guardrail_events_before_insert ()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
begin
  if new.action is distinct from 'blocked' then
    return null;
  end if;
  if new.request_hash is null or new.request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'request_hash must be a 64 character hex SHA-256';
  end if;
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'guardrail_hmac_key'
   limit 1;
  if v_key is null or length(v_key) = 0 then
    raise exception 'guardrail_hmac_key is missing from Supabase Vault. Create it (see migration 0019) before recording guardrail events.';
  end if;
  new.request_hash := encode(hmac(new.request_hash, v_key, 'sha256'), 'hex');
  new.subject := null;
  new.created_at := now();
  new.legal_hold_until := null;
  return new;
end;
$$;

drop trigger if exists guardrail_events_keyed_hash on public.guardrail_events;
create trigger guardrail_events_keyed_hash
  before insert on public.guardrail_events
  for each row execute function public.guardrail_events_before_insert ();

-- Re-key what is already stored, so every fingerprint is keyed. A report that
-- was already submitted keeps the fingerprint it was submitted with, and so do
-- the block rows that match it; everything else is re-keyed together, so the
-- report dedupe in record_enforcement (r.request_hash = g.request_hash) stays
-- consistent. This is the statement that stops the migration when the Vault
-- secret is missing and a row exists.
update public.guardrail_events g
   set request_hash = public.guardrail_hmac(g.request_hash)
 where not exists (
   select 1 from public.abuse_reports r
    where r.status = 'submitted'
      and r.user_id = g.user_id
      and r.request_hash = g.request_hash
 );
update public.abuse_reports
   set request_hash = public.guardrail_hmac(request_hash)
 where status <> 'submitted' and request_hash ~ '^[0-9a-f]{64}$';

-- Fail fast on a project with no rows at all, so a missing secret is caught
-- here and not at the first block.
do $$
begin
  perform public.guardrail_hmac(repeat('0', 64));
end $$;

-- queue_abuse_report (0016) takes a client-computed SHA-256; key it the same
-- way so a report made through it matches the block rows it describes.
create or replace function public.queue_abuse_report (
  p_category text,
  p_request_hash text,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_category not in ('csam', 'ncii', 'weapons-uplift') then
    raise exception 'invalid report category %', p_category;
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'request_hash must be a 64 character hex SHA-256';
  end if;
  insert into public.abuse_reports (user_id, category, request_hash, occurred_at, status, detail)
  values (
    auth.uid(),
    p_category,
    public.guardrail_hmac(p_request_hash),
    p_occurred_at,
    'queued',
    'Prepared and stored for the operator. No submission integration is configured, so nothing has been sent.'
  );
end;
$$;
grant execute on function public.queue_abuse_report (text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- E. The enforcement ladder, with the one published contact address
-- ---------------------------------------------------------------------------

-- 0018's body, unchanged except the appeal address in the warning text: until
-- the openshore.ai role inboxes pass a round-trip test, os-code@openshorellc.com
-- is the only published address (DECISIONS.md, "Contact inboxes").
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
  v_level smallint;
  v_action text;
  v_reason text;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- Countable violations: blocked requests, excluding check-failed (the layer
  -- failing closed) and likeness (the non-countable consent gate).
  select
    count(*) filter (where category not in ('check-failed', 'likeness')),
    count(*) filter (where tier = 1 and category <> 'check-failed'),
    count(*) filter (
      where tier = 1
        and category in ('csam', 'ncii', 'weapons-uplift')
        and cardinality(signals) >= 1
        and occurred_at >= now() - public.enforcement_window()
    )
    into v_countable, v_tier1, v_confirmed_recent
    from public.guardrail_events
   where user_id = v_uid and action = 'blocked';

  -- An operator's own confirmation stands regardless of the window.
  select exists (
    select 1 from public.enforcement_actions
     where user_id = v_uid and action = 'terminate' and actor <> 'system'
  ) into v_operator_terminated;

  if v_operator_terminated or v_confirmed_recent >= 2 then
    v_level := 2;
    v_action := 'terminate';
    v_reason := case
      when v_operator_terminated then 'Termination confirmed by an operator.'
      else v_confirmed_recent || ' confirmed prohibited requests in hard-blocked categories within '
        || extract(day from public.enforcement_window())::int || ' days.'
    end;
  elsif v_tier1 > 0 then
    v_level := 1;
    v_action := 'warn';
    v_reason := 'A request was blocked in a hard-blocked category. A second confirmed block within '
      || extract(day from public.enforcement_window())::int
      || ' days ends the account. If this was legitimate work, write to os-code@openshorellc.com.';
  else
    v_level := 0;
    v_action := 'log-only';
    v_reason := v_countable || ' blocked request(s) on this account.';
  end if;

  insert into public.enforcement_actions (user_id, level, action, reason, actor)
  values (v_uid, v_level, v_action, v_reason, 'system');

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

grant execute on function public.record_enforcement () to authenticated;

-- ---------------------------------------------------------------------------
-- F. Download my data
-- ---------------------------------------------------------------------------

-- Every row the server holds for the caller, as one JSON document. Memberships
-- and project grants match by user id, or by email only when that email is
-- confirmed (the same rule claim_membership uses, 0015 P0-4). Blocks the caller
-- made are included; blocks other people made against the caller are not, since
-- those belong to the people who made them.
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
    'version', 1,
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
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.export_my_data () from public, anon;
grant execute on function public.export_my_data () to authenticated;

-- ---------------------------------------------------------------------------
-- G. Billing events for a deleted account or team
-- ---------------------------------------------------------------------------

-- delete-account cancels a team's subscription and then deletes the team, and
-- sets a personal subscription to end at period end and then deletes the
-- account. Stripe reports each change afterwards (subscription updated, then
-- deleted), and stripe-webhook applies it through these RPCs. The insert would
-- hit the foreign key to a row that no longer exists, the webhook would answer
-- 500, and Stripe would retry for days. So each RPC (0015 BE-8, otherwise
-- unchanged) returns false for an account or team that is gone, which the
-- webhook already logs as a dropped event and answers 200.
create or replace function public.apply_user_entitlement_event(
  p_user uuid,
  p_status text,
  p_source text,
  p_valid_until timestamptz,
  p_event_at timestamptz,
  p_stripe_customer_id text default null,
  p_stripe_subscription_id text default null,
  p_apple_original_transaction_id text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  applied int;
begin
  if p_user is null or p_event_at is null then
    raise exception 'user and event time are required';
  end if;
  -- The account was deleted (delete-account cancels its subscription, and
  -- Stripe then reports the change): drop the event so the webhook answers 200
  -- instead of retrying a write that can never land.
  if not exists (select 1 from auth.users where id = p_user) then
    return false;
  end if;
  insert into public.user_entitlements as e (
    user_id, tier_id, status, source, valid_until,
    stripe_customer_id, stripe_subscription_id, apple_original_transaction_id,
    last_event_at, issued_at
  ) values (
    p_user, 'personal', p_status, p_source, p_valid_until,
    p_stripe_customer_id, p_stripe_subscription_id, p_apple_original_transaction_id,
    p_event_at, now()
  )
  on conflict (user_id) do update
    set status = excluded.status,
        source = excluded.source,
        tier_id = 'personal',
        valid_until = excluded.valid_until,
        stripe_customer_id = coalesce(excluded.stripe_customer_id, e.stripe_customer_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, e.stripe_subscription_id),
        apple_original_transaction_id =
          coalesce(excluded.apple_original_transaction_id, e.apple_original_transaction_id),
        last_event_at = excluded.last_event_at,
        issued_at = now()
    where e.last_event_at is null or e.last_event_at < excluded.last_event_at;
  get diagnostics applied = row_count;
  return applied > 0;
end;
$$;

create or replace function public.apply_org_entitlement_event(
  p_org uuid,
  p_tier text,
  p_seats int,
  p_status text,
  p_valid_until timestamptz,
  p_stripe_subscription_id text,
  p_event_at timestamptz,
  p_display_tier text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  applied int;
begin
  if p_org is null or p_event_at is null then
    raise exception 'org and event time are required';
  end if;
  -- The team was deleted (delete-account cancels its subscription first, and
  -- Stripe then reports the cancellation): drop the event, as above.
  if not exists (select 1 from public.orgs where id = p_org) then
    return false;
  end if;
  insert into public.org_entitlements as e (
    org_id, tier_id, seats, status, valid_until, stripe_subscription_id,
    last_event_at, issued_at
  ) values (
    p_org, p_tier, coalesce(p_seats, 0), p_status, p_valid_until, p_stripe_subscription_id,
    p_event_at, now()
  )
  on conflict (org_id) do update
    set tier_id = excluded.tier_id,
        seats = excluded.seats,
        status = excluded.status,
        valid_until = excluded.valid_until,
        stripe_subscription_id = excluded.stripe_subscription_id,
        last_event_at = excluded.last_event_at,
        issued_at = now()
    where e.last_event_at is null or e.last_event_at < excluded.last_event_at;
  get diagnostics applied = row_count;
  if applied > 0 then
    update public.orgs set tier_id = coalesce(p_display_tier, 'personal') where id = p_org;
  end if;
  return applied > 0;
end;
$$;

revoke execute on function public.apply_user_entitlement_event(uuid, text, text, timestamptz, timestamptz, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.apply_org_entitlement_event(uuid, text, int, text, timestamptz, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_user_entitlement_event(uuid, text, text, timestamptz, timestamptz, text, text, text)
  to service_role;
grant execute on function public.apply_org_entitlement_event(uuid, text, int, text, timestamptz, text, timestamptz, text)
  to service_role;
