// P2-14: the cloud context meter must be computed against the model's real
// context window, not a flat 1M (which read the meter roughly 5x too low).
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  contextPercentFor,
  contextWindowFor,
} from '../src/drivers/cloudClaudeDriver.js';

describe('cloud context meter (P2-14)', () => {
  it('every listed model carries a real context window', () => {
    for (const m of CLAUDE_MODELS) expect(m.contextWindow).toBeGreaterThanOrEqual(200_000);
  });

  it('reads against the real window, not 1M', () => {
    expect(contextWindowFor(DEFAULT_CLAUDE_MODEL)).toBe(200_000);
    // 100k tokens is ~50% of a 200k window (it read ~10% against a 1M window).
    expect(contextPercentFor(DEFAULT_CLAUDE_MODEL, 100_000)).toBe(50);
    // An unknown model falls back to the same default window, not 1M.
    expect(contextPercentFor('mystery-model', 100_000)).toBe(50);
  });

  it('clamps at 100 percent', () => {
    expect(contextPercentFor(DEFAULT_CLAUDE_MODEL, 999_999)).toBe(100);
  });
});
