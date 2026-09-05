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
 *  (money-safe); flip it into ENTITLED for a grace window if the founder asks. */
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
// Rail writes (review 2026-09-05, BE-3 and BE-8). Two payment rails (Stripe on
// the web, Apple on iOS) write the same user_entitlements row. Every writer
// runs the SAME decision before it touches the row, so no rail can clobber the
// other's paid coverage and no stale delivery can move the row backwards.

/** The existing user_entitlements row, as read by a writer. */
export interface RailRow {
  source: string;
  status: string;
  valid_until?: string | null;
  last_event_at?: string | null;
}

/** The write a rail wants to make. */
export interface RailWrite {
  source: string;
  validUntil: string | null;
  /** The event's own timestamp (UNIX ms): Stripe event.created, Apple signedDate. */
  eventMs: number;
}

function untilMs(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : Infinity;
}

/** Should this rail's write be applied over the existing row?
 *
 *  1. Ordering: an event at or before the recorded last_event_at is stale (a
 *     late or duplicate delivery) and is dropped. The apply_* RPCs enforce
 *     the same rule atomically in their WHERE; this is the cheap pre-check.
 *  2. Cross-rail: never let one rail revoke or shorten an ENTITLED row the
 *     other rail wrote, while that row's paid window runs at least as long as
 *     the incoming one. An old Stripe subscription's period-end `deleted`
 *     event must not lock out someone who since bought Personal on Apple, and
 *     an Apple notification must not shorten a live Stripe year. The rail with
 *     the longer coverage wins; same-rail writes always pass this check. */
export function shouldApplyRailWrite(
  existing: RailRow | null | undefined,
  incoming: RailWrite,
): boolean {
  if (!existing) return true;
  if (existing.last_event_at && new Date(existing.last_event_at).getTime() >= incoming.eventMs) {
    return false;
  }
  if (
    existing.source !== incoming.source &&
    isEntitled({ status: existing.status, validUntil: existing.valid_until }) &&
    untilMs(existing.valid_until) >= untilMs(incoming.validUntil)
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Apple transactions (BE-9). Shared by link-apple-purchase and
// apple-notifications so both derive status the same way and both refuse a
// transaction that is not the Personal subscription.

/** Derive an entitlement status from a decoded transaction. A refund or
 *  revocation ends access now; a lapsed expiry ends it too. Apple's "expired"
 *  maps to 'canceled' because the 0006 CHECK has no 'expired' status. Everything
 *  else is 'active' (StoreKit intro offers still grant access; validUntil gates
 *  the window). `nowMs` is injectable for tests. */
export function statusFromTransaction(
  txn: { expiresDate?: number; revocationDate?: number },
  nowMs: number = Date.now(),
): string {
  if (txn.revocationDate) return 'canceled';
  if (txn.expiresDate && txn.expiresDate <= nowMs) return 'canceled';
  return 'active';
}

/** The only StoreKit transaction type that is a subscription. A consumable or
 *  non-consumable has no expiresDate, which would otherwise read as lifetime
 *  Personal. */
export const APPLE_SUBSCRIPTION_TYPE = 'Auto-Renewable Subscription';

/** Parse a comma-separated id list secret (APPLE_PRODUCT_IDS,
 *  STRIPE_IGNORED_PRICES). Blank entries are dropped; unset is empty. */
export function parseIdList(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** The APPLE_PRODUCT_IDS secret, parsed. */
export const parseProductIds = parseIdList;

/** May this transaction grant Personal? Fail closed: an empty allowlist (the
 *  secret unset) accepts nothing, so a deploy that forgot the secret cannot
 *  hand out entitlements for an unknown product. */
export function appleTransactionAccepted(
  txn: { productId?: string; type?: string },
  allowedProductIds: ReadonlySet<string>,
): boolean {
  if (allowedProductIds.size === 0) return false;
  if (!txn.productId || !allowedProductIds.has(txn.productId)) return false;
  return txn.type === APPLE_SUBSCRIPTION_TYPE;
}

// ---------------------------------------------------------------------------
// Checkout (BE-7, CTO ruling 2026-09-05). Checkout lists the customer's
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
// endpoint until Stripe disabled it for every org. The founder names the
// ignorable prices in STRIPE_IGNORED_PRICES; everything else still throws.
export function isIgnoredPrice(priceId: string, ignored: ReadonlySet<string>): boolean {
  return ignored.has(priceId);
}

// ---------------------------------------------------------------------------
// Apple link freshness (BE-4, CTO ruling: option (a)). The link row keeps the
// subscription's live state, written by apple-notifications. A JWS posted to
// link-apple-purchase is accepted only when it is newer than the last event
// Apple told us about, the link is not revoked or refunded, and the JWS was
// signed within the last 48 hours (a captured purchase-time JWS replayed after
// a refund is the attack this closes).
export const APPLE_JWS_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export interface AppleLinkState {
  status?: string | null;
  last_event_at?: string | null;
}

export type LinkRefusal = 'stale' | 'revoked' | 'too-old';

/** Why this JWS must not be linked, or undefined when it may proceed. */
export function appleLinkRefusal(
  link: AppleLinkState | null | undefined,
  jwsSignedMs: number,
  nowMs: number = Date.now(),
): LinkRefusal | undefined {
  if (nowMs - jwsSignedMs > APPLE_JWS_MAX_AGE_MS) return 'too-old';
  if (!link) return undefined;
  if (link.status === 'revoked' || link.status === 'refunded') return 'revoked';
  if (link.last_event_at && new Date(link.last_event_at).getTime() >= jwsSignedMs) {
    return 'stale';
  }
  return undefined;
}
