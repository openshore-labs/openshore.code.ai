// The first open's letter ("Tide Letter", Creative Studio 2026-09-24): Harbor
// Lite's greeting and the walk's opening write themselves in whole-word groups,
// a bold heading arrives as one piece, the step heading gets its breath, and
// the reader gets a few seconds after the greeting. These pin the plan the
// bubble reveals by and the walk is sequenced by.
import { describe, expect, it } from 'vitest';
import {
  GREETING_PACE,
  HEADING_PAUSE_MS,
  READ_PAUSE_MS,
  WALK_PACE,
  introFinished,
  introSkipped,
  isIntroPlaying,
  pacedDurationMs,
  pacedSteps,
  setIntroPlaying,
  takeButtonsHaptic,
} from '../src/lib/introWalk.js';
import { HARBOR_MINI_SETUP_GREETING } from '../src/lib/harborMini.js';
import { openingMessage, SETUP_INTRO } from '../src/lib/guidedSetup.js';
import { WORD_FADE_MS } from '../src/lib/streamSmoothing.js';

const facts = {
  harborReady: false,
  harborDownloading: false,
  computer: false,
  repo: false,
  key: false,
};

describe('the paced reveal plan', () => {
  it('reveals whole words, ending on the whole text', () => {
    const text = HARBOR_MINI_SETUP_GREETING;
    const steps = pacedSteps(text, GREETING_PACE);
    expect(steps.at(-1)!.end).toBe(text.length);
    for (const st of steps) {
      // Never mid-word: the next character is a space, a break, or the end.
      expect(st.end === text.length || /\s/.test(text[st.end]!)).toBe(true);
    }
    expect(steps[0]!.delayMs).toBe(0);
  });

  it('writes the greeting in about four seconds, two words a beat', () => {
    const ms = pacedDurationMs(HARBOR_MINI_SETUP_GREETING, GREETING_PACE);
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(6000);
  });

  it('brings a bold step heading in as one piece, after its breath', () => {
    const text = openingMessage('harbor', facts);
    const steps = pacedSteps(text, WALK_PACE);
    const headingStart = text.indexOf('**Step 1');
    const headingEnd = text.indexOf('**', headingStart + 2) + 2;
    const step = steps.find((st) => st.end >= headingStart + 2)!;
    expect(step.end).toBe(headingEnd);
    expect(step.delayMs).toBe(WALK_PACE.groupMs + HEADING_PAUSE_MS);
    // No group ever ends inside a bold span.
    for (const st of steps) {
      expect((text.slice(0, st.end).match(/\*\*/g) ?? []).length % 2).toBe(0);
    }
  });

  it('starts every paragraph on a new group', () => {
    const text = openingMessage('harbor', facts);
    const ends = new Set(pacedSteps(text, WALK_PACE).map((st) => st.end));
    expect(ends.has(SETUP_INTRO.length)).toBe(true);
  });

  it('keeps the whole letter under about twenty seconds, reading pause included', () => {
    const total =
      pacedDurationMs(HARBOR_MINI_SETUP_GREETING, GREETING_PACE) +
      READ_PAUSE_MS +
      pacedDurationMs(openingMessage('harbor', facts), WALK_PACE);
    expect(total).toBeLessThan(20_000);
    expect(total).toBeGreaterThan(READ_PAUSE_MS + WORD_FADE_MS);
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
