// Same algorithm as os-code/src/tui/smoothing.test.ts; both copies stay
// covered independently since the browser-safe surface doesn't export it.
import { describe, expect, it } from 'vitest';
import { nextRevealLength } from '../src/lib/streamSmoothing.js';

describe('nextRevealLength', () => {
  it('reveals nothing more once caught up', () => {
    expect(nextRevealLength(10, 10)).toBe(10);
    expect(nextRevealLength(12, 10)).toBe(10);
  });

  it('drains a backlog in proportional chunks, never overshooting the target', () => {
    let shown = 0;
    const target = 60;
    let ticks = 0;
    while (shown < target && ticks < 100) {
      shown = nextRevealLength(shown, target);
      ticks += 1;
    }
    expect(shown).toBe(target);
    expect(ticks).toBeGreaterThan(1); // reveals gradually, not in one jump
  });

  it('reveals at least 2 characters per tick so a trickle still keeps pace', () => {
    expect(nextRevealLength(0, 1)).toBe(1); // clamped to target even below the floor
    expect(nextRevealLength(0, 3)).toBe(2);
  });
});
