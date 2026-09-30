// The Personal paid gate's rules and the web buy (CTO, CFO, CX, 2026-09-30;
// lib/payGate.ts holds the classification). Plain functions a test reads
// without the store; store.ts only wires them into newConversation,
// ensureDriver, buildDriver, attachDriver, failOpen, runCommand, the sample
// project, the routine actions, buyPersonal and manageBilling. Test:
// app/test/payGate.test.ts.
//
// The gate sits on actions, never rooms, and it never cuts a turn already
// running: a coding session is checked when it is built or reattached, so a
// lapse locks the next build, not the current answer. Sign-in comes first,
// then the paywall. A build with no account backend has nobody to buy with,
// so it stays open (the accounts rule).
import { SOURCE_ACCOUNT, type AccountFeature } from '../lib/accountGate.js';
import { featurePaid } from '../lib/payGate.js';
import type { PaywallReason } from './store.js';
import type { Conversation, Entitlement } from './types.js';

type EntitlementLike = { status: string; validUntil?: string | null };

// Subscription status -> access. Only active or trialing grant access; every
// other status (past_due, unpaid, canceled, incomplete, incomplete_expired,
// paused) is revoked. past_due counts as revoked (strict, money-safe); widen
// this set for a grace window.
const ENTITLED_STATUSES = new Set(['active', 'trialing']);

/**
 * Whether an entitlement grants paid access right now: an active or trialing
 * subscription whose paid period has not lapsed. The webhook-written status is
 * the single authoritative source (client-read-only); nothing gates on a tier
 * id. Used identically in the app, marketing, and daemon.
 */
export function isEntitled(e?: EntitlementLike): boolean {
  return (
    !!e &&
    ENTITLED_STATUSES.has(e.status) &&
    (!e.validUntil || new Date(e.validUntil).getTime() > Date.now())
  );
}

/**
 * Whether the signed-in person has full-app (paid) access right now, by EITHER
 * rail: an individual Personal entitlement (Stripe or Apple IAP) OR an entitled
 * commercial org. One identity anchor (the Supabase user); either entitlement
 * unlocks. Team-seat growth still keys off the org entitlement specifically.
 */
export function personalUnlocked(
  userEntitlement?: EntitlementLike,
  orgEntitlement?: EntitlementLike,
): boolean {
  return isEntitled(userEntitlement) || isEntitled(orgEntitlement);
}

/** What the gate reads: the build flag, whether this build has accounts, and
 *  the two entitlements. The flag is a parameter so a test runs the gate on. */
export interface PayView {
  gates: boolean;
  configured: boolean;
  userEntitlement?: EntitlementLike;
  orgEntitlement?: EntitlementLike;
}

/** Whether the paid moments are open right now: the flag off (every build
 *  shipped so far), no account backend, or a live entitlement by either rail. */
export function personalUnlockedFor(view: PayView): boolean {
  if (!view.gates || !view.configured) return true;
  return personalUnlocked(view.userEntitlement, view.orgEntitlement);
}

/** A subscriber whose Personal year ended (an expired, cancelled, or unpaid
 *  row), as against someone who never bought: the sheet says "Renew". A row
 *  checkout wrote before payment ('incomplete') is not a lapse. Lapsed
 *  subscribers keep everything; only the paid moments reopen the sheet. */
export function personalLapsed(e: Pick<Entitlement, 'status' | 'validUntil'> | undefined): boolean {
  if (!e || isEntitled(e)) return false;
  return e.status !== 'incomplete' && e.status !== 'incomplete_expired';
}

/** Where a paid action goes: on, to the sign-in sheet, or to the paywall.
 *  A free feature is never paywalled. */
export type PaidDoor = 'open' | 'account' | 'paywall';

export function paidDoor(
  feature: AccountFeature,
  s: { needsAccount: boolean; unlocked: boolean },
): PaidDoor {
  if (!featurePaid(feature)) return 'open';
  if (s.needsAccount) return 'account';
  return s.unlocked ? 'open' : 'paywall';
}

