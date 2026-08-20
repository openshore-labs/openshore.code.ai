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
