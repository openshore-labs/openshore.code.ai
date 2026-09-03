// The transcript's reveal pacing. A cousin of os-code/src/tui/smoothing.ts,
// tuned for the phone: a calm fixed pace with a bounded lag, rather than the
// terminal's drain-a-sixth-per-tick, so a cloud burst types out instead of
// landing as a block (founder, 2026-09-03).
import { describe, expect, it } from 'vitest';
import {
  LAG_TICKS,
  PACE_CHARS,
  TICK_MS,
  nextRevealLength,
  ticksToDrain,
} from '../src/lib/streamSmoothing.js';

describe('nextRevealLength', () => {
  it('reveals nothing more once caught up', () => {
    expect(nextRevealLength(10, 10)).toBe(10);
    expect(nextRevealLength(12, 10)).toBe(10);
  });

  it('types at the calm pace while the backlog is within reach', () => {
    // A trickle and a modest paragraph both reveal the same few characters a
    // tick, so the eye reads typing, not a dump.
    expect(nextRevealLength(0, 40)).toBe(PACE_CHARS);
    expect(nextRevealLength(0, PACE_CHARS * LAG_TICKS)).toBe(PACE_CHARS);
    expect(nextRevealLength(0, 1)).toBe(1); // clamped to target below the pace
  });

  it('keeps the calm pace readable: roughly 165 characters a second', () => {
    const perSecond = (PACE_CHARS * 1000) / TICK_MS;
    expect(perSecond).toBeGreaterThan(120);
    expect(perSecond).toBeLessThan(220);
  });

  it('speeds up past the lag bound so a long answer never trails for long', () => {
    // A 4,000 character code answer that landed in one burst drains in a few
    // seconds, not the twenty-plus the calm pace alone would take.
    const calmSeconds = (4000 / PACE_CHARS) * (TICK_MS / 1000);
    const actualSeconds = ticksToDrain(4000) * (TICK_MS / 1000);
    expect(calmSeconds).toBeGreaterThan(20);
    expect(actualSeconds).toBeLessThan(5);
    expect(nextRevealLength(0, 4000)).toBe(Math.ceil(4000 / LAG_TICKS));
  });

  it('drains gradually, never overshooting the target', () => {
    let shown = 0;
    const target = 60;
    let ticks = 0;
    while (shown < target && ticks < 100) {
      shown = nextRevealLength(shown, target);
      expect(shown).toBeLessThanOrEqual(target);
      ticks += 1;
    }
    expect(shown).toBe(target);
    expect(ticks).toBeGreaterThan(1);
  });
});
