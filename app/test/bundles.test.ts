// Every bundle must resolve entirely against the engine's bundled catalog, on
// the right platform, with a real summed size; a renamed catalog model must
// fail here, never as a dead Install button.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STACK_BUNDLES, bundleModelIds, bundleTotalGB, bundlesFor } from '../src/lib/bundles.js';

interface CatalogModel {
  id: string;
  sizeGB: number;
  onDevice?: unknown;
  source: { kind: string; ref: string };
  categories: string[];
}
const catalog = JSON.parse(
  readFileSync(join(process.cwd(), '..', 'os-code', 'catalog.sample.json'), 'utf8'),
) as { models: CatalogModel[] };
const byId = new Map(catalog.models.map((m) => [m.id, m]));

describe('stack bundles', () => {
  it('there are five, one for the phone', () => {
    expect(STACK_BUNDLES).toHaveLength(5);
    expect(bundlesFor('phone')).toHaveLength(1);
    expect(bundlesFor('desktop')).toHaveLength(4);
  });

  it('every model exists in the catalog on the right platform', () => {
    for (const b of STACK_BUNDLES) {
      for (const id of bundleModelIds(b)) {
        const m = byId.get(id);
        expect(m, `${b.id}: ${id} in catalog`).toBeDefined();
        if (b.platform === 'phone') expect(m!.onDevice, `${id} runs on device`).toBeTruthy();
        else expect(m!.source.kind, `${id} pulls via ollama`).toBe('ollama');
      }
    }
  });

  it('sums a real total size for every bundle', () => {
    for (const b of STACK_BUNDLES) {
      const total = bundleTotalGB(b, (id) => byId.get(id)?.sizeGB);
      expect(total, b.id).toBeDefined();
      expect(total!).toBeGreaterThan(0);
    }
    // A missing model must yield undefined, never a wrong number.
    expect(bundleTotalGB(STACK_BUNDLES[0]!, () => undefined)).toBeUndefined();
  });

  it('specialists carry a category matching their role', () => {
    for (const b of STACK_BUNDLES) {
      for (const [role, id] of Object.entries(b.specialists)) {
        expect(byId.get(id)!.categories, `${b.id}: ${id} as ${role}`).toContain(role);
      }
    }
  });
});
