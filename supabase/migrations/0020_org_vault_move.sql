-- Org Vault move (Vault M6, plan item 6.2; CTO rulings K3 and K12, 2026-09-27).
--
-- One RPC, org_vault_move, gives the team vault a native rename with the same
-- compare-and-swap contract as every other provider's rename():
--
--   1. Guarded by the source's rev. A stale rev is `changed` with theirs; a
--      source with no live note is `missing`. Nothing is written on either.
--   2. A move never replaces. A live note at the destination, judged under
--      lower(path) the way 0019's unique index judges it, is `exists` with
--      theirs under its real path. The one exception is a case-only rename of
--      the same note (plan.md to Plan.md), which is allowed.
--   3. The displaced version is kept as a 'renamed' revision row at the old
--      path (0019 already allows that reason), so history follows the note.
--   4. A move to a new name tombstones the source and writes the destination,
--      each with a fresh sequence rev, so other devices learn the old path is
--      gone on their next pull and a base rev from before the move never
--      matches either path. A tombstone already at the destination comes back,
--      the same as org_vault_write's if_absent create.
--   5. A case-only rename updates the same row in place (new path, new rev)
--      and leaves no tombstone: a tombstone at plan.md beside a live Plan.md
--      would read as "delete this file" on a case-insensitive volume. A stale
--      tombstone already holding the exact new spelling is dropped first (its
--      'deleted' revision row stays), or the primary key would refuse the move.
--   6. Both paths take 0019's advisory lock, in lower() order, so two moves
--      that cross each other cannot deadlock and a write to either path waits.
--      The unique index stays the backstop: a unique_violation from a race
--      undoes the whole move and answers `exists`.
--   7. The same membership rule as org_vault_write and org_vault_remove: an
--      active member of the org, nobody else. The destination passes
--      org_vault_path_ok.
--
-- Team trash needs no SQL of its own (K6, R3): a trash is org_vault_remove
-- with the base rev (a tombstone plus a 'deleted' revision row), Trash lists
-- tombstones whose latest revision row is 'deleted', and Restore is
-- org_vault_write with if_absent from that revision's body, at the original
-- path or, when that name is taken, at "{title} (restored).md". There is no
-- Empty: org_vault_purge (0019) already drops tombstones and revision rows
-- after 30 days, weekly through pg_cron. The pgTAP file exercises that path.
--
-- Additive: `create or replace` only, no data change. Ships to production after
-- 0019, in order (see supabase/README.md).

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

-- Authenticated only, the same as org_vault_write and org_vault_remove.
revoke execute on function public.org_vault_move(uuid, text, text, bigint) from public, anon;
grant execute on function public.org_vault_move(uuid, text, text, bigint) to authenticated;
