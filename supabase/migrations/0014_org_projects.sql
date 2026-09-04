-- Org Projects: the enterprise tier of Projects. A project (its name, standing
-- instructions, and attached repositories) shared across an org, with per-person
-- access decided by an admin: who may READ it, WRITE in it (chat / run the
-- coding agent), or EDIT it (change its instructions, repos, and access). This
-- is the server side of what the app's Team access card only configured locally
-- (app/src/lib/projectAccess.ts): the same read/write/edit ladder, now enforced.
--
-- Design (mirrors the org_vault precedent, 0010):
--   - One row per shared project in `org_projects`, owned by an org.
--   - One row per grant in `org_project_members`, keyed (project, lower(email)),
--     so an admin provisions by email exactly like org_members; the grant binds
--     to a user_id lazily, by matching the signed-in person's verified email.
--   - The caller's effective level is resolved SERVER-SIDE by project_level():
--     an org admin/owner always holds 'edit'; everyone else holds their grant,
--     or nothing. The client never gets to assert its own level.
--   - Every write goes through a SECURITY DEFINER RPC that checks project_level
--     BEFORE it writes, and direct table writes are revoked, so the ladder is
--     unbypassable (the same lockdown shape as org_vault and 0005).
--
-- Personal accounts and unshared local projects never touch these tables; the
-- app keeps working fully offline and degrades to local-only when Supabase is
-- not configured or the person is signed out.

create table if not exists public.org_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  instructions text not null default '',
  -- The same repo id space the chat header and Project.repoIds use: a workspace
  -- path or "github:owner/name". Stored as text[]; opaque to the server.
  repo_ids text[] not null default '{}',
  -- Monotonic revision, bumped on every content write, so a client can hand an
  -- honest base and a stale overwrite is detectable (last-write-wins here, no
  -- conflict copy: project metadata is small and edited rarely, unlike a note).
  rev bigint not null default 1,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
create index if not exists org_projects_org_idx on public.org_projects (org_id);

create table if not exists public.org_project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.org_projects (id) on delete cascade,
  -- Null until the invited person signs in and is matched by their verified
  -- email, the same lazy bind org_members uses.
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  level text not null default 'read' check (level in ('read', 'write', 'edit')),
  granted_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
-- One grant per email per project (case-insensitive), so a re-add updates it.
create unique index if not exists org_project_members_email_idx
  on public.org_project_members (project_id, lower(email));
create index if not exists org_project_members_user_idx on public.org_project_members (user_id);

-- The caller's effective level on a project, or null when they have none. An
-- org admin/owner always holds 'edit' (they run the account); everyone else
-- holds the grant matching their auth.uid() OR their verified auth.email(), so
-- a grant works the moment the invited person signs in, with no claim step.
-- SECURITY DEFINER so a member can test their own access without reading the
-- whole roster; resolved from the JWT, never client input.
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
begin
  select org_id into v_org from public.org_projects where id = p_project;
  if v_org is null then
    return null;
  end if;
  if public.is_org_admin(v_org) or public.is_org_owner(v_org) then
    return 'edit';
  end if;
  select m.level into v_level
    from public.org_project_members m
    where m.project_id = p_project
      and (m.user_id = auth.uid() or lower(m.email) = lower(coalesce(auth.email(), '')))
    order by array_position(array['read', 'write', 'edit'], m.level) desc
    limit 1;
  return v_level;
end;
$$;

alter table public.org_projects enable row level security;
alter table public.org_project_members enable row level security;

-- A shared project is visible to anyone who holds any level on it (which
-- includes every org admin, via project_level). No cross-org read, no anon.
drop policy if exists org_projects_select on public.org_projects;
create policy org_projects_select on public.org_projects for select
  using (public.project_level(id) is not null);

-- The roster is visible to anyone who can see the project.
drop policy if exists org_project_members_select on public.org_project_members;
create policy org_project_members_select on public.org_project_members for select
  using (public.project_level(project_id) is not null);

-- There is deliberately NO insert/update/delete policy on either table: every
-- write goes through the SECURITY DEFINER RPCs below, which check the level
-- first. Strip default table-write grants so a client cannot PATCH around them,
-- and keep anon out of reads entirely (same lockdown as org_vault / 0005).
revoke insert, update, delete on public.org_projects from authenticated, anon;
revoke insert, update, delete on public.org_project_members from authenticated, anon;
revoke select on public.org_projects, public.org_project_members from anon;
grant select on public.org_projects, public.org_project_members to authenticated;

