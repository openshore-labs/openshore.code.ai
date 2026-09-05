// The phone packs must resolve against the engine's bundled catalog (every
// preferred id is real and runs on the phone), degrade to the next preference
// when the newest pick is absent, and report an honest state. A renamed
// catalog model fails here, never as a dead Set up button.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CatalogModel } from 'os-code/protocol';
import { DEVICE_PACKS, packDownload, packFor, packState, resolvePack } from '../src/lib/packs.js';

const catalog = JSON.parse(
  readFileSync(join(process.cwd(), '..', 'os-code', 'catalog.sample.json'), 'utf8'),
) as { models: CatalogModel[] };
const byId = new Map(catalog.models.map((m) => [m.id, m]));

describe('device packs', () => {
  it('there is one per connection status, in the header order', () => {
    expect(DEVICE_PACKS.map((p) => p.id)).toEqual(['offline', 'offshore', 'docked']);
  });

  it('every preferred id is a real on-device model in the bundled catalog', () => {
    for (const p of DEVICE_PACKS) {
      const ids = [...p.anchor, ...Object.values(p.helpers).flat()];
      for (const id of ids) {
        const m = byId.get(id);
        expect(m, `${p.id}: ${id} in catalog`).toBeDefined();
        expect(m!.onDevice, `${id} runs on device`).toBeTruthy();
      }
    }
  });

  it('helpers carry the category they are placed under', () => {
    for (const p of DEVICE_PACKS) {
      for (const [category, ids] of Object.entries(p.helpers)) {
        for (const id of ids)
          expect(byId.get(id)!.categories, `${id} as ${category}`).toContain(category);
      }
    }
  });

  it('the offline pack resolves to the 4B anchor and the coder, anchor first', () => {
    const r = resolvePack(packFor('offline'), catalog.models);
    expect(r.anchor?.id).toBe('qwen3-4b-phone');
    expect(r.helpers.map((h) => `${h.category}:${h.model.id}`)).toEqual([
      'coding:qwen2.5-coder-1.5b-phone',
    ]);
    expect(r.models.map((m) => m.id)).toEqual(['qwen3-4b-phone', 'qwen2.5-coder-1.5b-phone']);
    expect(r.anchorMissing).toBe(false);
  });

  it('falls back down the preference list when the first pick is not in the feed', () => {
    const without4b = catalog.models.filter((m) => m.id !== 'qwen3-4b-phone');
    const r = resolvePack(packFor('offline'), without4b);
    expect(r.anchor?.id).toBe('qwen2.5-1.5b-phone');
    expect(r.anchorMissing).toBe(false);
  });

  it('a desktop twin never satisfies a phone pack', () => {
    const desktopOnly = catalog.models.map((m) =>
      m.id === 'qwen3-4b-phone' ? { ...m, onDevice: undefined } : m,
    ) as CatalogModel[];
    expect(resolvePack(packFor('offline'), desktopOnly).anchor?.id).toBe('qwen2.5-1.5b-phone');
  });

  it('reports a missing anchor honestly instead of installing nothing quietly', () => {
    const none = catalog.models.filter((m) => !m.onDevice);
    const r = resolvePack(packFor('offline'), none);
    expect(r.anchor).toBeUndefined();
    expect(r.anchorMissing).toBe(true);
    expect(r.models).toEqual([]);
  });

  it('docked wants no download, only its pairing step', () => {
    const r = resolvePack(packFor('docked'), catalog.models);
    expect(r.models).toEqual([]);
    expect(r.anchorMissing).toBe(false);
    expect(packFor('docked').nextStep?.view).toBe('pair');
  });

  it('sums the real download and what is already on the phone', () => {
    const r = resolvePack(packFor('offline'), catalog.models);
    expect(packDownload(r, () => false)).toEqual({ totalGB: 3.6, ownedGB: 0 });
    expect(packDownload(r, (id) => id === 'qwen2.5-coder-1.5b-phone')).toEqual({
      totalGB: 3.6,
      ownedGB: 1.1,
    });
  });

  it('state: not set up, partial while some of it is here, ready once anchored and complete', () => {
    const r = resolvePack(packFor('offline'), catalog.models);
    const none = () => false;
    const all = () => true;
    expect(packState(r, { owned: none, nextStepDone: true })).toBe('not-set-up');
    expect(packState(r, { owned: (id) => id === 'qwen3-4b-phone', nextStepDone: true })).toBe(
      'partial',
    );
    expect(packState(r, { owned: all, nextStepDone: true })).toBe('partial');
    expect(
      packState(r, { owned: all, reasoningDeviceId: 'qwen3-4b-phone', nextStepDone: true }),
    ).toBe('ready');
  });

  it('offshore is only ready once its key is connected; docked once a hub is paired', () => {
    const off = resolvePack(packFor('offshore'), catalog.models);
    const all = () => true;
    expect(
      packState(off, { owned: all, reasoningDeviceId: 'qwen3-4b-phone', nextStepDone: false }),
    ).toBe('partial');
    expect(
      packState(off, { owned: all, reasoningDeviceId: 'qwen3-4b-phone', nextStepDone: true }),
    ).toBe('ready');
    const dock = resolvePack(packFor('docked'), catalog.models);
    expect(packState(dock, { owned: all, nextStepDone: false })).toBe('not-set-up');
    expect(packState(dock, { owned: all, nextStepDone: true })).toBe('ready');
  });
});
