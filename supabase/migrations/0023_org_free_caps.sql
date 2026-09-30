-- Free caps on the org tables (CTO ruling 4, 2026-09-29; next build section 5,
-- backend finding 4). Any signed-in account could create an org and store
-- notes by API with no bound, and nothing was paying for it. Two caps close
-- the cost hole without deciding the v4 question of who may have a team:
--
--   1. An account owns at most one org that has no entitlement. An org with a
--      live plan does not count, so a paying team can still start a second
--      org and buy for it; a second free one is refused.
--   2. An org with no entitlement holds at most 25 MiB of note and revision
--      bytes. The total lives in org_storage_usage, kept by triggers on
--      org_vault_notes and org_vault_revisions, so the check never scans.
--
-- Both are triggers, never code inside org_vault_put or org_vault_write:
-- the settings file (written as 0021 on the held vault-m2-team branch, today's
-- 0025_org_vault_settings.sql) re-creates both of those whole, and a trigger
-- holds whichever body is live. no_entitlement_max_seats (0015) is left alone.
--
-- "Entitled" is _shared/entitlement.ts isEntitled, the rule 0015's seat
-- ceiling reads: an org_entitlements row with status active or trialing,
-- whose valid_until is unset or still ahead. No row, or any other row, is
-- unentitled.
--
-- Refusals raise check_violation (23514), the same code 0015's seat ceilings
-- use. Only growth is refused: a delete, a shrink, or a purge always goes
-- through, even over the cap. A delete's bytes stay counted in its revision
-- row until the weekly purge clears it (about 30 days), and the refusal says
-- so (CTO 11 resolved the gate 1 runbook's 0.3a this way while the file was
-- still unapplied). Rows already over a cap when this lands stay
-- (grandfathered, as 0015 does for seats); they cannot grow.
--
-- Deploy ordering: additive, after 0022. It backfills the byte totals from the
-- rows already stored, inside the migration.

-- ---------------------------------------------------------------- constants
-- Shaped like 0015's no_entitlement_max_seats: one line to change, by
-- migration, when the Board sets different numbers.
create or replace function public.no_entitlement_max_owned_orgs()
returns int
language sql
immutable
as $$
  select 1;
$$;

create or replace function public.no_entitlement_max_org_bytes()
returns bigint
language sql
immutable
as $$
  select 26214400::bigint; -- 25 MiB
$$;

-- Is this org on a live plan right now? isEntitled's rule, read as the owner
-- (the triggers below run above the caller's RLS).
create or replace function public.org_is_entitled(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_entitlements e
     where e.org_id = p_org
       and e.status in ('active', 'trialing')
       and (e.valid_until is null or e.valid_until > now())
  );
$$;

revoke execute on function public.org_is_entitled(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 1. one free org
-- On a new org, or an org handed to another owner (the service role can move
-- owner_uid; clients cannot, 0005). A transaction lock per owner makes two
-- racing inserts count each other.
create or replace function public.enforce_free_owned_orgs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_free int;
begin
  if tg_op = 'UPDATE' and new.owner_uid is not distinct from old.owner_uid then
    return new;
  end if;
  -- An entitled org handed over never counts; a new org is never entitled yet
  -- (its entitlement row needs the org to exist first).
  if tg_op = 'UPDATE' and public.org_is_entitled(new.id) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('oscode_owned_orgs:' || new.owner_uid::text, 0));
  select count(*) into v_free
    from public.orgs o
   where o.owner_uid = new.owner_uid
     and o.id <> new.id
     and not public.org_is_entitled(o.id);
  if v_free >= public.no_entitlement_max_owned_orgs() then
    raise exception 'an account without a plan can own one team; start a plan for your team before making another'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists org_free_owned_cap on public.orgs;
create trigger org_free_owned_cap
  before insert or update of owner_uid on public.orgs
  for each row execute function public.enforce_free_owned_orgs();

-- ---------------------------------------------------------------- 2. bytes
-- One row per org that has stored anything. Service role reads it; nobody
-- writes it but the trigger below.
create table if not exists public.org_storage_usage (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  bytes bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.org_storage_usage enable row level security;
revoke all on public.org_storage_usage from anon, authenticated;

-- Keep the total, and refuse a note that grows an unentitled org past the cap.
--
-- Every insert, body change, and delete on either table moves the total by
-- the bytes it adds or frees. The refusal is on NOTE growth only: a revision
-- row is the displaced copy of something already counted, written in the same
-- call as the note change that displaced it (0021's snapshot), and refusing it
-- would refuse a delete near the cap (the snapshot lands before the
-- tombstone). Revisions still count toward the total a note's growth is
-- checked against, so history cannot be used to hide bytes; at most one
-- snapshot of each live note's body rides above the cap until the weekly
-- purge.
create or replace function public.org_storage_track()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_delta bigint;
  v_total bigint;
begin
  if tg_op = 'INSERT' then
    v_org := new.org_id;
    v_delta := octet_length(new.body);
  elsif tg_op = 'DELETE' then
    v_org := old.org_id;
    v_delta := -octet_length(old.body);
  else
    if new.org_id is distinct from old.org_id then
      -- Not a path any RPC takes, but count it honestly: out of one org and
      -- into the other, where it is growth.
      update public.org_storage_usage
         set bytes = greatest(0, bytes - octet_length(old.body)), updated_at = now()
       where org_id = old.org_id;
      v_org := new.org_id;
      v_delta := octet_length(new.body);
    else
      v_org := new.org_id;
      v_delta := octet_length(new.body) - octet_length(old.body);
    end if;
  end if;

  if v_delta = 0 then
    return null;
  end if;

  if v_delta < 0 then
    -- Freeing bytes is never refused. The row may already be gone when the
    -- org itself is being deleted (its cascade takes this table too).
    update public.org_storage_usage
       set bytes = greatest(0, bytes + v_delta), updated_at = now()
     where org_id = v_org;
    return null;
  end if;

  insert into public.org_storage_usage as u (org_id, bytes)
  values (v_org, v_delta)
  on conflict (org_id) do update
    set bytes = u.bytes + excluded.bytes,
        updated_at = now()
  returning u.bytes into v_total;

  if tg_table_name = 'org_vault_notes'
     and v_total > public.no_entitlement_max_org_bytes()
     and not public.org_is_entitled(v_org) then
    raise exception 'this team has used its 25 MiB of free space; start a plan to add more. A deleted note frees its space when its history is cleared, about a month later'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke execute on function public.org_storage_track() from public, anon, authenticated;
revoke execute on function public.enforce_free_owned_orgs() from public, anon, authenticated;

drop trigger if exists org_vault_notes_storage on public.org_vault_notes;
create trigger org_vault_notes_storage
  after insert or update of body, org_id or delete on public.org_vault_notes
  for each row execute function public.org_storage_track();

drop trigger if exists org_vault_revisions_storage on public.org_vault_revisions;
create trigger org_vault_revisions_storage
  after insert or update of body, org_id or delete on public.org_vault_revisions
  for each row execute function public.org_storage_track();

-- Backfill from what is stored now, so the first write after this migration
-- is checked against the real total. Re-running recomputes it.
insert into public.org_storage_usage (org_id, bytes)
select org_id, sum(bytes)::bigint
  from (
    select org_id, octet_length(body)::bigint as bytes from public.org_vault_notes
    union all
    select org_id, octet_length(body)::bigint from public.org_vault_revisions
  ) stored
 group by org_id
on conflict (org_id) do update
  set bytes = excluded.bytes,
      updated_at = now();
