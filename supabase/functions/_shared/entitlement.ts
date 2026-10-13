// The single source of truth for "is this org entitled" and "does a plan cover
// this many seats", shared by every edge function so the gate is computed one
// way. `org_entitlements.status` is authoritative (webhook-written,
// client-read-only); nothing gates on `orgs.tier_id` (that is display only).
//
// Pure and dependency-free on purpose: it is unit-tested in entitlement.test.ts
// (the edge functions themselves have no runtime harness).
//
// Keep the tier bounds in sync with app/src/lib/plans.ts (tierForSeats). Edge
// functions cannot import app code, so this is a hand-mirror; if the bands move
// in plans.ts, move them here in the same change.

/** Statuses that grant access. Everything else (past_due, unpaid, canceled,
 *  incomplete, incomplete_expired, paused) is revoked. past_due is strict
 *  (money-safe); flip it into ENTITLED for a grace window if a maintainer asks. */
export const ENTITLED: ReadonlySet<string> = new Set(['active', 'trialing']);

export interface EntitlementLike {
  status: string;
  validUntil?: string | null;
}

/** True only for an active/trialing entitlement whose window has not lapsed. */
export function isEntitled(e?: EntitlementLike | null): boolean {
  return (
    !!e &&
    ENTITLED.has(e.status) &&
    (!e.validUntil || new Date(e.validUntil).getTime() > Date.now())
  );
}

/** The tier written to orgs.tier_id for DISPLAY: the real tier while entitled,
 *  else 'personal'. Access is decided by isEntitled(status), never by this. */
export function effectiveTier(tier: string, status: string): string {
  return ENTITLED.has(status) ? tier : 'personal';
}

// Commercial bands, mirrored from app/src/lib/plans.ts. A band covers up to and
// including maxEmployees; the top band is unbounded (maxEmployees null).
interface Band {
  id: string;
  maxEmployees: number | null;
}
export const COMMERCIAL_BANDS: readonly Band[] = [
  { id: 'commercial_micro', maxEmployees: 5 },
  { id: 'commercial_small', maxEmployees: 30 },
  { id: 'commercial_mid', maxEmployees: 100 },
  { id: 'commercial_large', maxEmployees: null },
];

/** Does the chosen commercial tier cover this seat count? A 500-seat org cannot
 *  buy Micro (max 5). Unknown tiers do not cover anything. */
export function tierCoversSeats(tierId: string, seatCount: number): boolean {
  const band = COMMERCIAL_BANDS.find((b) => b.id === tierId);
  if (!band) return false;
  const n = Math.max(1, Math.floor(seatCount || 1));
  return band.maxEmployees === null || n <= band.maxEmployees;
}

// ---------------------------------------------------------------------------
// Id lists.

/** Parse a comma-separated id list secret (STRIPE_IGNORED_PRICES). Blank entries are dropped; unset is empty. */
export function parseIdList(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// ---------------------------------------------------------------------------
// Checkout (BE-7, tech review ruling 2026-09-05). Checkout lists the customer's
// subscriptions with status 'all' and decides once, here:
//   - any sub in a LIVE state (active, trialing, past_due under Smart Retries,
//     unpaid, paused) routes to the billing portal: a second checkout would
//     double-bill and the webhook would flip-flop between the two subs.
//   - an `incomplete` sub is an abandoned checkout (a 3DS challenge never
//     finished). Stripe keeps it for 23 hours; treating it as live would trap
//     the buyer, so it is canceled and a fresh checkout proceeds.
//   - canceled and incomplete_expired are dead; checkout starts clean.
export const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'paused',
]);

export type CheckoutDecision<T> =
  | { action: 'portal'; sub: T }
  | { action: 'cancel-then-checkout'; cancel: T[] }
  | { action: 'checkout' };

/** Decide what checkout does for this customer. Pass the result of
 *  `subscriptions.list({ status: 'all' })`. */
export function checkoutDecision<T extends { status: string }>(
  subs: readonly T[],
): CheckoutDecision<T> {
  const live = subs.find((s) => LIVE_SUBSCRIPTION_STATUSES.has(s.status));
  if (live) return { action: 'portal', sub: live };
  const stuck = subs.filter((s) => s.status === 'incomplete');
  if (stuck.length > 0) return { action: 'cancel-then-checkout', cancel: stuck };
  return { action: 'checkout' };
}

// ---------------------------------------------------------------------------
// Stripe prices (BE-13). An unmapped price used to throw, which is right for a
// paid buyer (a 500 keeps Stripe retrying and emails the owner) but wrong for
// a price this backend is told to ignore: one such price wedged the whole
// endpoint until Stripe disabled it for every org. A maintainer names the
// ignorable prices in STRIPE_IGNORED_PRICES; everything else still throws.
export function isIgnoredPrice(priceId: string, ignored: ReadonlySet<string>): boolean {
  return ignored.has(priceId);
}
