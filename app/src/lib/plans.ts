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
  /** One-line copy shown on the plan card. */
  blurb: string;
}

// The free default account: chat only (Harbor / Ollama). The full app (coding
// agent, Marketplace) is the paid Personal unlock below.
export const PERSONAL_TIER: PlanTier = {
  id: 'personal',
  name: 'Personal',
  priceYear: 0,
  minEmployees: 1,
  maxEmployees: 1,
  blurb: 'Personal. Free to chat. For your own work.',
};

// The individual Personal UNLOCK price per year, in whole US dollars. Free is
// chat-only; this unlocks the full app for one person. Same $20 on both rails:
// Stripe on web/desktop, Apple In-App Purchase on iOS (Apple 3.1.1). Matches the
// commercial Micro price by design (one person == the smallest team's per-year).
export const PERSONAL_UNLOCK_PRICE_YEAR = 20;

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
    blurb: 'Up to 5 people. $20 / year.',
  },
  {
    id: 'commercial_small',
    name: 'Small',
    priceYear: 100,
    minEmployees: 6,
    maxEmployees: 30,
    blurb: '6 to 30 people. $100 / year.',
  },
  {
    id: 'commercial_mid',
    name: 'Growth',
    priceYear: 250,
    minEmployees: 31,
    maxEmployees: 100,
    blurb: '31 to 100 people. $250 / year.',
  },
  {
    id: 'commercial_large',
    name: 'Scale',
    priceYear: 500,
    minEmployees: 101,
    maxEmployees: null,
    blurb: 'More than 100 people. $500 / year.',
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
