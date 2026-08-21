// Pure marketplace logic. The load-bearing contract here is the sort ordering
// for the new optional fields: a missing value always sorts LAST, with
// curation.rank as the stable tiebreaker, so a partial or old catalog still
// lands in curated order. Plus fit, search, filters, and license posture.
import { describe, expect, it } from 'vitest';
import type { CatalogModel } from 'os-code/protocol';
import {
  EMPTY_FACETS,
  buildShelves,
  capabilityShelfTitle,
  featuredModels,
  filterModels,
  fitFor,
  fuzzyMatch,
  licensePosture,
  modelMonogram,
  sortModels,
} from '../src/components/marketplace.js';

function model(over: Partial<CatalogModel> & { id: string; rank: number }): CatalogModel {
  const { rank, ...rest } = over;
  return {
    id: over.id,
    name: over.id,
    tagline: 'A test model.',
    categories: ['coding'],
    orchestratorCapable: false,
    source: { kind: 'ollama', ref: `${over.id}:7b`, pullCommand: `ollama pull ${over.id}:7b` },
    sizeGB: 4,
    quantization: 'Q4_K_M',
    contextTokens: 32768,
    license: { id: 'Apache-2.0', name: 'Apache License 2.0' },
    curation: { rank, note: 'test' },
    blessed: false,
    ...rest,
  } as CatalogModel;
}

describe('fitFor', () => {
  it('mirrors the engine budget fractions', () => {
    // 16 GB -> comfortable max ~8.8 GB. A 4 GB model fits, a 20 GB is too big.
    expect(fitFor(4, 16)).toBe('fits');
    expect(fitFor(20, 16)).toBe('too-big');
  });
  it('reports a tight fit in the band just above comfortable', () => {
    // 8 GB -> single profile, max 6 GB. A 6 GB model needs 7.2, tight (<= 8.1).
    expect(fitFor(6, 8)).toBe('tight');
  });
});

describe('fuzzyMatch', () => {
  it('matches a subsequence, case and space insensitive', () => {
    expect(fuzzyMatch('qwn', 'Qwen 2.5 Coder')).toBe(true);
    expect(fuzzyMatch('llama', 'Qwen Coder')).toBe(false);
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });
});

describe('sortModels recommended (default)', () => {
  it('puts recommended first, then curation.rank, popularity never outranks it', () => {
    const models = [
      model({ id: 'a', rank: 5, popularity: { downloads: 9e6, likes: 100, source: 'ollama' } }),
      model({ id: 'b', rank: 2, recommended: { isRecommended: true } }),
      model({ id: 'c', rank: 1, recommended: { isRecommended: true } }),
    ];
    const out = sortModels(models, 'recommended', 16).map((m) => m.id);
    expect(out).toEqual(['c', 'b', 'a']);
  });
});

describe('sortModels undefined ordering', () => {
  it('sends models missing popularity LAST, ranked among themselves', () => {
    const models = [
      model({ id: 'noPopB', rank: 4 }),
      model({ id: 'hasPop', rank: 9, popularity: { downloads: 1000, likes: 1, source: 'ollama' } }),
      model({ id: 'noPopA', rank: 2 }),
    ];
    const out = sortModels(models, 'popular', 16).map((m) => m.id);
    // The one with popularity leads; the two without follow in curation.rank order.
    expect(out).toEqual(['hasPop', 'noPopA', 'noPopB']);
  });

  it('sends models missing timestamps LAST for the newest sort', () => {
    const models = [
      model({ id: 'noDate', rank: 3 }),
      model({ id: 'old', rank: 8, createdAt: '2024-01-01T00:00:00Z' }),
      model({ id: 'new', rank: 9, createdAt: '2026-01-01T00:00:00Z' }),
    ];
    const out = sortModels(models, 'newest', 16).map((m) => m.id);
    expect(out).toEqual(['new', 'old', 'noDate']);
  });
});

