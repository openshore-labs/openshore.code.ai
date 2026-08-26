import { describe, expect, it } from 'vitest';
import { GREETINGS, ENGLISH_GREETING, buildRotation } from '../src/lib/greeting.js';

describe('GREETINGS', () => {
  it('every entry has a language, a code, a native line, and an English one', () => {
    expect(GREETINGS.length).toBeGreaterThan(1);
    for (const g of GREETINGS) {
      expect(g.lang).toBeTruthy();
      expect(g.code).toMatch(/^[a-z]{2}$/);
      expect(g.native.trim()).toBeTruthy();
      expect(g.english.trim()).toBeTruthy();
      // The native line should not already be the English one, or the language
      // would be indistinguishable from the English landing line.
      expect(g.native).not.toBe(g.english);
    }
  });

  it('has no duplicate language codes, English included', () => {
    const codes = [ENGLISH_GREETING.code, ...GREETINGS.map((g) => g.code)];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('English is the reserved landing language, not one of the rotation entries', () => {
    expect(ENGLISH_GREETING.code).toBe('en');
    expect(GREETINGS.some((g) => g.code === 'en')).toBe(false);
  });
});

describe('buildRotation', () => {
  it('always lands on English first', () => {
    for (let r = 0; r < 1; r += 0.05) {
      const rot = buildRotation(() => r);
      expect(rot[0]).toBe(ENGLISH_GREETING);
    }
  });

  it('includes English plus every language exactly once', () => {
    const rot = buildRotation(() => 0.5);
    expect(rot.length).toBe(GREETINGS.length + 1);
    const codes = new Set(rot.map((g) => g.code));
    expect(codes.size).toBe(rot.length);
    for (const g of GREETINGS) {
      expect(rot.some((r) => r.code === g.code)).toBe(true);
    }
  });

  it('shuffles the order past English between rolls', () => {
    // Two different rng streams should generally produce different orders.
    let toggle = 0;
    const a = buildRotation(() => 0.1).map((g) => g.code);
    const b = buildRotation(() => (toggle++ % 2 === 0 ? 0.9 : 0.2)).map((g) => g.code);
    expect(a).not.toEqual(b);
  });
});
