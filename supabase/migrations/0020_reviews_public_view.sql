-- Community reviews without author ids for anonymous readers, and a server-set
-- "OpenShore team" label (compliance pass two, part A). Implements the advisory
-- org's 2026-09-24 ruling "Community ratings show the raw average": no user_id
-- for anonymous readers, and a staff label the server sets, never the client.
--
-- WHAT CHANGES
--
--   1. review_staff: the allowlist behind the "OpenShore team" tag. Same shape
--      as review_moderators (0012), but nobody reads or writes it from a
--      client; the service role seeds it from the SQL editor:
--        insert into public.review_staff (user_id)
--        select id from auth.users where email = '<staff address>'
--        on conflict do nothing;
--   2. model_reviews_public: the read surface the store uses. Every column the
--      app displays, the review id (report and block act on it), is_staff, and
--      is_mine (true only on the reader's own review, so the app can mark "You"
--      without learning anyone's id). No user_id. It filters to visible rows
--      and applies the reader's blocks itself, because it reads the base table
--      with its owner's rights (see the note on the view).
--   3. model_reviews: anon can no longer read the base table. A signed-in
--      person reads only their own rows there (for edit and delete).
--   4. The aggregate RPCs (0011 model_review_summary, model_review_summaries,
--      0013 model_review_snapshot) read the base table as the caller, which
--      anon can no longer do. They become SECURITY DEFINER with the same
--      visibility written into their WHERE clauses, and keep their grants.
--   5. block_review_author(review id): blocking by review, since the reader no
--      longer sees the author id.
--
-- Deploy ordering: apply after 0019 and BEFORE shipping the app build that
-- reads model_reviews_public. An older build reads model_reviews directly and
-- would see only the signed-in person's own review after this applies, so ship
-- the new build first where that matters. Nothing here depends on 0019.

-- ---------------------------------------------------------------------------
-- 1. Staff allowlist
-- ---------------------------------------------------------------------------

create table if not exists public.review_staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.review_staff enable row level security;
-- No policies and no client grants: only the service role reads or writes it.
revoke all on public.review_staff from anon, authenticated;
grant all on public.review_staff to service_role;

-- ---------------------------------------------------------------------------
-- 2. The public read surface
-- ---------------------------------------------------------------------------

-- A plain (owner-rights) view on purpose: it must read model_reviews for anon,
-- who no longer holds select on the base table, and read review_staff, which no
-- client may read. Because the owner's rights skip the base table's RLS, the
-- visibility rules are written here: visible rows only, and never a row by an
-- author the reader has blocked (author_blocked is false for anon). The
-- security_barrier keeps a caller's filter from being pushed below these.
drop view if exists public.model_reviews_public;
create view public.model_reviews_public
with (security_barrier = true, security_invoker = false)
as
select
  r.id,
  r.model_id,
  r.rating,
  r.body,
  r.use_cases,
  r.hardware,
  r.ram_gb,
  r.tokens_per_sec,
  r.quant,
  r.felt_speed,
  r.created_at,
  r.updated_at,
  exists (select 1 from public.review_staff s where s.user_id = r.user_id) as is_staff,
  coalesce(r.user_id = auth.uid(), false) as is_mine
from public.model_reviews r
where r.status = 'visible'
  and not public.author_blocked (r.user_id);

revoke all on public.model_reviews_public from anon, authenticated;
grant select on public.model_reviews_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The base table: no anonymous read, own rows only when signed in
-- ---------------------------------------------------------------------------

drop policy if exists model_reviews_select on public.model_reviews;
create policy model_reviews_select on public.model_reviews for select
  to authenticated
  using (auth.uid() = user_id);

revoke select on public.model_reviews from anon;
grant select on public.model_reviews to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Aggregates keep working for anon
-- ---------------------------------------------------------------------------

create or replace function public.model_review_summary (p_model_id text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'model_id', p_model_id,
    'count', count(*),
    'average', coalesce(avg(rating), 0),
    'dist', json_build_object(
      '1', count(*) filter (where rating = 1),
      '2', count(*) filter (where rating = 2),
      '3', count(*) filter (where rating = 3),
      '4', count(*) filter (where rating = 4),
      '5', count(*) filter (where rating = 5)
    )
  )
  from public.model_reviews
  where model_id = p_model_id
    and status = 'visible'
    and not public.author_blocked (user_id);
$$;

create or replace function public.model_review_summaries (p_model_ids text[])
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(r), '[]'::json)
  from (
    select model_id, count(*) as count, avg(rating) as average
    from public.model_reviews
    where status = 'visible'
      and model_id = any (p_model_ids)
      and not public.author_blocked (user_id)
    group by model_id
  ) r;
$$;

create or replace function public.model_review_snapshot ()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(r), '[]'::json)
  from (
    select model_id, count(*) as count, avg(rating) as average
    from public.model_reviews
    where status = 'visible'
    group by model_id
    order by model_id
  ) r;
$$;

grant execute on function public.model_review_summary (text) to anon, authenticated;
grant execute on function public.model_review_summaries (text[]) to anon, authenticated;
grant execute on function public.model_review_snapshot () to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Block by review
-- ---------------------------------------------------------------------------

-- The reader names the review; the server looks up its author and records the
-- block. The reader never handles the author id to do it.
create or replace function public.block_review_author (p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select user_id into v_author from public.model_reviews where id = p_review_id;
  if v_author is null then
    raise exception 'review not found';
  end if;
  if v_author = auth.uid() then
    raise exception 'you cannot block yourself';
  end if;
  insert into public.user_blocks (blocker_id, blocked_id)
  values (auth.uid(), v_author)
  on conflict do nothing;
end;
$$;

revoke execute on function public.block_review_author (uuid) from public, anon;
grant execute on function public.block_review_author (uuid) to authenticated;
