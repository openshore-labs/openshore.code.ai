-- Org Vault settings and entitlement (Vault M7, plan item 7.4; CTO ruling L17,
-- CX Y14 and Y15, 2026-09-27).
--
--   1. org_vault_settings holds one row per org: the vault conventions (the
--      same L2 schema a personal vault keeps in .oscode/vault.json, as jsonb),
--      who may delete team notes (`admin` or `member`), and the team context
--      folder (a column only: no model reads team notes in v1, D15, so no app
--      row sets it until v1.1). No row means the defaults: `{}`, `member`, no
--      folder, rev 0.
--   2. Members read it (RLS select, or org_vault_settings_get, which also
--      answers the defaults when there is no row). Nobody writes it directly:
--      org_vault_settings_put is admins only, entitled only, and a
--      compare-and-swap on `rev`. A stale rev is a `changed` result with
--      theirs, never a raise, the same as every other vault write.
--   3. org_vault_entitled(org) (CFO + CTO ruling, 2026-09-27): an
--      org_entitlements row decides when there is one, by `_shared/
--      entitlement.ts isEntitled`'s rule (status `active` or `trialing`, and
--      valid_until null or in the future); any other row is read-only with
--      export. The webhook never deletes a row, so NO row means "never
--      bought": such an org's members write until
--      no_entitlement_vault_until(), a constant shaped like 0015's
--      no_entitlement_max_seats(). It is null in the beta (no deadline). When
--      pay gates return, a one-line migration sets it at least 30 days out,
--      and that date is the notice (settings_get returns it). It runs as the
--      caller, so a non-member gets false either way.
--   4. Every write-shaped RPC (org_vault_write, org_vault_remove,
--      org_vault_move, the legacy org_vault_put and org_vault_delete, and
--      org_vault_settings_put) raises SQLSTATE OV402 when the org is not
--      entitled: after the member check, before the lock. Selects, lists,
--      revisions, org_vault_settings_get and org_vault_purge are untouched, so a
--      lapsed org still reads and exports every note it has.
--   5. With delete_role = 'admin', org_vault_remove and org_vault_delete refuse
--      a non-admin with SQLSTATE OV403 (CX Y14: "Not deleted. Only admins can
--      delete team notes."). A move is NOT gated by it: a rename keeps the note
--      and its history, and a member can already overwrite a body, so gating
--      the rename would take a tool away without protecting anything.
--      "Admin" here is an active admin member or the org's owner, as 0014
--      counts it.
--
-- The write RPCs are re-created whole below: each body is 0019's or 0024's
-- verbatim with the two new calls added after the member check. Additive:
-- `if not exists` / `create or replace`, no data change. Ships AFTER 0019 and
-- 0024 (see supabase/README.md). Pricing is a Board gate: nothing here names a
-- tier or a price.
--
-- Numbering (CTO ruling 4, 2026-09-29): written as 0021 on the held
-- vault-m2-team branch and renumbered 0025 there, above main's 0022 and
-- 0023, so it applies after both. 0023's free caps are triggers on
-- org_vault_notes and org_vault_revisions, so they hold under the bodies
-- re-created here. 0023's org_is_entitled is the row rule of
-- org_vault_entitled below without the beta's no-row window: an org that
-- never bought may still write notes here, and 0023 still caps its bytes.

-- ---------------------------------------------------------------- 1. table
-- The top-level keys a team row may hold: the L2 conventions a team shares.
-- The privacy and agent keys (exclude, localOnly, agent) stay out, because no
-- model reads team notes in v1 (D15). Each section is an object; `version` is
-- a number and `delete` (trash or permanent) a string.
create or replace function public.org_vault_settings_ok(p_settings jsonb)
returns boolean
language sql
immutable
as $$
  select p_settings is not null
    and jsonb_typeof(p_settings) = 'object'
    and octet_length(p_settings::text) <= 65536
    and not exists (
      select 1 from jsonb_each(p_settings) e
      where not (
        (e.key in ('newNotes', 'daily', 'templates', 'attachments', 'links', 'editor', 'tree')
          and jsonb_typeof(e.value) = 'object')
        or (e.key = 'version' and jsonb_typeof(e.value) = 'number')
        or (e.key = 'delete' and e.value in ('"trash"'::jsonb, '"permanent"'::jsonb))
      )
    );
$$;

create table if not exists public.org_vault_settings (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb
    check (public.org_vault_settings_ok(settings)),
  delete_role text not null default 'member'
    check (delete_role in ('admin', 'member')),
  context_folder text
    check (context_folder is null or public.org_vault_path_ok(context_folder)),
  rev bigint not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.org_vault_settings enable row level security;

drop policy if exists org_vault_settings_select on public.org_vault_settings;
create policy org_vault_settings_select on public.org_vault_settings for select
  using (public.is_org_member(org_id));

-- Members read; only org_vault_settings_put writes.
revoke insert, update, delete, truncate, references, trigger
  on public.org_vault_settings from authenticated, anon;
revoke select on public.org_vault_settings from anon;
grant select on public.org_vault_settings to authenticated;

-- ---------------------------------------------------------------- 2. gates
-- Writes stay open for a never-paid org until this moment. Null = no deadline
-- (the beta); when pay gates return, one migration sets a date 30+ days out.
create or replace function public.no_entitlement_vault_until()
returns timestamptz
language sql
immutable
as $$
  select null::timestamptz;
$$;

-- A row decides by isEntitled; no row writes until the deadline above.
-- SECURITY INVOKER on purpose: called from a SECURITY DEFINER RPC it reads the
-- row as the owner; called by a client it reads through org_entitlements'
-- RLS, and the no-row branch asks is_org_member, so a non-member learns
-- nothing (false).
create or replace function public.org_vault_entitled(p_org uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when exists (select 1 from public.org_entitlements e where e.org_id = p_org)
      then exists (
        select 1 from public.org_entitlements e
        where e.org_id = p_org
          and e.status in ('active', 'trialing')
          and (e.valid_until is null or e.valid_until > now()))
    else public.is_org_member(p_org)
      and (public.no_entitlement_vault_until() is null
           or public.no_entitlement_vault_until() > now())
  end;
$$;

-- The refusal every write RPC makes. OV402 is the client's cue for CX Y15's
-- read-only lead; the text it had not sent stays in its editor.
create or replace function public.org_vault_require_entitled(p_org uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if not public.org_vault_entitled(p_org) then
    raise exception 'the organization''s plan is not active, so team notes are read-only'
      using errcode = 'OV402';
  end if;
end;
$$;

-- An admin as 0014 counts one: an active admin member, or the org's owner.
create or replace function public.org_vault_is_admin(p_org uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.is_org_admin(p_org) or public.is_org_owner(p_org);
$$;

-- The who-may-delete rule. No settings row reads `member`.
create or replace function public.org_vault_require_may_delete(p_org uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if coalesce(
       (select delete_role from public.org_vault_settings where org_id = p_org),
       'member') = 'admin'
     and not public.org_vault_is_admin(p_org) then
    raise exception 'only admins can delete team notes here'
      using errcode = 'OV403';
  end if;
end;
$$;

-- ---------------------------------------------------------------- 3. read
-- The org's settings for the app's org provider, defaults when there is no
-- row, plus what the sheet needs up front: whether the org is entitled (Y15),
-- until when a never-paid org stays editable (`entitled_until`, the deadline
-- when there is no entitlement row, else null), and whether this caller may
-- edit (Y14). Members only. Readable when lapsed.
create or replace function public.org_vault_settings_get(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cur public.org_vault_settings;
begin
  if p_org is null then
    raise exception 'org is required';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this org';
  end if;
  select * into cur from public.org_vault_settings where org_id = p_org;
  return jsonb_build_object(
    'settings', coalesce(cur.settings, '{}'::jsonb),
    'delete_role', coalesce(cur.delete_role, 'member'),
    'context_folder', cur.context_folder,
    'rev', coalesce(cur.rev, 0),
    'updated_at', cur.updated_at,
    'updated_by', cur.updated_by,
    'entitled', public.org_vault_entitled(p_org),
    'entitled_until', case
      when exists (select 1 from public.org_entitlements e where e.org_id = p_org)
        then null
      else public.no_entitlement_vault_until()
    end,
    'is_admin', public.org_vault_is_admin(p_org));
end;
$$;

-- ---------------------------------------------------------------- 4. put
-- Replace the org's settings whole, when `rev` is still p_base_rev (0 when
-- there is no row yet). The client echoes context_folder from its read; null
-- clears it. Success: { ok: true, rev, updated_at }. A stale base:
-- { ok: false, conflict: 'changed', theirs: <what org_vault_settings_get
-- would answer> } and nothing is written.
create or replace function public.org_vault_settings_put(
  p_org uuid,
  p_settings jsonb,
  p_delete_role text,
  p_context_folder text,
  p_base_rev bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.org_vault_settings;
  res public.org_vault_settings;
begin
  if p_org is null then
    raise exception 'org is required';
  end if;
  if not public.org_vault_settings_ok(p_settings) then
    raise exception 'those vault settings are not allowed';
  end if;
  if p_delete_role is null or p_delete_role not in ('admin', 'member') then
    raise exception 'who may delete is admin or member';
  end if;
  if p_context_folder is not null and not public.org_vault_path_ok(p_context_folder) then
    raise exception 'that folder is not allowed';
  end if;
  if p_base_rev is null then
    raise exception 'a settings write needs the base rev (0 for none yet)';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this org';
  end if;
  if not public.org_vault_is_admin(p_org) then
    raise exception 'only admins can change team vault settings';
  end if;
  perform public.org_vault_require_entitled(p_org);

  -- One lock per org's settings, the same advisory family as the notes.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || '#settings', 0));

  select * into cur from public.org_vault_settings where org_id = p_org for update;
  if coalesce(cur.rev, 0) <> p_base_rev then
    return jsonb_build_object('ok', false, 'conflict', 'changed',
      'theirs', public.org_vault_settings_get(p_org));
  end if;

  insert into public.org_vault_settings as s
    (org_id, settings, delete_role, context_folder, rev, updated_at, updated_by)
  values
    (p_org, p_settings, p_delete_role, p_context_folder, 1, now(), auth.uid())
  on conflict (org_id) do update
    set settings = excluded.settings,
        delete_role = excluded.delete_role,
        context_folder = excluded.context_folder,
        rev = s.rev + 1,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
  returning * into res;

  return jsonb_build_object('ok', true, 'rev', res.rev, 'updated_at', res.updated_at);
end;
$$;

-- ---------------------------------------------------------------- 5. write
-- 0019's org_vault_write, plus the OV402 gate.
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
  perform public.org_vault_require_entitled(p_org);
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

-- ---------------------------------------------------------------- 6. remove
-- 0019's org_vault_remove, plus the OV402 gate and the who-may-delete rule.
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
  perform public.org_vault_require_entitled(p_org);
  perform public.org_vault_require_may_delete(p_org);
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

-- ---------------------------------------------------------------- 7. move
-- 0024's org_vault_move, plus the OV402 gate (not the delete rule; see 5.).
create or replace function public.org_vault_move(
  p_org uuid,
  p_from text,
  p_to text,
  p_if_match bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.org_vault_notes;
  other public.org_vault_notes;
  res public.org_vault_notes;
begin
  if p_org is null
     or coalesce(btrim(p_from), '') = ''
     or coalesce(btrim(p_to), '') = '' then
    raise exception 'org, from, and to are required';
  end if;
  if char_length(p_from) > 512 then
    raise exception 'that note path is not allowed';
  end if;
  if not public.org_vault_path_ok(p_to) then
    raise exception 'that note path is not allowed';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this org';
  end if;
  perform public.org_vault_require_entitled(p_org);
  if p_if_match is null then
    raise exception 'a move needs if_match';
  end if;

  -- Both locks, lower() first, so crossing moves take them in one order.
  if lower(p_from) <= lower(p_to) then
    perform public.org_vault_lock(p_org, p_from);
    perform public.org_vault_lock(p_org, p_to);
  else
    perform public.org_vault_lock(p_org, p_to);
    perform public.org_vault_lock(p_org, p_from);
  end if;

  select * into cur
    from public.org_vault_notes
    where org_id = p_org and path = p_from and not deleted
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'conflict', 'missing');
  end if;
  if cur.rev <> p_if_match then
    return jsonb_build_object('ok', false, 'conflict', 'changed',
      'theirs', public.org_vault_theirs(cur));
  end if;

  -- Moving a note onto its own exact name changes nothing.
  if p_from = p_to then
    return jsonb_build_object('ok', true, 'path', cur.path, 'rev', cur.rev,
      'updated_at', cur.updated_at, 'size', cur.size);
  end if;

  -- Never replace: any other live note under lower(p_to) is `exists`.
  select * into other
    from public.org_vault_notes
    where org_id = p_org and lower(path) = lower(p_to) and not deleted
      and path <> p_from
    limit 1;
  if found then
    return jsonb_build_object('ok', false, 'conflict', 'exists',
      'theirs', public.org_vault_theirs(other));
  end if;

  begin
    perform public.org_vault_snapshot(cur, 'renamed');

    if lower(p_from) = lower(p_to) then
      -- Case-only rename: the same row, a new spelling and a new rev.
      delete from public.org_vault_notes
        where org_id = p_org and path = p_to and deleted;
      update public.org_vault_notes
        set path = p_to,
            rev = nextval('public.org_vault_rev_seq'),
            updated_at = now(),
            updated_by = auth.uid()
        where org_id = p_org and path = p_from
        returning * into res;
    else
      update public.org_vault_notes
        set deleted = true,
            body = '',
            rev = nextval('public.org_vault_rev_seq'),
            updated_at = now(),
            updated_by = auth.uid()
        where org_id = p_org and path = p_from;

      insert into public.org_vault_notes as n
        (org_id, path, body, deleted, rev, updated_at, updated_by)
      values
        (p_org, p_to, cur.body, false, nextval('public.org_vault_rev_seq'), now(), auth.uid())
      on conflict (org_id, path) do update
        set body = excluded.body,
            deleted = false,
            rev = excluded.rev,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        where n.deleted
      returning * into res;

      -- A live row at the exact spelling (a race past the lock) leaves res
      -- empty; undo the whole move through the handler below.
      if res.path is null then
        raise unique_violation;
      end if;
    end if;
  exception when unique_violation then
    select * into other
      from public.org_vault_notes
      where org_id = p_org and lower(path) = lower(p_to) and not deleted
        and path <> p_from
      limit 1;
    return jsonb_build_object('ok', false, 'conflict', 'exists',
      'theirs', case when found then public.org_vault_theirs(other) end);
  end;

  return jsonb_build_object('ok', true, 'path', res.path, 'rev', res.rev,
    'updated_at', res.updated_at, 'size', res.size);
end;
$$;

-- ---------------------------------------------------------------- 8. legacy
-- 0019's org_vault_put and org_vault_delete, for builds in the field only
-- (remove after M8), plus the OV402 gate, and the delete rule on the delete.
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
  perform public.org_vault_require_entitled(p_org);

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
  perform public.org_vault_require_entitled(p_org);
  perform public.org_vault_require_may_delete(p_org);

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

-- ---------------------------------------------------------------- 9. grants
-- The read, the put and the entitlement answer: authenticated only. The
-- internal gates: no client. The re-created write RPCs keep their grants
-- (create or replace leaves them alone).
revoke execute on function public.org_vault_settings_get(uuid) from public, anon;
revoke execute on function public.org_vault_settings_put(uuid, jsonb, text, text, bigint) from public, anon;
revoke execute on function public.org_vault_entitled(uuid) from public, anon;
grant execute on function public.org_vault_settings_get(uuid) to authenticated;
grant execute on function public.org_vault_settings_put(uuid, jsonb, text, text, bigint) to authenticated;
grant execute on function public.org_vault_entitled(uuid) to authenticated;

revoke execute on function public.org_vault_require_entitled(uuid) from public, anon, authenticated;
revoke execute on function public.org_vault_require_may_delete(uuid) from public, anon, authenticated;
revoke execute on function public.org_vault_is_admin(uuid) from public, anon, authenticated;
