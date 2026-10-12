import { describe, it, expect } from 'vitest';
import {
  deriveModelClass,
  deriveProfile,
  paramsBFromModelId,
  useConstrainedDecoding,
  classBlurb,
  MODEL_CLASSES,
  numCtxCeiling,
  servedContextTokens,
  VAULT_PACK_MAX_TOKENS,
} from '../src/harness/profile.js';
import { packBudgetTokens, packModeFor } from '../src/harness/vaultContext.js';

describe('paramsBFromModelId', () => {
  it('reads a billions hint from the model id', () => {
    expect(paramsBFromModelId('qwen2.5-coder:7b')).toBe(7);
    expect(paramsBFromModelId('qwen2.5-coder:1.5b')).toBe(1.5);
    expect(paramsBFromModelId('llama3.1:70b')).toBe(70);
  });
  it('reads a millions hint as fractional billions', () => {
    expect(paramsBFromModelId('smollm2-135m-instruct')).toBeCloseTo(0.135, 3);
  });
  it('is undefined when the id carries no size', () => {
    expect(paramsBFromModelId('deepseek-coder:latest')).toBeUndefined();
    // The version dot is not a size, and "2.5" is not followed by b/m.
    expect(paramsBFromModelId('qwen2.5-coder:latest')).toBeUndefined();
  });
});

describe('verify retries per class', () => {
  it('gives a lean seat more goes at a failing check than a full one', () => {
    expect(deriveProfile({ model: 'x:3b', kind: 'local' }).verifyRetries).toBe(4);
    expect(deriveProfile({ model: 'x:1.5b', kind: 'local' }).verifyRetries).toBe(4);
    expect(deriveProfile({ model: 'x:14b', kind: 'local' }).verifyRetries).toBe(2);
    expect(deriveProfile({ model: 'x', kind: 'cloud' }).verifyRetries).toBe(2);
  });
  it('is a per-class override like the rest of the policy', () => {
    const p = deriveProfile({ model: 'x:3b', kind: 'local' }, { small: { verifyRetries: 6 } });
    expect(p.verifyRetries).toBe(6);
  });
});

describe('deriveModelClass', () => {
  it('classes by parameter count from the name', () => {
    expect(deriveModelClass({ model: 'x:1.5b', kind: 'local' })).toBe('tiny');
    expect(deriveModelClass({ model: 'x:7b', kind: 'local' })).toBe('small');
    expect(deriveModelClass({ model: 'x:14b', kind: 'local' })).toBe('mid');
    expect(deriveModelClass({ model: 'x:70b', kind: 'local' })).toBe('large');
  });
  it('honors an explicit paramsB over the name', () => {
    expect(deriveModelClass({ model: 'x:latest', kind: 'local', paramsB: 2 })).toBe('tiny');
  });
  it('estimates params from on-disk size when the name has none', () => {
    // 4.7 GB Q4 is roughly 7.8B, so small.
    expect(deriveModelClass({ model: 'x:latest', kind: 'local', sizeGB: 4.7 })).toBe('small');
    // 0.1 GB is a tiny pocket model.
    expect(deriveModelClass({ model: 'x:latest', kind: 'local', sizeGB: 0.1 })).toBe('tiny');
  });
  it('is always large for a cloud model', () => {
    expect(deriveModelClass({ model: 'claude-sonnet-5', kind: 'cloud' })).toBe('large');
  });
  it('defaults size-unknown to small so the discipline is applied', () => {
    expect(deriveModelClass({ model: 'mystery:latest', kind: 'local' })).toBe('small');
  });
  it('promotes a size-unknown model to mid when the eval proves it capable', () => {
    expect(deriveModelClass({ model: 'mystery:latest', kind: 'local', evalScore: 0.85 })).toBe(
      'mid',
    );
    expect(deriveModelClass({ model: 'mystery:latest', kind: 'local', evalScore: 0.4 })).toBe(
      'small',
    );
  });
  it('promotes a size-unknown model to mid on a very large context window', () => {
    expect(
      deriveModelClass({
        model: 'mystery:latest',
        kind: 'local',
        caps: { contextTokens: 128_000, supportsGrammar: true },
      }),
    ).toBe('mid');
  });
});

describe('deriveProfile', () => {
  it('gives a tiny seat the tightest discipline', () => {
    const p = deriveProfile({ model: 'x:1.5b', kind: 'local' });
    expect(p.modelClass).toBe('tiny');
    expect(p.maxCallsPerTurn).toBe(1);
    expect(p.maxToolsShown).toBe(6);
    expect(p.constrainedDecoding).toBe(true);
    expect(p.subagents).toBe('no');
    expect(p.plans).toBe(false);
  });
  it('lets a mid seat plan and delegate with native decoding', () => {
    const p = deriveProfile({ model: 'x:14b', kind: 'local' });
    expect(p.modelClass).toBe('mid');
    expect(p.plans).toBe(true);
    expect(p.subagents).toBe('yes');
    expect(p.constrainedDecoding).toBe(false);
    expect(p.maxToolsShown).toBe(Infinity);
  });
  it('applies a project override for the derived class only', () => {
    const p = deriveProfile({ model: 'x:1.5b', kind: 'local' }, { tiny: { maxCallsPerTurn: 3 } });
    expect(p.maxCallsPerTurn).toBe(3);
    // Untouched fields keep the class default.
    expect(p.maxToolsShown).toBe(6);
  });
  it('ignores an override for a different class than the one derived', () => {
    const p = deriveProfile({ model: 'x:14b', kind: 'local' }, { tiny: { maxCallsPerTurn: 99 } });
    expect(p.maxCallsPerTurn).toBe(8);
  });
});

