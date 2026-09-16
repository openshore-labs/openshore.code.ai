// Storage and memory math. The load-bearing contract: size decides WHERE a
// model lands, never WHETHER you may have it. No function here has a "blocked"
// return, and defaultTarget always resolves to a real target.
import { describe, expect, it } from 'vitest';
import type { CatalogModel } from 'os-code/protocol';
import {
  BYTES_PER_GB,
  STORAGE_RESERVE_BYTES,
  availableTargets,
  bytesToGB,
  defaultTarget,
  deviceRunsComfortably,
  estimatedRamGB,
  formatBytes,
  gbToBytes,
  recommendMachine,
  runsWellOnDevice,
  storageFit,
} from '../src/lib/modelStorage.js';

function model(over: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    id: over.id,
    name: over.id,
    tagline: 'A test model.',
    categories: ['coding'],
    orchestratorCapable: false,
    source: { kind: 'ollama', ref: `${over.id}:7b`, pullCommand: `ollama pull ${over.id}:7b` },
    sizeGB: 4,
    quantization: 'Q4_K_M',
    contextTokens: 8192,
    license: { id: 'Apache-2.0', name: 'Apache 2.0' },
    curation: { rank: 1, note: 'test' },
    blessed: false,
    ...over,
  } as CatalogModel;
}

describe('byte helpers', () => {
  it('round-trips GB and bytes', () => {
    expect(gbToBytes(4)).toBe(4 * BYTES_PER_GB);
    expect(bytesToGB(gbToBytes(7))).toBeCloseTo(7);
  });

  it('formats bytes without rounding a nearly-full number up', () => {
    expect(formatBytes(3.98 * BYTES_PER_GB)).toBe('4 GB');
    expect(formatBytes(3.94 * BYTES_PER_GB)).toBe('3.9 GB');
    expect(formatBytes(512 * 1e6)).toBe('512 MB');
    expect(formatBytes(2.5 * BYTES_PER_GB * 1000)).toBe('2.5 TB');
    expect(formatBytes(-5)).toBe('0 GB');
  });
});

describe('storageFit', () => {
  it('is plenty only when the reserve survives', () => {
    const free = gbToBytes(20);
    // 10 GB model + 3 GB reserve = 13 GB, well under 20.
    expect(storageFit(gbToBytes(10), free)).toBe('plenty');
  });

  it('is tight when it fits but eats the reserve', () => {
    const free = gbToBytes(12);
    // 10 GB fits in 12, but 10 + 3 reserve = 13 > 12.
    expect(storageFit(gbToBytes(10), free)).toBe('tight');
  });

  it('will not fit when the bytes exceed free space', () => {
    expect(storageFit(gbToBytes(20), gbToBytes(12))).toBe('wont-fit');
  });

  it('uses exactly the declared reserve at the boundary', () => {
    const needed = gbToBytes(10);
    expect(storageFit(needed, needed + STORAGE_RESERVE_BYTES)).toBe('plenty');
    expect(storageFit(needed, needed + STORAGE_RESERVE_BYTES - 1)).toBe('tight');
  });
});

describe('estimatedRamGB', () => {
  it('prefers the catalog floor when present', () => {
    const m = model({ id: 'a', sizeGB: 4, onDevice: { url: 'u', sizeGB: 4, minRamGB: 8 } });
    expect(estimatedRamGB(m)).toBe(8);
  });

  it('estimates from size when there is no floor', () => {
    expect(estimatedRamGB(model({ id: 'b', sizeGB: 10 }))).toBe(13); // 10 * 1.3
  });

  it('never returns below the minimum', () => {
    expect(estimatedRamGB(model({ id: 'c', sizeGB: 1 }))).toBe(4);
  });
});

describe('recommendMachine', () => {
  it('rounds up to a real machine tier', () => {
    // Wants 8 GB RAM -> target 8 / 0.6 = 13.3 -> 16 GB tier.
    expect(recommendMachine(8).ramGB).toBe(16);
  });

  it('names a laptop for small needs and a workstation for large', () => {
    expect(recommendMachine(8).label).toContain('laptop');
    expect(recommendMachine(60).label).toContain('workstation');
  });

  it('caps at the top tier and says "or more"', () => {
    const rec = recommendMachine(200);
    expect(rec.ramGB).toBe(128);
    expect(rec.label).toContain('or more');
  });

  it('always carries the pair-or-iCloud escape hatch, never a block', () => {
    const rec = recommendMachine(48);
    expect(rec.note).toMatch(/Tailscale|iCloud/);
  });
});

describe('deviceRunsComfortably', () => {
  it('reads the honest floor against physical memory, not a comfort fraction', () => {
    // The catalog's minRamGB is already the honest floor, so the rule is that
    // floor against the machine's memory. This is the review 3.2 fix: the 4B
    // pick (floor 6) must read as fitting an 8 GB iPhone, not "better on your
    // computer" while the pack calls it the iPhone pick.
    expect(deviceRunsComfortably(6, 8)).toBe(true);
    expect(deviceRunsComfortably(8, 16)).toBe(true);
    // A 7B (floor about 9) does not fit an 8 GB phone.
    expect(deviceRunsComfortably(9, 8)).toBe(false);
  });

  it('is false when device RAM is unknown', () => {
    expect(deviceRunsComfortably(4, 0)).toBe(false);
  });
});

describe('runsWellOnDevice', () => {
  it('the 4B pick runs well on a real iPhone, at the floor and above', () => {
    // The 4B (floor 6) on a 6 GB iPhone (at the floor) and an 8 GB iPhone.
    expect(runsWellOnDevice(6, 6)).toBe(true);
    expect(runsWellOnDevice(6, 8)).toBe(true);
  });

  it('a 7B does not run well on a phone', () => {
    // A 7B (floor about 9) on a 6 GB phone and an 8 GB phone: over the floor.
    expect(runsWellOnDevice(9, 6)).toBe(false);
    expect(runsWellOnDevice(9, 8)).toBe(false);
  });

  it('reads as runs-well when device memory is unknown, so we never wrongly say no', () => {
    // The web stub and older native builds report 0; stay silent, do not warn.
    expect(runsWellOnDevice(9, 0)).toBe(true);
  });
});

describe('defaultTarget and availableTargets', () => {
  it('prefers the device when the bytes fit with headroom', () => {
    expect(
      defaultTarget({
        neededBytes: gbToBytes(4),
        deviceFreeBytes: gbToBytes(64),
        icloudAvailable: true,
      }),
    ).toBe('device');
  });

  it('falls back to iCloud when it will not fit and iCloud is signed in', () => {
    expect(
      defaultTarget({
        neededBytes: gbToBytes(40),
        deviceFreeBytes: gbToBytes(10),
        icloudAvailable: true,
      }),
    ).toBe('icloud');
  });

  it('never blocks: still picks the device when iCloud is absent', () => {
    expect(
      defaultTarget({
        neededBytes: gbToBytes(40),
        deviceFreeBytes: gbToBytes(10),
        icloudAvailable: false,
      }),
    ).toBe('device');
  });

  it('offers iCloud only when available', () => {
    expect(availableTargets(false)).toEqual(['device']);
    expect(availableTargets(true)).toEqual(['device', 'icloud']);
  });
});
