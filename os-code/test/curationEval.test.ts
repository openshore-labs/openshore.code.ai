// Curation carries provenance: every eval entry says whether its number was
// published (a seed number) or measured (a run on a named box, on a date).
// The 3B's measured deep score on the reference box is what lets it clear the
// orchestrator gate; nothing is invented for the 4B. The seed flips the 3B to
// orchestrator-capable so the storefront, the bundles, and the starter can
// offer it as a seat.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { enrichCatalog } from '../scripts/build-catalog/enrich.js';
import { evalScore, evalSource } from '../scripts/build-catalog/evals.js';
import { derivePresets } from '../scripts/build-catalog/presets.js';
import type { BuildInputs, EvalEntries } from '../scripts/build-catalog/types.js';
import { CatalogSchema } from '../src/market/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const evals = JSON.parse(
  readFileSync(resolve(here, '../curation/eval.json'), 'utf8'),
) as EvalEntries;
const overlay = JSON.parse(readFileSync(resolve(here, '../curation/recommended.json'), 'utf8'));
const seed = JSON.parse(readFileSync(resolve(here, '../catalog.sample.json'), 'utf8'));

describe('curation/eval.json provenance', () => {
  it('every entry names its source', () => {
    for (const [id, entry] of Object.entries(evals)) {
      expect(evalSource(entry), id).toMatch(/^(published|measured)$/);
      const score = evalScore(entry);
      expect(score, id).toBeGreaterThanOrEqual(0);
      expect(score, id).toBeLessThanOrEqual(1);
    }
  });

  it('carries the measured 3B entry from the reference box, as recorded', () => {
    const e = evals['qwen2.5-coder-3b'];
    expect(e).toBeDefined();
    expect(typeof e).toBe('object');
    expect(e).toMatchObject({
      deep: 0.75,
      attempts: 2,
      box: 'cpu-7.6gb',
      date: '2026-09-15',
      source: 'measured',
    });
  });

  it('invents nothing for the 4B', () => {
    // A standalone 4B, not the "4b" inside "14b": the 14B is a real published
    // seed, while no 4B has a measured loop number yet, so none may appear.
    for (const id of Object.keys(evals)) expect(id).not.toMatch(/(?<!\d)4b/i);
  });

  it('the existing seed numbers are marked published', () => {
    for (const id of ['qwen2.5-coder-7b', 'qwen2.5-coder-14b', 'qwen2.5-1.5b-phone']) {
      expect(evalSource(evals[id]), id).toBe('published');
    }
  });

  it('a bare number still reads as a published score (older files)', () => {
    expect(evalScore(0.8)).toBe(0.8);
    expect(evalSource(0.8)).toBe('published');
    expect(evalScore(undefined)).toBeUndefined();
  });
});

function model(id: string, orchestratorCapable: boolean) {
  return {
    id,
    name: id,
    tagline: 'A test model.',
    categories: ['coding'],
    orchestratorCapable,
    source: { kind: 'ollama', ref: `${id}:3b`, pullCommand: `ollama pull ${id}:3b` },
    sizeGB: 1.9,
    quantization: 'Q4_K_M',
    contextTokens: 32768,
    license: { id: 'Apache-2.0', name: 'seed name' },
    curation: { rank: 1, note: 'test' },
    blessed: false,
  };
}

const inputs = (over: Partial<BuildInputs>): BuildInputs => ({
  seed: { version: 1, updated: '2026-09-15', models: [], presets: [] },
  metadata: {},
  benchmarks: {},
  evals: {},
  overlay: {},
  ...over,
});

describe('the enrich gate accepts a measured deep score', () => {
  it('keeps an orchestrator with only a measured deep number, fit from that number', () => {
    const { catalog, drops } = enrichCatalog(
      inputs({
        seed: { version: 1, updated: '2026-09-15', models: [model('orch', true)], presets: [] },
        evals: {
          orch: {
            deep: 0.75,
            attempts: 2,
            box: 'cpu-7.6gb',
            date: '2026-09-15',
            source: 'measured',
          },
        },
      }),
    );
    expect(drops).toEqual([]);
    expect(catalog.models[0]?.ratings?.osCodeFit).toBe(4);
  });

  it('a probe number keeps working, and a measured number below the bar still drops', () => {
    const kept = enrichCatalog(
      inputs({
        seed: { version: 1, updated: '2026-09-15', models: [model('orch', true)], presets: [] },
        evals: { orch: { probe: 0.86, source: 'published' } },
      }),
    );
    expect(kept.catalog.models).toHaveLength(1);
    const dropped = enrichCatalog(
      inputs({
        seed: { version: 1, updated: '2026-09-15', models: [model('orch', true)], presets: [] },
        evals: { orch: { deep: 0.25, attempts: 1, box: 'cpu-7.6gb', source: 'measured' } },
      }),
    );
    expect(dropped.catalog.models).toHaveLength(0);
    expect(dropped.drops[0]?.reason).toMatch(/eval bar/);
  });

  it('presets score models through the same reader', () => {
    const parsed = CatalogSchema.parse({
      version: 1,
      updated: '2026-09-15',
      models: [model('a', true), { ...model('b', true), sizeGB: 4.7 }],
      presets: [],
    });
    const presets = derivePresets(parsed.models, {
      a: { deep: 0.75, source: 'measured' },
      b: { probe: 0.5, source: 'published' },
    });
    expect(presets.find((p) => p.id === 'starter')?.stack.orchestrator).toBe('a');
  });
});

describe('the bundled seed offers the 3B as a seat', () => {
  it('flips qwen2.5-coder-3b to orchestrator-capable and it clears the real gate', () => {
    const three = seed.models.find((m: { id: string }) => m.id === 'qwen2.5-coder-3b');
    expect(three?.orchestratorCapable).toBe(true);
    const { catalog, drops } = enrichCatalog(
      inputs({ seed, evals, overlay, metadata: {}, benchmarks: {} }),
    );
    expect(drops.map((d) => d.id)).not.toContain('qwen2.5-coder-3b');
    const kept = catalog.models.find((m) => m.id === 'qwen2.5-coder-3b');
    expect(kept?.orchestratorCapable).toBe(true);
    expect(kept?.ratings?.osCodeFit).toBe(4);
  });
});

describe('rename drift: no quarterback in engine strings the app shows', () => {
  it('roles.ts and router.ts speak of the Reasoning LLM', () => {
    for (const rel of ['../src/router/roles.ts', '../src/router/router.ts']) {
      expect(readFileSync(resolve(here, rel), 'utf8'), rel).not.toMatch(/quarterback/i);
    }
  });
  it('the engine never puts a command inside a sentence', () => {
    const install = readFileSync(resolve(here, '../src/market/install.ts'), 'utf8');
    expect(install).not.toContain('Install it first: curl');
    expect(install).toContain(
      'Install it first.\\n\\ncurl -fsSL https://ollama.com/install.sh | sh',
    );
    const compat = readFileSync(resolve(here, '../src/providers/openaiCompatible.ts'), 'utf8');
    expect(compat).not.toContain('start it with: ollama serve');
    expect(compat).toContain('\\n\\nollama serve');
  });
});
