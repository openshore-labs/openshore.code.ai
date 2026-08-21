-- Individual (Personal) entitlements + the Apple purchase link table.
--
-- Until now billing was org-only: org_entitlements (0001/0004), written by the
-- Stripe webhook, gates commercial team seats. The individual Personal plan
-- ($20/yr, unlocks the full app for one person) needs its OWN entitlement,
-- keyed to the Supabase user, not an org. 0001 deliberately kept Personal
-- accounts out of `orgs` ("Personal accounts need no rows here"), so we do NOT
-- reuse a phantom self-org; a dedicated user_entitlements table keeps RLS a
-- direct auth.uid() match and leaves Personal orgless.
--
-- Two payment rails write the SAME row, keyed to the same user_id:
--   - Stripe (web/desktop): stripe-webhook, source 'stripe'.
--   - Apple  (iOS IAP):     apple-notifications, source 'apple', resolved from
--                           apple_links (original_transaction_id -> user_id).
-- The app reads this row via a unified resolver (individual OR org entitles).
--
-- Column choices mirror org_entitlements plus 0004's hard-won lessons:
--   - status uses the SAME widened vocabulary as 0004 so isEntitled() is one
--     rule across both tables.
--   - last_event_at is present from day one (the ordering guard 0004 had to add
--     later), so a late/duplicate webhook or Apple notification can never
--     resurrect a lapsed entitlement.
--
-- Deploy ordering: apply this BEFORE the app reads user_entitlements and BEFORE
-- deploying stripe-webhook's individual path / the apple-notifications function.
-- Purely additive; nothing existing depends on it, so it is safe to apply early.

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier_id text not null default 'personal',
  status text not null default 'active' check (
    status in (
      'active',
      'trialing',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused'
    )
  ),
  -- Which rail wrote this row. An individual buys on exactly one rail at a time;
  -- the double-purchase guard (client-side) keeps it that way.
  source text not null check (source in ('stripe', 'apple')),
  valid_until timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  apple_original_transaction_id text,
  last_event_at timestamptz,
  issued_at timestamptz not null default now()
);

-- Apple ties a subscription to an Apple ID and gives us a stable
-- originalTransactionId; our entitlement is keyed to auth.uid(). This table is
-- the binding. It is written only after the server verifies the signed Apple
-- transaction (link-apple-purchase), never trusted from the client.
--
-- original_transaction_id is the PRIMARY KEY: one Apple subscription maps to
-- exactly one account. On a restore under a different account we MOVE the link
-- (update user_id) rather than duplicate, so one $20 sub cannot be shared across
-- many accounts (move-not-duplicate; the abuse ceiling this tier accepts).
create table if not exists public.apple_links (
  original_transaction_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  linked_at timestamptz not null default now()
);
create index if not exists apple_links_user_idx on public.apple_links (user_id);

-- RLS. A user may READ their own entitlement and their own Apple link; nobody
-- writes either from a client. The service role (stripe-webhook,
-- apple-notifications, link-apple-purchase) bypasses RLS and is the sole writer,
-- exactly as with org_entitlements.
alter table public.user_entitlements enable row level security;
alter table public.apple_links enable row level security;

drop policy if exists user_entitlements_select on public.user_entitlements;
create policy user_entitlements_select on public.user_entitlements for select
  using (user_id = auth.uid());

drop policy if exists apple_links_select on public.apple_links;
create policy apple_links_select on public.apple_links for select
  using (user_id = auth.uid());

-- No insert/update/delete policies: with RLS on and none defined, client writes
-- are denied by default. Only the service role can write.
