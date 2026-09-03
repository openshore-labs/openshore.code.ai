import { describe, expect, it } from 'vitest';
import { sourceSupportsVision } from '../src/state/types.js';

describe('sourceSupportsVision', () => {
  it('is true for every Claude chat (the whole lineup reads images)', () => {
    expect(
      sourceSupportsVision({ kind: 'cloud', provider: 'anthropic', model: 'claude-opus-5' }),
    ).toBe(true);
    expect(
      sourceSupportsVision({ kind: 'cloud', provider: 'anthropic', model: 'claude-haiku-4-5' }),
    ).toBe(true);
  });

  it('follows the catalog for other cloud providers', () => {
    // GPT-5 and Gemini 2.5 Pro read images; GPT-5 mini does not, so the attach
    // button shows only where an image is actually understood.
    expect(sourceSupportsVision({ kind: 'cloud', provider: 'openai', model: 'gpt-5' })).toBe(true);
    expect(
      sourceSupportsVision({ kind: 'cloud', provider: 'google', model: 'gemini-2.5-pro' }),
    ).toBe(true);
    expect(sourceSupportsVision({ kind: 'cloud', provider: 'openai', model: 'gpt-5-mini' })).toBe(
      false,
    );
  });

  it('defaults to false for every text-only or unknown brain', () => {
    expect(sourceSupportsVision(undefined)).toBe(false);
    expect(sourceSupportsVision({ kind: 'stack' })).toBe(false);
    expect(sourceSupportsVision({ kind: 'device', modelId: 'x', modelName: 'X' })).toBe(false);
    expect(sourceSupportsVision({ kind: 'desktop' })).toBe(false);
    expect(sourceSupportsVision({ kind: 'mock' })).toBe(false);
  });
});
