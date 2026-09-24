// The pure decision core of delete-account: how recent a sign-in must be, which
// owned orgs need the person's say-so, which paid invoice is refundable, and
// what a legal-hold copy carries. Dependency-free and free of Deno APIs on
// purpose, so the app's vitest suite imports it directly (the edge functions
// themselves have no runtime harness).

/** A destructive request must ride a sign-in this recent. */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

/** Team plans refund in full within this many days of the charge (DECISIONS.md,
 *  "Team plans refund within 14 days", 2026-09-24). */
export const REFUND_WINDOW_DAYS = 14;

/** The claims this module reads from a Supabase access token. */
export interface AccessClaims {
  iat?: number;
  amr?: Array<{ method?: string; timestamp?: number }>;
}

/** Decode a JWT's payload without verifying it. Only call this on a token the
 *  auth server has already accepted (auth.getUser succeeded). */
export function decodeJwtPayload(token: string): AccessClaims | undefined {
  const part = token.split('.')[1];
  if (!part) return undefined;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as AccessClaims;
  } catch {
    return undefined;
  }
}

/** The bearer token from an Authorization header, or undefined. */
export function bearerToken(header: string | null | undefined): string | undefined {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return m ? m[1]!.trim() : undefined;
}

/** When the person last actually signed in, in epoch seconds. A silent refresh
 *  re-issues the token (a new `iat`) without anyone typing anything, so the
 *  latest `amr` timestamp (the sign-in itself) is preferred; `iat` is the
 *  fallback when a token carries no amr. Either way it is never later than the
 *  token's issue time, so this is at least as strict as checking `iat` alone. */
export function signedInAtSeconds(claims: AccessClaims | undefined): number | undefined {
  if (!claims) return undefined;
  const stamps = (claims.amr ?? [])
    .map((a) => a?.timestamp)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  if (stamps.length > 0) return Math.max(...stamps);
  return typeof claims.iat === 'number' ? claims.iat : undefined;
}

/** True when the sign-in behind this token is within the reauth window. */
export function isRecentSignIn(claims: AccessClaims | undefined, nowMs: number): boolean {
  const at = signedInAtSeconds(claims);
  if (at === undefined) return false;
  return nowMs - at * 1000 <= REAUTH_WINDOW_MS;
}

/** The org ids the request body asks to delete, deduplicated. Anything that is
 *  not a list of non-empty strings reads as none. */
export function parseDeleteOrgs(body: unknown): string[] {
  const raw = (body as { deleteOrgs?: unknown } | null | undefined)?.deleteOrgs;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0))];
}

export interface OwnedOrg {
  id: string;
  name: string;
  /** Active members other than the owner. */
  otherActiveMembers: number;
  /** Whether the org holds a paid plan (an entitled Stripe subscription). */
  paid: boolean;
}

/** Owned orgs that still have other active members and were not named in
 *  deleteOrgs. Any of these stops the deletion with a 409 so the person
 *  chooses; a sole-member org is deleted with the account. */
export function orgsNeedingChoice(owned: OwnedOrg[], deleteOrgs: string[]): OwnedOrg[] {
  const chosen = new Set(deleteOrgs);
  return owned.filter((o) => o.otherActiveMembers > 0 && !chosen.has(o.id));
}

/** Case-insensitive email equality, false when either side is missing. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Whether a paid invoice is inside the refund window. `paidAtSeconds` is the
 *  Stripe paid-at time (epoch seconds). A zero-amount invoice is never
 *  refunded, since there is nothing to return. */
export function refundEligible(
  paidAtSeconds: number | null | undefined,
  amountPaid: number | null | undefined,
  nowMs: number,
): boolean {
  if (!paidAtSeconds || !amountPaid || amountPaid <= 0) return false;
  return nowMs - paidAtSeconds * 1000 <= REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** The rows copied into deletion_holds, without the user id (the hold is keyed
 *  by a hash of it instead). */
export function stripUserId<T extends Record<string, unknown>>(rows: T[]): Omit<T, 'user_id'>[] {
  return rows.map((row) => {
    const { user_id: _drop, ...rest } = row;
    return rest;
  });
}

/** The latest legal_hold_until across the held rows, or undefined if none. */
export function latestHold(rows: Array<{ legal_hold_until?: string | null }>): string | undefined {
  let best: number | undefined;
  for (const r of rows) {
    const t = r.legal_hold_until ? Date.parse(r.legal_hold_until) : NaN;
    if (Number.isFinite(t) && (best === undefined || t > best)) best = t;
  }
  return best === undefined ? undefined : new Date(best).toISOString();
}

/** Escape a string for a SQL LIKE / ILIKE pattern, so an email's `_` or `%`
 *  matches only itself. Callers still compare the rows exactly afterwards. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
