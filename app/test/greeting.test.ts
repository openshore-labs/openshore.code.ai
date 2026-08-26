import { describe, expect, it } from 'vitest';
import { GREETINGS, pickGreeting } from '../src/lib/greeting.js';

describe('GREETINGS', () => {
  it('every entry has a language, a code, a native line, and an English one', () => {
    expect(GREETINGS.length).toBeGreaterThan(1);
    for (const g of GREETINGS) {
      expect(g.lang).toBeTruthy();
      expect(g.code).toMatch(/^[a-z]{2}$/);
      expect(g.native.trim()).toBeTruthy();
      expect(g.english.trim()).toBeTruthy();
      // The native line should not already be the English one, or the tap
      // would do nothing.
      expect(g.native).not.toBe(g.english);
    }
  });

  it('has no duplicate language codes', () => {
    const codes = GREETINGS.map((g) => g.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('pickGreeting', () => {
  it('returns an in-range index', () => {
    for (let r = 0; r < 1; r += 0.05) {
      const i = pickGreeting(undefined, () => r);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(GREETINGS.length);
    }
  });

  it('never repeats the excluded index', () => {
    // Force the rng to land exactly on each index, then confirm exclude moves it.
    for (let idx = 0; idx < GREETINGS.length; idx++) {
      const i = pickGreeting(idx, () => idx / GREETINGS.length);
      expect(i).not.toBe(idx);
    }
  });
});
