// The decisions behind delete-account (Apple 5.1.1(v); next build E1; tech review 11
// package C), kept pure so CI's `deno test supabase/functions/_shared` covers
// them. The edge function reads everything first, asks planAccountDeletion
// what to do, and only then writes: the owns_org refusal comes before any
// canceled subscription or deleted row. The database's own writes (the
// legal-hold copy, the owned-team delete, the tombstone, memberships and
// grants) are service-role functions in 0022 section 6, so their rules live
// in SQL beside their pgTAP tests; this module decides what to ask them and
// how to read what they answer.
//
// Every refusal the function sends is one of DELETE_ACCOUNT_ERRORS, a fixed
// code with nothing from the request or the database echoed back.

import { LIVE_SUBSCRIPTION_STATUSES } from './entitlement.ts';
import { requireSignIn } from './repoOAuth.ts';

/** The only error bodies delete-account sends: `{ error: <code> }`.
 *  `reauth_required` goes out only while DELETE_REQUIRE_RECENT_SIGN_IN is on
 *  (finding F2, 2026-10-21); every app build since package C (2026-09-29)
 *  already reads it, from the 2026-09-24 function. */
export const DELETE_ACCOUNT_ERRORS = [
  'unauthorized',
  'reauth_required',
  'owns_org',
  'billing',
  'failed',
] as const;
export type DeleteAccountError = (typeof DELETE_ACCOUNT_ERRORS)[number];

/** The HTTP status each code goes out with. */
export const DELETE_ACCOUNT_STATUS: Record<DeleteAccountError, number> = {
  unauthorized: 401,
  reauth_required: 401,
  owns_org: 409,
  billing: 502,
  failed: 500,
};

/** The success body. `ok` is what main's app reads; `deleted` is what the
 *  2026-09-24 function answered (`{ deleted: true }`), so a build that reads
 *  either one sees success (tech review 11). */
export interface DeleteAccountAnswer {
  ok: true;
  deleted: true;
  appleNote: boolean;
}

export function deletedAnswer(appleNote: boolean): DeleteAccountAnswer {
  return { ok: true, deleted: true, appleNote };
}

/** A Stripe subscription that could still charge or retry a charge: every
 *  live status checkout knows, plus `incomplete` (a first payment still in
 *  flight). Only canceled and incomplete_expired are finished. */
export function subscriptionMayBill(status: string | null | undefined): boolean {
  if (!status) return false;
  return LIVE_SUBSCRIPTION_STATUSES.has(status) || status === 'incomplete';
}

/** The ids to cancel out of a `subscriptions.list({ status: 'all' })` page. */
export function subscriptionsToCancel(subs: readonly { id: string; status: string }[]): string[] {
  return subs.filter((s) => subscriptionMayBill(s.status)).map((s) => s.id);
}

/** A row's billing, as the function reads it from user_entitlements or
 *  orgs plus org_entitlements. */
export interface BillingRow {
  source?: string | null;
  status?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
}

/** An org_members row as the function reads it for an owned team. */
export interface MemberRow {
  user_id: string | null;
  status: string;
}

/** Who else is active in a team: an active row bound to someone other than
 *  the owner. An active row with no user id is nobody (its person's account
 *  was deleted, and 0001's key set it null). The same test 0022's
 *  account_deletion_orgs makes, so the plan and the delete agree. */
export function otherActiveMembers(rows: readonly MemberRow[], ownerId: string): number {
  return rows.filter((m) => m.status === 'active' && m.user_id !== null && m.user_id !== ownerId)
    .length;
}

export interface OwnedOrg {
  id: string;
  /** Active members other than the person deleting their account. */
  otherActiveMembers: number;
  billing: BillingRow | null;
}

export interface DeletionFacts {
  /** The person's own user_entitlements row, if any. */
  personal: BillingRow | null;
  /** True when apple_links binds an Apple subscription to this account. */
  appleLinked: boolean;
  /** Orgs whose owner_uid is this account. */
  ownedOrgs: OwnedOrg[];
}

export type DeletionPlan =
  | { refuse: 'owns_org' }
  | {
      refuse?: undefined;
      /** Stripe customers whose every live subscription is canceled. */
      stripeCustomers: string[];
      /** Recorded subscription ids to cancel if still live, in case a row
       *  carries a subscription but no customer. */
      stripeSubscriptions: string[];
      /** Owned orgs with nobody else active in them, deleted outright. */
      deleteOrgs: string[];
      /** The person pays (or paid) through Apple, which only they can cancel. */
      appleNote: boolean;
    };

