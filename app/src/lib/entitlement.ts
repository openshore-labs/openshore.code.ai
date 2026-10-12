// Whether a billing entitlement is live. OpenShore has no paid gate for a
// person (open source, 2026-10-11); this reads only a commercial
// org's team-seat billing (a later tier, docs/release-tiers.md), which the
// Stripe webhook writes and the store's growthGatedByBilling checks.

type EntitlementLike = { status: string; validUntil?: string | null };

// Only active or trialing grant access; every other status (past_due, unpaid,
// canceled, incomplete, incomplete_expired, paused) is revoked.
const ENTITLED_STATUSES = new Set(['active', 'trialing']);

/** An active or trialing subscription whose paid period has not lapsed. */
export function isEntitled(e?: EntitlementLike): boolean {
  return (
    !!e &&
    ENTITLED_STATUSES.has(e.status) &&
    (!e.validUntil || new Date(e.validUntil).getTime() > Date.now())
  );
}
