// The leaner-stack optimizer is where the sustainability honesty risk lives, so
// its guardrails are pinned here: it never trades capability away for a smaller
// model, it only surfaces a meaningful energy gain, it never calls a cloud model
// greener, and it makes no claim about a model it cannot identify.
import { describe, expect, it } from 'vitest';
import type { CapabilityCategory, CatalogModel } from 'os-code/protocol';
import { leanerSuggestions, type CrewMemberLite } from '../src/lib/stackOptimizer.js';

function model(
  over: Partial<CatalogModel> & { id: string; sizeGB: number; fit: number } & {
    caps?: CapabilityCategory[];
  },
): CatalogModel {
  const { fit, caps, ...rest } = over;
  return {
    id: over.id,
    name: over.id,
    tagline: 'A test model.',
    categories: caps ?? ['coding'],
    orchestratorCapable: false,
    source: { kind: 'ollama', ref: `${over.id}:ref`, pullCommand: `ollama pull ${over.id}` },
    sizeGB: over.sizeGB,
    quantization: 'Q4_K_M',
    contextTokens: 32768,
    license: { id: 'Apache-2.0', name: 'Apache License 2.0' },
    curation: { rank: 1, note: 'test' },
    blessed: false,
    ratings: { perCapability: {}, osCodeFit: fit },
    ...rest,
  } as CatalogModel;
}

describe('leanerSuggestions', () => {
  it('suggests a leaner, capability-preserving peer for a local role', () => {
    const big = model({ id: 'big', sizeGB: 32, fit: 4.5, caps: ['coding'] });
    const lean = model({ id: 'lean', sizeGB: 8, fit: 4.5, caps: ['coding'] });
    const crew: CrewMemberLite[] = [{ role: 'coding', model: 'big', kind: 'local' }];
    const out = leanerSuggestions(crew, [big, lean]);
    expect(out).toHaveLength(1);
    expect(out[0].to.id).toBe('lean');
    expect(out[0].fromCloud).toBe(false);
    // 8GB vs 32GB is about 75% leaner by the size proxy.
    expect(out[0].savingFraction).toBeCloseTo(0.75, 2);
  });

  it('never trades capability away: skips a smaller model that guts the fit', () => {
    const good = model({ id: 'good', sizeGB: 32, fit: 4.6, caps: ['coding'] });
    const tiny = model({ id: 'tiny', sizeGB: 2, fit: 3.0, caps: ['coding'] }); // leaner but far weaker
    const crew: CrewMemberLite[] = [{ role: 'coding', model: 'good', kind: 'local' }];
    expect(leanerSuggestions(crew, [good, tiny])).toEqual([]);
  });

  it('skips a leaner model that drops the capability the role needs', () => {
    const coder = model({ id: 'coder', sizeGB: 32, fit: 4.5, caps: ['coding'] });
    const writer = model({ id: 'writer', sizeGB: 6, fit: 4.8, caps: ['writing'] }); // leaner, strong, wrong job
    const crew: CrewMemberLite[] = [{ role: 'coding', model: 'coder', kind: 'local' }];
    expect(leanerSuggestions(crew, [coder, writer])).toEqual([]);
  });

  it('does not surface a swap that is not meaningfully leaner', () => {
    const a = model({ id: 'a', sizeGB: 10, fit: 4.5, caps: ['coding'] });
    const b = model({ id: 'b', sizeGB: 9.2, fit: 4.6, caps: ['coding'] }); // <15% leaner
    const crew: CrewMemberLite[] = [{ role: 'coding', model: 'a', kind: 'local' }];
    expect(leanerSuggestions(crew, [a, b])).toEqual([]);
  });

  it('replaces a cloud role with a strong local peer, no invented per-token delta', () => {
    const strong = model({ id: 'local-strong', sizeGB: 20, fit: 4.4, caps: ['coding'] });
    const weak = model({ id: 'local-weak', sizeGB: 4, fit: 3.2, caps: ['coding'] });
    const crew: CrewMemberLite[] = [{ role: 'coding', model: 'claude-sonnet', kind: 'cloud' }];
    const out = leanerSuggestions(crew, [strong, weak]);
    expect(out).toHaveLength(1);
    expect(out[0].to.id).toBe('local-strong'); // the weak one is below the cloud-replace floor
    expect(out[0].fromCloud).toBe(true);
    expect(out[0].savingFraction).toBeUndefined();
  });

  it('makes no claim about a local model it cannot find in the catalog', () => {
    const lean = model({ id: 'lean', sizeGB: 4, fit: 4.5, caps: ['coding'] });
    const crew: CrewMemberLite[] = [{ role: 'coding', model: 'some-unlisted-model', kind: 'local' }];
    expect(leanerSuggestions(crew, [lean])).toEqual([]);
  });

  it('requires orchestrator-capable for the orchestrator role', () => {
    const orch = model({ id: 'orch', sizeGB: 40, fit: 4.6, caps: ['reasoning'], orchestratorCapable: true });
    const notOrch = model({ id: 'small', sizeGB: 6, fit: 4.7, caps: ['reasoning'], orchestratorCapable: false });
    const alsoOrch = model({ id: 'lean-orch', sizeGB: 14, fit: 4.4, caps: ['reasoning'], orchestratorCapable: true });
    const crew: CrewMemberLite[] = [{ role: 'orchestrator', model: 'orch', kind: 'local' }];
    const out = leanerSuggestions(crew, [orch, notOrch, alsoOrch]);
    expect(out).toHaveLength(1);
    expect(out[0].to.id).toBe('lean-orch');
  });
});
