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
