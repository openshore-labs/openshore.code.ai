// PROGRESS.md SHAPE GUARD. The file's own contract (CLAUDE.md: "current state
// first, then What remains, then the log") drifted into 62 stacked Current
// state sections and 3,700 lines, a per-session reading tax that made its
// "What remains" list give wrong directions. The 2026-09-05 restructure moved
// the history to docs/progress-archive.md and the parked prompts to
// docs/parked-ideas.md; this test keeps it that way.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const progress = readFileSync(resolve(ROOT, 'PROGRESS.md'), 'utf8');
const lines = progress.split('\n');
const count = (re: RegExp) => lines.filter((l) => re.test(l)).length;

describe('PROGRESS.md shape', () => {
  it('has exactly one Current state section', () => {
    expect(count(/^## Current state/)).toBe(1);
  });

  it('has exactly one What remains section', () => {
    expect(count(/^## What remains/)).toBe(1);
  });

  it('has one Log section, after What remains', () => {
    expect(count(/^## Log$/)).toBe(1);
    const remains = lines.findIndex((l) => /^## What remains/.test(l));
    const log = lines.findIndex((l) => /^## Log$/.test(l));
    const state = lines.findIndex((l) => /^## Current state/.test(l));
    expect(state).toBeLessThan(remains);
    expect(remains).toBeLessThan(log);
  });

  it('stays under 1,000 lines (history goes to the archive)', () => {
    expect(lines.length).toBeLessThan(1000);
  });

  it('keeps the archive and the parked prompts where the pointer says', () => {
    expect(existsSync(resolve(ROOT, 'docs/progress-archive.md'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'docs/parked-ideas.md'))).toBe(true);
    expect(progress).toContain('docs/progress-archive.md');
    expect(progress).toContain('docs/parked-ideas.md');
  });
});
