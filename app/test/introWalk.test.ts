// The first open's letter ("Tide Letter", Creative Studio 2026-09-24): Harbor
// Lite's greeting and the walk's opening write themselves in whole-word groups,
// a bold heading arrives as one piece, the step heading gets its breath, and
// the reader gets a few seconds after the greeting. These pin the plan the
// bubble reveals by and the walk is sequenced by.
import { describe, expect, it } from 'vitest';
import {
  GREETING_PACE,
  HEADING_PAUSE_MS,
  PARAGRAPH_PAUSE_MS,
  READ_PAUSE_MS,
  WALK_PACE,
  inkDurationMs,
  inkPlan,
  introFinished,
  introSkipped,
  isIntroPlaying,
  setIntroPlaying,
  takeButtonsHaptic,
} from '../src/lib/introWalk.js';
import { HARBOR_MINI_SETUP_GREETING } from '../src/lib/harborMini.js';
import { openingMessage, SETUP_INTRO } from '../src/lib/guidedSetup.js';
import { rehypeInk, restampForSkip } from '../src/lib/inkSwell.js';

const facts = {
  harborReady: false,
  harborDownloading: false,
  computer: false,
  repo: false,
  key: false,
};

describe('the ink plan', () => {
  it('stamps every visible character, in reading order, bold markers excluded', () => {
    const text = openingMessage('harbor', facts);
    const plan = inkPlan(text, WALK_PACE);
    const visible = text.replace(/\*\*/g, '').replace(/\s/g, '');
    expect(plan.delays).toHaveLength(visible.length);
    for (let i = 1; i < plan.delays.length; i += 1) {
      expect(plan.delays[i]!).toBeGreaterThan(plan.delays[i - 1]!);
    }
    expect(plan.delays[0]).toBe(0);
  });

  it('never lets a step outrun the swell, so it reads as a wave, not typing', () => {
    for (const pace of [GREETING_PACE, WALK_PACE]) {
      expect(pace.swellMs / pace.stepMs).toBeGreaterThan(10);
    }
  });

  it('rolls the greeting in unhurried, in about six and a half seconds', () => {
    const ms = inkDurationMs(HARBOR_MINI_SETUP_GREETING, GREETING_PACE);
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(7500);
  });

  it('gives the step heading its breath instead of a paragraph pause', () => {
    const text = openingMessage('harbor', facts);
    const plan = inkPlan(text, WALK_PACE);
    const visible = text.replace(/\*\*/g, '');
    const before = visible.slice(0, visible.indexOf('Step 1')).replace(/\s/g, '').length;
    const gap = plan.delays[before]! - plan.delays[before - 1]!;
    expect(gap).toBeGreaterThanOrEqual(HEADING_PAUSE_MS);
    expect(gap).toBeLessThan(HEADING_PAUSE_MS + PARAGRAPH_PAUSE_MS);
  });

  it('keeps the whole letter under about twenty seconds, reading pause included', () => {
    const total =
      inkDurationMs(HARBOR_MINI_SETUP_GREETING, GREETING_PACE) +
      READ_PAUSE_MS +
      inkDurationMs(openingMessage('harbor', facts), WALK_PACE);
    expect(total).toBeLessThan(20_000);
    expect(total).toBeGreaterThan(READ_PAUSE_MS + 5000);
  });
});

describe('the swell markup', () => {
  type Node = {
    type: string;
    tagName?: string;
    value?: string;
    properties?: Record<string, unknown>;
    children?: Node[];
  };
  const tree = (): Node => ({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'p',
        children: [
          { type: 'element', tagName: 'strong', children: [{ type: 'text', value: 'Step 1' }] },
          { type: 'text', value: ' Get it.' },
        ],
      },
    ],
  });
  const spans = (n: Node, cls: string): Node[] =>
    (n.children ?? []).flatMap((c) =>
      c.type === 'element' && (c.properties?.className as string[] | undefined)?.includes(cls)
        ? [c, ...spans(c, cls)]
        : spans(c, cls),
    );

  it('wraps words nowrap and stamps each character with its start', () => {
    const t = tree();
    rehypeInk({ delays: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] })()(t);
    const words = spans(t, 'iw');
    expect(
      words.map((w) => (w.children ?? []).map((c) => c.children?.[0]?.value).join('')),
    ).toEqual(['Step', '1', 'Get', 'it.']);
    const chars = spans(t, 'ic');
    expect(chars).toHaveLength(11);
    expect(chars[4]!.properties?.style).toBe('--d:40ms');
  });

  it('finishes a skip flat: under-way characters keep their swell, the rest land within the spread', () => {
    const { delays, flatFrom } = restampForSkip([0, 100, 200, 300, 400], 150, 200);
    expect(flatFrom).toBe(2);
    expect(delays.slice(0, 2)).toEqual([0, 100]);
    expect(delays[2]).toBe(150);
    expect(delays.at(-1)).toBe(350);
    const t = tree();
    rehypeInk({ delays, flatFrom })()(t);
    const chars = spans(t, 'ic');
    expect((chars[2]!.properties?.className as string[]).includes('flat')).toBe(true);
    expect((chars[1]!.properties?.className as string[]).includes('flat')).toBe(false);
  });
});

describe('playing state', () => {
  it('owes one tick when the letter plays through, none after a skip', () => {
    setIntroPlaying(true);
    expect(isIntroPlaying()).toBe(true);
    introFinished();
    expect(isIntroPlaying()).toBe(false);
    expect(takeButtonsHaptic()).toBe(true);
    expect(takeButtonsHaptic()).toBe(false);

    setIntroPlaying(true);
    introSkipped();
    expect(isIntroPlaying()).toBe(false);
    expect(takeButtonsHaptic()).toBe(false);
  });
});

describe('the copy', () => {
  it('counts the steps it names and keeps web search to when online', () => {
    expect(SETUP_INTRO).toMatch(/There are four short steps/);
    const text = openingMessage('harbor', facts);
    expect(text).toMatch(/Qwen 2\.5 Coder 3B/);
    expect(text).toMatch(/searches the web when you're online/);
  });
});
