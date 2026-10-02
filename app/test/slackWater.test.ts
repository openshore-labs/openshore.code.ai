// Slack Water's third pass (founder, 2026-10-02; docs/slack-water.md): the
// water starts a short beat after the guide's line, it is clear (light and
// shade over the app, no paper), the rings reach the farthest corner, and the
// old chat is gone before the new page goes in.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIP_MS,
  FRONT_MS,
  HEAVE_KEYS,
  SWAP_BACKSTOP_MS,
  WATER_AFTER_LINE_MS,
  WATER_MS,
  frontRadius,
  heaveFor,
  reachMs,
  thinAtMs,
  waterFrame,
} from '../src/lib/slackWater.js';
import { READ_PAUSE_MS } from '../src/lib/introWalk.js';

const R = 577;

describe('Slack Water, the clock', () => {
  it('starts the water a short beat after the line, never the old read pause', () => {
    expect(WATER_AFTER_LINE_MS).toBeLessThanOrEqual(400);
    expect(WATER_AFTER_LINE_MS).toBeLessThan(READ_PAUSE_MS / 5);
    const store = readFileSync(join(process.cwd(), 'src', 'state', 'store.ts'), 'utf8');
    expect(store).toMatch(/inkDurationMs\(SETUP_LATER_LINE, WALK_PACE\) \+ WATER_AFTER_LINE_MS/);
  });

  it('holds the front at the tap through the dip, then reaches the farthest corner', () => {
    expect(frontRadius(0, R)).toBe(0);
    expect(frontRadius(DIP_MS, R)).toBe(0);
    expect(frontRadius(DIP_MS + FRONT_MS, R)).toBeCloseTo(R);
    // It slows as it spreads, and keeps going past the corner.
    const early = frontRadius(DIP_MS + 100, R) - frontRadius(DIP_MS, R);
    const late = frontRadius(DIP_MS + FRONT_MS, R) - frontRadius(DIP_MS + FRONT_MS - 100, R);
    expect(early).toBeGreaterThan(late);
    expect(frontRadius(DIP_MS + FRONT_MS + 200, R)).toBeGreaterThan(R);
  });

  it('knows when the front reaches a point, the inverse of its radius', () => {
    for (const d of [0, 40, 200, R * 0.5, R, R * 1.3]) {
      expect(frontRadius(reachMs(d, R), R)).toBeCloseTo(d, 3);
    }
  });

  it('thins the old chat after the front is halfway, and swaps before the water stills', () => {
    const thin = thinAtMs(R);
    expect(thin).toBeGreaterThan(DIP_MS);
    expect(thin + 520).toBeLessThan(SWAP_BACKSTOP_MS);
    expect(SWAP_BACKSTOP_MS).toBeLessThan(WATER_MS);
  });

  it('loses energy and ends still', () => {
    expect(waterFrame(400, R).amp).toBeGreaterThan(waterFrame(1600, R).amp);
    expect(waterFrame(WATER_MS, R).amp).toBeCloseTo(0);
    expect(waterFrame(DIP_MS, R).dip).toBeCloseTo(1);
    expect(waterFrame(WATER_MS, R).dip).toBe(0);
  });

  it('heaves near blocks first and hardest, and every heave settles back to rest', () => {
    const near = heaveFor(20, R);
    const far = heaveFor(R, R);
    expect(near.delay).toBeLessThan(far.delay);
    expect(near.px).toBeGreaterThan(far.px);
    expect(HEAVE_KEYS[0]).toMatchObject({ at: 0, push: 0, stretch: 0 });
    expect(HEAVE_KEYS.at(-1)).toMatchObject({ at: 1, push: 0, stretch: 0 });
  });
});

describe('Slack Water, the look', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8');
  const component = readFileSync(
    join(process.cwd(), 'src', 'components', 'SlackWater.tsx'),
    'utf8',
  );

  it('is clear water: no paper disc floods the screen', () => {
    expect(css).not.toMatch(/\.slack-disc|slack-flood|slack-clear/);
    expect(component).not.toMatch(/slack-disc/);
    expect(component).toMatch(/createRippleRenderer/);
  });

  it('falls back to the CSS crests when the GPU cannot draw it, and honours reduced motion', () => {
    expect(component).toMatch(/slack-ring a/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.slack-water \{\s*display: none;/,
    );
  });
});
