import { describe, expect, it } from 'vitest';
import { sourceSupportsVision } from '../src/state/types.js';

describe('sourceSupportsVision', () => {
  it('is true only for a direct Claude chat', () => {
    expect(
      sourceSupportsVision({ kind: 'cloud', provider: 'anthropic', model: 'claude-opus-5' }),
    ).toBe(true);
  });

  it('defaults to false for every text-only or unknown brain', () => {
    expect(sourceSupportsVision(undefined)).toBe(false);
    expect(sourceSupportsVision({ kind: 'stack' })).toBe(false);
    expect(sourceSupportsVision({ kind: 'device', modelId: 'x', modelName: 'X' })).toBe(false);
    expect(sourceSupportsVision({ kind: 'desktop' })).toBe(false);
    expect(sourceSupportsVision({ kind: 'mock' })).toBe(false);
  });
});
