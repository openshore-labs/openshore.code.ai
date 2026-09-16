-- The graduated enforcement ladder, and the one row a person may remove
-- themselves: their own org membership.
--
-- WHY THIS EXISTS
--
-- 0016 (and 0017, which reconciled it onto the live schema) set `terminate` on
-- the FIRST Tier 1 block. The Tier 1 classifier can misread, and a single false
-- positive flagged an account for removal, silently: the app never read
-- enforcement_actions and the person had no appeal path (review 8, finding 6;
-- Technical Advisor memo item 1). The board settled the graduated shape
-- (2026-09-16): one warns you, a pattern or a human ends you.
--
--   log-only   No countable block on the account.
--   warn       One confirmed Tier 1 block within the rolling window. The app
--              shows it as standing with the appeal path (support@openshore.ai).
--   terminate  A SECOND confirmed Tier 1 block within the rolling window, or an
--              operator's own confirmation through admin_confirm_termination.
--              Termination still means: flagged for the operator to remove and
--              a report prepared (never submitted by this system).
--
-- "Confirmed" means the block carries at least one named classifier signal
-- (guardrail_events.signals), which is the high-confidence path: the rule pass
-- named what it saw. A block with no signal at all is not a confirmed strike;
-- it still counts toward the log line and the app still refused it.
--
-- WHAT DOES NOT CHANGE
--
-- Tier 1 blocking itself. Every Tier 1 request is still refused on the device,
-- before any model sees it; this file only changes what happens to the ACCOUNT
-- afterwards. check-failed and likeness stay non-countable. No network address
-- is stored, read, or reasoned about anywhere here (0016 header note).
--
-- Deploy ordering: additive, applies after 0017.

-- ---------------------------------------------------------------------------
-- The rolling window
-- ---------------------------------------------------------------------------

-- How long a warning stays "live" for the purposes of a second strike. A
-- second confirmed Tier 1 block after the window is a fresh warning, not a
-- termination, so a misread years apart never compounds.
create or replace function public.enforcement_window ()
returns interval
language sql
immutable
as $$
  select interval '90 days';
$$;

-- ---------------------------------------------------------------------------
-- The ladder, graduated
-- ---------------------------------------------------------------------------

-- Same signature as 0016/0017 (no arguments, computed from server truth), so
-- the app's call site is unchanged. A client still cannot pass a level in.
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
  v_confirmed_recent int;
  v_operator_terminated boolean;
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
    count(*) filter (where tier = 1 and category <> 'check-failed'),
    count(*) filter (
      where tier = 1
        and category in ('csam', 'ncii', 'weapons-uplift')
        and cardinality(signals) >= 1
        and occurred_at >= now() - public.enforcement_window()
    )
    into v_countable, v_tier1, v_confirmed_recent
    from public.guardrail_events
   where user_id = v_uid and action = 'blocked';

  -- An operator's own confirmation stands regardless of the window.
  select exists (
    select 1 from public.enforcement_actions
     where user_id = v_uid and action = 'terminate' and actor <> 'system'
  ) into v_operator_terminated;

  if v_operator_terminated or v_confirmed_recent >= 2 then
    v_level := 2;
    v_action := 'terminate';
    v_reason := case
      when v_operator_terminated then 'Termination confirmed by an operator.'
      else v_confirmed_recent || ' confirmed prohibited requests in hard-blocked categories within '
        || extract(day from public.enforcement_window())::int || ' days.'
    end;
  elsif v_tier1 > 0 then
    v_level := 1;
    v_action := 'warn';
    v_reason := 'A request was blocked in a hard-blocked category. A second confirmed block within '
      || extract(day from public.enforcement_window())::int
      || ' days ends the account. If this was legitimate work, write to support@openshore.ai.';
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

-- ---------------------------------------------------------------------------
-- The operator's confirmation
-- ---------------------------------------------------------------------------

-- The human half of "a pattern or a human ends you". An abuse reviewer, after
-- reading the prepared evidence (category, tier, time, hash, signal names,
-- never the prompt), confirms a termination for an account. Records who did it
-- (actor is the reviewer's uuid, never 'system') and prepares the report the
-- same way the ladder does. Nothing here deletes the account: removal stays a
-- deliberate operator step outside this system, as in 0016.
create or replace function public.admin_confirm_termination (
  p_user_id uuid,
  p_reason text
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
  if p_user_id is null then
    raise exception 'no account named';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a reason is required';
  end if;

  insert into public.enforcement_actions (user_id, level, action, reason, actor)
  values (p_user_id, 2, 'terminate', btrim(p_reason), auth.uid()::text);

  insert into public.abuse_reports (user_id, category, request_hash, occurred_at, status, detail)
  select p_user_id, g.category, g.request_hash, g.occurred_at, 'queued',
    'Prepared and stored for the operator. No submission integration is configured, so nothing has been sent.'
    from public.guardrail_events g
   where g.user_id = p_user_id and g.action = 'blocked' and g.tier = 1
     and g.category in ('csam', 'ncii', 'weapons-uplift')
     and not exists (
       select 1 from public.abuse_reports r
        where r.user_id = p_user_id and r.request_hash = g.request_hash
     )
   order by g.occurred_at desc
   limit 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Leave company: a person may delete their OWN membership row
-- ---------------------------------------------------------------------------

-- The join sheet promised "You can leave the company account from Settings at
-- any time" and nothing implemented it (review 6, defect 1). 0015's delete
-- policy lets only an admin or the owner remove a row; this one adds the
-- person themselves, for their own bound row only. An admin removing someone
-- else is unchanged. An owner cannot leave their own org this way (the row
-- they would delete is the bootstrap admin row; ownership is handled by the
-- orgs table, not membership).
drop policy if exists members_delete_self on public.org_members;
create policy members_delete_self on public.org_members for delete
  using (user_id = auth.uid() and not public.is_org_owner(org_id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant delete on public.org_members to authenticated;
grant execute on function public.enforcement_window () to authenticated;
grant execute on function public.record_enforcement () to authenticated;
grant execute on function public.admin_confirm_termination (uuid, text) to authenticated;
