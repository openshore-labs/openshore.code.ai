// Curation carries provenance: every eval entry says whether its number was
// published (a seed number) or measured (a run on a named box, on a date).
// A measured deep score alone can clear the orchestrator gate; nothing is
// invented for the 4B. The Qwen 2.5 Coder 3B is under the Qwen Research License
// (non-commercial only), so it was pulled on 2026-09-24 (DECISIONS): its
// measured result stays as history, labeled research use, and the license gate
// drops it from the storefront fail-closed.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { enrichCatalog } from '../scripts/build-catalog/enrich.js';
import { evalScore, evalSource } from '../scripts/build-catalog/evals.js';
import { resolveLicense } from '../scripts/build-catalog/licenses.table.js';
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
  it('every entry names its source, and a note, when present, is a plain label', () => {
    for (const [id, entry] of Object.entries(evals)) {
      expect(evalSource(entry), id).toMatch(/^(published|measured)$/);
      const score = evalScore(entry);
      expect(score, id).toBeGreaterThanOrEqual(0);
      expect(score, id).toBeLessThanOrEqual(1);
      if (typeof entry === 'object' && entry.note !== undefined) {
        expect(typeof entry.note, id).toBe('string');
        expect(entry.note.trim().length, id).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the measured 3B entry as history, labeled research use and not seated', () => {
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
    const note = typeof e === 'object' ? (e.note ?? '') : '';
    expect(note).toMatch(/research use only/);
    expect(note).toMatch(/Qwen Research License/);
    expect(note).toMatch(/not seated/);
  });

  it('a note never moves the score', () => {
    const base = { deep: 0.75, source: 'measured' as const };
    expect(evalScore({ ...base, note: 'research use only' })).toBe(evalScore(base));
  });

  it('invents nothing for the 4B', () => {
    // A standalone 4B, not the "4b" inside "14b": the 14B is a real published
    // seed, while no 4B has a measured loop number yet, so none may appear.
    for (const id of Object.keys(evals)) expect(id).not.toMatch(/(?<!\d)4b/i);
  });

  it('attaches no coding eval number to the Harbor Lite guide (DECISIONS 2026-09-23)', () => {
    // Harbor Lite (SmolLM2-135M, the harbor-mini slot) is a guide, not a coding
    // seat, so the coding deep eval does not apply to it and no number is quoted
    // for it. Guards against a future stray entry under the guide's own weights
    // (the 135M) or its slot id. Narrow on purpose: a larger SmolLM2 that is a
    // real seat (e.g. smollm2-1.7b-phone) keeps its published number.
    for (const id of Object.keys(evals)) {
      expect(id, id).not.toMatch(/harbor-mini|135m/i);
    }
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

describe('the bundled seed pulls the research-licensed 3B', () => {
  it('the bundled seed does not ship qwen2.5-coder-3b at all', () => {
    // The engine and the app read the bundled seed directly when offline, with
    // no license gate in that path, so a withdrawn model must not be in it.
    // Its measured result stays in curation/eval.json as research-use history.
    expect(seed.models.map((m: { id: string }) => m.id)).not.toContain('qwen2.5-coder-3b');
    expect(resolveLicense('qwen-research')).toBeUndefined();
  });

  it('the license gate drops a research-licensed model fail-closed, even with a measured eval', () => {
    const research = {
      ...model('research-coder', true),
      license: { id: 'qwen-research', name: 'Qwen Research License' },
    };
    const { catalog, drops } = enrichCatalog(
      inputs({
        seed: { version: 1, updated: '2026-09-24', models: [research], presets: [] },
        evals: { 'research-coder': { deep: 0.75, attempts: 2, source: 'measured' } },
      }),
    );
    const drop = drops.find((d) => d.id === 'research-coder');
    expect(drop?.reason).toMatch(/license "qwen-research" is not on the SPDX allow-list/);
    expect(catalog.models).toHaveLength(0);
  });

  it('no preset built from the real seed seats the 3B', () => {
    const { catalog } = enrichCatalog(
      inputs({ seed, evals, overlay, metadata: {}, benchmarks: {} }),
    );
    expect(catalog.models.map((m) => m.id)).not.toContain('qwen2.5-coder-3b');
    for (const p of catalog.presets) {
      const refs = [p.stack.orchestrator, ...Object.values(p.stack.specialists)];
      expect(refs, p.id).not.toContain('qwen2.5-coder-3b');
    }
  });

  it('no editorial overlay recommends it, so no license note can call it commercial', () => {
    expect(overlay['qwen2.5-coder-3b']).toBeUndefined();
  });

  it('the 1.5B that stands in is Apache 2.0 and survives the gate', () => {
    const benchmarks = JSON.parse(
      readFileSync(resolve(here, '../curation/benchmarks.json'), 'utf8'),
    );
    const { catalog } = enrichCatalog(inputs({ seed, evals, overlay, metadata: {}, benchmarks }));
    const kept = catalog.models.find((m) => m.id === 'qwen2.5-coder-1.5b');
    expect(kept?.source.ref).toBe('qwen2.5-coder:1.5b');
    expect(kept?.license.id).toBe('Apache-2.0');
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
