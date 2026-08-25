-- Completion push notifications for walk-away-able desktop sessions.
--
-- The desktop daemon runs the agent loop on the user's own machine and keeps
-- going while the phone is closed. This adds the one missing piece: a
-- content-free push ("your session needs you") when a run finishes while idle,
-- or blocks on an approval, and no phone is watching. Payloads never carry code
-- or prompt text, only an opaque session id.
--
-- Three tables:
--   push_devices  - a user's APNs device tokens (the phone registers its own).
--   push_grants   - opaque, revocable capability tokens. The phone mints one and
--                   hands it to its daemon; the daemon presents it to push-send.
--                   This is the ONLY credential the daemon holds for pushing, and
--                   it can do nothing but cause a content-free push to this same
--                   user's own devices. Revoke = delete the row (or set
--                   revoked_at), which a short-exp JWT could not offer and which
--                   the "app stays closed for hours" use case needs (no clock to
--                   silence a long run).
--   push_sends    - idempotency + rate accounting, service-role only.
--
-- Auth model (per the CTO review): the daemon is already fully trusted (it runs
-- the agent and pushes git), so the grant's job is not to defend against the
-- daemon, it is to be single-purpose and revocable if it leaks at rest.
-- push-send derives the target user and device tokens SOLELY from the grant,
-- never from the request body, so a leaked grant cannot become a cross-user
-- push oracle.

-- A user's APNs device tokens. The phone writes its own token (RLS insert-own),
-- which is low-stakes: it is the user's own token and only ever used to deliver
-- these notifications. device_token is the primary key because it is globally
-- unique per install and can move between accounts on a reinstall or a re-sign-in
-- (the upsert then overwrites user_id, so one device maps to one current user).
create table if not exists public.push_devices (
  device_token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'sandbox' for an Xcode debug build (aps-environment development), 'production'
  -- for TestFlight and the App Store. A token is only valid against the matching
  -- APNs host, and push-send cannot tell them apart by inspection, so the phone
  -- records which one it is at register time and push-send routes per token.
  aps_environment text not null check (aps_environment in ('sandbox', 'production')),
  platform text not null default 'ios',
  updated_at timestamptz not null default now()
);
create index if not exists push_devices_user_idx on public.push_devices (user_id);

-- Opaque, revocable capability grants. Only the sha256 of the token is stored;
-- the plaintext is returned to the phone once and never persisted server-side.
create table if not exists public.push_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_sha256 text not null unique,
  label text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_sent_at timestamptz,
  sent_count bigint not null default 0
);
create index if not exists push_grants_user_idx on public.push_grants (user_id);

-- Idempotency + rate accounting. One row per delivered (or attempted) push,
-- keyed by a caller-supplied dedupe key so a push-send retry cannot double-buzz.
-- Service role is the sole reader and writer.
create table if not exists public.push_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id text not null,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index if not exists push_sends_user_time_idx on public.push_sends (user_id, created_at);
create index if not exists push_sends_session_time_idx on public.push_sends (session_id, created_at);

-- RLS. A user may read and manage their OWN device rows and read/revoke their own
-- grants. Grants are minted by push-grant (service role) and consumed by
-- push-send (service role); push_sends is service-role only. Nobody reaches
-- another user's rows.
alter table public.push_devices enable row level security;
alter table public.push_grants enable row level security;
alter table public.push_sends enable row level security;

drop policy if exists push_devices_select on public.push_devices;
create policy push_devices_select on public.push_devices for select
  using (user_id = auth.uid());

-- The phone registers its own token. insert-own and update-own are scoped to the
-- caller so a client can never write a row for another user.
drop policy if exists push_devices_insert on public.push_devices;
create policy push_devices_insert on public.push_devices for insert
  with check (user_id = auth.uid());

drop policy if exists push_devices_update on public.push_devices;
create policy push_devices_update on public.push_devices for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists push_devices_delete on public.push_devices;
create policy push_devices_delete on public.push_devices for delete
  using (user_id = auth.uid());

-- A user may see their own grants (a future settings screen lists paired daemons)
-- and revoke one by setting revoked_at. New grants are inserted by the service
-- role only (push-grant); the client cannot mint one, and the update policy only
-- lets a user flip their own row, never create or reassign it.
drop policy if exists push_grants_select on public.push_grants;
create policy push_grants_select on public.push_grants for select
  using (user_id = auth.uid());

drop policy if exists push_grants_update on public.push_grants;
create policy push_grants_update on public.push_grants for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- push_sends: RLS on, no policies, so client access is denied by default. Only
-- the service role (push-send) reads and writes it.
