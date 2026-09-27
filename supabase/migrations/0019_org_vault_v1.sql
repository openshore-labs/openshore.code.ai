-- Org Vault v1 (Vault M2, plan item 2.3; CTO ruling G3, 2026-09-27).
--
-- The team vault gets compare-and-swap like every other writable provider,
-- keeps what a write displaces, and stops losing notes in the three ways the
-- v1 review found (orgvault-3, -4, -7, -8, -18, truth-3):
--
--   1. Revs never repeat. Every write takes its rev from one sequence that
--      starts far above any rev 0010 ever handed out, so a note deleted and
--      re-created can never match an old base.
--   2. An append-only org_vault_revisions table keeps the DISPLACED version on
--      a teammate's overwrite, on an overwrite of anything older than ten
--      minutes, and on every delete and rename. Same-author autosave inside
--      ten minutes leaves no row, or every keystroke burst would store 1 MB.
--   3. Paths are unique per org under lower(path) among live notes. Existing
--      case duplicates are renamed first, losslessly (below).
--   4. size is the body's length in BYTES (octet_length), as the seam says.
--   5. Every RPC takes one advisory lock per (org, lower(path)), which covers
--      the first-create race and choosing a conflict name. The unique index
--      is the backstop: a unique_violation from a race becomes `exists`.
--   6. Conflict names are unique: "<base> (conflict YYYY-MM-DD HHMM).md", then
--      " 2", " 3", up to 20, always free under lower(), always passing
--      org_vault_path_ok. A repeat clash never folds onto an earlier copy.
--   7. New clients call org_vault_write and org_vault_remove, which answer a
--      conflict as a RESULT (never a server-made copy) so the app shows its
--      resolve sheet, the same as every other provider.
--   8. org_vault_put and the two-argument org_vault_delete stay, same
--      signatures, for builds already in the field (a TestFlight build that
--      calls put expects a saved row back and would read a refusal as a save).
--      They keep last-write-wins with a server copy, now under the lock, with
--      unique names, sequence revs, and revision rows. Remove both after M8.
--   9. org_vault_purge deletes tombstones and revision rows past a window,
--      weekly through pg_cron, in the same guarded block shape 0015 uses.
--
-- Additive: `if not exists` / `create or replace` throughout. The only data
-- change is the case-duplicate rename, which loses nothing (each renamed note
-- also leaves a revision row) and which the README's preflight query counts
-- before `supabase db push`.

-- ---------------------------------------------------------------- 1. revs
create sequence if not exists public.org_vault_rev_seq start with 1000000000;
-- Only the SECURITY DEFINER functions below draw from it. Supabase's default
-- privileges hand sequences in public to the client roles; take that back.
revoke all on sequence public.org_vault_rev_seq from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. revisions
create table if not exists public.org_vault_revisions (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  path text not null,
  rev bigint not null,
  body text not null,
  deleted boolean not null,
  updated_at timestamptz not null,
  updated_by uuid,
  reason text not null check (reason in ('overwritten', 'deleted', 'renamed')),
  recorded_at timestamptz not null default now()
);

create index if not exists org_vault_revisions_path_idx
  on public.org_vault_revisions (org_id, path, recorded_at desc);

alter table public.org_vault_revisions enable row level security;

drop policy if exists org_vault_revisions_select on public.org_vault_revisions;
create policy org_vault_revisions_select on public.org_vault_revisions for select
  using (public.is_org_member(org_id));

-- Members read their org's history; nobody writes it but the RPCs.
revoke insert, update, delete, truncate, references, trigger
  on public.org_vault_revisions from authenticated, anon;
revoke select on public.org_vault_revisions from anon;
grant select on public.org_vault_revisions to authenticated;

-- Append-only: an update is refused for every role, the owner included. The
-- purge deletes whole rows, which this does not touch.
create or replace function public.org_vault_revisions_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'org_vault_revisions is append-only';
end;
$$;

