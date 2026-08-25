// The gates. The curated storefront gate (per model) decides who gets in; the
// bad-build regression gate (whole catalog) decides whether the build ships at
// all. A regression breach fails the job so the previous catalog keeps serving.
import { describe, expect, it } from 'vitest';
import { enrichCatalog } from '../scripts/build-catalog/enrich.js';
import { regressionGate, validateCatalog } from '../scripts/build-catalog/gate.js';
import type { BuildInputs } from '../scripts/build-catalog/types.js';
import type { Catalog } from '../src/market/schema.js';

interface ModelSeed {
  id: string;
  categories: string[];
  orchestratorCapable?: boolean;
  ref?: string;
  pullCommand?: string;
  blessed?: boolean;
  licenseId?: string;
}

function model(s: ModelSeed) {
  return {
    id: s.id,
    name: s.id,
    tagline: 'A test model.',
    categories: s.categories,
    orchestratorCapable: s.orchestratorCapable ?? false,
    source: {
      kind: 'ollama',
      ref: s.ref ?? `${s.id}:7b`,
      pullCommand: s.pullCommand ?? `ollama pull ${s.id}:7b`,
    },
    sizeGB: 4,
    quantization: 'Q4_K_M',
    contextTokens: 32768,
    license: { id: s.licenseId ?? 'Apache-2.0', name: 'seed name' },
    curation: { rank: 1, note: 'test' },
    blessed: s.blessed ?? false,
  };
}

function seed(models: ModelSeed[], presets: unknown[] = []) {
  return { version: 1, updated: '2026-08-20', models: models.map(model), presets };
}

const baseInputs = (over: Partial<BuildInputs>): BuildInputs => ({
  seed: seed([]),
  metadata: {},
  benchmarks: {},
  evals: {},
  overlay: {},
  ...over,
});

describe('curated storefront gate', () => {
  it('drops an orchestrator that has no eval report', () => {
    const { catalog, drops } = enrichCatalog(
      baseInputs({
        seed: seed([{ id: 'orch', categories: ['coding'], orchestratorCapable: true }]),
        benchmarks: { orch: { HumanEval: 92 } },
        evals: {},
      }),
    );
    expect(catalog.models).toHaveLength(0);
    expect(drops[0]?.reason).toMatch(/eval bar/);
  });

  it('keeps an orchestrator that clears the eval bar', () => {
    const { catalog } = enrichCatalog(
      baseInputs({
        seed: seed([{ id: 'orch', categories: ['coding'], orchestratorCapable: true }]),
        benchmarks: { orch: { HumanEval: 92 } },
        evals: { orch: 0.86 },
      }),
    );
    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]?.ratings?.osCodeFit).toBe(4);
  });

  it('drops a specialist whose best capability star is below the bar', () => {
    const { catalog, drops } = enrichCatalog(
      baseInputs({
        seed: seed([{ id: 'weak', categories: ['coding'] }]),
        benchmarks: { weak: { HumanEval: 30 } }, // 2 stars, below 3.5
      }),
    );
    expect(catalog.models).toHaveLength(0);
    expect(drops[0]?.reason).toMatch(/capability bar/);
  });

  it('keeps a specialist with a strong capability star', () => {
    const { catalog } = enrichCatalog(
      baseInputs({
        seed: seed([{ id: 'vis', categories: ['vision'] }]),
        benchmarks: { vis: { MMMU: 80, ChartQA: 82 } },
      }),
    );
    expect(catalog.models).toHaveLength(1);
  });

  it('drops a preset when one of its members was gated out', () => {
    const { catalog } = enrichCatalog(
      baseInputs({
        seed: seed(
          [{ id: 'orch', categories: ['coding'], orchestratorCapable: true }],
          [
            {
              id: 'p1',
              name: 'P1',
              tagline: 't',
              minVramGB: 0,
              stack: { orchestrator: 'orch', specialists: { vision: 'missing' } },
            },
          ],
        ),
        benchmarks: { orch: { HumanEval: 92 } },
        evals: { orch: 0.86 },
      }),
    );
    expect(catalog.presets).toHaveLength(0);
  });
});

