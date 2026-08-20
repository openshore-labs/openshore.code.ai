-- Entitlement status widening + ordering column, for the rewritten Stripe
-- webhook. A failed payment produces 'unpaid'/'incomplete*'/'paused' statuses
-- the original CHECK did not allow, which would make the entitlement write fail
-- (and, now that the webhook returns 500 on any write error, retry forever).
-- last_event_at lets the webhook drop stale or duplicate deliveries so a late
-- subscription.updated(active) can never resurrect a canceled sub.
--
-- Deploy ordering: apply this BEFORE or WITH the new stripe-webhook. The old
-- webhook never wrote last_event_at and only wrote the four original statuses,
-- so this migration is backward-compatible with it.

-- The inline CHECK in 0001 auto-named to org_entitlements_status_check.
alter table public.org_entitlements
  drop constraint if exists org_entitlements_status_check;

alter table public.org_entitlements
  add constraint org_entitlements_status_check
  check (
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
  );

alter table public.org_entitlements
  add column if not exists last_event_at timestamptz;