drop trigger if exists org_vault_revisions_no_update on public.org_vault_revisions;
create trigger org_vault_revisions_no_update
  before update on public.org_vault_revisions
  for each row execute function public.org_vault_revisions_immutable();

-- Record the version a write is about to displace. The rule: a delete or a
-- rename always records; an overwrite records when the displaced version is
-- someone else's (or nobody's) or is more than ten minutes old. A tombstone
-- has nothing to keep. Internal: called only from the RPCs below.
create or replace function public.org_vault_snapshot(
  p_row public.org_vault_notes,
  p_reason text
) returns void
language plpgsql
set search_path = public
as $$
begin
  if p_row.path is null or p_row.deleted then
    return;
  end if;
  if p_reason = 'overwritten'
     and p_row.updated_by is not distinct from auth.uid()
     and p_row.updated_at >= now() - interval '10 minutes' then
    return;
  end if;
  insert into public.org_vault_revisions
    (org_id, path, rev, body, deleted, updated_at, updated_by, reason)
  values
    (p_row.org_id, p_row.path, p_row.rev, p_row.body, p_row.deleted,
     p_row.updated_at, p_row.updated_by, p_reason);
end;
$$;

-- ---------------------------------------------------------------- 6. names
-- The first free keep-both name for p_path at p_at (UTC), the same shape as
-- the engine's vaultConflictCopyPath. "Free" means no row at all, live or
-- tombstone, holds that name under lower(), so a copy never lands on (or
-- revives) anything. The base is trimmed so the result fits 512 characters.
create or replace function public.org_vault_conflict_name(
  p_org uuid,
  p_path text,
  p_at timestamptz
) returns text
language plpgsql
stable
set search_path = public
as $$
declare
  base text := regexp_replace(p_path, '\.md$', '', 'i');
  stamp text := to_char(p_at at time zone 'utc', 'YYYY-MM-DD HH24MI');
  suffix text;
  candidate text;
begin
  for n in 1..20 loop
    suffix := ' (conflict ' || stamp || case when n > 1 then ' ' || n else '' end || ').md';
    candidate := left(base, 512 - char_length(suffix)) || suffix;
    if public.org_vault_path_ok(candidate)
       and not exists (
         select 1 from public.org_vault_notes
         where org_id = p_org and lower(path) = lower(candidate)
       ) then
      return candidate;
    end if;
  end loop;
  raise exception 'no free conflict name for % after 20 tries', p_path;
end;
$$;

-- ---------------------------------------------------------------- 3. case
-- Live notes in one org whose paths differ only by letter case collide under
-- the new unique index. Keep the most recently updated one at its path; move
-- each other one to a free conflict name, with a revision row, so nothing is
-- lost. Old paths are not tombstoned: every client lists live rows only.
do $$
declare
  r record;
  cur public.org_vault_notes;
  moved integer := 0;
  dest text;
begin
  for r in
    select org_id, path
    from (
      select org_id, path,
        row_number() over (
          partition by org_id, lower(path)
          order by updated_at desc, path
        ) as rn
      from public.org_vault_notes
      where not deleted
    ) ranked
    where rn > 1
    order by org_id, path
  loop
    select * into cur
      from public.org_vault_notes
      where org_id = r.org_id and path = r.path
      for update;
    dest := public.org_vault_conflict_name(r.org_id, r.path, now());
    perform public.org_vault_snapshot(cur, 'renamed');
    update public.org_vault_notes
      set path = dest,
          rev = nextval('public.org_vault_rev_seq'),
          updated_at = now()
      where org_id = r.org_id and path = r.path;
    moved := moved + 1;
  end loop;
  if moved > 0 then
    raise notice 'org_vault: renamed % live note(s) whose paths differed only by case', moved;
  end if;
end $$;

create unique index if not exists org_vault_notes_live_lower_idx
  on public.org_vault_notes (org_id, lower(path))
  where not deleted;

