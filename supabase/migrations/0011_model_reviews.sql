-- Community model reviews: crowd-sourced run reports for the Marketplace.
--
-- This is a deliberate change to a documented foundation. Until now the store's
-- ratings were benchmark-derived only ("OpenShore fit"), never crowd-sourced.
-- The founder asked for App-Store-style user reviews, so the store now carries
-- TWO separate rating axes: the benchmark score (static, in catalog.json, never
-- touched here) and this community score (dynamic, here). They are kept apart in
-- the schema, the API, and the UI so the honesty foundation is not corrupted: a
-- community rating is always shown with a count and never merges into the
-- benchmark stars.
--
-- Apple App Store 1.2 (user-generated content) requires four things or the app
-- is rejected: a moderation method, a way to report content, a way to block a
-- user, and a EULA with a zero-tolerance clause. All four are here:
--   - moderation: `status` plus an auto-hide trigger past a report threshold, and
--     the service role can hide/restore any row from the admin surface.
--   - report:     `review_reports` + the auto-hide trigger.
--   - block:      `user_blocks`, enforced in the read policy.
--   - EULA:       `review_eula_acceptance`, required before the first review.
--
-- A model review is a REPORT OF A RUN, so it carries the reviewer's hardware and
-- felt speed alongside the star. That is what lets the store answer "how does it
-- run on a machine like mine," which a benchmark cannot. These fields are shared
-- only when the user submits a review; nothing is auto-collected (the app's
-- local usage stays device-local).
--
-- Deploy ordering: apply this BEFORE the app reads model_reviews. Purely
-- additive; nothing existing depends on it, so it is safe to apply early.
-- Reviews are readable by anon (the store browses signed-out, local-first), so
-- the SELECT policies below grant anon and authenticated; writes require a
-- signed-in user who owns the row.

-- ---------------------------------------------------------------- reviews
create table if not exists public.model_reviews (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The catalog model id (text: "hf-bartowski-qwen3-8b", "qwen2.5-coder-7b").
  -- Not a foreign key: the catalog is a shipped JSON artifact, not a table.
  model_id text not null,
  rating int not null check (rating between 1 and 5),
  body text check (char_length(body) <= 2000),
  -- What they ran it for (capability slugs), so the store can read "4.8 for
  -- coding, 3.9 for reasoning" rather than one mushy average.
  use_cases text[] not null default '{}',
  -- The run, in the reviewer's words. All optional; prefilled from the device on
  -- submit, editable, never invented.
  hardware text check (char_length(hardware) <= 120),
  ram_gb int check (ram_gb between 1 and 4096),
  tokens_per_sec numeric check (tokens_per_sec >= 0 and tokens_per_sec <= 100000),
  quant text check (char_length(quant) <= 40),
  felt_speed text check (felt_speed in ('snappy', 'usable', 'slow')),
  -- Moderation. 'visible' is public; 'reported' is auto-hidden pending review;
  -- 'hidden' is removed by a moderator. Only 'visible' rows are read publicly.
  status text not null default 'visible' check (status in ('visible', 'reported', 'hidden')),
  flag_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One review per person per model. A later submit updates the same row.
  unique (user_id, model_id)
);
create index if not exists model_reviews_model_idx on public.model_reviews (model_id, status);

