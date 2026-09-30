// Account plans. A person signs up Personal (free, their own work) or
// Commercial (an org with employee-band pricing). The bands come straight from
// the founder; the CFO resolved the boundary overlaps so a band covers up to
// and including its top number, and the next band starts at N+1. Prices are
// per year. No em dashes in any copy a customer reads (house rule).
export type AccountType = 'personal' | 'commercial';

export type PlanTierId =
  'personal' | 'commercial_micro' | 'commercial_small' | 'commercial_mid' | 'commercial_large';

export interface PlanTier {
  id: PlanTierId;
  name: string;
  /** Price per year in whole US dollars. */
  priceYear: number;
  /** Inclusive employee range; max null means "no upper bound". */
  minEmployees: number;
  maxEmployees: number | null;
  /** One-line copy shown on the plan card: the headcount band, never a price
   *  (prices show only through shownPrice, behind the pay gates). */
  blurb: string;
}

// The free default account: every chat, the Stack, Projects, Repositories,
// Vault by hand, pairing. The coding agent and Crew routines are the paid
// Personal unlock below (lib/payGate.ts).
export const PERSONAL_TIER: PlanTier = {
  id: 'personal',
  name: 'OpenShore Plus',
  priceYear: 0,
  minEmployees: 1,
  maxEmployees: 1,
  blurb: 'Free to chat. Plus lets the agent build on your computer.',
};

// The individual Personal UNLOCK price per year, in whole US dollars: $50 a
// year (founder, 2026-09-05 and 2026-09-27; the CFO's ruling), charged as
// $49.99 on both rails (2026-09-30): an Apple In-App Purchase on iPhone and
// iPad, Stripe Checkout on the desktop and the web. The App Store's own
// localized price wins on iOS (the Paywall asks StoreKit); the desktop shows
// lib/payGate.ts PERSONAL_WEB_PRICE. Neither shows while the pay gates are off.
export const PERSONAL_UNLOCK_PRICE_YEAR = 50;

// Commercial bands, cheapest first. The boundary number belongs to the lower
// band (5 is Micro, 30 is Small, 100 is Growth), so nobody lands in a pricier
// band on a round number.
export const COMMERCIAL_TIERS: PlanTier[] = [
  {
    id: 'commercial_micro',
    name: 'Micro',
    priceYear: 20,
    minEmployees: 1,
    maxEmployees: 5,
    blurb: 'Up to 5 people.',
  },
  {
    id: 'commercial_small',
    name: 'Small',
    priceYear: 100,
    minEmployees: 6,
    maxEmployees: 30,
    blurb: '6 to 30 people.',
  },
  {
    id: 'commercial_mid',
    name: 'Growth',
    priceYear: 250,
    minEmployees: 31,
    maxEmployees: 100,
    blurb: '31 to 100 people.',
  },
  {
    id: 'commercial_large',
    name: 'Scale',
    priceYear: 500,
    minEmployees: 101,
    maxEmployees: null,
    blurb: 'More than 100 people.',
  },
];

export const ALL_TIERS: PlanTier[] = [PERSONAL_TIER, ...COMMERCIAL_TIERS];

/** The commercial band a seat count falls into. One ladder, no gaps. */
export function tierForSeats(seats: number): PlanTier {
  const n = Math.max(1, Math.floor(seats || 1));
  return (
    COMMERCIAL_TIERS.find((t) => t.maxEmployees == null || n <= t.maxEmployees) ??
    COMMERCIAL_TIERS[COMMERCIAL_TIERS.length - 1]!
  );
}

export function tierById(id: PlanTierId): PlanTier {
  return ALL_TIERS.find((t) => t.id === id) ?? PERSONAL_TIER;
}

/** A short price label, e.g. "$100 / year" or "Free". */
export function priceLabel(tier: PlanTier): string {
  return tier.priceYear === 0 ? 'Free' : `$${tier.priceYear} / year`;
}

/** The price a screen may show, or null. Pricing is a Board gate, so no price
 *  reaches the screen while the pay gates are off (brand sweep, founder
 *  2026-09-24); the headcount band (the tier's blurb) shows instead. Every UI
 *  price goes through here with PAY_GATES_ENABLED (lib/payGate.ts, the
 *  VITE_PAY_GATES build flag). */
export function shownPrice(tier: PlanTier, payGatesOn: boolean): string | null {
  return payGatesOn ? priceLabel(tier) : null;
}
