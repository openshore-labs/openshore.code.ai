-- Moderation surface for community reviews (Apple 1.2: a first-party way to act
-- on reported content, beyond the auto-hide trigger in 0011 and the Supabase
-- dashboard). A small operator allowlist decides who may moderate; the RPCs run
-- SECURITY DEFINER above RLS but refuse anyone not in that allowlist.
--
-- Seeding: the founder adds an operator by user id from the dashboard, e.g.
--   insert into public.review_moderators (user_id) values ('<auth-user-uuid>');
-- Nobody is a moderator until seeded, so this ships inert and safe.
--
-- Deploy ordering: apply AFTER 0011 (it references model_reviews). Additive.

create table if not exists public.review_moderators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

-- RLS: a moderator may read the table to confirm their own membership; nobody
-- writes it from a client (seeded by the service role only). With RLS on and no
-- insert/update/delete policy, client writes are denied by default.
alter table public.review_moderators enable row level security;

drop policy if exists review_moderators_select on public.review_moderators;
create policy review_moderators_select on public.review_moderators for select
  using (user_id = auth.uid());

-- Is the caller a moderator? A cheap check the app uses to decide whether to
-- show the moderation surface at all.
create or replace function public.is_review_moderator ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.review_moderators where user_id = auth.uid());
$$;

-- The moderation queue: reviews that are reported, hidden, or carry any flags,
-- most-flagged first. Refuses a non-moderator. SECURITY DEFINER so it can read
-- rows the public read policy hides (reported/hidden), but only for an operator.
create or replace function public.admin_list_reviews (p_limit int default 100)
returns setof public.model_reviews
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_review_moderator () then
    raise exception 'not a review moderator';
  end if;
  return query
    select *
    from public.model_reviews
    where status <> 'visible' or flag_count > 0
    order by flag_count desc, created_at desc
    limit greatest(1, least(p_limit, 500));
end;
$$;

-- Set a review's status. Restoring to visible also clears the flag count, so a
-- reviewed-and-kept review is not immediately re-hidden by its old reports.
create or replace function public.admin_set_review_status (p_review_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_review_moderator () then
    raise exception 'not a review moderator';
  end if;
  if p_status not in ('visible', 'hidden', 'reported') then
    raise exception 'invalid status %', p_status;
  end if;
  update public.model_reviews
     set status = p_status,
         flag_count = case when p_status = 'visible' then 0 else flag_count end,
         updated_at = now()
   where id = p_review_id;
end;
$$;

grant execute on function public.is_review_moderator () to authenticated;
grant execute on function public.admin_list_reviews (int) to authenticated;
grant execute on function public.admin_set_review_status (uuid, text) to authenticated;
