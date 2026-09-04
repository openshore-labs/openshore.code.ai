// The sustainability read is a pure reprice of token counts at published
// intensities. These tests pin the parts with real logic risk: the wall-draw
// energy math (PUE folded in), carbon and water following from energy, the
// local side carrying no on-site water, the counterfactual/avoided/actual split,
// and the zero-token and floor edges.
import { describe, expect, it } from 'vitest';
import { SUSTAINABILITY_BASIS, computeSustainability } from '../src/insights/sustainability.js';

const B = SUSTAINABILITY_BASIS;

describe('computeSustainability', () => {
  it('is all zero with no tokens', () => {
    const s = computeSustainability(0, 0);
    for (const f of [s.local, s.cloudCounterfactual, s.avoided, s.cloudActual]) {
      expect(f.kwh).toBe(0);
      expect(f.grams).toBe(0);
      expect(f.liters).toBe(0);
    }
    expect(s.basis).toEqual(B);
  });

  it('folds PUE into the wall draw and derives carbon and water from it', () => {
    // 1,000,000 local tokens: energy = 1M/1M * localWhPerMTok * localPue Wh.
    const s = computeSustainability(1_000_000, 0);
    const expectedLocalKwh = (B.localWhPerMTok * B.localPue) / 1000;
    expect(s.local.kwh).toBeCloseTo(expectedLocalKwh, 10);
    expect(s.local.grams).toBeCloseTo(expectedLocalKwh * B.gridGramsPerKwh, 8);
    // A personal machine is air-cooled: no on-site water.
    expect(s.local.liters).toBe(0);
  });

  it('prices the counterfactual at the cloud model in a data center, with water', () => {
    const s = computeSustainability(1_000_000, 0);
    const expectedCloudKwh = (B.cloudWhPerMTok * B.cloudPue) / 1000;
    expect(s.cloudCounterfactual.kwh).toBeCloseTo(expectedCloudKwh, 10);
    expect(s.cloudCounterfactual.liters).toBeCloseTo(expectedCloudKwh * B.cloudLitersPerKwh, 8);
    // The cloud model is larger AND carries data-center overhead, so the
    // counterfactual always draws more than the local run.
    expect(s.cloudCounterfactual.kwh).toBeGreaterThan(s.local.kwh);
  });

  it('avoided is the counterfactual minus the local draw, per field', () => {
    const s = computeSustainability(2_000_000, 0);
    expect(s.avoided.kwh).toBeCloseTo(s.cloudCounterfactual.kwh - s.local.kwh, 10);
    expect(s.avoided.grams).toBeCloseTo(s.cloudCounterfactual.grams - s.local.grams, 8);
    // All of the water is avoided (local has none), so it equals the cloud water.
    expect(s.avoided.liters).toBeCloseTo(s.cloudCounterfactual.liters, 10);
    expect(s.avoided.liters).toBeGreaterThan(0);
  });

  it('cloudActual reflects only the tokens actually sent to the cloud', () => {
    const s = computeSustainability(0, 1_000_000);
    // No local work: nothing avoided, but the cloud turns have a real footprint.
    expect(s.avoided.kwh).toBe(0);
    expect(s.cloudActual.kwh).toBeGreaterThan(0);
    expect(s.cloudActual.liters).toBeGreaterThan(0);
    const s2 = computeSustainability(0, 2_000_000);
    expect(s2.cloudActual.kwh).toBeCloseTo(s.cloudActual.kwh * 2, 10);
  });

  it('never reports negative avoided even with a degenerate basis', () => {
    // A basis where local is somehow costlier than the cloud: avoided floors at 0.
    const flipped = { ...B, localWhPerMTok: 10_000, cloudWhPerMTok: 1 };
    const s = computeSustainability(1_000_000, 0, flipped);
    expect(s.avoided.kwh).toBe(0);
    expect(s.avoided.grams).toBe(0);
  });
});
