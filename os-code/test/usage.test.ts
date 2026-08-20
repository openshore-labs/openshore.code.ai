// Cloud usage persistence (E2). All-time spend is money the status line reports,
// so a torn write or a concurrent process must never silently reset it to zero.
// A corrupt usage.json is preserved as .corrupt and refused, never re-seeded.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageTracker } from '../src/auth/usage.js';

let home: string;

function usagePath(): string {
  return join(home, 'usage.json');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'osc-usage-'));
  process.env.OSC_HOME = home;
  mkdirSync(home, { recursive: true });
});
afterEach(() => {
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('usage persistence', () => {
  it('does not re-seed from zero when the existing usage.json is unparsable', () => {
    const garbage = '{"dollars": 123.45, "promptTokens":'; // truncated torn write
    writeFileSync(usagePath(), garbage);

    new UsageTracker().noteCloud('claude-sonnet', 1000, 500);

    // The corrupt file is left untouched (NOT overwritten with a fresh, tiny
    // zero-based total), and a recovery copy is preserved.
    expect(readFileSync(usagePath(), 'utf8')).toBe(garbage);
    expect(existsSync(`${usagePath()}.corrupt`)).toBe(true);
    expect(readFileSync(`${usagePath()}.corrupt`, 'utf8')).toBe(garbage);
  });

  it('accumulates lifetime totals across calls rather than resetting', () => {
    const tracker = new UsageTracker();
    tracker.noteCloud('claude-sonnet', 1000, 500);
    tracker.noteCloud('claude-sonnet', 2000, 1000);

    const totals = JSON.parse(readFileSync(usagePath(), 'utf8'));
    expect(totals.promptTokens).toBe(3000);
    expect(totals.completionTokens).toBe(1500);
    expect(totals.cloudCalls).toBe(2);
    expect(totals.dollars).toBeGreaterThan(0);
  });

  it('leaves no temp file behind after a successful write', () => {
    new UsageTracker().noteCloud('claude-sonnet', 10, 10);
    const strays = readdirSync(home).filter((f) => f.includes('.tmp'));
    expect(strays).toEqual([]);
  });
});