-- List every shared project the caller can reach, each with THEIR level and the
-- full grant roster, in one round trip. SECURITY DEFINER so project_level and
-- the roster read run with the definer's rights; the WHERE still scopes rows to
-- what the caller may see, so this never leaks another org's projects.
create or replace function public.list_org_projects()
returns table (
  id uuid,
  org_id uuid,
  name text,
  instructions text,
  repo_ids text[],
  rev bigint,
  updated_at timestamptz,
  my_level text,
  access jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.id,
    p.org_id,
    p.name,
    p.instructions,
    p.repo_ids,
    p.rev,
    p.updated_at,
    public.project_level(p.id) as my_level,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('email', m.email, 'level', m.level)
                         order by m.created_at)
        from public.org_project_members m
        where m.project_id = p.id
      ),
      '[]'::jsonb
    ) as access
  from public.org_projects p
  where public.project_level(p.id) is not null;
$$;

-- Create a shared project. Only an org admin can stand one up (they own the
-- account and its seats); editors edit content afterward. Returns the new id.
create or replace function public.create_org_project(
  p_org uuid,
  p_name text,
  p_instructions text,
  p_repo_ids text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not (public.is_org_admin(p_org) or public.is_org_owner(p_org)) then
    raise exception 'only an admin can share a project with the team';
  end if;
  insert into public.org_projects (org_id, name, instructions, repo_ids, created_by, updated_by)
  values (p_org, coalesce(nullif(btrim(p_name), ''), 'Untitled project'),
          coalesce(p_instructions, ''), coalesce(p_repo_ids, '{}'), auth.uid(), auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- Update a shared project's content. Requires edit. Last-write-wins; rev is
-- bumped so a client can adopt the new base. p_base_rev is advisory today (kept
-- so a future conflict UI has an honest base to compare); the write still lands.
create or replace function public.update_org_project(
  p_id uuid,
  p_name text,
  p_instructions text,
  p_repo_ids text[],
  p_base_rev bigint
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_rev bigint;
begin
  if public.project_level(p_id) is distinct from 'edit' then
    raise exception 'need edit access to change this project';
  end if;
  update public.org_projects
    set name = coalesce(nullif(btrim(p_name), ''), name),
        instructions = coalesce(p_instructions, instructions),
        repo_ids = coalesce(p_repo_ids, repo_ids),
        rev = rev + 1,
        updated_at = now(),
        updated_by = auth.uid()
    where id = p_id
    returning rev into new_rev;
  if new_rev is null then
    raise exception 'project not found';
  end if;
  return new_rev;
end;
$$;

-- Delete a shared project (and its grants, via cascade). Requires edit.
create or replace function public.delete_org_project(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.project_level(p_id) is distinct from 'edit' then
    raise exception 'need edit access to delete this project';
  end if;
  delete from public.org_projects where id = p_id;
end;
$$;

-- Grant or change a teammate's access by email. Requires edit (edit is the
-- level that "may change access", matching the app's ladder). The email must
-- belong to an active member of the project's org, so access can only be handed
-- to a real seat, never an arbitrary address. Re-adding an email updates it.
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
    (select id from auth.users where lower(email) = v_email limit 1)
  )
  on conflict (project_id, lower(email)) do update
    set level = excluded.level, granted_by = auth.uid();
end;
$$;

-- Remove a teammate's access. Requires edit.
create or replace function public.revoke_org_project_access(p_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.project_level(p_id) is distinct from 'edit' then
    raise exception 'need edit access to change who can use this project';
  end if;
  delete from public.org_project_members
    where project_id = p_id and lower(email) = lower(btrim(coalesce(p_email, '')));
end;
$$;

grant execute on function public.project_level(uuid) to authenticated;
grant execute on function public.list_org_projects() to authenticated;
grant execute on function public.create_org_project(uuid, text, text, text[]) to authenticated;
grant execute on function public.update_org_project(uuid, text, text, text[], bigint) to authenticated;
grant execute on function public.delete_org_project(uuid) to authenticated;
grant execute on function public.set_org_project_access(uuid, text, text) to authenticated;
grant execute on function public.revoke_org_project_access(uuid, text) to authenticated;
