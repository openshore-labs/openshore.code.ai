// What the Admin screen says about seats and billing, per platform. Billing
// lives on the web (openshore.ai, Stripe), and on iOS the app may not point
// to a purchase outside the App Store, so the iOS Admin screen shows seat
// counts only: no price, no "Buy seats on the web", no "renew" call to action,
// no path to purchase (advisory org ruling, 2026-09-24). Pure, so the rule is
// pinned by a test rather than remembered.

export interface BillingEntitlement {
  status: string;
  validUntil?: string;
}

/** Does this platform show a purchase or billing path at all? */
export function showsPurchasePath(ios: boolean): boolean {
  return !ios;
}

/** The one status line under the plan. On iOS it states the subscription and
 *  nothing about where to buy one. */
export function billingStatusLine(
  entitlement: BillingEntitlement | undefined,
  ios: boolean,
): string {
  if (entitlement) {
    const renews = entitlement.validUntil
      ? ` · renews ${new Date(entitlement.validUntil).toLocaleDateString()}`
      : '';
    return `Subscription ${entitlement.status}${renews}`;
  }
  return ios
    ? 'No active subscription.'
    : 'No active subscription yet. Seats are purchased on the web.';
}

/** The hint when the team cannot grow (no active subscription). */
export function cannotGrowHint(ios: boolean): string {
  return ios
    ? 'Adding teammates needs an active subscription. Your current team keeps working.'
    : 'Renew your subscription to add teammates. Your current team keeps working. Use Manage billing above to renew.';
}
