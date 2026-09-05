-- The ethics layer's account-side record: what was blocked, what authorization
-- a person asserted, what enforcement followed, and the one queue a human has
-- to work through (reports prepared for an authority).
--
-- WHAT IS STORED, AND WHAT IS DELIBERATELY NOT
--
-- Stored: a category tag, a tier, a timestamp, a SHA-256 of the request, and
-- which model path served it. That is enough to run the enforcement ladder, to
-- recognize a repeat, and to identify the same request in a lawful report.
--
-- NOT stored: the prompt, the completion, or any excerpt of either. There is no
-- column here that could hold them. Retaining harmful material in order to
-- police harmful material is its own harm, and the hash does the job.
--
-- NO NETWORK ADDRESSES, ANYWHERE, EVER.
--
-- An earlier draft of this migration captured the caller's network location on
-- a block (and, before that, on every row). The founder cut it (2026-09-05,
-- after CTO and CMO review): enforcement is account termination plus a lawful
-- report, full stop, and nothing here collects, stores, or reasons about where
-- a request came from. There is no header-reading function, no column for it
-- on anything, and no address-ban queue, because banning a network location is
-- not a capability this product has. `test/ethicsEnforcement.test.ts` greps
-- this file for the identifiers that draft used, so they can never come back
-- quietly.
--
-- Deploy ordering: additive, applies after 0015 (the 2026-09-05 review migration).

-- ---------------------------------------------------------------------------
-- Blocked requests
-- ---------------------------------------------------------------------------

create table if not exists public.guardrail_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 'csam' | 'ncii' | 'weapons-uplift' | 'likeness' | 'check-failed'
  category text not null check (
    category in ('csam', 'ncii', 'weapons-uplift', 'likeness', 'check-failed')
  ),
  tier smallint not null check (tier between 1 and 3),
  occurred_at timestamptz not null default now(),
  -- SHA-256 hex of the screened text. Never reversible to the content.
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  model_path text not null check (model_path in ('local', 'cloud')),
  action text not null check (action in ('blocked', 'allowed-with-assertion')),
  side text not null check (side in ('input', 'output')),
  -- Signal names only, as evidence for a reviewer. No matched text.
  signals text[] not null default '{}',
  -- Tier 2 only: the subject named, so an assertion can be audited.
  subject text,
  created_at timestamptz not null default now()
);
create index if not exists guardrail_events_user_time_idx
  on public.guardrail_events (user_id, occurred_at desc);
create index if not exists guardrail_events_tier_idx
  on public.guardrail_events (tier, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Authorization assertions (the Tier 2 accountability record)
-- ---------------------------------------------------------------------------

create table if not exists public.likeness_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The subject as the person named them, normalized lowercase for matching.
  subject text not null check (length(btrim(subject)) > 0),
  asserted_at timestamptz not null default now(),
  unique (user_id, subject)
);
create index if not exists likeness_consents_user_idx on public.likeness_consents (user_id);

-- ---------------------------------------------------------------------------
-- Enforcement actions taken on an account
-- ---------------------------------------------------------------------------

create table if not exists public.enforcement_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  level smallint not null check (level between 0 and 2),
  action text not null check (action in ('log-only', 'warn', 'restrict', 'terminate')),
  reason text not null,
  -- Who acted: 'system' for the ladder, or a reviewer's uuid as text.
  actor text not null default 'system',
  created_at timestamptz not null default now()
);
create index if not exists enforcement_actions_user_idx
  on public.enforcement_actions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Reports prepared for an authority or hotline
-- ---------------------------------------------------------------------------

create table if not exists public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  category text not null check (category in ('csam', 'ncii', 'weapons-uplift')),
  request_hash text not null,
  occurred_at timestamptz not null,
  -- 'queued' until an operator actually submits it. Nothing in this system
  -- marks a report submitted on its own, because nothing in this system submits
  -- one: claiming otherwise would be worse than having no hook at all.
  status text not null default 'queued'
    check (status in ('queued', 'submitted', 'not-submitted')),
  destination text,
  detail text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  submitted_by uuid references auth.users (id) on delete set null
);
create index if not exists abuse_reports_status_idx on public.abuse_reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Who may review enforcement
-- ---------------------------------------------------------------------------

