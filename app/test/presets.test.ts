// The app-side prefab-stack helpers over a live catalog: the member id list,
// specialist roles, and a summed size that returns undefined when a member is
// missing (so the UI never shows a wrong number or a dead download).
import { describe, expect, it } from 'vitest';
import { presetMemberIds, presetSpecialists, presetTotalGB } from '../src/lib/presets.js';
import type { Catalog, CatalogPreset } from 'os-code/protocol';

const preset = {
  id: 'coding',
  name: 'Coding',
  tagline: 'x',
  minVramGB: 12,
  stack: { orchestrator: 'coder-14b', specialists: { embedding: 'embed', fast: 'coder-3b' } },
} as CatalogPreset;

const catalog = {
  models: [
    { id: 'coder-14b', sizeGB: 9 },
    { id: 'embed', sizeGB: 0.3 },
    { id: 'coder-3b', sizeGB: 1.9 },
  ],
  presets: [preset],
} as unknown as Catalog;

describe('prefab stack helpers', () => {
  it('lists the orchestrator first, then specialists', () => {
    expect(presetMemberIds(preset)).toEqual(['coder-14b', 'embed', 'coder-3b']);
    expect(presetSpecialists(preset)).toEqual([
      ['embedding', 'embed'],
      ['fast', 'coder-3b'],
    ]);
  });

  it('sums the real total size', () => {
    expect(presetTotalGB(preset, catalog)).toBe(11.2);
  });

  it('returns undefined when a member is not in the catalog', () => {
    const missing = { ...catalog, models: catalog.models.filter((m) => m.id !== 'embed') } as Catalog;
    expect(presetTotalGB(preset, missing)).toBeUndefined();
  });
});