/** The paywall's reason for a paid feature. */
export function paywallReasonFor(feature: AccountFeature): PaywallReason {
  return feature === 'crew' ? 'crew' : feature === 'marketplace' ? 'marketplace' : 'coding';
}

/** A coding session refused at the paid door. Not a failure to show: a
 *  message waiting to go opens the paywall instead, and stays parked. */
export class PaywallLockedError extends Error {
  constructor() {
    super('The coding agent is part of OpenShore Plus.');
    this.name = 'PaywallLockedError';
  }
}

/** Whether the paid door holds this chat shut: a coding session and the paid
 *  moments are closed right now. Checked at a build, never mid-turn. */
export function codingPaywalled(
  conv: Pick<Conversation, 'source'> | undefined,
  unlocked: boolean,
): boolean {
  const feature = conv ? SOURCE_ACCOUNT[conv.source.kind] : null;
  return Boolean(feature && featurePaid(feature)) && !unlocked;
}

/** Whether a routine change is free: pausing only (enabled set to false, and
 *  nothing else). Resuming or editing runs agentic work again, so it is paid;
 *  deleting and stopping are their own free actions. */
export function routinePatchFree(patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch);
  return keys.length === 1 && keys[0] === 'enabled' && patch.enabled === false;
}

// ---------------------------------------------------------------------------
// Buying on the desktop and the web: Stripe Checkout in the system browser.
// iOS buys through the App Store only (App Store 3.1.1) and never reaches
// this. The checkout-return deep link and the foreground re-check unlock.

/** Apple's own subscription management page, for "Manage subscription" on
 *  iOS; the desktop opens the Stripe customer portal instead. */
export const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

/** Restore on an Apple device that found nothing to link. */
export const RESTORE_FOUND_NOTHING =
  'No Plus purchase on this Apple Account. Bought on the web? Sign in with that email.';

export type WebCheckoutOutcome =
  | { kind: 'opened'; url: string }
  | { kind: 'manage'; url: string }
  | { kind: 'error'; message: string };

export interface WebCheckoutDeps {
  token: string;
  invoke: <T>(fn: string, token: string, body: Record<string, unknown>) => Promise<T>;
  open: (url: string) => void;
}

/** Start a Personal checkout: the stripe-checkout function makes the Stripe
 *  session for the signed-in caller (no org, tierId 'personal') and answers
 *  its URL, or the portal's when a subscription is already live, or a 409
 *  when an Apple subscription is (no double purchase). The URL opens in the
 *  system browser; nothing about the card touches the app. */
export async function startWebCheckout(deps: WebCheckoutDeps): Promise<WebCheckoutOutcome> {
  let answer: { url?: string; alreadySubscribed?: boolean };
  try {
    answer = await deps.invoke<{ url?: string; alreadySubscribed?: boolean }>(
      'stripe-checkout',
      deps.token,
      { tierId: 'personal' },
    );
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : '';
    return { kind: 'error', message: message || 'Could not start checkout. Try again.' };
  }
  if (!answer?.url) return { kind: 'error', message: 'Could not start checkout. Try again.' };
  deps.open(answer.url);
  return answer.alreadySubscribed
    ? { kind: 'manage', url: answer.url }
    : { kind: 'opened', url: answer.url };
}

// ---------------------------------------------------------------------------
// Apple transaction updates (a purchase Apple completes outside the purchase
// call: Ask to Buy approved later, a purchase on another device). A live one
// is sent to link-apple-purchase, or kept for the next sign-in, Restore or
// foreground when nobody is signed in; a revocation only re-reads the account
// (apple-notifications writes the server side).

export type AppleUpdateAction = 'link' | 'keep' | 'refresh' | 'ignore';

export function appleUpdateAction(
  update: { jws?: string; productId?: string; revoked?: boolean },
  s: { signedIn: boolean; productId: string },
): AppleUpdateAction {
  if (update.productId !== s.productId) return 'ignore';
  if (update.revoked) return s.signedIn ? 'refresh' : 'ignore';
  if (!update.jws) return 'ignore';
  return s.signedIn ? 'link' : 'keep';
}