-- A separate allowlist from review_moderators (0012). Community review
-- moderation and abuse enforcement are different jobs with different stakes,
-- and one should not silently grant the other.
--
-- Seeding, from the SQL editor:
--   insert into public.abuse_reviewers (user_id)
--   select id from auth.users where email = 'founder@openshore.ai'
--   on conflict do nothing;
-- Nobody is a reviewer until seeded, so this ships inert.
create table if not exists public.abuse_reviewers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

create or replace function public.is_abuse_reviewer ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.abuse_reviewers where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.guardrail_events enable row level security;
alter table public.likeness_consents enable row level security;
alter table public.enforcement_actions enable row level security;
alter table public.abuse_reports enable row level security;
alter table public.abuse_reviewers enable row level security;

-- A person may write their own block records and read their own history. They
-- may not update or delete them: an audit trail a person can edit is not one.
drop policy if exists guardrail_events_insert_own on public.guardrail_events;
create policy guardrail_events_insert_own on public.guardrail_events for insert
  with check (user_id = auth.uid());

drop policy if exists guardrail_events_select_own on public.guardrail_events;
create policy guardrail_events_select_own on public.guardrail_events for select
  using (user_id = auth.uid() or public.is_abuse_reviewer());

-- Assertions: a person makes their own, reads their own, and may withdraw one.
drop policy if exists likeness_consents_insert_own on public.likeness_consents;
create policy likeness_consents_insert_own on public.likeness_consents for insert
  with check (user_id = auth.uid());

drop policy if exists likeness_consents_select_own on public.likeness_consents;
create policy likeness_consents_select_own on public.likeness_consents for select
  using (user_id = auth.uid() or public.is_abuse_reviewer());

drop policy if exists likeness_consents_delete_own on public.likeness_consents;
create policy likeness_consents_delete_own on public.likeness_consents for delete
  using (user_id = auth.uid());

-- Enforcement actions are readable by the person they apply to, so a warning or
-- a restriction is never a mystery. Only the service role and the guarded RPCs
-- write them.
drop policy if exists enforcement_actions_select_own on public.enforcement_actions;
create policy enforcement_actions_select_own on public.enforcement_actions for select
  using (user_id = auth.uid() or public.is_abuse_reviewer());

-- The report queue and the reviewer allowlist are reviewer-only, through the
-- RPCs below. With RLS on and no insert/update/delete policy, every client
-- write is denied by default.
drop policy if exists abuse_reports_select_reviewer on public.abuse_reports;
create policy abuse_reports_select_reviewer on public.abuse_reports for select
  using (public.is_abuse_reviewer());

drop policy if exists abuse_reviewers_select_self on public.abuse_reviewers;
create policy abuse_reviewers_select_self on public.abuse_reviewers for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The enforcement RPCs
-- ---------------------------------------------------------------------------

