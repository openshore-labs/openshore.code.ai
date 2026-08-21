-- Idempotency ledger for App Store Server Notifications V2.
--
-- Apple delivers a notification at-least-once and retries on any non-2xx, so the
-- apple-notifications function can see the same notificationUUID more than once.
-- It records the uuid here BEFORE processing; a unique-violation on the primary
-- key means the delivery was already handled, so the function no-ops with 200.
-- If processing then fails and the function returns 500 for a retry, it DELETES
-- the uuid first so the retry reprocesses (the recorded uuid must never make a
-- failed write look done). This mirrors the ordering guard on user_entitlements
-- but catches EXACT re-deliveries, which the timestamp guard alone would let
-- through as harmless re-writes.
--
-- Service-role only: like user_entitlements and apple_links, only the edge
-- function (service role, which bypasses RLS) reads or writes this table. RLS is
-- enabled with NO policies, so every anon/authenticated access is denied by
-- default, and no grants are issued to those roles.
--
-- Deploy ordering: apply BEFORE deploying apple-notifications, which inserts
-- into this table on every call; without it the function 500s on a missing table.

create table if not exists public.apple_notifications_seen (
  notification_uuid text primary key,
  received_at timestamptz not null default now()
);

alter table public.apple_notifications_seen enable row level security;

-- No policies: with RLS on and none defined, all client access is denied. Only
-- the service role writes/reads this table. Belt-and-suspenders, make sure the
-- anon/authenticated roles hold no table privileges either.
revoke all on public.apple_notifications_seen from anon, authenticated;
