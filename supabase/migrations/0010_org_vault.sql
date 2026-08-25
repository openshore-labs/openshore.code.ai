-- Org Vault: the organization tier of Vault. A shared, multi-writer markdown
-- knowledge base, one per org, that every active member reads and writes. This
-- is the "different problem than the personal tier" the Vault build prompt
-- flagged: concurrent writers across their own devices, so it needs real
-- server-side sync and a permission model, not a single folder on one device.
--
-- Design (CTO ruling, recorded in os-code/PROGRESS.md):
--   - One row per note per org in `org_vault_notes`, keyed (org_id, path).
--   - Permissions ride the existing org roles: any active member reads and
--     writes; non-members see nothing (RLS via is_org_member).
--   - Writes go through a SECURITY DEFINER RPC that does last-write-wins with a
--     CONFLICT COPY, so a concurrent overwrite never silently loses a member's
--     work: the body that would have been lost is preserved as its own note.
--   - Deletes are tombstones (deleted = true), so other devices learn of a
--     removal on their next pull instead of silently keeping a ghost note.
--
-- Direct table writes are revoked from clients; the RPCs are the ONLY write
-- path, which is what makes the LWW-plus-conflict-copy rule unbypassable.

create table if not exists public.org_vault_notes (
  org_id uuid not null references public.orgs (id) on delete cascade,
  -- Vault-relative POSIX path, e.g. "ideas/roadmap.md". Same address space as
  -- the gitOS seam, so the same tree opens in Obsidian on export.
  path text not null,
  body text not null default '',
  deleted boolean not null default false,
  -- A cheap size signal for list views, maintained by Postgres so no client can
  -- lie about it and list() never has to fetch bodies.
  size integer generated always as (char_length(body)) stored,
  -- Monotonic per-note revision. The editor sends the rev it started from; the
  -- RPC bumps it on every write. A mismatch is how a concurrent edit is caught.
  rev bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  primary key (org_id, path)
);

-- List and backlink scans only ever want the live notes of one org.
create index if not exists org_vault_notes_live_idx
  on public.org_vault_notes (org_id)
  where not deleted;

alter table public.org_vault_notes enable row level security;

-- Members read their own org's notes. No cross-org read, no anon read.
drop policy if exists org_vault_select on public.org_vault_notes;
create policy org_vault_select on public.org_vault_notes for select
  using (public.is_org_member(org_id));

-- There is deliberately NO insert/update/delete policy: every write goes
-- through the SECURITY DEFINER RPCs below, which enforce membership and the
-- conflict-copy rule. Strip any default table-write grant so a client cannot
-- PATCH the table directly and skip that path (the same lockdown shape used for
-- public.orgs in 0005).
revoke insert, update, delete on public.org_vault_notes from authenticated, anon;
-- Defense in depth: anon never reads this table (RLS would return zero rows for
-- a null uid anyway, but do not rely on the policy alone). Only authenticated
-- members select, and even then RLS scopes them to their own org.
revoke select on public.org_vault_notes from anon;
grant select on public.org_vault_notes to authenticated;

-- Write a note: last-write-wins, but never lose work. When the note has moved
-- on since the editor's base rev (a concurrent write landed first) and the two
-- bodies actually differ, the current server body is first copied aside to a
-- "(conflict ...)" note, then this write wins. Returns the stored row so the
-- client can adopt the new rev as its next base.
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

-- Delete a note: a tombstone, not a hard delete, so peers converge on the
-- removal. Membership is enforced the same way as a write.
create or replace function public.org_vault_delete(p_org uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this org';
  end if;
  update public.org_vault_notes
    set deleted = true,
        body = '',
        updated_at = now(),
        updated_by = auth.uid(),
        rev = rev + 1
    where org_id = p_org and path = p_path;
end;
$$;

grant execute on function public.org_vault_put(uuid, text, text, bigint) to authenticated;
grant execute on function public.org_vault_delete(uuid, text) to authenticated;
