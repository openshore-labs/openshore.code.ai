// License fail-closed behavior. The builder takes a license id/name/url ONLY
// from the SPDX allow-list table, never synthesizes one from a source tag, and
// takes the human note ONLY from the editorial overlay. A model whose license
// id is missing or unmapped does not clear the curated gate: it is dropped.
import { describe, expect, it } from 'vitest';
import { enrichCatalog } from '../scripts/build-catalog/enrich.js';
import { resolveLicense } from '../scripts/build-catalog/licenses.table.js';
import type { BuildInputs } from '../scripts/build-catalog/types.js';

function seedWith(licenseId: string) {
  return {
    version: 1,
    updated: '2026-08-20',
    models: [
      {
        id: 'm1',
        name: 'Model One',
        tagline: 'A test model.',
        categories: ['coding'],
        orchestratorCapable: false,
        source: { kind: 'ollama', ref: 'model-one:7b', pullCommand: 'ollama pull model-one:7b' },
        sizeGB: 4,
        quantization: 'Q4_K_M',
        contextTokens: 32768,
        // A seed note that MUST be ignored: notes are editorial only.
        license: { id: licenseId, name: 'Whatever the seed says', note: 'seed note, ignore me' },
        curation: { rank: 1, note: 'test' },
        blessed: false,
      },
    ],
    presets: [],
  };
}

function inputs(seed: unknown, overlay: BuildInputs['overlay'] = {}): BuildInputs {
  return {
    seed,
    metadata: {},
    // A strong coding score so the specialist clears the capability bar and any
    // drop we see is purely the license decision.
    benchmarks: { m1: { HumanEval: 92 } },
    evals: {},
    overlay,
  };
}

describe('license fail-closed', () => {
  it('resolveLicense returns undefined for an unmapped id', () => {
    expect(resolveLicense('Totally-Made-Up-1.0')).toBeUndefined();
    expect(resolveLicense(undefined)).toBeUndefined();
    expect(resolveLicense('apache-2.0')?.id).toBe('Apache-2.0'); // case-insensitive
  });

  it('drops a model whose license id is not on the allow-list', () => {
    const { catalog, drops } = enrichCatalog(inputs(seedWith('Totally-Made-Up-1.0')));
    expect(catalog.models).toHaveLength(0);
    expect(drops[0]?.reason).toMatch(/not on the SPDX allow-list/);
  });

  it('takes name and url from the table, never from the seed', () => {
    const { catalog } = enrichCatalog(inputs(seedWith('Apache-2.0')));
    const m = catalog.models[0];
    expect(m?.license.name).toBe('Apache License 2.0');
    expect(m?.license.url).toBe('https://www.apache.org/licenses/LICENSE-2.0');
  });

  it('takes the human note ONLY from the overlay, dropping the seed note', () => {
    const withOverlay = enrichCatalog(
      inputs(seedWith('Apache-2.0'), {
        m1: { isRecommended: false, licenseNote: 'Commercial use is fine. Attribution required.' },
      }),
    );
    expect(withOverlay.catalog.models[0]?.license.note).toBe(
      'Commercial use is fine. Attribution required.',
    );

    // No overlay note means no note at all. The seed note is never carried.
    const withoutOverlay = enrichCatalog(inputs(seedWith('Apache-2.0')));
    expect(withoutOverlay.catalog.models[0]?.license.note).toBeUndefined();
  });
});
