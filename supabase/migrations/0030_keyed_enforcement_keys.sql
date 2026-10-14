-- 0030: the tombstone and deletion-hold keys are keyed hashes (security and
-- privacy review 2026-10-01, follow-up 4).
--
-- 0022 stored a terminated account's tombstone under SHA-256 of its email,
-- and a legal-hold copy under SHA-256 of the account id. Anyone holding a copy
-- of either table could test a known address or id against them. From here
-- both are HMAC-SHA256 under the Vault key 0019 already keeps
-- (guardrail_hmac_key), each with its own domain prefix, so a value from one
-- table never matches the other or a guardrail fingerprint, and no new secret
-- is needed.
--
-- Rows written before this file cannot be re-keyed (the address and the id
-- are gone with the account), so every reader checks both forms until they
-- age out: a tombstone after two years from its termination (0026), a hold
-- at its hold_until (0019). The next tombstone write for the same address
-- folds an old row into a keyed one.
--
-- UNAPPLIED. It lands on main for the founder's push through
-- docs/vault-gate1-runbook.md, after supabase/scripts/push-preflight.mjs; that
-- push appends its history row. It needs guardrail_hmac_key in Supabase Vault,
-- which production has had since 0019.
--
-- Nothing applied is edited: every function here is `create or replace`.
-- Every statement is safe to run again.

-- ---------------------------------------------------------------- 1. the keys
-- HMAC-SHA256 hex of `<domain>:<value>` under the Vault key. SECURITY DEFINER
-- to read vault.decrypted_secrets; no client role may call it. pgcrypto (0001)
-- lives in the extensions schema on Supabase, hence the path.
create or replace function public.enforcement_keyed_hash(p_domain text, p_value text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
begin
  if p_value is null or p_value = '' then
    return null;
  end if;
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'guardrail_hmac_key'
   limit 1;
  if v_key is null or length(v_key) = 0 then
    raise exception 'guardrail_hmac_key is missing from Supabase Vault. Create it (see migration 0019) first.';
  end if;
  return encode(hmac(p_domain || ':' || p_value, v_key, 'sha256'), 'hex');
end;
$$;
revoke execute on function public.enforcement_keyed_hash(text, text) from public, anon, authenticated;

-- The tombstone key: the address with ASCII letters lowercased, as 0022 did,
-- now keyed. Every writer and reader of a tombstone goes through it.
create or replace function public.enforcement_email_key(p_email text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.enforcement_keyed_hash('enforcement-email', lower(p_email collate "C"));
end;
$$;
revoke execute on function public.enforcement_email_key(text) from public, anon, authenticated;

-- 0022's plain key, read only to find a row written before this file.
create or replace function public.enforcement_email_legacy_key(p_email text)
returns text
language sql
stable
as $$
  select case
    when p_email is null or p_email = '' then null
    else encode(sha256(convert_to(lower(p_email collate "C"), 'UTF8')), 'hex')
  end;
$$;
revoke execute on function public.enforcement_email_legacy_key(text) from public, anon, authenticated;

-- The legal-hold copy's key for an account id.
create or replace function public.deletion_hold_key(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.enforcement_keyed_hash('deletion-hold', p_user::text);
end;
$$;
revoke execute on function public.deletion_hold_key(uuid) from public, anon, authenticated;
grant execute on function public.deletion_hold_key(uuid) to service_role;

-- ---------------------------------------------------------------- 2. the ladder
-- 0022's record_enforcement, with the tombstone matched under either key.
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

-- ---------------------------------------------------------------- 3. export
-- 0026's export_my_data, with the tombstone matched under either key (the
-- later one, should both stand).
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
    -- By email, only rows nobody has claimed: a row bound to another account
    -- under this address is theirs (0022 6d keeps it on deletion, and access
    -- follows user_id), so it is not in this person's export.
    'org_memberships', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.org_members t
       where t.user_id = v_uid
          or (t.user_id is null and v_confirmed is not null and lower(t.email) = v_confirmed)
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
                    or (m.user_id is null and v_confirmed is not null
                        and lower(m.email) = v_confirmed))
          )
    ), '[]'::jsonb),
    'org_project_members', coalesce((
      select jsonb_agg(to_jsonb(t)) from public.org_project_members t
       where t.user_id = v_uid
          or (t.user_id is null and v_confirmed is not null and lower(t.email) = v_confirmed)
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
    -- Keyed on the account's own confirmed address, like every other email
    -- match here: an unconfirmed sign-up learns nothing about an address.
    'enforcement_tombstone', (
      select jsonb_build_object('level', t.level, 'terminated_at', t.terminated_at)
        from public.enforcement_tombstones t
       where v_confirmed is not null
         and t.email_sha256 in (public.enforcement_email_key(v_confirmed),
                                public.enforcement_email_legacy_key(v_confirmed))
       order by t.terminated_at desc
       limit 1
    ),
    'review_staff', exists (
      select 1 from public.review_staff s where s.user_id = v_uid
    ),
    'push_sends', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.push_sends t
       where t.user_id = v_uid
    ), '[]'::jsonb),
    'likeness_consents', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.asserted_at, t.id) from public.likeness_consents t
       where t.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.export_my_data () from public, anon;
