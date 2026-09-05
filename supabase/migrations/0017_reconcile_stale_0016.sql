-- 0016_guardrail_enforcement.sql was edited in place four times after it was
-- first written (IP capture narrowed to blocks only, the enforcement ladder
-- moved server-side, then IP capture removed entirely). Every one of those
-- edits was believed to be pre-deploy. It was not: `0016` was already recorded
-- as applied against production, from the very first draft of that file (the
-- version with unconditional IP capture on every row, the full ip_ban_proposals
-- queue, and a client-driven record_enforcement). Postgres tracks a migration
-- by version number, not content, so none of the later edits ever reached the
-- live database. Discovered 2026-09-05 by querying the live schema directly
-- rather than trusting the file (see DECISIONS.md).
--
-- This migration reconciles that gap: it brings the live schema up to exactly
-- what the current 0016 file describes. Confirmed empty before writing this
-- (ban_proposals_count, guardrail_events_count, consents_count all 0), so
-- nothing real is lost.
--
-- Every statement here is written to be a no-op on a fresh project that never
-- had the stale objects (0016 as it stands today never creates them), so this
-- migration is safe to run once, in order, on any environment.

-- ---------------------------------------------------------------------------
-- No network addresses, anywhere, ever (matches the 0016 header note).
-- ---------------------------------------------------------------------------

drop index if exists public.guardrail_events_ip_idx;
alter table public.guardrail_events drop column if exists ip_address;
alter table public.likeness_consents drop column if exists ip_address;
drop function if exists public.request_ip ();

-- The IP ban queue never should have existed as a live capability. Cascade
-- takes its policy and index with it; there is nothing else that depends on
-- this table.
drop table if exists public.ip_ban_proposals cascade;
drop function if exists public.admin_list_ip_ban_proposals (int);
drop function if exists public.admin_decide_ip_ban (uuid, text, timestamptz);

-- ---------------------------------------------------------------------------
-- The enforcement ladder, computed server-side (matches the 0016 file).
-- ---------------------------------------------------------------------------

-- The stale live version took three client-supplied arguments and reasoned
-- about an IP address. Drop it outright rather than leave a superseded
-- overload reachable.
drop function if exists public.record_enforcement (smallint, text, text);

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

grant execute on function public.record_enforcement () to authenticated;