describe('filterModels', () => {
  const models = [
    model({ id: 'coder', rank: 1, categories: ['coding'], sizeGB: 4 }),
    model({ id: 'seer', rank: 2, categories: ['vision'], sizeGB: 30 }),
    model({
      id: 'phone',
      rank: 3,
      categories: ['fast'],
      sizeGB: 1,
      onDevice: { url: 'https://example.com/x.gguf', sizeGB: 1, minRamGB: 4 },
    }),
  ];

  it('filters by capability', () => {
    const out = filterModels(models, { ...EMPTY_FACETS, capability: 'vision' }, 16);
    expect(out.map((m) => m.id)).toEqual(['seer']);
  });
  it('filters runs-on-my-machine by fit', () => {
    const out = filterModels(models, { ...EMPTY_FACETS, fits: true }, 16).map((m) => m.id);
    expect(out).toContain('coder');
    expect(out).not.toContain('seer'); // 30 GB is too big on 16 GB
  });
  it('filters on-device only', () => {
    const out = filterModels(models, { ...EMPTY_FACETS, onDeviceOnly: true }, 16).map((m) => m.id);
    expect(out).toEqual(['phone']);
  });
  it('filters by minimum star in a capability', () => {
    const rated = [
      model({
        id: 'strong',
        rank: 1,
        categories: ['coding'],
        ratings: {
          perCapability: { coding: 4.5 },
          osCodeFit: 4,
          provenance: { coding: ['HumanEval'] },
        },
      }),
      model({
        id: 'weak',
        rank: 2,
        categories: ['coding'],
        ratings: {
          perCapability: { coding: 2.5 },
          osCodeFit: 2,
          provenance: { coding: ['HumanEval'] },
        },
      }),
    ];
    const out = filterModels(rated, { ...EMPTY_FACETS, capability: 'coding', minStar: 4 }, 16);
    expect(out.map((m) => m.id)).toEqual(['strong']);
  });
});

describe('licensePosture', () => {
  it('reads commercial posture from the SPDX id, unknown reads as gated', () => {
    expect(licensePosture(model({ id: 'a', rank: 1 }))).toBe('commercial-ok');
    expect(
      licensePosture(
        model({ id: 'b', rank: 1, license: { id: 'Llama-3.1-Community', name: 'x' } }),
      ),
    ).toBe('gated');
    expect(
      licensePosture(model({ id: 'c', rank: 1, license: { id: 'Weird-9.9', name: 'x' } })),
    ).toBe('gated');
  });
});

describe('modelMonogram', () => {
  it('takes the first two letters of the first word that starts with a letter', () => {
    expect(modelMonogram('Qwen 2.5 Coder 7B')).toBe('Qw');
    expect(modelMonogram('DeepSeek R1 14B')).toBe('De');
    expect(modelMonogram('3.2 Llama')).toBe('Ll');
  });
});

describe('capabilityShelfTitle', () => {
  it('sentence-cases the plain capability label', () => {
    expect(capabilityShelfTitle('coding')).toBe('Great at code');
  });
});

describe('featuredModels', () => {
  it('leads with editorial picks in curated order when any exist', () => {
    const models = [
      model({ id: 'plain', rank: 1 }),
      model({ id: 'pickB', rank: 6, recommended: { isRecommended: true } }),
      model({ id: 'pickA', rank: 3, recommended: { isRecommended: true } }),
    ];
    expect(featuredModels(models).map((m) => m.id)).toEqual(['pickA', 'pickB']);
  });
  it('falls back to the top of the curated order when nothing is picked', () => {
    const models = [model({ id: 'b', rank: 2 }), model({ id: 'a', rank: 1 })];
    expect(featuredModels(models, 1).map((m) => m.id)).toEqual(['a']);
  });
});

describe('buildShelves', () => {
  it('surfaces a pocket shelf, a popular shelf, and per-capability shelves', () => {
    const models = [
      model({ id: 'code1', rank: 1, categories: ['coding'] }),
      model({ id: 'code2', rank: 2, categories: ['coding'] }),
      model({ id: 'code3', rank: 3, categories: ['coding'] }),
      model({
        id: 'phone1',
        rank: 4,
        categories: ['fast'],
        onDevice: { url: 'https://x/y.gguf', sizeGB: 1, minRamGB: 4 },
        popularity: { downloads: 9e6, likes: 200, source: 'huggingface' },
      }),
    ];
    const shelves = buildShelves(models, 16);
    const keys = shelves.map((s) => s.key);
    expect(keys).toContain('pocket');
    expect(keys).toContain('cap-coding');
    // Coding shelf keeps curated order and holds all three coding models.
    const coding = shelves.find((s) => s.key === 'cap-coding')!;
    expect(coding.models.map((m) => m.id)).toEqual(['code1', 'code2', 'code3']);
    expect(coding.capability).toBe('coding');
  });

  it('omits a capability shelf below the minimum model count', () => {
    const models = [
      model({ id: 'v1', rank: 1, categories: ['vision'] }),
      model({ id: 'v2', rank: 2, categories: ['vision'] }),
    ];
    expect(buildShelves(models, 16).some((s) => s.key === 'cap-vision')).toBe(false);
  });
});
