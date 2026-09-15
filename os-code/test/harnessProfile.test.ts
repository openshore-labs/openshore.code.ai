import { describe, it, expect } from 'vitest';
import {
  deriveModelClass,
  deriveProfile,
  paramsBFromModelId,
  useConstrainedDecoding,
  classBlurb,
  MODEL_CLASSES,
} from '../src/harness/profile.js';

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
    expect(classBlurb('tiny').toLowerCase()).toContain('single steps');
  });
});
