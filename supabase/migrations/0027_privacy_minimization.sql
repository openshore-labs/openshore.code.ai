-- 0027: privacy minimization (CTO security and privacy review, 2026-10-01,
-- docs/security-privacy-review-2026-10-01.md; the Proton standard: keep the
-- bare minimum). Applied 2026-10-02 by the founder in the SQL editor, block by
-- block, then recorded here with its history row. Every statement is safe to
-- run again.

-- 1. Keep push data only as long as it is useful: the send log 2 days, stale
--    tokens and grants after 180 days.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'oscode_privacy_retention') then
      perform cron.unschedule('oscode_privacy_retention');
    end if;
    perform cron.schedule('oscode_privacy_retention', '17 4 * * *', $job$
      delete from public.push_sends where created_at < now() - interval '2 days';
      delete from public.push_grants
       where (revoked_at is not null and revoked_at < now() - interval '30 days')
          or coalesce(last_sent_at, created_at) < now() - interval '180 days';
      delete from public.push_devices where updated_at < now() - interval '180 days';
    $job$);
  end if;
end $$;

-- 2. No names on our server: the app can no longer write likeness consents,
--    and the rows go.
revoke insert, update on public.likeness_consents from authenticated, anon;
delete from public.likeness_consents;

-- 3. The guardrail rows the app no longer uploads (a failed check, an
--    allowed-with-assertion), unless a legal hold keeps them.
delete from public.guardrail_events
 where (action is distinct from 'blocked' or category = 'check-failed')
   and (legal_hold_until is null or legal_hold_until <= now());

-- 4. No new model reviews while the Marketplace (v3) is shut; the migration
--    that opens it grants these back.
revoke insert, update on public.model_reviews from authenticated;
revoke insert on public.review_reports from authenticated;

-- 5. The login service's own logs: a week of the audit log, and no IP address
--    or user agent kept on sessions.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'oscode_auth_log_retention') then
      perform cron.unschedule('oscode_auth_log_retention');
    end if;
    perform cron.schedule('oscode_auth_log_retention', '23 4 * * *', $job$
      delete from auth.audit_log_entries where created_at < now() - interval '7 days';
      update auth.sessions set ip = null, user_agent = null
       where ip is not null or user_agent is not null;
    $job$);
  end if;
end $$;
