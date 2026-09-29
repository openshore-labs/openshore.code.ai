-- Account deletion (Apple 5.1.1(v); next build E1, review finding 12; CTO
-- ruling 4, 2026-09-29). The delete-account edge function erases a person's
-- account with auth.admin.deleteUser. Three things stood in its way or would
-- have been lost with it, and this file fixes each:
--
--   1. Five author columns pointed at auth.users with the default `no action`,
--      so deleting anyone who ever invited a teammate, edited a shared
--      project, granted access, or wrote a team note failed with a foreign key
--      error. They become `on delete set null`: the team keeps the row, and
--      the name of who wrote it goes with the account.
--   2. enforcement_actions cascades with the account, so a terminated person
--      could delete the account and sign up again with the same email to a
--      clean ladder. enforcement_tombstones keeps one row per email (a SHA-256
--      of the lowercased address, never the address), written by the function
--      before the account goes, and record_enforcement reads a level 2
--      tombstone as an operator's termination.
--   3. org_vault_revisions is append-only, so the function could not clear the
--      departing author's id from team history. The immutability trigger now
--      lets exactly one update through: updated_by set to null, every other
--      column unchanged.
--
-- And from the backend review: abuse_reports.request_hash gets the same
-- 64-hex check guardrail_events has, and one report per (account, hash).
--
-- Numbering (CTO ruling 4): 0020 and 0021 are held on vault-m2-team, which
-- renumbers above main's newest file when it merges. Neither held file adds an
-- auth.users foreign key or touches record_enforcement or the revisions
-- trigger, so this file composes with them in either order.
--
-- Deploy ordering: apply BEFORE deploying the delete-account function (it
-- writes enforcement_tombstones and clears org_vault_revisions.updated_by).
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
-- One row per email that ever carried a warning or a termination, kept after
-- the account is deleted. Only a hash is stored: the tombstone recognizes the
-- same address signing up again and can say nothing else about it. `level` is
-- the highest the ladder reached (1 warn, 2 terminate).
create table if not exists public.enforcement_tombstones (
  email_sha256 text primary key check (email_sha256 ~ '^[0-9a-f]{64}$'),
  level smallint not null check (level between 1 and 2),
  recorded_at timestamptz not null default now()
);

-- Service role only (the delete-account function writes it; record_enforcement
-- reads it as its owner). RLS on with no policies denies every client, and the
-- client roles hold no privileges either.
alter table public.enforcement_tombstones enable row level security;
revoke all on public.enforcement_tombstones from anon, authenticated;

-- The key the tombstone is stored under: SHA-256 hex of the address with
-- ASCII letters lowercased. `collate "C"` keeps lower() to ASCII whatever the
-- database locale, so this matches the edge function's emailSha256
-- (_shared/accountDeletion.ts) byte for byte. Postgres 11+ has sha256()
-- built in, so no extension schema is involved.
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
-- 0018's record_enforcement with two changes.
--
-- A level 2 tombstone for the caller's email counts as an operator's
-- termination, so an account deleted while terminated does not come back to
-- a clean ladder under the same address. A level 1 tombstone (a warning) is
-- recorded but not enforced here: a warning does not follow a person to a new
-- account.
--
-- And every column is qualified by its table. The function returns a column
-- named `action`, which PL/pgSQL makes a variable, so 0016 to 0018's bare
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
-- 0019's append-only rule, with the one exception deletion needs: clearing
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
-- request_hash is a SHA-256 hex everywhere it is written by the server, but
-- queue_abuse_report took it from the client unchecked. The check lands NOT
-- VALID so a stray old row cannot stop this migration; it is validated at
-- once when every existing row already passes, and every new row is checked
-- either way.
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