describe('bad-build regression gate', () => {
  const good: Catalog = validateCatalog({
    version: 1,
    updated: '2026-08-20',
    models: [
      {
        ...model({ id: 'a', categories: ['coding'], blessed: true }),
        license: { id: 'Apache-2.0', name: 'Apache License 2.0' },
      },
      {
        ...model({ id: 'b', categories: ['coding'] }),
        license: { id: 'Apache-2.0', name: 'Apache License 2.0' },
      },
    ],
    presets: [],
  });

  it('passes a healthy build with no previous', () => {
    expect(regressionGate(good, undefined).ok).toBe(true);
  });

  it('fails when the catalog is empty', () => {
    const empty = { ...good, models: [] };
    const result = regressionGate(empty, undefined);
    expect(result.ok).toBe(false);
    expect(result.breaches.some((b) => b.check === 'non-empty')).toBe(true);
  });

  it('fails when a preset id resolves to no model', () => {
    const withBadPreset = {
      ...good,
      presets: [
        {
          id: 'p',
          name: 'P',
          tagline: 't',
          minVramGB: 0,
          stack: { orchestrator: 'ghost', specialists: {} },
        },
      ],
    };
    const result = regressionGate(validateCatalog(withBadPreset), undefined);
    expect(result.ok).toBe(false);
    expect(result.breaches.some((b) => b.check === 'preset ids resolve')).toBe(true);
  });

  it('fails when a previously blessed model is dropped', () => {
    const next = { ...good, models: good.models.filter((m) => m.id !== 'a') };
    const result = regressionGate(next, good);
    expect(result.ok).toBe(false);
    expect(result.breaches.some((b) => b.check === 'no blessed model dropped')).toBe(true);
  });

  it('fails when the model count falls more than 25 percent', () => {
    const previous: Catalog = {
      ...good,
      models: [
        good.models[0]!,
        { ...good.models[1]!, id: 'b', blessed: false },
        { ...good.models[1]!, id: 'c', blessed: false },
        { ...good.models[1]!, id: 'd', blessed: false },
      ],
    };
    // previous has 4, next has 2: a 50 percent fall.
    const result = regressionGate(good, previous);
    expect(result.ok).toBe(false);
    expect(result.breaches.some((b) => b.check.includes('25 percent'))).toBe(true);
  });

  it('fails when the previous baseline is present but not JSON (H3)', () => {
    // An HTML error page or a truncated body seeded over the baseline (index.ts
    // passes such raw text straight through) must not silently disarm the gate.
    const result = regressionGate(good, '<html>502 Bad Gateway</html>');
    expect(result.ok).toBe(false);
    expect(result.breaches.some((b) => b.check === 'baseline parses')).toBe(true);
  });

  it('fails when the previous baseline is partial/old-shape and does not parse (H3)', () => {
    // A truncated catalog (here: missing the required `presets` key) cannot
    // anchor the regression checks, so it is a breach rather than a skip.
    const partial = { version: 1, updated: '2026-08-20', models: [] };
    const result = regressionGate(good, partial);
    expect(result.ok).toBe(false);
    expect(result.breaches.some((b) => b.check === 'baseline parses')).toBe(true);
  });

  it('fails when every preset is dropped while the previous had presets (P2-4)', () => {
    const prevWithPresets = validateCatalog({
      ...good,
      presets: [
        {
          id: 'p',
          name: 'P',
          tagline: 't',
          minVramGB: 0,
          stack: { orchestrator: 'a', specialists: {} },
        },
      ],
    });
    // next = good ships zero presets; the previous catalog had one.
    const result = regressionGate(good, prevWithPresets);
    expect(result.ok).toBe(false);
    expect(result.breaches.some((b) => b.check === 'presets not all dropped')).toBe(true);
  });

  it('fails an online run when popularity coverage falls more than half (MP-A-4)', () => {
    const withPop: Catalog = {
      ...good,
      models: good.models.map((m) => ({
        ...m,
        popularity: { downloads: 100, likes: 1, source: 'huggingface' as const },
      })),
    };
    // next = good carries zero popularity; the previous had it on both models.
    const online = regressionGate(good, withPop, { online: true });
    expect(online.ok).toBe(false);
    expect(online.breaches.some((b) => b.check === 'popularity coverage not halved')).toBe(true);
    // Offline (the default) legitimately carries no popularity: no such breach.
    const offline = regressionGate(good, withPop);
    expect(offline.breaches.some((b) => b.check === 'popularity coverage not halved')).toBe(false);
  });

  it('fails when an onDevice.url host is not huggingface.co (MP-S2)', () => {
    const evil: Catalog = {
      ...good,
      models: [
        {
          ...good.models[0]!,
          onDevice: { url: 'https://evil.example.com/x.gguf', sizeGB: 1, minRamGB: 4 },
        },
        good.models[1]!,
      ],
    };
    const result = regressionGate(evil, undefined);
    expect(result.ok).toBe(false);
    expect(result.breaches.some((b) => b.check === 'onDevice.url host is huggingface.co')).toBe(
      true,
    );
  });

  it('passes a huggingface.co onDevice.url host (MP-S2)', () => {
    const okDev: Catalog = {
      ...good,
      models: [
        {
          ...good.models[0]!,
          onDevice: {
            url: 'https://huggingface.co/org/repo/resolve/main/x.gguf',
            sizeGB: 1,
            minRamGB: 4,
          },
        },
        good.models[1]!,
      ],
    };
    expect(regressionGate(okDev, undefined).ok).toBe(true);
  });
});