describe('useConstrainedDecoding', () => {
  it('constrains a small seat only when the backend supports grammar', () => {
    const small = deriveProfile({ model: 'x:7b', kind: 'local' });
    expect(useConstrainedDecoding(small, { supportsGrammar: true })).toBe(true);
    expect(useConstrainedDecoding(small, { supportsGrammar: false })).toBe(false);
  });
  it('never constrains a large seat even where grammar is available', () => {
    const large = deriveProfile({ model: 'x:70b', kind: 'local' });
    expect(useConstrainedDecoding(large, { supportsGrammar: true })).toBe(false);
  });
});

describe('classBlurb', () => {
  it('has an honest line for every class', () => {
    for (const c of MODEL_CLASSES) {
      expect(classBlurb(c).length).toBeGreaterThan(0);
    }
    expect(classBlurb('tiny').toLowerCase()).toContain('one step at a time');
    // D3 (2026-10-07): the copy review's plain rewrite, read by a person.
    for (const c of MODEL_CLASSES) {
      expect(classBlurb(c)).not.toMatch(/harness|seat|tools|subagent/i);
    }
    expect(classBlurb('small')).toBe('Handles short plans. OpenShore keeps the checklist for it.');
  });
});

// Vault M4, tech review I1 and I2: the served window and the pack budget. The numbers
// are placeholders until the eval; these pin the shape, not the values' worth.
describe('the served window', () => {
  it('reads the class ceiling by memory band', () => {
    expect(numCtxCeiling('small', 8)).toBe(8192);
    expect(numCtxCeiling('small', 16)).toBe(16384);
    expect(numCtxCeiling('mid', 32)).toBe(16384);
    expect(numCtxCeiling('large', 64)).toBe(16384);
    expect(numCtxCeiling('tiny', 12)).toBe(16384);
  });
  it('serves the lower of the native window and the ceiling', () => {
    expect(servedContextTokens(131_072, 'small', 16)).toBe(16384);
    expect(servedContextTokens(4096, 'small', 64)).toBe(4096);
  });
  it('a served window below 100k never drops a seat a class', () => {
    const caps = { contextTokens: 16384, nativeContextTokens: 131_072, supportsGrammar: false };
    expect(deriveModelClass({ model: 'mystery', kind: 'local', caps })).toBe('mid');
  });
});

describe('the pack budget', () => {
  it('is the class fraction of the served window, capped for every class', () => {
    const small = deriveProfile({ model: 'x:7b', kind: 'local' });
    expect(packBudgetTokens(small, 16384)).toBe(Math.floor(16384 * small.vaultPackFraction));
    expect(packBudgetTokens(small, 1_000_000)).toBe(VAULT_PACK_MAX_TOKENS);
  });
  it('every class is Current State under auto in M4', () => {
    for (const c of MODEL_CLASSES) {
      expect(packModeFor('auto', c)).toBe('current-state');
      expect(packModeFor('full', c)).toBe('full');
      expect(packModeFor('off', c)).toBeNull();
    }
  });
  it('a project may override the merged vault tool only', () => {
    const p = deriveProfile(
      { model: 'x:7b', kind: 'local' },
      { small: { mergedVaultTool: false } },
    );
    expect(p.mergedVaultTool).toBe(false);
  });
});

// Vault M4, 4.1 (tech review I2): the loop now reads these, so the tighter class
// must spend less of its window on the map and compact sooner, and every
// budget must scale with the served window.
describe('the budgets the loop reads, by class', () => {
  const profileOf = (model: string) => deriveProfile({ model, kind: 'local' });
  const byClass = {
    tiny: profileOf('qwen2.5-coder:1.5b'),
    small: profileOf('qwen2.5-coder:7b'),
    mid: profileOf('qwen2.5-coder:14b'),
    large: deriveProfile({ model: 'claude', kind: 'cloud' }),
  };

  it('a tighter class spends less on the code map and compacts sooner', () => {
    const order = MODEL_CLASSES.map((c) => byClass[c]);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!.codeMapContextFraction).toBeGreaterThanOrEqual(
        order[i - 1]!.codeMapContextFraction,
      );
      expect(order[i]!.compactAtContextFraction).toBeGreaterThanOrEqual(
        order[i - 1]!.compactAtContextFraction,
      );
    }
    expect(byClass.tiny.compactAtContextFraction).toBeLessThan(0.7);
  });

  it('the pack budget scales with the served window, never past the cap', () => {
    for (const c of MODEL_CLASSES) {
      const p = byClass[c];
      const at8k = packBudgetTokens(p, servedContextTokens(131072, c, 8));
      const at64 = packBudgetTokens(p, servedContextTokens(131072, c, 64));
      expect(at8k).toBeLessThanOrEqual(at64);
      expect(at64).toBeLessThanOrEqual(VAULT_PACK_MAX_TOKENS);
    }
    expect(packBudgetTokens(byClass.small, 8192)).toBe(Math.floor(8192 * 0.08));
  });
});
