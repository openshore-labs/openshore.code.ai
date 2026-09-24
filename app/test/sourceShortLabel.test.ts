import { describe, expect, it } from 'vitest';
import { sourceShortLabel } from '../src/state/types.js';

// The composer's model pill: a cloud model is named for its own provider,
// never "Claude" for every cloud source (brand sweep 2026-09-24, wave 1 #5).
describe('sourceShortLabel', () => {
  it('names Claude as Claude', () => {
    expect(sourceShortLabel({ kind: 'cloud', provider: 'anthropic', model: 'claude-opus-5' })).toBe(
      'Claude',
    );
  });

  it('names OpenAI and the other providers for themselves', () => {
    expect(sourceShortLabel({ kind: 'cloud', provider: 'openai', model: 'gpt-5' })).toBe('OpenAI');
    const gemini = sourceShortLabel({ kind: 'cloud', provider: 'google', model: 'gemini-2.5-pro' });
    expect(gemini).not.toBe('Claude');
    expect(gemini.length).toBeGreaterThan(0);
  });

  it('falls back to the provider id for an unknown provider', () => {
    expect(sourceShortLabel({ kind: 'cloud', provider: 'acme', model: 'x-1' })).toBe('acme');
  });

  it('keeps the short names for the other sources', () => {
    expect(sourceShortLabel(undefined)).toBe('Stack');
    expect(sourceShortLabel({ kind: 'stack' })).toBe('Stack');
    expect(sourceShortLabel({ kind: 'mock' })).toBe('Demo');
  });
});
