// The commercial band boundaries are money math, so pin them. The CFO's rule:
// a band covers up to and including its top number; the next starts at N+1.
import { describe, expect, it } from 'vitest';
import { priceLabel, tierById, tierForSeats } from '../src/lib/plans.js';

describe('plan tiers', () => {
  it('places seats in the right band at every boundary', () => {
    expect(tierForSeats(1).id).toBe('commercial_micro');
    expect(tierForSeats(5).id).toBe('commercial_micro');
    expect(tierForSeats(6).id).toBe('commercial_small');
    expect(tierForSeats(30).id).toBe('commercial_small');
    expect(tierForSeats(31).id).toBe('commercial_mid');
    expect(tierForSeats(100).id).toBe('commercial_mid');
    expect(tierForSeats(101).id).toBe('commercial_large');
    expect(tierForSeats(5000).id).toBe('commercial_large');
  });

  it('guards odd inputs without throwing', () => {
    expect(tierForSeats(0).id).toBe('commercial_micro');
    expect(tierForSeats(-3).id).toBe('commercial_micro');
    expect(tierForSeats(2.7).id).toBe('commercial_micro');
  });

  it('carries the founder prices', () => {
    expect(tierById('commercial_micro').priceYear).toBe(20);
    expect(tierById('commercial_small').priceYear).toBe(100);
    expect(tierById('commercial_mid').priceYear).toBe(250);
    expect(tierById('commercial_large').priceYear).toBe(500);
    expect(priceLabel(tierById('personal'))).toBe('Free');
    expect(priceLabel(tierById('commercial_mid'))).toBe('$250 / year');
  });
});
