// The wait-then-answer moment (founder, 2026-09-03): the OpenShore mark rolls
// as surf while the app waits on a first token, the word beside it turns over
// through an honest lexicon, the reply types out at a calm pace and finishes
// its tail instead of snapping, and the row eases out over the first line.
// Pinned here so the next session keeps the feel without remembering it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CALM_WORDS,
  FIRST_WORD,
  LONG_WAIT_MS,
  LONG_WAIT_WORDS,
  WORD_SWAP_MS,
  nextThinkingWord,
} from '../src/lib/thinkingWords.js';

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('thinking words', () => {
  it('opens on plain "Thinking" and holds each word a slow beat', () => {
    expect(FIRST_WORD).toBe('Thinking');
    expect(WORD_SWAP_MS).toBeGreaterThanOrEqual(3000);
    expect(LONG_WAIT_MS).toBe(15_000);
  });

  it('keeps every word calm and honest: no exclamation, no claim of work', () => {
    for (const word of [...CALM_WORDS, ...LONG_WAIT_WORDS]) {
      expect(word).not.toMatch(/!/);
      expect(word).not.toMatch(/^(Composing|Drafting|Searching|Charting|Writing|Coding)/);
      expect(word.length).toBeLessThanOrEqual(24);
    }
    expect(CALM_WORDS.length).toBeGreaterThanOrEqual(12);
  });

  it('draws every calm word once before repeating, never the one on screen', () => {
    const shown: string[] = [FIRST_WORD];
    for (let i = 0; i < CALM_WORDS.length; i += 1) {
      const next = nextThinkingWord(1000, shown);
      expect(CALM_WORDS).toContain(next);
      expect(shown).not.toContain(next);
      shown.push(next);
    }
    // The set is used up: the next draw may repeat, but never the current word.
    const again = nextThinkingWord(1000, shown);
    expect(again).not.toBe(shown[shown.length - 1]);
    expect(CALM_WORDS).toContain(again);
  });

  it('turns to the honest long-wait set after fifteen seconds', () => {
    expect(LONG_WAIT_WORDS).toContain(nextThinkingWord(LONG_WAIT_MS, [FIRST_WORD]));
    expect(CALM_WORDS).toContain(nextThinkingWord(LONG_WAIT_MS - 1, [FIRST_WORD]));
  });

  it('honors the injected draw', () => {
    expect(nextThinkingWord(0, [FIRST_WORD], () => 0)).toBe(CALM_WORDS[0]);
    expect(nextThinkingWord(0, [FIRST_WORD], () => 0.999)).toBe(CALM_WORDS[CALM_WORDS.length - 1]);
  });
});

describe('the wave', () => {
  const wave = read('components/WaveMark.tsx');
  const brand = read('components/BrandMark.tsx');
  const theme = read('theme.css');

  it('is the brand mark, verbatim: the same shore-wave motif, two wavelengths wide', () => {
    expect(brand).toContain('q4.5-3.3 9 0t9 0');
    expect(wave).toMatch(/d="M-18 6\.5q4\.5-3\.3 9 0t9 0t9 0t9 0"/);
  });

  it('rolls exactly one wavelength per loop on transform only, and rests under reduced motion', () => {
    const surf = theme.match(/@keyframes surf \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(surf).toContain('translateX(0)');
    expect(surf).toContain('translateX(18px)');
    expect(surf).not.toMatch(/\b(width|height|left|right|d:)\b/);
    expect(theme).toMatch(/\.wave-mark-surf \{[^}]*animation: surf \d+ms linear infinite/);
    const reduced = theme.match(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.wave-mark-surf,[\s\S]*?animation: none/,
    );
    expect(reduced, 'the surf must rest under reduced motion').toBeTruthy();
  });

  it('is what the working row shows, with the rotating word hidden from the screen reader', () => {
    const row = read('components/WorkingRow.tsx');
    expect(row).toContain('<WaveMark />');
    expect(row).not.toContain('working-dots');
    expect(row).toMatch(/className="working-word" aria-hidden="true"/);
    expect(row).toContain('className="visually-hidden"');
  });
});

describe('the seam', () => {
  const list = read('components/MessageList.tsx');
  const theme = read('theme.css');

  it('eases the working row out instead of unmounting it', () => {
    expect(list).toMatch(/useExitPresence\(showWorking/);
    expect(list).toMatch(/closing=\{workingClosing\}/);
    expect(theme).toMatch(/\.working-row\.closing \{[^}]*animation: working-out/);
  });

  it('plays the exit over the arriving first line so nothing below it jumps', () => {
    expect(list).toMatch(/working-slot\$\{workingSeam \? ' seam' : ''\}/);
    expect(theme).toMatch(
      /\.working-slot\.seam \{[^}]*height: 0;[^}]*margin-top: calc\(-1 \* var\(--thread-gap\)\)/,
    );
    expect(theme).toMatch(/\.thread-inner \{[^}]*gap: var\(--thread-gap\)/);
  });

  it('keeps the caret while the tail settles and fades it, never a hard unmount', () => {
    expect(list).toMatch(/const live = streaming \|\| settling/);
    expect(list).toMatch(/useExitPresence\(live/);
    expect(theme).toMatch(/\.cursor-caret\.closing \{[^}]*animation: caret-out/);
    expect(theme).not.toContain('steps(1)');
  });
});
