// The transcript's reveal pacing (docs/design/flowing-reveal.md): a playout
// buffer paced from the stream, so a burst flows into the pause after it,
// words land whole, and a long answer never trails for long. Replaces the
// fixed typing clock (2026-09-03), which raced each burst out and then sat
// frozen through the pause (the recording of 2026-10-18).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DRAIN_S,
  FLOOR_CPS,
  MAX_LAG_S,
  WORD_FADE_MS,
  revealLimit,
  startPace,
  stepPace,
  wholeWordsUpTo,
  type RevealPace,
} from '../src/lib/streamSmoothing.js';
import { splitWords } from '../src/lib/fadeWords.js';
import { closeOpenMarks, splitBlocks } from '../src/lib/markdownBlocks.js';
import { FOLLOW_GLIDE_TAU_MS, glideStep } from '../src/components/MessageList.js';

const FRAME = 1000 / 60;

/** Play a stream frame by frame: `arrivals` maps a frame to how many more
 *  characters have arrived by then. Returns the played length per frame. */
function play(frames: number, arrivedAt: (frame: number) => number, liveUntil = frames): number[] {
  let pace: RevealPace = startPace();
  const out: number[] = [];
  for (let f = 0; f < frames; f += 1) {
    const arrived = arrivedAt(f);
    const live = f < liveUntil;
    pace = stepPace(pace, { arrived, limit: arrived, dtMs: FRAME, live });
    out.push(pace.played);
  }
  return out;
}

describe('stepPace', () => {
  it('never plays past what may be shown', () => {
    const played = play(120, () => 50);
    expect(Math.max(...played)).toBeLessThanOrEqual(50);
    expect(played.at(-1)).toBe(50);
  });

  it('plays a trickle out as it comes, at no less than a calm reading pace', () => {
    // 20 characters a second, slower than the floor: the reveal keeps up.
    const played = play(180, (f) => Math.floor((f * FRAME * 20) / 1000));
    expect(played.at(-1)!).toBeGreaterThan(55);
    expect(FLOOR_CPS).toBeGreaterThanOrEqual(30);
    expect(FLOOR_CPS).toBeLessThanOrEqual(60);
  });

  it('flows a burst into the pause after it instead of racing it out', () => {
    // The recording: 300 characters in under two seconds, then a long pause.
    const burstFrames = 110;
    const arrivedAt = (f: number) => Math.min(300, Math.floor((f / burstFrames) * 300));
    const played = play(600, arrivedAt);
    const doneAt = played.findIndex((p) => p >= 300);
    // Still flowing well after the burst ended, never frozen behind it...
    expect(doneAt).toBeGreaterThan(burstFrames + 30);
    // ...and caught up a few seconds later: the backlog eases out with a
    // time constant of MAX_LAG_S, then the calm floor finishes it.
    expect(doneAt).toBeLessThan(burstFrames + 2 * MAX_LAG_S * 60);
    // And every frame in between moves: no stall, no leap.
    const steps = played.slice(1, doneAt).map((p, i) => p - played[i]!);
    expect(Math.min(...steps)).toBeGreaterThan(0);
    expect(Math.max(...steps)).toBeLessThan(15);
  });

  it('keeps up with a fast cloud stream, trailing it by a bounded lag', () => {
    // 2,000 characters a second for three seconds.
    const played = play(180, (f) => Math.floor((f * FRAME * 2000) / 1000));
    const arrived = Math.floor((179 * FRAME * 2000) / 1000);
    expect(arrived - played.at(-1)!).toBeLessThan(2000 * MAX_LAG_S);
  });

  it('drains what is left once the stream ends, within DRAIN_S', () => {
    const played = play(240, () => 4000, 0);
    const doneAt = played.findIndex((p) => p >= 4000);
    expect(doneAt).toBeGreaterThan(0);
    expect(doneAt * FRAME).toBeLessThanOrEqual(DRAIN_S * 1000 + 2 * FRAME);
  });
});