-- Evaluate the enforcement ladder for the calling account FROM SERVER TRUTH,
-- and, on a termination, prepare a report for review.
--
-- The level is computed here from guardrail_events, not passed by the client.
-- That fixes two things a client-driven version would get wrong: a reinstall
-- cannot reset the ladder (the history lives on the server), and a client
-- cannot under-report its own standing. The app calls this with no arguments
-- after a block and reads back the outcome.
--
-- The ladder matches the engine's evaluateEnforcement: any Tier 1 block is
-- termination; check-failed and likeness are non-countable. Termination here
-- means the account is flagged for the operator to remove; this function does
-- not delete the account itself, and it does not touch, request, or reason
-- about any network address.
create or replace function public.record_enforcement ()
returns table (level smallint, action text, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_countable int;
  v_tier1 int;
  v_level smallint;
  v_action text;
  v_reason text;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- Countable violations: blocked requests, excluding check-failed (the layer
  -- failing closed) and likeness (the non-countable consent gate).
  select
    count(*) filter (where category not in ('check-failed', 'likeness')),
    count(*) filter (where tier = 1 and category <> 'check-failed')
    into v_countable, v_tier1
    from public.guardrail_events
   where user_id = v_uid and action = 'blocked';

  if v_tier1 > 0 then
    v_level := 2;
    v_action := 'terminate';
    v_reason := case
      when v_tier1 = 1 then 'A prohibited request in a hard-blocked category.'
      else v_tier1 || ' prohibited requests in hard-blocked categories.'
    end;
  else
    v_level := 0;
    v_action := 'log-only';
    v_reason := v_countable || ' blocked request(s) on this account.';
  end if;

  insert into public.enforcement_actions (user_id, level, action, reason, actor)
  values (v_uid, v_level, v_action, v_reason, 'system');

  if v_action = 'terminate' then
    -- Prepare (do not submit) a report for the latest Tier 1 block, deduped by
    -- request hash so re-running does not re-report the same content.
    insert into public.abuse_reports (user_id, category, request_hash, occurred_at, status, detail)
    select v_uid, g.category, g.request_hash, g.occurred_at, 'queued',
      'Prepared and stored for the operator. No submission integration is configured, so nothing has been sent.'
      from public.guardrail_events g
     where g.user_id = v_uid and g.action = 'blocked' and g.tier = 1
       and g.category in ('csam', 'ncii', 'weapons-uplift')
       and not exists (
         select 1 from public.abuse_reports r
          where r.user_id = v_uid and r.request_hash = g.request_hash
       )
     order by g.occurred_at desc
     limit 1;
  end if;

  return query select v_level, v_action, v_reason;
end;
$$;

-- Store a report for the operator. Storing is not submitting.
create or replace function public.queue_abuse_report (
  p_category text,
  p_request_hash text,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_category not in ('csam', 'ncii', 'weapons-uplift') then
    raise exception 'invalid report category %', p_category;
  end if;
  insert into public.abuse_reports (user_id, category, request_hash, occurred_at, status, detail)
  values (
    auth.uid(),
    p_category,
    p_request_hash,
    p_occurred_at,
    'queued',
    'Prepared and stored for the operator. No submission integration is configured, so nothing has been sent.'
  );
end;
$$;

-- The reviewer's report queue, and the one place a report is marked submitted:
-- by a person who actually submitted it, recording who and when.
create or replace function public.admin_list_abuse_reports (p_limit int default 100)
returns setof public.abuse_reports
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_abuse_reviewer () then
    raise exception 'not an abuse reviewer';
  end if;
  return query
    select * from public.abuse_reports
    order by (status = 'queued') desc, created_at desc
    limit greatest(1, least(p_limit, 500));
end;
$$;

create or replace function public.admin_mark_report_submitted (
  p_report_id uuid,
  p_destination text,
  p_detail text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_abuse_reviewer () then
    raise exception 'not an abuse reviewer';
  end if;
  update public.abuse_reports
     set status = 'submitted',
         destination = p_destination,
         detail = p_detail,
         submitted_at = now(),
         submitted_by = auth.uid()
   where id = p_report_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert on public.guardrail_events to authenticated;
grant select, insert, delete on public.likeness_consents to authenticated;
grant select on public.enforcement_actions to authenticated;
grant select on public.abuse_reports to authenticated;
grant select on public.abuse_reviewers to authenticated;

grant execute on function public.is_abuse_reviewer () to authenticated;
grant execute on function public.record_enforcement () to authenticated;
grant execute on function public.queue_abuse_report (text, text, timestamptz) to authenticated;
grant execute on function public.admin_list_abuse_reports (int) to authenticated;
grant execute on function public.admin_mark_report_submitted (uuid, text, text) to authenticated;