grant execute on function public.export_my_data () to authenticated;

revoke execute on function public.export_my_data () from public, anon;
grant execute on function public.export_my_data () to authenticated;

-- ---------------------------------------------------------------- 4. deletion
-- 0022's account_deletion_hold (6a), with the keyed id.
create or replace function public.account_deletion_hold(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_events jsonb;
  v_actions jsonb;
  v_until timestamptz;
  v_rows jsonb;
  v_n integer;
begin
  if p_user is null then
    raise exception 'no account named';
  end if;
  v_key := public.deletion_hold_key(p_user);
  -- One copy at a time for this account, so two taps cannot both insert.
  perform pg_advisory_xact_lock(hashtextextended('account_deletion_hold:' || v_key, 0));

  select coalesce(jsonb_agg(to_jsonb(g) - 'user_id' order by g.created_at, g.id), '[]'::jsonb),
         max(g.legal_hold_until)
    into v_events, v_until
    from public.guardrail_events g
   where g.user_id = p_user and g.legal_hold_until > now();
  select coalesce(jsonb_agg(to_jsonb(e) - 'user_id' order by e.created_at, e.id), '[]'::jsonb),
         greatest(v_until, max(e.legal_hold_until))
    into v_actions, v_until
    from public.enforcement_actions e
   where e.user_id = p_user and e.legal_hold_until > now();

  v_n := jsonb_array_length(v_events) + jsonb_array_length(v_actions);
  if v_n = 0 then
    return 0;
  end if;
  v_rows := jsonb_build_object('guardrail_events', v_events, 'enforcement_actions', v_actions);
  insert into public.deletion_holds (user_id_sha256, held_rows, hold_until)
  select v_key, v_rows, v_until
   where not exists (
     select 1 from public.deletion_holds d
      where d.user_id_sha256 = v_key and d.held_rows = v_rows);
  return v_n;
end;
$$;

-- 0022's account_deletion_tombstone (6c), writing the keyed address. A row
-- under the old key for the same address is folded in: it goes, and the
-- keyed row keeps the later of the two terminations' times.
create or replace function public.account_deletion_tombstone(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_key text;
  v_at timestamptz;
  v_old timestamptz;
begin
  if p_user is null then
    raise exception 'no account named';
  end if;
  select u.email into v_email
    from auth.users u
   where u.id = p_user;
  v_key := public.enforcement_email_key(v_email);
  select max(e.created_at) into v_at
    from public.enforcement_actions e
   where e.user_id = p_user and e.action = 'terminate' and e.actor <> 'system';
  if v_key is null or v_at is null then
    return false;
  end if;
  delete from public.enforcement_tombstones t
   where t.email_sha256 = public.enforcement_email_legacy_key(v_email)
  returning t.terminated_at into v_old;
  insert into public.enforcement_tombstones as t (email_sha256, level, terminated_at)
  values (v_key, 2, greatest(v_at, v_old))
  on conflict (email_sha256) do update
    set terminated_at = greatest(t.terminated_at, excluded.terminated_at);
  return true;
end;
$$;

revoke execute on function public.account_deletion_hold(uuid) from public, anon, authenticated;
revoke execute on function public.account_deletion_tombstone(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_hold(uuid) to service_role;
grant execute on function public.account_deletion_tombstone(uuid) to service_role;

comment on column public.enforcement_tombstones.email_sha256 is
  'HMAC-SHA256 hex of the lowercased address under guardrail_hmac_key (0030); rows from before 0030 hold its plain SHA-256 until they age out.';
comment on column public.deletion_holds.user_id_sha256 is
  'HMAC-SHA256 hex of the account id under guardrail_hmac_key (0030); rows from before 0030 hold its plain SHA-256 until hold_until.';
