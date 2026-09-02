// Prefab stacks are derived from the model set, so they reassess as models
// change. Pin the derivation shape against a realistic fixture: a pocket stack
// for the phone, a starter, a coding stack with the right specialists, and a
// performance stack led by the highest-scoring coder. Every referenced id must
// exist in the input set (no dangling members).
import { describe, expect, it } from 'vitest';
import { derivePresets } from '../scripts/build-catalog/presets.js';
import type { CatalogModel } from '../src/market/schema.js';

function model(
  id: string,
  categories: string[],
  sizeGB: number,
  opts: { onDevice?: boolean; kind?: 'ollama' | 'huggingface' } = {},
): CatalogModel {
  return {
    id,
    name: id,
    blurb: id,
    sizeGB,
    quant: 'Q4_K_M',
    contextTokens: 32768,
    categories,
    license: { id: 'Apache-2.0', name: 'Apache 2.0', url: 'https://x', commercialUse: true },
    source: { kind: opts.kind ?? 'ollama', ref: `${id}:tag` },
    onDevice: opts.onDevice ? { url: 'https://hf/x.gguf', fileName: 'x.gguf' } : undefined,
  } as unknown as CatalogModel;
}

const models: CatalogModel[] = [
  model('coder-3b', ['coding', 'fast'], 1.9),
  model('coder-7b', ['coding', 'reasoning'], 4.7),
  model('coder-14b', ['coding', 'reasoning'], 9),
  model('coder-32b', ['coding', 'reasoning'], 20),
  model('embed', ['embedding'], 0.3),
  model('vision-7b', ['vision'], 4.7),
  model('pocket-1_5b', ['reasoning', 'fast'], 1.1, { onDevice: true, kind: 'huggingface' }),
];
const evals = { 'coder-32b': 0.94, 'coder-14b': 0.88, 'coder-7b': 0.86, 'coder-3b': 0.7 };

describe('derivePresets', () => {
  const presets = derivePresets(models, evals);
  const byId = new Map(models.map((m) => [m.id, m]));
  const get = (id: string) => presets.find((p) => p.id === id);

  it('produces pocket, starter, coding, and performance', () => {
    expect(presets.map((p) => p.id)).toEqual(['pocket', 'starter', 'coding', 'performance']);
  });

  it('every member id exists in the model set', () => {
    for (const p of presets) {
      expect(byId.has(p.stack.orchestrator), p.id).toBe(true);
      for (const id of Object.values(p.stack.specialists)) {
        if (id) expect(byId.has(id), `${p.id}:${id}`).toBe(true);
      }
    }
  });

  it('picks size-appropriate coders and the right specialists', () => {
    expect(get('pocket')!.stack.orchestrator).toBe('pocket-1_5b');
    expect(get('starter')!.stack.orchestrator).toBe('coder-7b'); // best coder under 6 GB
    expect(get('coding')!.stack.orchestrator).toBe('coder-14b'); // best under 10 GB
    expect(get('coding')!.stack.specialists.embedding).toBe('embed');
    expect(get('coding')!.stack.specialists.fast).toBe('coder-3b');
    expect(get('performance')!.stack.orchestrator).toBe('coder-32b'); // highest score overall
    expect(get('performance')!.stack.specialists.vision).toBe('vision-7b');
  });

  it('falls back to nothing when there are no models to derive from', () => {
    expect(derivePresets([], {})).toEqual([]);
  });
});