function billingTargets(rows: readonly (BillingRow | null)[]): {
  customers: string[];
  subscriptions: string[];
} {
  const customers = new Set<string>();
  const subscriptions = new Set<string>();
  // An Apple-sourced row can still carry a Stripe customer from an earlier web
  // purchase (the rails keep each other's columns, 0015 BE-8), so every row's
  // customer is swept; Stripe itself says which subscriptions are live.
  for (const row of rows) {
    if (!row) continue;
    if (row.stripe_customer_id) customers.add(row.stripe_customer_id);
    if (row.stripe_subscription_id && subscriptionMayBill(row.status)) {
      subscriptions.add(row.stripe_subscription_id);
    }
  }
  return { customers: [...customers], subscriptions: [...subscriptions] };
}

/** Decide the whole deletion from what the function read. */
export function planAccountDeletion(facts: DeletionFacts): DeletionPlan {
  // A team with other people in it is not this person's alone to erase.
  if (facts.ownedOrgs.some((o) => o.otherActiveMembers > 0)) return { refuse: 'owns_org' };
  const { customers, subscriptions } = billingTargets([
    facts.personal,
    ...facts.ownedOrgs.map((o) => o.billing),
  ]);
  return {
    stripeCustomers: customers,
    stripeSubscriptions: subscriptions,
    deleteOrgs: facts.ownedOrgs.map((o) => o.id),
    appleNote: facts.personal?.source === 'apple' || facts.appleLinked,
  };
}

/** Read account_deletion_orgs' answer (a uuid array, all or none): true only
 *  when every planned team came back deleted. Anything less means someone
 *  became active in one of them after the plan was read, nothing was deleted,
 *  and the function answers owns_org. An answer that is not a list of ids
 *  reads as nothing deleted. */
export function ownedOrgsGone(planned: readonly string[], answered: unknown): boolean {
  if (planned.length === 0) return true;
  if (!Array.isArray(answered)) return false;
  const gone = new Set(answered.filter((id): id is string => typeof id === 'string'));
  return planned.every((id) => gone.has(id));
}

// ------------------------------------------------------------ recent sign-in (F2)

/** Whether delete-account asks for a recent sign-in: only when the
 *  DELETE_REQUIRE_RECENT_SIGN_IN secret is "true" or "1", read the way
 *  repo-oauth reads REPO_OAUTH_REQUIRE_SIGN_IN. Unset, the function behaves
 *  exactly as it did before F2. It is turned on only once the build that
 *  answers reauth_required with an email code is what people run. */
export function recentSignInRequired(raw: string | undefined): boolean {
  return requireSignIn(raw);
}

/** How recent a sign-in must be: ten minutes, the window the 2026-09-24
 *  function used, the one the app's copy names, and 0031's passkey step-up. */
export const RECENT_SIGN_IN_S = 10 * 60;

/** How far ahead of this clock a sign-in time may sit and still count (the
 *  auth server and the function run on different machines). */
export const CLOCK_SKEW_S = 60;

/** The `amr` methods that are a sign-in the person made: an email code or
 *  link (and a new account's first email), a passkey, or a provider. Never
 *  `token_refresh` or `anonymous`, so a session kept alive by refreshing
 *  does not read as recent. An unknown method does not count either. */
export const SIGN_IN_METHODS: ReadonlySet<string> = new Set([
  'otp',
  'magiclink',
  'email/signup',
  'webauthn',
  'oauth',
  'sso/saml',
  'password',
]);

/** The claims of an access token, read without checking its signature. Only
 *  call it on a token the auth server has already accepted (auth.getUser
 *  with the same token, and verify_jwt at the gateway). */
export function tokenClaims(token: string): Record<string, unknown> | undefined {
  const part = token.split('.')[1];
  if (!part) return undefined;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    return claims && typeof claims === 'object' && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** When this session last signed in, in seconds since the epoch: the newest
 *  `amr` entry with a sign-in method. Supabase keeps each method's time in
 *  the session (auth.mfa_amr_claims) and carries it in every token the
 *  session refreshes into, while `iat` moves with each refresh, so `iat`
 *  says nothing about the sign-in. Undefined when the token names none. */
export function lastSignInAt(claims: Record<string, unknown> | undefined): number | undefined {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return undefined;
  let newest: number | undefined;
  for (const entry of amr) {
    if (!entry || typeof entry !== 'object') continue;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (typeof method !== 'string' || !SIGN_IN_METHODS.has(method)) continue;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) continue;
    if (newest === undefined || timestamp > newest) newest = timestamp;
  }
  return newest;
}

/** Whether the bearer's session signed in within RECENT_SIGN_IN_S of `nowMs`.
 *  A header that is not a bearer, a token that cannot be read, or one that
 *  names no sign-in reads as not recent: the app then asks for a code. */
export function signedInRecently(authorization: string, nowMs: number = Date.now()): boolean {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!m) return false;
  const at = lastSignInAt(tokenClaims(m[1]));
  if (at === undefined) return false;
  const age = nowMs / 1000 - at;
  return age <= RECENT_SIGN_IN_S && age >= -CLOCK_SKEW_S;
}
