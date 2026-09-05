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
  deviceSplit,
  featuredModels,
  filterModels,
  fitFor,
  fuzzyMatch,
  installLabel,
  licensePosture,
  modelMonogram,
  runsOn,
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

describe('sortModels greenest', () => {
  it('orders leanest first by estimated energy, then curated rank', () => {
    const models = [
      model({ id: 'big', rank: 1, sizeGB: 40 }),
      model({ id: 'small', rank: 9, sizeGB: 2 }),
      model({ id: 'mid', rank: 5, sizeGB: 8 }),
    ];
    const out = sortModels(models, 'greenest', 16).map((m) => m.id);
    expect(out).toEqual(['small', 'mid', 'big']);
  });

  it('prefers the on-device footprint when a model can run on the phone', () => {
    const a = model({ id: 'a', rank: 1, sizeGB: 20 });
    const b = model({
      id: 'b',
      rank: 2,
      sizeGB: 20,
      onDevice: { url: 'https://x/b.gguf', sizeGB: 1.5, minRamGB: 4 },
    });
    // Same catalog size, but b advertises a small on-device build, so it is
    // estimated leaner and sorts first.
    const out = sortModels([a, b], 'greenest', 16).map((m) => m.id);
    expect(out).toEqual(['b', 'a']);
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

  it('prefers the published commercial flag over the id table (MP-A-6)', () => {
    // Apache-2.0 reads commercial-ok in the fallback table, but a published
    // non-commercial flag wins: the builder is the authority.
    expect(
      licensePosture(
        model({
          id: 'x',
          rank: 1,
          license: { id: 'Apache-2.0', name: 'x', commercial: 'non-commercial' },
        }),
      ),
    ).toBe('non-commercial');
    // An id unknown to the table would read as gated, but a published 'ok' flag
    // maps to the module's 'commercial-ok' label.
    expect(
      licensePosture(
        model({ id: 'y', rank: 1, license: { id: 'Weird-9.9', name: 'x', commercial: 'ok' } }),
      ),
    ).toBe('commercial-ok');
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
    expect(keys).toContain('lean');
    expect(keys).toContain('cap-coding');
    // The lean shelf is ordered leanest first and carries the greenest axis.
    const lean = shelves.find((s) => s.key === 'lean')!;
    expect(lean.sort).toBe('greenest');
    expect(lean.models[0].id).toBe('phone1');
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

  it('on a phone the pocket shelf names the device and says bigger is not better', () => {
    const models = [
      model({
        id: 'phone1',
        rank: 1,
        onDevice: { url: 'https://x/y.gguf', sizeGB: 1, minRamGB: 4 },
      }),
    ];
    const pocket = buildShelves(models, 16, { phone: true }).find((s) => s.key === 'pocket')!;
    expect(pocket.title).toBe('Runs on this iPhone');
    expect(pocket.subtitle).toMatch(/bigger is not better/);
    expect(buildShelves(models, 16).find((s) => s.key === 'pocket')!.title).toBe(
      'Runs on your phone',
    );
  });
});

describe('where it runs', () => {
  it('a phone home needs an on-device build; laptop and workstation read off the size', () => {
    const pocket = model({
      id: 'p',
      rank: 1,
      sizeGB: 2.5,
      onDevice: { url: 'https://x/y.gguf', sizeGB: 2.5, minRamGB: 6 },
    });
    expect(runsOn(pocket)).toEqual({ phone: true, laptop: true, workstation: true });
    expect(runsOn(model({ id: 'l', rank: 1, sizeGB: 4.7 }))).toEqual({
      phone: false,
      laptop: true,
      workstation: true,
    });
    expect(runsOn(model({ id: 'w', rank: 1, sizeGB: 20 }))).toEqual({
      phone: false,
      laptop: false,
      workstation: true,
    });
    expect(runsOn(model({ id: 'x', rank: 1, sizeGB: 140 })).workstation).toBe(false);
  });

  it('deviceSplit puts every model in exactly one list', () => {
    const a = model({
      id: 'a',
      rank: 1,
      onDevice: { url: 'https://x/y.gguf', sizeGB: 1, minRamGB: 4 },
    });
    const b = model({ id: 'b', rank: 2 });
    const split = deviceSplit([a, b]);
    expect(split.phone.map((m) => m.id)).toEqual(['a']);
    expect(split.desktop.map((m) => m.id)).toEqual(['b']);
  });
});

describe('installLabel', () => {
  it('a phone never shows Get on a model it cannot get', () => {
    expect(installLabel({ onDevice: false, hasBridge: false })).toEqual({
      text: 'Desktop',
      kind: 'desktop-only',
    });
    expect(installLabel({ onDevice: false, hasBridge: false, hubName: 'Studio' })).toEqual({
      text: 'On Studio',
      kind: 'hub',
    });
  });

  it('Get stays for on-device models and for a desktop with its own engine', () => {
    expect(installLabel({ onDevice: true, hasBridge: false }).text).toBe('Get');
    expect(installLabel({ onDevice: false, hasBridge: true }).text).toBe('Get');
  });

  it('Retry wins after a failure, whatever the home', () => {
    expect(installLabel({ onDevice: false, hasBridge: false, failed: true }).text).toBe('Retry');
  });
});
