-- Review remediation, 2026-09-05 (CODE-REVIEW-FINDINGS-2026-09-05.md). One
-- migration for every schema change that pass asked for, each section labelled
-- with its finding id. Idempotent where Postgres allows it: functions are
-- create-or-replace, policies are dropped-then-created, grants are column
-- lists that can be re-run.
--
-- Sections:
--   P0-4  Email-keyed grants require a CONFIRMED email (claim_membership,
--         project_level, set_org_project_access).
--   BE-1  An admin can no longer enroll an arbitrary user_id into their org.
--   BE-5  A removed teammate loses shared-project access (project_level checks
--         for an active org_members row).
--   BE-6  Reviews: column-level grants and a status guard, so an author can
--         never write flag_count, status, or created_at.
--   BE-8  apply_*_entitlement_event: the last_event_at ordering guard moves
--         into one atomic statement (the comparison lives in the WHERE).
--   BE-10 org_vault_put refuses path traversal and oversized bodies.
--   BE-13 pg_cron retention for the two append-only ledgers.
--
-- Deploy ordering: apply BEFORE redeploying stripe-webhook, apple-notifications
-- and link-apple-purchase (they call the new apply_* RPCs) and BEFORE the app
-- build that drops `status` from the review payload (the column grant would
-- reject the old payload). Nothing here is destructive; every existing row is
-- kept as is.

-- ---------------------------------------------------------------- P0-4
-- Is the caller's email confirmed? SECURITY DEFINER so a plain authenticated
-- caller (who cannot read auth.users) can still be checked. auth.uid() is the
-- JWT subject, so this is resolved from the token, never from client input.
create or replace function public.auth_email_confirmed()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;
revoke execute on function public.auth_email_confirmed() from public, anon;
grant execute on function public.auth_email_confirmed() to authenticated, service_role;

-- claim_membership: bind invited seats to the caller ONLY when the JWT email
-- has been confirmed. With confirmations off a signup carrying a victim's email
-- would otherwise inherit every seat invited for that address. Returns 0 (not
-- an error) for an unconfirmed caller, so the app's sign-in path stays quiet.
create or replace function public.claim_membership()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed int;
begin
  if not public.auth_email_confirmed() then
    return 0;
  end if;
  update public.org_members m
    set user_id = auth.uid(), status = 'active'
    where lower(m.email) = lower(auth.email())
      and m.user_id is null
      and m.status = 'invited';
  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

