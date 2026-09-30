// The three curated models are sellable (founder, 2026-09-30): Harbor Lite,
// Harbor, and DeepBlue ride Apache 2.0 weights only. Pinned so a later swap to
// a research-licensed or non-commercial model fails the build, not a sale.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HARBOR_MODEL_URL,
  HARBOR_MODEL_VERSION,
  HARBOR_WEIGHTS_NAME,
  harborWeightsStale,
} from '../src/lib/harbor.js';
import { HARBOR_MINI_MODEL_URL } from '../src/lib/harborMini.js';
import { HARBOR_MASTER_SIZES } from '../src/lib/harborMaster.js';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

interface CatalogModel {
  id: string;
  license: { id: string; commercial?: string };
  onDevice?: { url: string; minRamGB: number };
}
const catalog = JSON.parse(read('../os-code/catalog.sample.json')) as { models: CatalogModel[] };

describe('the curated models are Apache 2.0', () => {
  it('Harbor Lite is SmolLM2-135M-Instruct', () => {
    expect(HARBOR_MINI_MODEL_URL).toMatch(/SmolLM2-135M-Instruct/);
  });

  it('Harbor is the catalog phone 4B, an Apache model, never the research 3B', () => {
    expect(HARBOR_MODEL_URL).toMatch(/Qwen3-4B-Instruct-2507-Q4_K_M\.gguf$/);
    expect(HARBOR_MODEL_URL).not.toMatch(/Coder-3B/i);
    expect(HARBOR_WEIGHTS_NAME).toBe('Qwen3 4B Instruct');
    const phone = catalog.models.find((m) => m.onDevice?.url === HARBOR_MODEL_URL);
    expect(phone?.id).toBe('qwen3-4b-phone');
    expect(phone?.license.id).toBe('Apache-2.0');
  });

  it('every DeepBlue size is Apache 2.0 and none is marked non-commercial', () => {
    for (const s of HARBOR_MASTER_SIZES) {
      const m = catalog.models.find((x) => x.id === s.catalogId)!;
      expect(m.license.id, s.catalogId).toBe('Apache-2.0');
      expect(m.license.commercial, s.catalogId).toBeUndefined();
    }
  });

  it('MODEL-LICENSES says the same', () => {
    const doc = read('MODEL-LICENSES.md');
    expect(doc).toContain('Qwen3-4B-Instruct-2507');
    expect(doc).not.toMatch(/Qwen2\.5-Coder-3B-Instruct \(GGUF/);
  });
});

describe('older Harbor weights do not stay on a phone', () => {
  it('only weights recorded at the current version are kept', () => {
    expect(HARBOR_MODEL_VERSION).toBe('3.0');
    expect(harborWeightsStale(HARBOR_MODEL_VERSION)).toBe(false);
    // Harbor 2.0 was the research-licensed 3B, and a download before 3.0
    // recorded no version at all: both are dropped at launch.
    expect(harborWeightsStale('2.0')).toBe(true);
    expect(harborWeightsStale(undefined)).toBe(true);
  });

  it('the store records the version on download and drops stale weights at launch', () => {
    const store = read('src/state/store.ts');
    expect(store).toContain('harborReady: true, harborVersion: HARBOR_MODEL_VERSION');
    expect(store).toMatch(/harborWeightsStale\(settings\.harborVersion\)[\s\S]{0,120}deleteModel/);
  });
});
