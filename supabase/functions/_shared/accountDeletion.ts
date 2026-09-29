// The decisions behind delete-account (Apple 5.1.1(v); next build E1), kept
// pure so CI's `deno test supabase/functions/_shared` covers them. The edge
// function reads everything first, asks planAccountDeletion what to do, and
// only then writes: a refusal (owns_org) must never follow a canceled
// subscription or a deleted org.
//
// Every refusal the function sends is one of DELETE_ACCOUNT_ERRORS, a fixed
// code with nothing from the request or the database echoed back.

import { LIVE_SUBSCRIPTION_STATUSES } from './entitlement.ts';

/** The only error bodies delete-account sends: `{ error: <code> }`. */
export const DELETE_ACCOUNT_ERRORS = ['unauthorized', 'owns_org', 'billing', 'failed'] as const;
export type DeleteAccountError = (typeof DELETE_ACCOUNT_ERRORS)[number];

/** The HTTP status each code goes out with. */
export const DELETE_ACCOUNT_STATUS: Record<DeleteAccountError, number> = {
  unauthorized: 401,
  owns_org: 409,
  billing: 502,
  failed: 500,
};

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
  /** enforcement_actions.action values recorded for this account. */
  enforcementActions: string[];
  /** True when abuse_reports holds a row for this account. */
  hasAbuseReport: boolean;
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
      /** The tombstone to keep for this email, or 0 for none. */
      tombstoneLevel: 0 | 1 | 2;
      /** The person pays (or paid) through Apple, which only they can cancel. */
      appleNote: boolean;
    };

/** The ladder level a deleted account leaves behind: 2 after a termination
 *  (a prepared report only follows one), 1 after a warning, else 0. */
export function tombstoneLevelFor(actions: readonly string[], hasAbuseReport: boolean): 0 | 1 | 2 {
  if (hasAbuseReport || actions.includes('terminate')) return 2;
  if (actions.includes('warn')) return 1;
  return 0;
}

/** A tombstone never steps down: a second deletion under the same email keeps
 *  the higher of the two levels. */
export function mergeTombstoneLevel(existing: number | null | undefined, next: 0 | 1 | 2): 0 | 1 | 2 {
  const before = existing === 1 || existing === 2 ? existing : 0;
  return Math.max(before, next) as 0 | 1 | 2;
}

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
    tombstoneLevel: tombstoneLevelFor(facts.enforcementActions, facts.hasAbuseReport),
    appleNote: facts.personal?.source === 'apple' || facts.appleLinked,
  };
}

/** The address as the tombstone keys it: ASCII letters lowercased and nothing
 *  else touched, the same as 0022's enforcement_email_key (`lower(... collate
 *  "C")`), so the two hashes match byte for byte in any locale. */
export function normalizeEmail(email: string): string {
  return email.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** SHA-256 hex of the normalized address: the only form of it the tombstone
 *  keeps. */
export async function emailSha256(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeEmail(email));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