-- ---------------------------------------------------------------- BE-5, P0-4
-- project_level now requires an ACTIVE org membership for the project's org
-- before any grant is honored (Vault already did this via is_org_member). A
-- teammate removed from the roster loses shared projects the same moment. The
-- email match on the grant row is honored only for a confirmed email (P0-4);
-- the user_id match needs no such check because user_id is bound only by
-- claim_membership and set_org_project_access, both confirmed-email paths.
create or replace function public.project_level(p_project uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_org uuid;
  v_level text;
  v_email text;
begin
  select org_id into v_org from public.org_projects where id = p_project;
  if v_org is null then
    return null;
  end if;
  if public.is_org_admin(v_org) or public.is_org_owner(v_org) then
    return 'edit';
  end if;
  if not public.is_org_member(v_org) then
    return null;
  end if;
  v_email := case
    when public.auth_email_confirmed() then lower(coalesce(auth.email(), ''))
    else ''
  end;
  select m.level into v_level
    from public.org_project_members m
    where m.project_id = p_project
      and (m.user_id = auth.uid() or (v_email <> '' and lower(m.email) = v_email))
    order by array_position(array['read', 'write', 'edit'], m.level) desc
    limit 1;
  return v_level;
end;
$$;

-- set_org_project_access: bind user_id at grant time only to a CONFIRMED
-- account holding that email. An unconfirmed signup with a teammate's address
-- must never be pre-bound to the teammate's grant.
create or replace function public.set_org_project_access(
  p_id uuid,
  p_email text,
  p_level text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if public.project_level(p_id) is distinct from 'edit' then
    raise exception 'need edit access to change who can use this project';
  end if;
  if v_email = '' or p_level not in ('read', 'write', 'edit') then
    raise exception 'a valid email and level are required';
  end if;
  select org_id into v_org from public.org_projects where id = p_id;
  if not exists (
    select 1 from public.org_members mm
    where mm.org_id = v_org and lower(mm.email) = v_email and mm.status <> 'revoked'
  ) then
    raise exception 'that email is not a member of this organization';
  end if;
  insert into public.org_project_members as m (project_id, email, level, granted_by, user_id)
  values (
    p_id, v_email, p_level, auth.uid(),
    (
      select u.id from auth.users u
      where lower(u.email) = v_email and u.email_confirmed_at is not null
      limit 1
    )
  )
  on conflict (project_id, lower(email)) do update
    set level = excluded.level, granted_by = auth.uid();
end;
$$;

-- ---------------------------------------------------------------- BE-1
-- org_members: an admin could insert a row carrying ANY user_id, enrolling a
-- stranger into their org (the victim's client then adopts that membership).
-- Two layers, like the orgs lockdown in 0005:
--   1. Split the single FOR ALL policy into insert / update / delete. The
--      INSERT check now allows user_id to be null (an invite, bound later by
--      claim_membership) or the caller's own uid (the owner's bootstrap row).
--      UPDATE cannot use that check (a role change on an already-bound member
--      carries the member's user_id), so user_id is made immutable by 2.
--   2. Column-level privileges: authenticated can never UPDATE user_id. Binding
--      stays in claim_membership (SECURITY DEFINER). The service role is
--      unaffected.
drop policy if exists members_write on public.org_members;
drop policy if exists members_insert on public.org_members;
drop policy if exists members_update on public.org_members;
drop policy if exists members_delete on public.org_members;

create policy members_insert on public.org_members for insert
  with check (
    (public.is_org_admin(org_id) or public.is_org_owner(org_id))
    and (user_id is null or user_id = auth.uid())
  );

create policy members_update on public.org_members for update
  using (public.is_org_admin(org_id) or public.is_org_owner(org_id))
  with check (public.is_org_admin(org_id) or public.is_org_owner(org_id));

create policy members_delete on public.org_members for delete
  using (public.is_org_admin(org_id) or public.is_org_owner(org_id));

-- The client writes exactly these columns (store.ts pushOrgToServer, the
-- invite, the role change). user_id is insertable (own uid or null, per the
-- policy) but never updatable from a client; org_id is never updatable either
-- (CTO ruling), so an admin cannot re-point an existing row into another org.
revoke insert, update on public.org_members from authenticated, anon;
grant insert (org_id, user_id, email, role, status, invited_by) on public.org_members to authenticated;
grant update (email, role, status, invited_by) on public.org_members to authenticated;
revoke update (user_id, org_id) on public.org_members from authenticated;

-- ---------------------------------------------------------------- BE-2
-- Seat ceilings were never enforced server-side: a $20 Micro entitlement
-- unlocked the app for an unbounded roster, and orgs.seat_count was
-- client-writable with no cap. Two SECURITY DEFINER triggers (the owner
-- inserting the bootstrap row cannot read org_entitlements under RLS, so the
-- trigger reads the truth itself) enforce the band of the ENTITLED tier.
--
-- The bands are hand-mirrored from _shared/entitlement.ts COMMERCIAL_BANDS and
-- app/src/lib/plans.ts COMMERCIAL_TIERS; app/test/entitlementDrift.test.ts
-- parses this file so the three copies cannot drift.
create or replace function public.tier_max_seats(p_tier text)
returns int
language sql
immutable
as $$
  select case p_tier
    when 'commercial_micro' then 5
    when 'commercial_small' then 30
    when 'commercial_mid' then 100
    when 'commercial_large' then null
    else 0
  end;
$$;

-- The ceiling for an org with NO entitlement row (a team still on the free
-- beta, or one whose subscription lapsed). Null = no ceiling for now, per the
-- founder's beta call (all pay gates off, DECISIONS.md 2026-08-31). The CFO
-- recommends flipping this to 5 (the Micro band) once billing is live; that is
-- a one-line 0016 replacing the body with `select 5`. The founder decides.
create or replace function public.no_entitlement_max_seats()
returns int
language sql
immutable
as $$
  select null::int;
$$;

-- The seat ceiling in force for an org right now: the entitled tier's band,
-- or the no-entitlement constant. Reads org_entitlements.status only (the
-- entitled set mirrors ENTITLED in _shared/entitlement.ts); orgs.tier_id is
-- display only and is never consulted.
create or replace function public.org_seat_ceiling(p_org uuid)
returns int
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_tier text;
  v_status text;
begin
  select tier_id, status into v_tier, v_status
    from public.org_entitlements where org_id = p_org;
  if v_tier is null or v_status not in ('active', 'trialing') then
    return public.no_entitlement_max_seats();
  end if;
  return public.tier_max_seats(v_tier);
end;
$$;
revoke execute on function public.org_seat_ceiling(uuid) from public, anon;
grant execute on function public.org_seat_ceiling(uuid) to authenticated, service_role;

-- Roster trigger: a new or re-activated member must fit under the ceiling.
-- Existing rows are grandfathered on a downgrade (only the arriving row is
-- refused). Revoked rows do not count and are never refused.
create or replace function public.enforce_org_member_ceiling()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int;
  v_count int;
begin
  if new.status = 'revoked' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'revoked' and old.org_id = new.org_id then
    -- Already counted; a role or email change never trips the ceiling.
    return new;
  end if;
  v_max := public.org_seat_ceiling(new.org_id);
  if v_max is null then
    return new;
  end if;
  select count(*) into v_count
    from public.org_members m
    where m.org_id = new.org_id and m.status <> 'revoked' and m.id <> new.id;
  if v_count + 1 > v_max then
    raise exception 'this plan covers % seats; add a seat or upgrade before inviting more', v_max
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists org_member_ceiling on public.org_members;
create trigger org_member_ceiling
  before insert or update on public.org_members
  for each row execute function public.enforce_org_member_ceiling();

-- Seat trigger: orgs.seat_count stays client-writable (the seat picker) but
-- can no longer exceed the entitled band.
create or replace function public.enforce_org_seat_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int;
begin
  if new.seat_count is not distinct from old.seat_count then
    return new;
  end if;
  v_max := public.org_seat_ceiling(new.id);
  if v_max is not null and new.seat_count > v_max then
    raise exception 'this plan covers % seats; upgrade before adding more', v_max
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists org_seat_count_ceiling on public.orgs;
create trigger org_seat_count_ceiling
  before update on public.orgs
  for each row execute function public.enforce_org_seat_count();

-- ---------------------------------------------------------------- BE-4
-- apple_links keeps the subscription's live state so link-apple-purchase can
-- refuse a replayed purchase-time JWS after a refund (option (a), CTO ruling).
-- apple-notifications writes these by original_transaction_id on every event;
-- link-apple-purchase refuses a JWS not newer than last_event_at, never grants
-- on a revoked or refunded link, and refuses any JWS older than 48 hours.
-- Follow-up: live status from the App Store Server API (the .p8 the README
-- reserves) closes the remaining window between events.
alter table public.apple_links add column if not exists status text;
alter table public.apple_links add column if not exists valid_until timestamptz;
alter table public.apple_links add column if not exists last_event_at timestamptz;
alter table public.apple_links drop constraint if exists apple_links_status_check;
alter table public.apple_links add constraint apple_links_status_check
  check (status is null or status in ('active', 'expired', 'revoked', 'refunded'));

-- ---------------------------------------------------------------- BE-6
-- Reviews: the 0011 grants were table-wide, so an author could insert with
-- flag_count = -1000000 (defeating the auto-hide threshold), set status, or
-- backdate created_at. Column lists close all three; the moderation trigger
-- and the admin RPCs are SECURITY DEFINER, so they keep writing those columns.
-- The UPDATE policy also requires the row to still be visible: a hidden or
-- reported review cannot be edited (or re-submitted through the upsert) by its
-- author, so it can never un-hide itself.
revoke insert, update on public.model_reviews from authenticated, anon;
grant insert (user_id, model_id, rating, body, use_cases, hardware, ram_gb,
              tokens_per_sec, quant, felt_speed, updated_at)
  on public.model_reviews to authenticated;
grant update (rating, body, use_cases, hardware, ram_gb, tokens_per_sec, quant,
              felt_speed, updated_at)
  on public.model_reviews to authenticated;

drop policy if exists model_reviews_update on public.model_reviews;
create policy model_reviews_update on public.model_reviews for update
  using (auth.uid() = user_id and status = 'visible')
  with check (auth.uid() = user_id and status = 'visible');

-- ---------------------------------------------------------------- BE-8
-- The ordering guard on both entitlement tables was read-then-write in the
-- edge functions, so two parallel deliveries could let the older event land
-- last. These RPCs do the compare and the write in ONE statement: the row is
-- touched only when its last_event_at is older than the incoming event. They
-- return true when the write landed, false when the event was stale. Service
-- role only; a client can never call them.
--
-- Columns that belong to the other rail are preserved (coalesce), matching the
-- old upserts that wrote only the columns they owned.
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

-- The org twin also moves orgs.tier_id (display only) in the same transaction,
-- so the two can never disagree after a half-failed webhook.
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

-- ---------------------------------------------------------------- BE-10
-- A vault path is a vault-relative POSIX path. The export writes it under
-- Documents/Vault/<path> recursively, so a teammate storing "../../x.md" could
-- reach outside the vault folder on every member's device. Refuse traversal
-- and anything a filesystem would misread; cap a body at 1 MiB (a note, not an
-- attachment store).
create or replace function public.org_vault_path_ok(p_path text)
returns boolean
language sql
immutable
as $$
  select p_path is not null
    and btrim(p_path) <> ''
    and char_length(p_path) <= 512
    and left(p_path, 1) <> '/'
    and position(E'\\' in p_path) = 0
    and not ('..' = any (string_to_array(p_path, '/')))
    and not ('.' = any (string_to_array(p_path, '/')))
    and not ('' = any (string_to_array(p_path, '/')));
$$;
grant execute on function public.org_vault_path_ok(text) to authenticated;

create or replace function public.org_vault_put(
  p_org uuid,
  p_path text,
  p_body text,
  p_base_rev bigint
) returns public.org_vault_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.org_vault_notes;
  result public.org_vault_notes;
  conflict_path text;
begin
  if p_org is null or coalesce(btrim(p_path), '') = '' then
    raise exception 'org and path are required';
  end if;
  if not public.org_vault_path_ok(p_path) then
    raise exception 'that note path is not allowed';
  end if;
  if octet_length(coalesce(p_body, '')) > 1048576 then
    raise exception 'a note is limited to 1 MB';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this org';
  end if;

  select * into existing
    from public.org_vault_notes
    where org_id = p_org and path = p_path
    for update;

  if existing.path is not null
     and not existing.deleted
     and existing.rev is distinct from p_base_rev
     and existing.body is distinct from p_body then
    -- Preserve the soon-to-be-overwritten body as its own note so nothing is
    -- lost. A repeat clash in the same minute folds onto the same copy.
    conflict_path := regexp_replace(p_path, '\.md$', '', 'i')
      || ' (conflict ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24MI') || ').md';
    insert into public.org_vault_notes as n (org_id, path, body, updated_at, updated_by, rev)
    values (p_org, conflict_path, existing.body, now(), existing.updated_by, 1)
    on conflict (org_id, path) do update
      set body = excluded.body,
          updated_at = now(),
          updated_by = excluded.updated_by,
          rev = n.rev + 1,
          deleted = false;
  end if;

  insert into public.org_vault_notes as n (org_id, path, body, updated_at, updated_by, rev, deleted)
  values (p_org, p_path, p_body, now(), auth.uid(), 1, false)
  on conflict (org_id, path) do update
    set body = excluded.body,
        updated_at = now(),
        updated_by = auth.uid(),
        rev = n.rev + 1,
        deleted = false
  returning * into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------- BE-13
-- The two ledgers are append-only and read only for dedupe within minutes
-- (apple_notifications_seen) or hours (push_sends), so anything older than 30
-- days is dead weight. Weekly delete through pg_cron, guarded so this
-- migration still applies where pg_cron is absent (local dev, a project where
-- the extension is not enabled): it prints a notice instead of failing, and
-- the README tells the founder how to enable it.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be enabled here (%). Enable it in the dashboard, then re-run this block.', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'oscode_ledger_retention') then
      perform cron.unschedule('oscode_ledger_retention');
    end if;
    perform cron.schedule(
      'oscode_ledger_retention',
      '17 3 * * 0',
      $job$
        delete from public.apple_notifications_seen where received_at < now() - interval '30 days';
        delete from public.push_sends where created_at < now() - interval '30 days';
      $job$
    );
  else
    raise notice 'pg_cron is not installed; ledger retention was not scheduled (see supabase/README.md).';
  end if;
end $$;