describe('whole words', () => {
  it('never shows a word that is still arriving', () => {
    expect(revealLimit('Sure. The morn', true)).toBe('Sure. The'.length);
    expect(revealLimit('Sure', true)).toBe(0);
    expect(revealLimit('Sure. The morn', false)).toBe('Sure. The morn'.length);
  });

  it('shows a word only once the pace has reached its end', () => {
    const text = 'The morning fog rolled in';
    expect(wholeWordsUpTo(text, 2, text.length)).toBe(0);
    expect(wholeWordsUpTo(text, 3, text.length)).toBe(3);
    expect(wholeWordsUpTo(text, 7.6, text.length)).toBe(3);
    expect(wholeWordsUpTo(text, 11, text.length)).toBe('The morning'.length);
    expect(wholeWordsUpTo(text, 99, 15)).toBe(15);
  });

  it('keeps the fade length on the --dur-swell token, on the ink curve', () => {
    const theme = readFileSync(join(process.cwd(), 'src/theme.css'), 'utf8');
    expect(theme).toContain(`--dur-swell: ${WORD_FADE_MS}ms;`);
    expect(theme).toMatch(
      /\.md-live \.w \{\n\s*animation: word-in var\(--dur-swell\) var\(--ease-ink\) backwards;/,
    );
  });
});

describe('splitBlocks', () => {
  it('cuts at blank lines between paragraphs and headings', () => {
    expect(splitBlocks('# Title\n\nOne two.\nThree.\n\nFour')).toEqual([
      '# Title\n',
      'One two.\nThree.\n',
      'Four',
    ]);
  });

  it('keeps a fence whole, blank lines and all', () => {
    const text = 'Run:\n\n```sh\na\n\nb\n```\n\nDone';
    expect(splitBlocks(text)).toEqual(['Run:\n', '```sh\na\n\nb\n```\n', 'Done']);
  });

  it('keeps a loose list and its indented paragraphs together', () => {
    const list = '1. First\n\n   more on first\n\n2. Second\n\n- a\n- b';
    expect(splitBlocks(list)).toEqual([list]);
  });

  it('joins back to exactly the text it was cut from', () => {
    const text = 'a\n\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n~~~\nopen fence';
    expect(splitBlocks(text).join('\n')).toBe(text);
  });
});

describe('closeOpenMarks', () => {
  it('closes bold, italic and code a live block has opened', () => {
    expect(closeOpenMarks('**Step 1: Under')).toBe('**Step 1: Under**');
    expect(closeOpenMarks('an *operational rhythm')).toBe('an *operational rhythm*');
    expect(closeOpenMarks('run `npm te')).toBe('run `npm te`');
    expect(closeOpenMarks('***both at once')).toBe('***both at once***');
    expect(closeOpenMarks('**Goal:** Show *you ')).toBe('**Goal:** Show *you* ');
  });

  it('leaves balanced text, bullets and arithmetic alone', () => {
    expect(closeOpenMarks('**done** and *done*')).toBe('**done** and *done*');
    expect(closeOpenMarks('* first item\n* second')).toBe('* first item\n* second');
    expect(closeOpenMarks('2 * 3 = 6')).toBe('2 * 3 = 6');
    expect(closeOpenMarks('a \\*literal')).toBe('a \\*literal');
    expect(closeOpenMarks('```js\nconst a = **b')).toBe('```js\nconst a = **b');
  });

  it('drops a marker with nothing after it yet, never closing it empty', () => {
    expect(closeOpenMarks('Then **')).toBe('Then ');
    expect(closeOpenMarks('text `')).toBe('text ');
  });
});

describe('the follow glide', () => {
  it('closes the gap to the foot smoothly, never past it', () => {
    let top = 0;
    const seen: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      top = glideStep(top, 24, FRAME);
      seen.push(top);
    }
    expect(seen[0]!).toBeGreaterThan(0);
    expect(seen[0]!).toBeLessThan(12);
    expect(seen.every((t, i) => i === 0 || t >= seen[i - 1]!)).toBe(true);
    expect(seen.at(-1)).toBe(24);
    expect(FOLLOW_GLIDE_TAU_MS).toBeGreaterThanOrEqual(80);
    expect(FOLLOW_GLIDE_TAU_MS).toBeLessThanOrEqual(160);
  });
});

describe('splitWords', () => {
  it('wraps each word and keeps the whitespace as plain text', () => {
    const nodes = splitWords('fog  rolled\nin');
    expect(nodes.map((n) => (n.type === 'text' ? n.value : n.children?.[0]?.value))).toEqual([
      'fog',
      '  ',
      'rolled',
      '\n',
      'in',
    ]);
    expect(nodes.filter((n) => n.tagName === 'span')).toHaveLength(3);
  });
});
