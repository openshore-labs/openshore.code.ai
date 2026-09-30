-- Account deletion (Apple 5.1.1(v); next build E1, review finding 12; CTO
-- ruling 4, 2026-09-29). The delete-account edge function erases a person's
-- account with auth.admin.deleteUser. Three things stood in its way or would
-- have been lost with it, and this file fixes each:
--
--   1. Five author columns pointed at auth.users with the default `no action`,
--      so deleting anyone who ever invited a teammate, edited a shared
--      project, granted access, or wrote a team note failed with a foreign key
--      error. They become `on delete set null`: the team keeps the row, and
--      the name of who wrote it goes with the account. Production's 0019
--      (0019_account_deletion_and_guardrail_retention.sql, applied
--      2026-09-24) already set these five keys to set null by their default
--      names, so on production this loop changes nothing. It is kept because
--      it finds the keys by catalog, and so still catches a key made in the
--      dashboard under another name.
--   2. enforcement_actions cascades with the account, so a person an operator
--      terminated could delete the account and sign up again with the same
--      email to a clean ladder. enforcement_tombstones keeps one row per such
--      email (a SHA-256 of the lowercased address, never the address), written
--      before the account goes, and record_enforcement reads it as an
--      operator's termination. Only an operator's confirmed termination
--      (action 'terminate', actor not 'system', the test record_enforcement
--      already uses) leaves one, and only at level 2 (CTO 11): an automatic
--      termination or a warning never follows a person to a new account. A
--      tombstone carries the time of the termination it stands for, never the
--      time of the deletion, so the retention job (0026) ends it two years
--      after that termination, the same bound enforcement actions have.
--   3. org_vault_revisions is append-only, so the function could not clear the
--      departing author's id from team history. The immutability trigger now
--      lets exactly one update through: updated_by set to null, every other
--      column unchanged.
--   4. The deletion's own writes, as service-role functions the function
--      calls (section 6; CTO 11 package C): the legal-hold copy into 0019's
--      deletion_holds, safe to repeat; the owned-team delete that removes a
--      team only when nobody else is active in it, in one statement; the
--      tombstone; and the removal of the person's memberships and project
--      grants by id and, for rows nobody has claimed, by confirmed email.
--
-- And from the backend review: abuse_reports.request_hash gets the same
-- 64-hex check guardrail_events has, and one report per (account, hash). The
-- unique index on (user_id, request_hash) makes a repeated queue_abuse_report
-- call for the same account and hash raise 23505; the app does not call it
-- today.
--
-- Numbering (CTO 11, 2026-09-29): production holds 0019 and 0020 as the
-- privacy branch's files (account deletion and guardrail retention, and the
-- reviews public view), and org_vault_v1 moved to 0021. Neither privacy file
-- touches the revisions trigger, and this file's record_enforcement
-- supersedes 0019's on purpose: it keeps 0019's appeal address and adds the
-- tombstone and the qualified columns.
--
-- Deploy ordering: apply BEFORE deploying the delete-account function (it
-- calls section 6's functions and clears org_vault_revisions.updated_by).
-- Production's 2026-09-24 delete-account calls none of them and keeps working
-- after this file.
-- Additive except the abuse_reports dedupe, which removes only a queued report
-- that repeats another row for the same account and hash, and never a report
-- an operator acted on.

-- ---------------------------------------------------------------- 1. authors
-- Found by catalog, not by name: an inline `references auth.users` is
-- auto-named <table>_<column>_fkey, but a constraint made by hand in the
-- dashboard could carry any name, and dropping the wrong one would leave the
-- `no action` key in place. Each column loses every foreign key it has to
-- auth.users that is not already set null, then gains the named set-null one.
-- Re-running is a no-op.
do $$
declare
  r record;
  v_con text;
begin
  for r in
    select * from (values
      ('org_members', 'invited_by'),
      ('org_vault_notes', 'updated_by'),
      ('org_projects', 'created_by'),
      ('org_projects', 'updated_by'),
      ('org_project_members', 'granted_by')
    ) as t (tbl, col)
  loop
    for v_con in
      select c.conname
        from pg_constraint c
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.conrelid = format('public.%I', r.tbl)::regclass
         and c.contype = 'f'
         and c.confrelid = 'auth.users'::regclass
         and a.attname = r.col
         and c.confdeltype <> 'n'
    loop
      execute format('alter table public.%I drop constraint %I', r.tbl, v_con);
    end loop;

    if not exists (
      select 1
        from pg_constraint c
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.conrelid = format('public.%I', r.tbl)::regclass
         and c.contype = 'f'
         and c.confrelid = 'auth.users'::regclass
         and a.attname = r.col
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references auth.users (id) on delete set null',
        r.tbl, r.tbl || '_' || r.col || '_fkey', r.col);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- 2. tombstones
-- One row per email whose account an operator terminated, kept after the
-- account is deleted. Only a hash is stored: the tombstone recognizes the same
-- address signing up again and can say nothing else about it. `level` is
-- always 2, a termination (CTO 11: a level 1 tombstone would be data with no
-- use, since a warning never follows a person). `terminated_at` is when the
-- operator confirmed the termination it carries (that enforcement action's
-- own created_at), never when the account was deleted, and a later write
-- never moves it to the time of the write; retention counts two years from it.
create table if not exists public.enforcement_tombstones (
  email_sha256 text primary key check (email_sha256 ~ '^[0-9a-f]{64}$'),
  level smallint not null default 2 check (level = 2),
  terminated_at timestamptz not null
);

-- Service role only (account_deletion_tombstone, section 6, writes it;
-- record_enforcement reads it as its owner). RLS on with no policies denies
-- every client, and the client roles hold no privileges either.
alter table public.enforcement_tombstones enable row level security;
revoke all on public.enforcement_tombstones from anon, authenticated;

-- The key the tombstone is stored under: SHA-256 hex of the address with
-- ASCII letters lowercased. `collate "C"` keeps lower() to ASCII whatever the
-- database locale, so every writer and reader of a tombstone (section 6's
-- account_deletion_tombstone, record_enforcement, 0026's export) keys the
-- same address the same way. Postgres 11+ has sha256() built in, so no
-- extension schema is involved.
create or replace function public.enforcement_email_key(p_email text)
returns text
language sql
stable
as $$
  select case
    when p_email is null or p_email = '' then null
    else encode(sha256(convert_to(lower(p_email collate "C"), 'UTF8')), 'hex')
  end;
$$;
revoke execute on function public.enforcement_email_key(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. the ladder
-- 0018's record_enforcement with two changes, and the one published appeal
-- address (support@openshore.ai, founder decision F1 of 2026-09-30, after its
-- round-trip test; 0019 had os-code@openshorellc.com until then).
--
-- A tombstone for the caller's email counts as an operator's termination, so
-- an account an operator terminated does not come back to a clean ladder
-- under the same address. The automatic termination this writes for such an
-- account is actor 'system', so deleting that account leaves no new
-- tombstone: the ban ends two years after the operator's own decision.
--
-- And every column is qualified by its table. The function returns a column
-- named `action`, which PL/pgSQL makes a variable, so 0016 to 0019's bare
-- `action = 'blocked'` was ambiguous and every call raised before it wrote
-- anything: the server-side ladder has never recorded a row. (The app's call
-- swallows the error, lib/ethics.ts postRecord.) The pgTAP test in
-- tests/account_deletion.test.sql now calls it.
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
     where t.email_sha256 = public.enforcement_email_key(auth.email())
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

-- ---------------------------------------------------------------- 4. history
-- 0021's append-only rule, with the one exception deletion needs: clearing
-- who wrote a revision. Anything else (a body, a path, a rev, or setting an
-- author rather than clearing one) is still refused for every role.
create or replace function public.org_vault_revisions_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.updated_by is not null
     and new.updated_by is null
     and (new.id, new.org_id, new.path, new.rev, new.body, new.deleted,
          new.updated_at, new.reason, new.recorded_at)
         is not distinct from
         (old.id, old.org_id, old.path, old.rev, old.body, old.deleted,
          old.updated_at, old.reason, old.recorded_at) then
    return new;
  end if;
  raise exception 'org_vault_revisions is append-only';
end;
$$;

revoke execute on function public.org_vault_revisions_immutable() from public, anon, authenticated;

-- ---------------------------------------------------------------- 5. abuse_reports
-- request_hash is a SHA-256 hex everywhere it is written by the server.
-- queue_abuse_report is already checked and keyed by production's 0019, so
-- this column check is the backstop for a service-role write. The check
-- lands NOT VALID so a stray old row cannot stop this migration; it is
-- validated at once when every existing row already passes, and every new row
-- is checked either way.
alter table public.abuse_reports
  drop constraint if exists abuse_reports_request_hash_check;
alter table public.abuse_reports
  add constraint abuse_reports_request_hash_check
  check (request_hash ~ '^[0-9a-f]{64}$') not valid;

do $$
begin
  if exists (select 1 from public.abuse_reports where request_hash !~ '^[0-9a-f]{64}$') then
    raise notice 'abuse_reports has rows whose request_hash is not 64 hex characters; the check covers new rows only until they are fixed.';
  else
    alter table public.abuse_reports validate constraint abuse_reports_request_hash_check;
  end if;
end $$;

-- One report per account and hash. A queued report that repeats another row
-- for the same pair is the only thing removed (it says nothing the kept row
-- does not); a submitted or not-submitted report records what an operator
-- did and is never removed, so if two of those collide the index waits with a
-- notice. Rows whose account was deleted (user_id null) never collide.
delete from public.abuse_reports r
 using (
   select id,
          row_number() over (
            partition by user_id, request_hash
            order by case status when 'submitted' then 0 when 'not-submitted' then 1 else 2 end,
                     created_at, id
          ) as n
     from public.abuse_reports
    where user_id is not null
 ) d
 where r.id = d.id and d.n > 1 and r.status = 'queued';

do $$
begin
  if exists (
    select 1 from public.abuse_reports
     where user_id is not null
     group by user_id, request_hash
    having count(*) > 1
  ) then
    raise notice 'abuse_reports has repeated (user_id, request_hash) rows an operator acted on; the unique index was not created (see supabase/README.md).';
  else
    create unique index if not exists abuse_reports_user_hash_idx
      on public.abuse_reports (user_id, request_hash);
  end if;
end $$;

-- ---------------------------------------------------------------- 6. the deletion's writes
-- What delete-account (supabase/functions/delete-account) does to the
-- database before auth.admin.deleteUser, in the order it calls them. Each is
-- SECURITY DEFINER for the service role alone, takes the account's id from the
-- function (which resolved it from the caller's own token), and is safe to
-- run again, so a deletion that stops partway is finished by trying again.

-- 6a. The legal-hold copy (0019's deletion_holds, CTO 11 package C). Rows of
-- guardrail_events and enforcement_actions still under a legal hold
-- (legal_hold_until in the future, which 0019's trigger sets when a report is
-- submitted, 18 U.S.C. 2258A(h)) would cascade with the account; they are
-- copied first, without the user id, under a SHA-256 of it, in the shape the
-- 2026-09-24 function wrote: { "guardrail_events": [...],
-- "enforcement_actions": [...] }, held until the latest of their holds. Called
-- after the owned teams go (6b; deleting a team touches no held row) and
-- before anything under a hold is deleted. A second call with the same held
-- rows adds nothing; a call after the held rows changed adds the newer copy
-- beside the older one and never edits or removes either. Returns how many rows are
-- under hold (0 when none, and then nothing is written).
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
  v_key := encode(sha256(convert_to(p_user::text, 'UTF8')), 'hex');
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

-- 6b. The owned-team delete (the interaction review's finding (b)). Deletes
-- the named teams this account owns, and only when nobody else is active in
-- any of them: all or none. The check and the delete are one statement, after
-- the teams' rows and their member rows are locked, so an invite that turns
-- active, or a member added, while the account is being deleted either lands
-- before the check (and stops the delete) or waits and finds the team gone.
-- An active row with no user id (its person's account was deleted) is nobody.
-- A team named here that this account no longer owns (support handed it over
-- after delete-account read the plan) stops the delete too, so all or none
-- holds for every team named, not only the ones still owned.
-- Returns the ids it deleted, as one array; delete-account answers owns_org
-- when fewer come back than it planned, and then nothing was deleted.
create or replace function public.account_deletion_orgs(p_owner uuid, p_orgs uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gone uuid[];
begin
  if p_owner is null or p_orgs is null or cardinality(p_orgs) = 0 then
    return '{}'::uuid[];
  end if;
  perform 1 from public.orgs o
   where o.id = any (p_orgs) and o.owner_uid = p_owner
   order by o.id
     for update;
  perform 1 from public.org_members m
   where m.org_id = any (p_orgs)
   order by m.id
     for update;
  if (select count(*) from public.orgs o where o.id = any (p_orgs) and o.owner_uid = p_owner)
     <> (select count(distinct x) from unnest(p_orgs) as x) then
    return '{}'::uuid[];
  end if;
  with gone as (
    delete from public.orgs o
     where o.id = any (p_orgs)
       and o.owner_uid = p_owner
       and not exists (
         select 1 from public.org_members m
          where m.org_id = any (p_orgs)
            and m.status = 'active'
            and m.user_id is not null
            and m.user_id <> p_owner)
    returning o.id)
  select coalesce(array_agg(gone.id order by gone.id), '{}'::uuid[]) into v_gone from gone;
  return v_gone;
end;
$$;

-- 6c. The tombstone. Written only when an operator confirmed a termination
-- of this account (action 'terminate', actor not 'system', the test
-- record_enforcement uses), at level 2, carrying that termination's own
-- time. An automatic termination (actor 'system', including the one a
-- tombstone itself causes on a returning account) and a warning write
-- nothing. A second write for the same email keeps the later of the two
-- terminations' times and never takes the time of the write. Called while the
-- enforcement record still exists. Returns whether a tombstone now stands for
-- this account's email.
create or replace function public.account_deletion_tombstone(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_at timestamptz;
begin
  if p_user is null then
    raise exception 'no account named';
  end if;
  select public.enforcement_email_key(u.email) into v_key
    from auth.users u
   where u.id = p_user;
  select max(e.created_at) into v_at
    from public.enforcement_actions e
   where e.user_id = p_user and e.action = 'terminate' and e.actor <> 'system';
  if v_key is null or v_at is null then
    return false;
  end if;
  insert into public.enforcement_tombstones as t (email_sha256, level, terminated_at)
  values (v_key, 2, v_at)
  on conflict (email_sha256) do update
    set terminated_at = greatest(t.terminated_at, excluded.terminated_at);
  return true;
end;
$$;

-- 6d. Memberships and project grants (the interaction review's finding (c);
-- CX: erase the email). Every org_members and org_project_members row bound to
-- this account, and every row nobody has claimed yet (user_id null) under the
-- account's confirmed email, matched as claim_membership and export_my_data
-- match it (lower(email), and only a confirmed address). A row bound to
-- someone else is theirs and stays, whatever its email says. Returns how many
-- rows it removed.
create or replace function public.account_deletion_memberships(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_confirmed text;
  v_members integer;
  v_grants integer;
begin
  if p_user is null then
    raise exception 'no account named';
  end if;
  select case when u.email_confirmed_at is not null and u.email <> '' then lower(u.email) end
    into v_confirmed
    from auth.users u
   where u.id = p_user;

  delete from public.org_members m
   where m.user_id = p_user
      or (m.user_id is null and v_confirmed is not null and lower(m.email) = v_confirmed);
  get diagnostics v_members = row_count;
  delete from public.org_project_members g
   where g.user_id = p_user
      or (g.user_id is null and v_confirmed is not null and lower(g.email) = v_confirmed);
  get diagnostics v_grants = row_count;
  return v_members + v_grants;
end;
$$;

revoke execute on function public.account_deletion_hold(uuid) from public, anon, authenticated;
revoke execute on function public.account_deletion_orgs(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.account_deletion_tombstone(uuid) from public, anon, authenticated;
revoke execute on function public.account_deletion_memberships(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_hold(uuid) to service_role;
grant execute on function public.account_deletion_orgs(uuid, uuid[]) to service_role;
grant execute on function public.account_deletion_tombstone(uuid) to service_role;
grant execute on function public.account_deletion_memberships(uuid) to service_role;
