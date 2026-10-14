-- 0029: push_sends keeps a keyed hash of the session id, never the id itself
-- (security and privacy review 2026-10-01, follow-up 3).
--
-- push-send now writes HMAC-SHA256(PUSH_SESSION_HASH_KEY, session id) into
-- push_sends.session_id and its dedupe_key, and counts the cooldown by user and
-- that hash, so the send log cannot be matched to a session on the person's
-- computer without the key, which lives only in the function's secrets. This
-- file clears the rows that still hold a raw id and fits the index to the new
-- lookup.
--
-- UNAPPLIED. It lands on main for the founder's push through
-- docs/vault-gate1-runbook.md, after supabase/scripts/push-preflight.mjs; that
-- push appends its history row. Order: set PUSH_SESSION_HASH_KEY on the
-- functions and deploy push-send first (without the key push-send sends
-- nothing, so no raw id is stored meanwhile), then apply this file.
--
-- Every statement is safe to run again.

-- 1. Rows from before the keyed hash. They are rate accounting only, kept 2
--    days (0027); a raw session id is the one thing in them worth not keeping.
--    A keyed hash is 64 hex characters and an engine session id is 8, so the
--    test below never deletes a keyed row.
delete from public.push_sends where session_id !~ '^[0-9a-f]{64}$';

-- 2. push-send looks the cooldown up by user and session hash.
drop index if exists public.push_sends_session_time_idx;
create index if not exists push_sends_user_session_time_idx
  on public.push_sends (user_id, session_id, created_at);

comment on column public.push_sends.session_id is
  'HMAC-SHA256 hex of the session id under the push-send function secret PUSH_SESSION_HASH_KEY (0029). Never the raw id.';
