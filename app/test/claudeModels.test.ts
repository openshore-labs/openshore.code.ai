import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MODELS,
  claudeModel,
  claudeModelLabel,
  DEFAULT_CLAUDE_MODEL,
} from '../src/lib/claudeModels.js';

describe('Claude model catalog', () => {
  it('lists the full current lineup, most capable first', () => {
    expect(CLAUDE_MODELS.map((m) => m.id)).toEqual([
      'claude-fable-5',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ]);
  });

  it('carries the first-party context windows and no pricing', () => {
    // OpenShore does not price usage; billing rides the user's own account, so
    // the catalog carries no per-token rates, only the real context window.
    expect(claudeModel('claude-fable-5')?.contextWindow).toBe(1_000_000);
    expect(claudeModel('claude-haiku-4-5')?.contextWindow).toBe(200_000);
    expect(claudeModel('claude-opus-5')).not.toHaveProperty('inPerM');
    expect(claudeModel('claude-opus-5')).not.toHaveProperty('outPerM');
  });

  it('names models by their short label, falling back to the id', () => {
    expect(claudeModelLabel('claude-opus-5')).toBe('Opus 5');
    expect(claudeModelLabel('unknown')).toBe('unknown');
  });

  it('defaults to Opus 5', () => {
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-opus-5');
  });
});