-- ---------------------------------------------------------------- 4. size
-- 0010 counted characters; the seam and every other provider report bytes.
-- Same column name, so old clients that select `size` keep working. Guarded so
-- a re-run does not rewrite the table again.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_vault_notes'
      and column_name = 'size'
      and generation_expression ilike '%octet_length%'
  ) then
    alter table public.org_vault_notes drop column if exists size;
    alter table public.org_vault_notes
      add column size integer generated always as (octet_length(body)) stored;
  end if;
end $$;

-- ---------------------------------------------------------------- helpers
-- The note as a conflict result carries it, so the client needs no second read.
create or replace function public.org_vault_theirs(p_row public.org_vault_notes)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'path', p_row.path,
    'body', p_row.body,
    'rev', p_row.rev,
    'updated_at', p_row.updated_at,
    'updated_by', p_row.updated_by
  );
$$;

-- One lock per (org, lower(path)), held to the end of the transaction.
create or replace function public.org_vault_lock(p_org uuid, p_path text)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtextextended(p_org::text || '/' || lower(p_path), 0));
$$;

-- ---------------------------------------------------------------- 7. write
-- Guarded write for the v1 client. Exactly one guard:
--   p_if_absent: create. A live note matching lower(path) is `exists` (with
--     theirs, under its real path). A tombstone at the exact path comes back.
--   p_if_match: replace the live note at exactly this path only when its rev
--     is still p_if_match. No live note is `missing` (nothing is re-created);
--     a different rev is `changed`, with theirs.
-- Success: { ok: true, path, rev, updated_at, size }.
create or replace function public.org_vault_write(
  p_org uuid,
  p_path text,
  p_body text,
  p_if_match bigint default null,
  p_if_absent boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.org_vault_notes;
  res public.org_vault_notes;
  v_body text := coalesce(p_body, '');
begin
  if p_org is null or coalesce(btrim(p_path), '') = '' then
    raise exception 'org and path are required';
  end if;
  if not public.org_vault_path_ok(p_path) then
    raise exception 'that note path is not allowed';
  end if;
  if octet_length(v_body) > 1048576 then
    raise exception 'a note is limited to 1 MB';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this org';
  end if;
  if (p_if_match is null) = (not coalesce(p_if_absent, false)) then
    raise exception 'a write needs exactly one guard: if_match or if_absent';
  end if;

  perform public.org_vault_lock(p_org, p_path);

  if coalesce(p_if_absent, false) then
    select * into cur
      from public.org_vault_notes
      where org_id = p_org and lower(path) = lower(p_path) and not deleted
      limit 1;
    if found then
      return jsonb_build_object('ok', false, 'conflict', 'exists',
        'theirs', public.org_vault_theirs(cur));
    end if;
    begin
      insert into public.org_vault_notes as n
        (org_id, path, body, deleted, rev, updated_at, updated_by)
      values
        (p_org, p_path, v_body, false, nextval('public.org_vault_rev_seq'), now(), auth.uid())
      on conflict (org_id, path) do update
        set body = excluded.body,
            deleted = false,
            rev = excluded.rev,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        where n.deleted
      returning * into res;
    exception when unique_violation then
      res := null;
    end;
    if res.path is null then
      select * into cur
        from public.org_vault_notes
        where org_id = p_org and lower(path) = lower(p_path) and not deleted
        limit 1;
      return jsonb_build_object('ok', false, 'conflict', 'exists',
        'theirs', case when found then public.org_vault_theirs(cur) end);
    end if;
  else
    select * into cur
      from public.org_vault_notes
      where org_id = p_org and path = p_path and not deleted
      for update;
    if not found then
      return jsonb_build_object('ok', false, 'conflict', 'missing');
    end if;
    if cur.rev <> p_if_match then
      return jsonb_build_object('ok', false, 'conflict', 'changed',
        'theirs', public.org_vault_theirs(cur));
    end if;
    perform public.org_vault_snapshot(cur, 'overwritten');
    update public.org_vault_notes
      set body = v_body,
          rev = nextval('public.org_vault_rev_seq'),
          updated_at = now(),
          updated_by = auth.uid()
      where org_id = p_org and path = p_path
      returning * into res;
  end if;

  return jsonb_build_object('ok', true, 'path', res.path, 'rev', res.rev,
    'updated_at', res.updated_at, 'size', res.size);
end;
$$;

-- ---------------------------------------------------------------- 8. remove
-- Guarded remove for the v1 client. p_if_match is required. A stale rev is
-- `changed` with theirs and the note stays live; a missing note or a
-- tombstone is already gone, so it is `ok`. Otherwise the live version goes
-- to the revisions table and the row becomes a tombstone with a new rev.
create or replace function public.org_vault_remove(
  p_org uuid,
  p_path text,
  p_if_match bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.org_vault_notes;
  res public.org_vault_notes;
begin
  if p_org is null or coalesce(btrim(p_path), '') = '' then
    raise exception 'org and path are required';
  end if;
  if char_length(p_path) > 512 then
    raise exception 'that note path is not allowed';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this org';
  end if;
  if p_if_match is null then
    raise exception 'a remove needs if_match';
  end if;

  perform public.org_vault_lock(p_org, p_path);

  select * into cur
    from public.org_vault_notes
    where org_id = p_org and path = p_path and not deleted
    for update;
  if not found then
    return jsonb_build_object('ok', true, 'path', p_path);
  end if;
  if cur.rev <> p_if_match then
    return jsonb_build_object('ok', false, 'conflict', 'changed',
      'theirs', public.org_vault_theirs(cur));
  end if;

  perform public.org_vault_snapshot(cur, 'deleted');
  update public.org_vault_notes
    set deleted = true,
        body = '',
        rev = nextval('public.org_vault_rev_seq'),
        updated_at = now(),
        updated_by = auth.uid()
    where org_id = p_org and path = p_path
    returning * into res;
  return jsonb_build_object('ok', true, 'path', res.path, 'rev', res.rev);
end;
$$;

-- ---------------------------------------------------------------- 9. legacy
-- For builds in the field only; remove after M8. Same signature and return
-- type as 0015, same last-write-wins-with-a-copy rule, now under the lock, with
-- a unique conflict name, a sequence rev, and a revision row for what an
-- overwrite displaces. A path that differs only by case from another live note
-- is refused (the unique index would refuse it anyway); the old build keeps
-- the text in its editor.
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
  v_body text := coalesce(p_body, '');
begin
  if p_org is null or coalesce(btrim(p_path), '') = '' then
    raise exception 'org and path are required';
  end if;
  if not public.org_vault_path_ok(p_path) then
    raise exception 'that note path is not allowed';
  end if;
  if octet_length(v_body) > 1048576 then
    raise exception 'a note is limited to 1 MB';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this org';
  end if;

  perform public.org_vault_lock(p_org, p_path);

  if exists (
    select 1 from public.org_vault_notes
    where org_id = p_org and lower(path) = lower(p_path) and path <> p_path and not deleted
  ) then
    raise exception 'a note with that name in different letter case already exists';
  end if;

  select * into existing
    from public.org_vault_notes
    where org_id = p_org and path = p_path
    for update;

  if existing.path is not null
     and not existing.deleted
     and existing.rev is distinct from p_base_rev
     and existing.body is distinct from v_body then
    -- Keep the body this write is about to replace as its own note, under a
    -- name no earlier copy holds.
    conflict_path := public.org_vault_conflict_name(p_org, p_path, now());
    insert into public.org_vault_notes
      (org_id, path, body, deleted, rev, updated_at, updated_by)
    values
      (p_org, conflict_path, existing.body, false, nextval('public.org_vault_rev_seq'),
       now(), existing.updated_by);
  end if;

  perform public.org_vault_snapshot(existing, 'overwritten');

  insert into public.org_vault_notes as n
    (org_id, path, body, deleted, rev, updated_at, updated_by)
  values
    (p_org, p_path, v_body, false, nextval('public.org_vault_rev_seq'), now(), auth.uid())
  on conflict (org_id, path) do update
    set body = excluded.body,
        deleted = false,
        rev = excluded.rev,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
  returning * into result;

  return result;
end;
$$;

-- For builds in the field only; remove after M8. Unguarded, as before.
create or replace function public.org_vault_delete(p_org uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.org_vault_notes;
begin
  if p_org is null or coalesce(btrim(p_path), '') = '' then
    raise exception 'org and path are required';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this org';
  end if;

  perform public.org_vault_lock(p_org, p_path);

  select * into cur
    from public.org_vault_notes
    where org_id = p_org and path = p_path and not deleted
    for update;
  if not found then
    return;
  end if;
  perform public.org_vault_snapshot(cur, 'deleted');
  update public.org_vault_notes
    set deleted = true,
        body = '',
        rev = nextval('public.org_vault_rev_seq'),
        updated_at = now(),
        updated_by = auth.uid()
    where org_id = p_org and path = p_path;
end;
$$;

-- ---------------------------------------------------------------- 10. purge
-- Tombstones and revision rows older than the window go. Never callable by a
-- client; pg_cron runs it as the owner. A window under a day is refused so a
-- slip cannot empty the history.
create or replace function public.org_vault_purge(p_older_than interval default '30 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  notes_gone integer;
  revisions_gone integer;
begin
  if p_older_than is null or p_older_than < interval '1 day' then
    raise exception 'the purge window must be at least one day';
  end if;
  delete from public.org_vault_notes
    where deleted and updated_at < now() - p_older_than;
  get diagnostics notes_gone = row_count;
  delete from public.org_vault_revisions
    where recorded_at < now() - p_older_than;
  get diagnostics revisions_gone = row_count;
  return notes_gone + revisions_gone;
end;
$$;

-- Weekly, Sundays 03:29 UTC, just after 0015's ledger retention. Guarded the
-- same way as 0015: where pg_cron is absent it prints a notice and the
-- migration still applies (see supabase/README.md).
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be enabled here (%). Enable it in the dashboard, then re-run this block.', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'oscode_vault_purge') then
      perform cron.unschedule('oscode_vault_purge');
    end if;
    perform cron.schedule(
      'oscode_vault_purge',
      '29 3 * * 0',
      $job$ select public.org_vault_purge(); $job$
    );
  else
    raise notice 'pg_cron is not installed; the vault purge was not scheduled (see supabase/README.md).';
  end if;
end $$;

-- ---------------------------------------------------------------- 11. grants
-- New RPCs: authenticated only. Internal helpers and the purge: no client.
revoke execute on function public.org_vault_write(uuid, text, text, bigint, boolean) from public, anon;
revoke execute on function public.org_vault_remove(uuid, text, bigint) from public, anon;
grant execute on function public.org_vault_write(uuid, text, text, bigint, boolean) to authenticated;
grant execute on function public.org_vault_remove(uuid, text, bigint) to authenticated;

revoke execute on function public.org_vault_purge(interval) from public, anon, authenticated;
revoke execute on function public.org_vault_snapshot(public.org_vault_notes, text) from public, anon, authenticated;
revoke execute on function public.org_vault_conflict_name(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.org_vault_theirs(public.org_vault_notes) from public, anon, authenticated;
revoke execute on function public.org_vault_lock(uuid, text) from public, anon, authenticated;
revoke execute on function public.org_vault_revisions_immutable() from public, anon, authenticated;

-- The legacy pair keeps its 0010 grant (create or replace leaves it alone).
grant execute on function public.org_vault_put(uuid, text, text, bigint) to authenticated;
grant execute on function public.org_vault_delete(uuid, text) to authenticated;
