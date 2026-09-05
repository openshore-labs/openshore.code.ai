-- The ethics layer's account-side record: what was blocked, what authorization
-- a person asserted, what enforcement followed, and the two queues a human has
-- to work through (proposed IP bans, and reports prepared for an authority).
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
-- ON IP ADDRESSES
--
-- request_ip() records the caller's address ON A BLOCK ONLY. This is not a new
-- tracking surface: nothing here records an address for an ordinary request,
-- and there is no address column on anything except a violation record and the
-- ban proposals derived from one.
--
-- Nothing auto-bans. ip_ban_proposals can only ever be created 'pending', and
-- only a human in the abuse_reviewers allowlist can decide one. Addresses are
-- shared (households, offices, cafes, campuses, carrier-grade NAT), so an
-- automatic ban is collateral damage against people who did nothing. The review
-- notes travel with the proposal so the reviewer sees that before the button.
--
-- Deploy ordering: additive, applies after 0015 (the 2026-09-05 review migration).

-- ---------------------------------------------------------------------------
-- The caller's IP, safely.
-- ---------------------------------------------------------------------------

-- PostgREST exposes the request headers as a setting. A missing header, a
-- malformed list, or a value that is not an address must never fail an insert,
-- so every failure path returns null.
create or replace function public.request_ip ()
returns inet
language plpgsql
stable
as $$
declare
  raw text;
begin
  begin
    raw := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  exception when others then
    return null;
  end;
  if raw is null or btrim(raw) = '' then
    return null;
  end if;
  -- x-forwarded-for is a list; the client is the first entry.
  raw := btrim(split_part(raw, ',', 1));
  begin
    return raw::inet;
  exception when others then
    return null;
  end;
end;
$$;

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
  -- Recorded on a violation only. See the header note.
  ip_address inet default public.request_ip(),
  created_at timestamptz not null default now()
);
create index if not exists guardrail_events_user_time_idx
  on public.guardrail_events (user_id, occurred_at desc);
create index if not exists guardrail_events_tier_idx
  on public.guardrail_events (tier, occurred_at desc);
create index if not exists guardrail_events_ip_idx
  on public.guardrail_events (ip_address) where ip_address is not null;

-- ---------------------------------------------------------------------------
-- Authorization assertions (the Tier 2 accountability record)
-- ---------------------------------------------------------------------------

create table if not exists public.likeness_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The subject as the person named them, normalized lowercase for matching.
  subject text not null check (length(btrim(subject)) > 0),
  asserted_at timestamptz not null default now(),
  -- The address the assertion was made from, for the same accountability
  -- reason the assertion itself exists.
  ip_address inet default public.request_ip(),
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
-- Proposed IP bans, for human review
-- ---------------------------------------------------------------------------

create table if not exists public.ip_ban_proposals (
  id uuid primary key default gen_random_uuid(),
  ip_address inet not null,
  -- The account whose termination prompted this proposal.
  user_id uuid references auth.users (id) on delete set null,
  reason text not null,
  proposed_at timestamptz not null default now(),
  -- A proposal starts pending and can only be moved by a reviewer through the
  -- RPC below. There is no code path anywhere that inserts a non-pending row.
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  -- An approved ban carries an expiry. A permanent address ban outlives the
  -- person who earned it and lands on whoever holds the address next.
  expires_at timestamptz,
  review_notes text[] not null default '{}'
);
create index if not exists ip_ban_proposals_status_idx
  on public.ip_ban_proposals (status, proposed_at desc);

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
alter table public.ip_ban_proposals enable row level security;
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

-- The two queues and the reviewer allowlist are reviewer-only, through the RPCs
-- below. With RLS on and no insert/update/delete policy, every client write is
-- denied by default, including a write that tried to set status = 'approved'.
drop policy if exists ip_ban_proposals_select_reviewer on public.ip_ban_proposals;
create policy ip_ban_proposals_select_reviewer on public.ip_ban_proposals for select
  using (public.is_abuse_reviewer());

drop policy if exists abuse_reports_select_reviewer on public.abuse_reports;
create policy abuse_reports_select_reviewer on public.abuse_reports for select
  using (public.is_abuse_reviewer());

drop policy if exists abuse_reviewers_select_self on public.abuse_reviewers;
create policy abuse_reviewers_select_self on public.abuse_reviewers for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The enforcement RPCs
-- ---------------------------------------------------------------------------

-- Record the ladder's outcome for the calling account, and, on a termination,
-- queue an IP ban PROPOSAL for review. Called by the app after a block.
--
-- This function is the only way an ip_ban_proposals row is created, and it can
-- only create a pending one. There is no apply step here, and deliberately no
-- function anywhere in this migration that bans an address.
create or replace function public.record_enforcement (
  p_level smallint,
  p_action text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip inet;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_action not in ('log-only', 'warn', 'restrict', 'terminate') then
    raise exception 'invalid enforcement action %', p_action;
  end if;

  insert into public.enforcement_actions (user_id, level, action, reason, actor)
  values (auth.uid(), p_level, p_action, p_reason, 'system');

  if p_action = 'terminate' then
    v_ip := public.request_ip();
    if v_ip is not null then
      insert into public.ip_ban_proposals (ip_address, user_id, reason, review_notes)
      values (
        v_ip,
        auth.uid(),
        p_reason,
        array[
          'Shared addresses are the norm. Households, offices, cafes, schools, and carrier-grade NAT put unrelated people behind one address.',
          'A ban here does not reach the account holder if they move networks, and it does reach everyone else who does not.',
          'Prefer the account termination alone unless this address shows a pattern across several terminated accounts.',
          'Set an expiry. A permanent address ban outlives the person who earned it.'
        ]
      );
    end if;
  end if;
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

-- The reviewer's queue: proposals waiting on a person, newest first.
create or replace function public.admin_list_ip_ban_proposals (p_limit int default 100)
returns setof public.ip_ban_proposals
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
    select *
    from public.ip_ban_proposals
    where status = 'pending'
    order by proposed_at desc
    limit greatest(1, least(p_limit, 500));
end;
$$;

-- A human decides one proposal. Approving requires an expiry, so a decision to
-- ban an address is always a decision about how long.
create or replace function public.admin_decide_ip_ban (
  p_proposal_id uuid,
  p_decision text,
  p_expires_at timestamptz default null
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
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;
  if p_decision = 'approved' and p_expires_at is null then
    raise exception 'an approved IP ban needs an expiry';
  end if;
  update public.ip_ban_proposals
     set status = p_decision,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         expires_at = case when p_decision = 'approved' then p_expires_at else null end
   where id = p_proposal_id
     and status = 'pending';
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
grant select on public.ip_ban_proposals to authenticated;
grant select on public.abuse_reports to authenticated;
grant select on public.abuse_reviewers to authenticated;

grant execute on function public.request_ip () to authenticated;
grant execute on function public.is_abuse_reviewer () to authenticated;
grant execute on function public.record_enforcement (smallint, text, text) to authenticated;
grant execute on function public.queue_abuse_report (text, text, timestamptz) to authenticated;
grant execute on function public.admin_list_ip_ban_proposals (int) to authenticated;
grant execute on function public.admin_decide_ip_ban (uuid, text, timestamptz) to authenticated;
grant execute on function public.admin_list_abuse_reports (int) to authenticated;
grant execute on function public.admin_mark_report_submitted (uuid, text, text) to authenticated;
