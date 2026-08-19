-- Row-level security. The server becomes the truth the app only pretends at:
-- a member can read their org, only an admin can change it, and entitlements are
-- written by the Stripe webhook (service role) alone. The helpers are SECURITY
-- DEFINER so a member can test their own membership without seeing others' rows,
-- the same pattern Uki uses for is_dmca_moderator().

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'admin'
  );
$$;

-- True for the person who created the org, so they can seed the first admin row
-- before any membership exists (the bootstrap that is_org_admin cannot cover).
create or replace function public.is_org_owner(p_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.orgs o where o.id = p_org and o.owner_uid = auth.uid());
$$;

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.org_entitlements enable row level security;

-- orgs: members read; owner inserts; admins update.
create policy orgs_select on public.orgs for select using (public.is_org_member(id) or owner_uid = auth.uid());
create policy orgs_insert on public.orgs for insert with check (owner_uid = auth.uid());
create policy orgs_update on public.orgs for update using (public.is_org_admin(id) or owner_uid = auth.uid());

-- members: members read the roster; admins (or the owner, for bootstrap) write it.
create policy members_select on public.org_members for select using (public.is_org_member(org_id) or public.is_org_owner(org_id));
create policy members_write on public.org_members for all
  using (public.is_org_admin(org_id) or public.is_org_owner(org_id))
  with check (public.is_org_admin(org_id) or public.is_org_owner(org_id));

-- entitlements: members read; only the service role (webhook) writes, so there
-- is no insert/update policy for authenticated users.
create policy ent_select on public.org_entitlements for select using (public.is_org_member(org_id));
