import { describe, expect, it } from 'vitest';
import {
  GREETINGS,
  ENGLISH_GREETING,
  LANDING_LINES,
  WEEKEND_LINES,
  MONDAY_LINES,
  FRIDAY_LINES,
  bucketForHour,
  dayFlavorLines,
  pickLanding,
  buildRotation,
  type TimeBucket,
} from '../src/lib/greeting.js';

// A deterministic rng that walks a fixed list of values, wrapping at the end.
// Lets a test steer pickLanding's two rolls (flavor gate, then index) precisely.
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

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

describe('landing library', () => {
  const buckets: TimeBucket[] = [
    'earlyMorning',
    'morning',
    'midday',
    'afternoon',
    'evening',
    'lateNight',
  ];

  const allLines = [
    ...buckets.flatMap((b) => LANDING_LINES[b]),
    ...WEEKEND_LINES,
    ...MONDAY_LINES,
    ...FRIDAY_LINES,
  ];

  it('gives every time bucket a healthy pool of lines', () => {
    for (const b of buckets) {
      expect(LANDING_LINES[b].length).toBeGreaterThanOrEqual(6);
    }
    expect(WEEKEND_LINES.length).toBeGreaterThanOrEqual(6);
    expect(MONDAY_LINES.length).toBeGreaterThanOrEqual(6);
    expect(FRIDAY_LINES.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps the founder north-star line in the morning bucket', () => {
    expect(LANDING_LINES.morning).toContain('Coffee and coding?');
  });

  it('holds every line short, trimmed, capitalized, and em-dash-free', () => {
    for (const line of allLines) {
      expect(line).toBe(line.trim());
      expect(line.length).toBeGreaterThan(0);
      expect(line.length).toBeLessThanOrEqual(44);
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(8);
      expect(line[0]).toBe(line[0].toUpperCase());
      // No em dash anywhere, straight or encoded, per the repo policy.
      expect(line).not.toMatch(/—|&mdash;|&#x2014;|&#8212;/);
    }
  });

  it('has no duplicate lines across the whole library', () => {
    expect(new Set(allLines).size).toBe(allLines.length);
  });
});

describe('bucketForHour', () => {
  it('maps each hour of the day to its bucket, wrapping late night over midnight', () => {
    const cases: [number, TimeBucket][] = [
      [0, 'lateNight'],
      [4, 'lateNight'],
      [5, 'earlyMorning'],
      [7, 'earlyMorning'],
      [8, 'morning'],
      [10, 'morning'],
      [11, 'midday'],
      [13, 'midday'],
      [14, 'afternoon'],
      [16, 'afternoon'],
      [17, 'evening'],
      [20, 'evening'],
      [21, 'lateNight'],
      [23, 'lateNight'],
    ];
    for (const [hour, bucket] of cases) {
      expect(bucketForHour(hour)).toBe(bucket);
    }
  });
});

describe('dayFlavorLines', () => {
  // Jan 2026 anchors: 1st is a Thursday, so the week reads Thu, Fri, Sat, Sun,
  // Mon, Tue off that date.
  it('returns the weekend pool on Saturday and Sunday', () => {
    expect(dayFlavorLines(new Date(2026, 0, 3, 12))).toBe(WEEKEND_LINES); // Sat
    expect(dayFlavorLines(new Date(2026, 0, 4, 12))).toBe(WEEKEND_LINES); // Sun
  });
  it('returns the Monday pool on Monday and the Friday pool on Friday', () => {
    expect(dayFlavorLines(new Date(2026, 0, 5, 12))).toBe(MONDAY_LINES); // Mon
    expect(dayFlavorLines(new Date(2026, 0, 2, 12))).toBe(FRIDAY_LINES); // Fri
  });
  it('returns null on a plain weekday', () => {
    expect(dayFlavorLines(new Date(2026, 0, 1, 12))).toBeNull(); // Thu
    expect(dayFlavorLines(new Date(2026, 0, 6, 12))).toBeNull(); // Tue
  });
});

describe('pickLanding', () => {
  it('returns an English line from the hour bucket on a plain weekday', () => {
    const thuMorning = new Date(2026, 0, 1, 9); // Thursday, morning
    const g = pickLanding(thuMorning, () => 0);
    expect(g.code).toBe('en');
    expect(g.english).toBe(g.native);
    expect(LANDING_LINES.morning).toContain(g.native);
    expect(g.native).toBe('Coffee and coding?'); // index 0 of the morning pool
  });

  it('mixes in the day flavor when the first roll falls under one third', () => {
    const friMorning = new Date(2026, 0, 2, 9); // Friday, morning
    const g = pickLanding(friMorning, seqRng([0, 0])); // flavor gate 0 < 1/3, index 0
    expect(FRIDAY_LINES).toContain(g.native);
    expect(g.native).toBe('Friday. Ship it?');
  });

  it('stays in the hour bucket when the first roll is above one third', () => {
    const friMorning = new Date(2026, 0, 2, 9); // Friday, morning
    const g = pickLanding(friMorning, seqRng([0.9, 0])); // flavor gate fails, index 0
    expect(LANDING_LINES.morning).toContain(g.native);
    expect(g.native).toBe('Coffee and coding?');
  });
});

describe('buildRotation', () => {
  it('lands on an English line first, then the shuffled languages', () => {
    const rot = buildRotation(() => 0, new Date(2026, 0, 1, 9));
    expect(rot[0].code).toBe('en');
    expect(LANDING_LINES.morning).toContain(rot[0].native);
  });

  it('includes the landing plus every language exactly once', () => {
    const rot = buildRotation(() => 0.5, new Date(2026, 0, 1, 9));
    expect(rot.length).toBe(GREETINGS.length + 1);
    const codes = new Set(rot.map((g) => g.code));
    expect(codes.size).toBe(rot.length);
    for (const g of GREETINGS) {
      expect(rot.some((r) => r.code === g.code)).toBe(true);
    }
  });

  it('shuffles the order past the landing between rolls', () => {
    let toggle = 0;
    const now = new Date(2026, 0, 1, 9);
    const a = buildRotation(() => 0.1, now).map((g) => g.code);
    const b = buildRotation(() => (toggle++ % 2 === 0 ? 0.9 : 0.2), now).map((g) => g.code);
    expect(a).not.toEqual(b);
  });
});
