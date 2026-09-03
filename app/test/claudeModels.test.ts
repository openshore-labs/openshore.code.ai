import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MODELS,
  CLAUDE_MODELS_PRIMARY,
  CLAUDE_MODELS_MORE,
  claudeModel,
  claudeModelLabel,
  DEFAULT_CLAUDE_MODEL,
} from '../src/lib/claudeModels.js';

describe('Claude model catalog', () => {
  it('leads with the current lineup, most capable first', () => {
    // The Claude app's picker shape: the current family up top.
    expect(CLAUDE_MODELS_PRIMARY.map((m) => m.id)).toEqual([
      'claude-fable-5-1',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ]);
    expect(CLAUDE_MODELS_PRIMARY.every((m) => m.tier === 'primary')).toBe(true);
  });

  it('lists the older, still-reachable models behind "more"', () => {
    expect(CLAUDE_MODELS_MORE.map((m) => m.id)).toEqual([
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
    ]);
    expect(CLAUDE_MODELS_MORE.every((m) => m.tier === 'more')).toBe(true);
  });

  it('the two tiers together make the full catalog, ids unique', () => {
    expect(CLAUDE_MODELS.length).toBe(CLAUDE_MODELS_PRIMARY.length + CLAUDE_MODELS_MORE.length);
    expect(new Set(CLAUDE_MODELS.map((m) => m.id)).size).toBe(CLAUDE_MODELS.length);
  });

  it('carries a real context window on every model and no pricing', () => {
    // OpenShore does not price usage; billing rides the user's own account, so
    // the catalog carries no per-token rates, only the real context window.
    for (const m of CLAUDE_MODELS) {
      expect(m.contextWindow, `${m.id} context`).toBeGreaterThanOrEqual(200_000);
    }
    expect(claudeModel('claude-fable-5-1')?.contextWindow).toBe(1_000_000);
    expect(claudeModel('claude-haiku-4-5')?.contextWindow).toBe(200_000);
    expect(claudeModel('claude-opus-5')).not.toHaveProperty('inPerM');
    expect(claudeModel('claude-opus-5')).not.toHaveProperty('outPerM');
  });

  it('names models by their short label, falling back to the id', () => {
    expect(claudeModelLabel('claude-opus-5')).toBe('Opus 5');
    expect(claudeModelLabel('claude-opus-4-8')).toBe('Opus 4.8');
    expect(claudeModelLabel('unknown')).toBe('unknown');
  });

  it('defaults to Opus 5', () => {
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-opus-5');
  });
});
