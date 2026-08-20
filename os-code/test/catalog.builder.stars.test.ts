// Star normalization. The data table turns published benchmark scores into
// provenance-backed stars. These tests pin the two rules that keep the ratings
// honest: a category is rated only when the model targets it AND a benchmark
// exists, and a star is never invented.
import { describe, expect, it } from 'vitest';
import { osCodeFitFromEval, rateCapability, rateModel } from '../scripts/build-catalog/stars.js';

describe('rateCapability', () => {
  it('maps a strong coding score to a high star with provenance', () => {
    const rated = rateCapability('coding', { HumanEval: 92 });
    expect(rated?.stars).toBe(5);
    expect(rated?.provenance).toEqual(['HumanEval']);
  });

  it('averages several benchmarks and snaps to a 0.5 step', () => {
    // HumanEval 88.4 -> 4.5, MBPP 79 -> 4, BFCL 85 -> 4.5; mean 4.33 snaps to 4.5.
    const rated = rateCapability('coding', { HumanEval: 88.4, MBPP: 79, BFCL: 85 });
    expect(rated?.stars).toBe(4.5);
    expect(rated?.provenance).toEqual(['HumanEval', 'MBPP', 'BFCL']);
  });

  it('returns undefined when no benchmark for the capability has a score', () => {
    // A vision benchmark cannot rate the coding dimension.
    expect(rateCapability('coding', { MMMU: 80 })).toBeUndefined();
  });

  it('ignores non-finite scores rather than rating them', () => {
    expect(rateCapability('coding', { HumanEval: Number.NaN })).toBeUndefined();
  });

  it('rates embedding on its own tighter MTEB scale', () => {
    expect(rateCapability('embedding', { MTEB: 62 })?.stars).toBe(4);
  });
});

describe('rateModel', () => {
  it('rates only the categories the model targets, never invents a star', () => {
    // The model targets coding and reasoning; a stray vision score is ignored.
    const stars = rateModel(['coding', 'reasoning'], {
      HumanEval: 88.4,
      MMLU: 68,
      MMMU: 90,
    });
    const caps = stars.map((s) => s.capability).sort();
    expect(caps).toEqual(['coding', 'reasoning']);
    expect(stars.every((s) => s.provenance.length > 0)).toBe(true);
  });

  it('omits a targeted category that has no benchmark score', () => {
    const stars = rateModel(['coding', 'writing'], { HumanEval: 80 });
    expect(stars.map((s) => s.capability)).toEqual(['coding']);
  });
});

describe('osCodeFitFromEval', () => {
  it('is round(average * 5), clamped to a valid star', () => {
    expect(osCodeFitFromEval(0.86)).toBe(4);
    expect(osCodeFitFromEval(0.94)).toBe(5);
    expect(osCodeFitFromEval(0)).toBe(0);
    expect(osCodeFitFromEval(1)).toBe(5);
  });
});
