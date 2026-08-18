// The polish layer: streaming smoother, diff syntax tinting, the download
// progress bar, color-depth downsampling, the load-note logic, and transcript
// search. These protect the "delight" surface, so they get real tests.
import { afterEach, describe, expect, it } from 'vitest';
import { nextRevealLength, ticksToDrain } from '../src/tui/smoothing.js';
import { tokenizeCodeLine } from '../src/tui/syntax.js';
import { progressBarPlain, fmtBytes } from '../src/commands/util.js';
import { busyNote } from '../src/tui/statusLine.js';
import { searchTranscript } from '../src/tui/transcriptSearch.js';
import { fgSequence, setColorDepth } from '../src/brand/theme.js';

describe('streaming smoother', () => {
  it('never moves backward and never overshoots the target', () => {
    expect(nextRevealLength(10, 10)).toBe(10);
    expect(nextRevealLength(12, 10)).toBe(10); // clamp if shown ran ahead
    const next = nextRevealLength(0, 3);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThanOrEqual(3);
  });

  it('keeps pace with a slow trickle (lag stays bounded, never unbounded)', () => {
    // Local models often emit a few chars per tick. The smoother reveals a
    // little slower to stay calm, but the lag must stay small and bounded.
    let shown = 0;
    let target = 0;
    for (let step = 0; step < 40; step += 1) {
      target += 3;
      shown = nextRevealLength(shown, target);
    }
    expect(target - shown).toBeLessThanOrEqual(14); // bounded lag
    expect(shown).toBeGreaterThan(target * 0.85); // still roughly keeping up
  });

  it('drains a large burst smoothly but promptly', () => {
    // A 1200-char cloud burst should fully reveal within a reasonable number
    // of ticks (at 24ms/tick that is well under a second), never in one jump.
    const ticks = ticksToDrain(1200);
    expect(ticks).toBeGreaterThan(5); // not a single dump
    expect(ticks).toBeLessThan(60); // under ~1.5s at 24ms/tick
  });
});

describe('diff syntax tokenizer', () => {
  it('separates strings, keywords, comments, and plain code', () => {
    const tokens = tokenizeCodeLine('const x = "hi"; // note');
    const byKind = (k: string) =>
      tokens
        .filter((t) => t.kind === k)
        .map((t) => t.text.trim())
        .filter(Boolean);
    expect(byKind('keyword')).toContain('const');
    expect(byKind('string')).toContain('"hi"');
    expect(tokens.some((t) => t.kind === 'comment' && t.text.includes('note'))).toBe(true);
  });

  it('does not treat a # inside a string as a comment', () => {
    const tokens = tokenizeCodeLine('color = "#ff0000"');
    const strings = tokens.filter((t) => t.kind === 'string');
    expect(strings[0]!.text).toBe('"#ff0000"');
    expect(tokens.some((t) => t.kind === 'comment')).toBe(false);
  });

  it('handles a python-style comment and def keyword', () => {
    const tokens = tokenizeCodeLine('def add(a, b):  # sums');
    expect(tokens.some((t) => t.kind === 'keyword' && t.text === 'def')).toBe(true);
    expect(tokens.some((t) => t.kind === 'comment')).toBe(true);
  });

  it('reconstructs the original line exactly', () => {
    const line = "  return `${a}` + foo('x') // done";
    expect(
      tokenizeCodeLine(line)
        .map((t) => t.text)
        .join(''),
    ).toBe(line);
  });
});

describe('progress bar and byte sizes', () => {
  it('fills proportionally and clamps', () => {
    expect(progressBarPlain(0, 10)).toBe('░'.repeat(10));
    expect(progressBarPlain(100, 10)).toBe('█'.repeat(10));
    expect(progressBarPlain(50, 10)).toBe('█'.repeat(5) + '░'.repeat(5));
    expect(progressBarPlain(150, 10)).toBe('█'.repeat(10)); // clamp high
    expect(progressBarPlain(-5, 10)).toBe('░'.repeat(10)); // clamp low
  });

  it('formats bytes in base-1000 units', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(500)).toBe('500 B');
    expect(fmtBytes(4_700_000_000)).toBe('4.7 GB');
    expect(fmtBytes(2_100_000)).toBe('2.1 MB');
  });
});

describe('status load note', () => {
  it('names the model warming up once past the hint threshold', () => {
    const note = busyNote({
      loading: true,
      loadElapsedSec: 3,
      kind: 'local',
      model: 'qwen',
      stepNote: 'thinking',
    });
    expect(note).toContain('warming up qwen');
    expect(note).toContain('3s');
  });

  it('stays quiet for a fast first token', () => {
    expect(
      busyNote({
        loading: true,
        loadElapsedSec: 0.3,
        kind: 'local',
        model: 'qwen',
        stepNote: 'thinking',
      }),
    ).toBe('thinking');
  });

  it('falls back to the step note when not loading', () => {
    expect(
      busyNote({
        loading: false,
        loadElapsedSec: 9,
        kind: 'local',
        model: 'qwen',
        stepNote: 'grep',
      }),
    ).toBe('grep');
  });
});

describe('transcript search', () => {
  const items = [
    { kind: 'user' as const, text: 'fix the auth bug' },
    { kind: 'assistant' as const, text: 'I updated login.ts and added a test' },
    { kind: 'tool' as const, name: 'editFile', summary: 'login.ts', state: 'ok' as const },
    { kind: 'banner' as const, lines: [], tagline: 'x' },
  ];

  it('finds matches case-insensitively across item kinds', () => {
    expect(searchTranscript(items, 'LOGIN')).toHaveLength(2);
    expect(searchTranscript(items, 'auth')[0]).toContain('fix the auth bug');
  });

  it('returns nothing for an empty query or no match', () => {
    expect(searchTranscript(items, '')).toEqual([]);
    expect(searchTranscript(items, 'nonexistent')).toEqual([]);
  });
});

describe('color depth downsampling', () => {
  const ESC = '\u001b';
  afterEach(() => setColorDepth(undefined));

  it('emits truecolor, 256, or 16-color sequences per depth', () => {
    setColorDepth('truecolor');
    expect(fgSequence(45, 212, 191)).toBe(`${ESC}[38;2;45;212;191m`);
    setColorDepth('ansi256');
    expect(fgSequence(45, 212, 191)).toMatch(/\[38;5;\d+m$/);
    setColorDepth('ansi16');
    expect(fgSequence(45, 212, 191)).toMatch(/\[(3\d|9\d)m$/);
  });

  it('maps a near-gray to the 256 grayscale ramp', () => {
    setColorDepth('ansi256');
    const seq = fgSequence(128, 130, 129);
    const idx = Number(/38;5;(\d+)m/.exec(seq)![1]);
    expect(idx).toBeGreaterThanOrEqual(232); // grayscale range
    expect(idx).toBeLessThanOrEqual(255);
  });
});