-- ---------------------------------------------------------------- reports
create table if not exists public.review_reports (
  id uuid primary key default gen_random_uuid (),
  review_id uuid not null references public.model_reviews (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  -- One report per person per review, so a single user cannot inflate the count.
  unique (review_id, reporter_id)
);

-- ---------------------------------------------------------------- blocks
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- ---------------------------------------------------------------- EULA
create table if not exists public.review_eula_acceptance (
  user_id uuid primary key references auth.users (id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default now()
);

-- --------------------------------------------------------- auto-hide trigger
-- A reported review past the threshold is hidden pending moderation (Apple 1.2:
-- objectionable content must be actioned quickly; auto-hide is the first line).
-- SECURITY DEFINER so the count and status update run above the reporter's RLS.
create or replace function public.on_review_reported ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.model_reviews
     set flag_count = flag_count + 1,
         status = case when flag_count + 1 >= 3 then 'reported' else status end,
         updated_at = now()
   where id = new.review_id;
  return new;
end;
$$;

drop trigger if exists review_reported on public.review_reports;
create trigger review_reported
  after insert on public.review_reports
  for each row execute function public.on_review_reported ();

-- --------------------------------------------------------- aggregate RPC
-- The honest community summary for one model, computed server-side over visible
-- rows only, so the client never has to pull every row to average (CTO M9). Runs
-- as the caller (not SECURITY DEFINER) so it honors the same visibility as the
-- read policy. Returned as a single json object: average, count, and the star
-- distribution. The UI count-gates the average (hides a number below a floor).
create or replace function public.model_review_summary (p_model_id text)
returns json
language sql
stable
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
  where model_id = p_model_id and status = 'visible';
$$;

-- A batched summary for many models at once, so the browse list can show a
-- community star per row in ONE call rather than one per row (CTO M9: keep
-- per-browse egress bounded). Returns only count and average per model, over
-- visible rows; the UI count-gates the average as elsewhere.
create or replace function public.model_review_summaries (p_model_ids text[])
returns json
language sql
stable
as $$
  select coalesce(json_agg(r), '[]'::json)
  from (
    select model_id, count(*) as count, avg(rating) as average
    from public.model_reviews
    where status = 'visible' and model_id = any (p_model_ids)
    group by model_id
  ) r;
$$;

-- ---------------------------------------------------------------- RLS
alter table public.model_reviews enable row level security;
alter table public.review_reports enable row level security;
alter table public.user_blocks enable row level security;
alter table public.review_eula_acceptance enable row level security;

-- Has the current user blocked this author? A SECURITY DEFINER helper so the
-- read policy below can enforce blocking WITHOUT granting every reader (anon
-- included) select on user_blocks: a plain subquery in the policy would run as
-- the caller and fail with "permission denied for table user_blocks" for anon,
-- breaking signed-out browsing entirely. For anon, auth.uid() is null and this
-- returns false, so the block clause is a no-op.
create or replace function public.author_blocked (p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks
    where blocker_id = auth.uid() and blocked_id = p_author
  );
$$;
grant execute on function public.author_blocked (uuid) to anon, authenticated;

-- Anyone (anon or signed-in) reads visible reviews, EXCEPT those authored by a
-- user the reader has blocked. This is the one policy that enforces the Apple
-- block requirement at read time.
drop policy if exists model_reviews_select on public.model_reviews;
create policy model_reviews_select on public.model_reviews for select using (
  status = 'visible' and not public.author_blocked (user_id)
);

-- A signed-in user writes only their own review, and can edit or delete it.
drop policy if exists model_reviews_insert on public.model_reviews;
create policy model_reviews_insert on public.model_reviews for insert
  with check (auth.uid() = user_id);

drop policy if exists model_reviews_update on public.model_reviews;
create policy model_reviews_update on public.model_reviews for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and status = 'visible');

drop policy if exists model_reviews_delete on public.model_reviews;
create policy model_reviews_delete on public.model_reviews for delete
  using (auth.uid() = user_id);

-- Reports: a user files their own, and reads only their own (a report is not
-- public). The trigger, not the client, acts on the count.
drop policy if exists review_reports_insert on public.review_reports;
create policy review_reports_insert on public.review_reports for insert
  with check (auth.uid() = reporter_id);

drop policy if exists review_reports_select on public.review_reports;
create policy review_reports_select on public.review_reports for select
  using (auth.uid() = reporter_id);

-- Blocks: a user manages and sees only their own block list.
drop policy if exists user_blocks_all on public.user_blocks;
create policy user_blocks_all on public.user_blocks for all
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

-- EULA acceptance: a user records and reads only their own acceptance.
drop policy if exists review_eula_insert on public.review_eula_acceptance;
create policy review_eula_insert on public.review_eula_acceptance for insert
  with check (auth.uid() = user_id);

drop policy if exists review_eula_select on public.review_eula_acceptance;
create policy review_eula_select on public.review_eula_acceptance for select
  using (auth.uid() = user_id);

-- Table privileges. Supabase's default privileges usually grant these to the
-- anon/authenticated roles automatically, but make it explicit so the feature
-- is not at the mercy of a project's default-privileges config; RLS above still
-- governs which ROWS each role may touch. anon reads only; a signed-in user
-- writes its own rows.
grant select on public.model_reviews to anon, authenticated;
grant insert, update, delete on public.model_reviews to authenticated;
grant select, insert on public.review_reports to authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
grant select, insert, update on public.review_eula_acceptance to authenticated;

-- The summary RPC is safe for anyone to call (it returns only aggregates over
-- visible rows). PostgREST exposes it at /rest/v1/rpc/model_review_summary.
grant execute on function public.model_review_summary (text) to anon, authenticated;
grant execute on function public.model_review_summaries (text[]) to anon, authenticated;
