// The First Seat's pure core: one fit model shared with the engine, a starter
// that resolves against this computer, a phone pick that reads real memory,
// and the one rule for when the empty chat shows the seat at all. The load-
// bearing case is the founder's box: 8 GB, no GPU, where the 7B must read
// "too big" (the engine's own verdict) and the 3B must be the pick.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CatalogModel } from 'os-code/protocol';
import { budgetFor, fitsBudget } from '../../os-code/src/router/resourceBudget.js';
import {
  CLASS_LINES,
  classLineFor,
  effectiveBudgetGB,
  firstSeatNeeded,
  fitLine,
  fitVerdict,
  hardwareFromSummary,
  hardwareLine,
  modelClassFor,
  phoneFits,
  readDesktopHardware,
  resolvePhoneSeat,
  type HardwareRead,
} from '../src/lib/firstSeat.js';
import { STARTER_CANDIDATES, STARTER_MODEL, resolveStarter } from '../src/lib/starterModel.js';

const cpu = (ramGB: number): HardwareRead => ({ ramGB, gpu: false, platform: 'linux' });
const gpu = (ramGB: number, vram: number): HardwareRead => ({
  ramGB,
  gpu: true,
  gpuVramGB: vram,
  platform: 'linux',
});

describe('hardwareFromSummary (the fallback parser over the engine summary)', () => {
  it('reads a CPU box: RAM and no GPU', () => {
    const hw = hardwareFromSummary(
      'no dedicated GPU detected, 8 GB system RAM (CPU inference works, it is just slower). Comfortable profile: one strong model at a time.',
    );
    expect(hw).toEqual({ ramGB: 8, gpu: false });
  });

  it('reads a GPU box: the summed VRAM, GPU true', () => {
    const hw = hardwareFromSummary(
      'NVIDIA RTX 4090 (24 GB). Comfortable profile: a resident fleet.',
    );
    expect(hw).toEqual({ ramGB: 0, gpu: true, gpuVramGB: 24 });
  });

  it('is undefined for nothing, never a guessed 16 GB', () => {
    expect(hardwareFromSummary(undefined)).toBeUndefined();
    expect(hardwareFromSummary('')).toBeUndefined();
    expect(hardwareFromSummary('Comfortable profile: one strong model at a time.')).toBeUndefined();
  });
});

describe('fitVerdict mirrors the engine budget exactly', () => {
  it('the founder box: 4.7 GB on 8 GB CPU reads too-big, on 16 GB it fits', () => {
    expect(fitVerdict(4.7, cpu(8))).toBe('too-big');
    expect(fitVerdict(4.7, cpu(16))).toBe('fits');
    // The 3B fits the floor machine with room.
    expect(fitVerdict(1.9, cpu(8))).toBe('fits');
  });

  it('agrees with budgetFor + fitsBudget across a grid of machines', () => {
    const sizes = [1.1, 1.9, 2.5, 4.7, 9, 20, 40];
    const machines: HardwareRead[] = [
      cpu(4),
      cpu(8),
      cpu(12),
      cpu(14),
      cpu(16),
      cpu(32),
      cpu(64),
      gpu(8, 1), // an iGPU carve-out must not cap the machine
      gpu(16, 8),
      gpu(32, 12),
      gpu(64, 24),
    ];
    for (const hw of machines) {
      const engine = budgetFor({
        gpus: hw.gpu ? [{ name: 'GPU', vramGB: hw.gpuVramGB ?? 0 }] : [],
        totalVramGB: hw.gpu ? (hw.gpuVramGB ?? 0) : 0,
        systemRamGB: hw.ramGB,
        source: hw.gpu ? 'nvidia-smi' : 'none',
      });
      expect(effectiveBudgetGB(hw), JSON.stringify(hw)).toBeGreaterThan(0);
      for (const size of sizes) {
        expect(fitVerdict(size, hw), `${size} GB on ${JSON.stringify(hw)}`).toBe(
          fitsBudget(size, engine),
        );
      }
    }
  });

  it('prints the machine in the person units', () => {
    expect(hardwareLine(cpu(8))).toBe('This computer: 8 GB, no GPU');
    expect(hardwareLine(gpu(32, 12))).toBe('This computer: 32 GB, 12 GB GPU');
    expect(hardwareLine(gpu(0, 24))).toBe('This computer: 24 GB GPU');
  });

  it('writes an honest fit line for each verdict', () => {
    expect(fitLine('fits', cpu(16))).toBe('Fits this computer (16 GB, no GPU).');
    expect(fitLine('tight', cpu(14))).toMatch(/^A tight fit on this computer \(14 GB, no GPU\)/);
    expect(fitLine('too-big', cpu(8))).toBe('Too big for this computer (8 GB, no GPU).');
    expect(fitLine('unknown', undefined)).toBe('Could not read this computer yet.');
  });
});

describe('resolveStarter is a preference list resolved by fit', () => {
  it('is DeepBlue: the 32B on a big hub, the 14B, the 7B, then the 3B floor seat', () => {
    expect(STARTER_CANDIDATES.map((c) => c.catalogId)).toEqual([
      'qwen2.5-coder-32b',
      'qwen2.5-coder-14b',
      'qwen2.5-coder-7b',
      'qwen2.5-coder-3b',
    ]);
    // The default pick, before the machine is read, is never the biggest.
    expect(STARTER_MODEL.catalogId).toBe('qwen2.5-coder-7b');
  });

  it('picks the 3B on a CPU box under about 12 GB and the 7B when it fits', () => {
    // The fit is the engine's own verdict (fitVerdict over budgetFor), so the
    // pill never drifts from the store. The load-bearing guarantee is the PICK:
    // the 3B on a CPU box through 12 GB, the 7B once real memory allows it.
    for (const ram of [4, 8, 12]) {
      expect(resolveStarter(cpu(ram)).pick.ollamaRef, `${ram} GB`).toBe('qwen2.5-coder:3b');
    }
    // On the 8 and 12 GB boxes the 3B reads a clean fit; a 4 GB box is honestly
    // tight (half of 4 GB leaves the 3B little headroom), never a false "fits".
    expect(resolveStarter(cpu(8)).fit).toBe('fits');
    expect(resolveStarter(cpu(12)).fit).toBe('fits');
    expect(resolveStarter(cpu(4)).fit).toBe('tight');
    expect(resolveStarter(cpu(14))).toMatchObject({
      pick: { ollamaRef: 'qwen2.5-coder:7b' },
      fit: 'tight',
    });
    expect(resolveStarter(cpu(16))).toMatchObject({
      pick: { ollamaRef: 'qwen2.5-coder:7b' },
      fit: 'fits',
    });
    expect(resolveStarter(gpu(16, 8))).toMatchObject({
      pick: { ollamaRef: 'qwen2.5-coder:7b' },
      fit: 'fits',
    });
  });

  it('with no hardware read, offers the first pick and says the fit is unknown', () => {
    const r = resolveStarter(undefined);
    expect(r.pick.ollamaRef).toBe('qwen2.5-coder:7b');
    expect(r.fit).toBe('unknown');
  });

  it('falls to the 3B on the reference box because the 7B is too big, and says so honestly', () => {
    // The 8 GB CPU box is the founder's floor: the 7B is the engine's own
    // "too big" there (it swaps), so the starter falls to the 3B and reports
    // the 3B's real verdict, never the 7B's.
    expect(fitVerdict(4.7, cpu(8))).toBe('too-big');
    const r = resolveStarter(cpu(8));
    expect(r.pick.ollamaRef).toBe('qwen2.5-coder:3b');
    expect(r.fit).toBe('fits');
  });
});

describe('the class line comes from the engine, never invented on the card', () => {
  it('mirrors the harness thresholds and the small-class blurb verbatim', () => {
    const engine = readFileSync(
      join(process.cwd(), '..', 'os-code', 'src', 'harness', 'profile.ts'),
      'utf8',
    );
    expect(engine).toContain(`'${CLASS_LINES.small}'`);
    expect(engine).toContain(`'${CLASS_LINES.tiny}'`);
    expect(modelClassFor(1.5)).toBe('tiny');
    expect(modelClassFor(3)).toBe('small');
    expect(modelClassFor(7)).toBe('small');
    expect(modelClassFor(14)).toBe('mid');
    expect(modelClassFor(32)).toBe('large');
  });

  it('the 7B and 3B picks are small, the 14B is mid, and the 32B is large', () => {
    for (const c of STARTER_CANDIDATES.filter(
      (c) => c.catalogId === 'qwen2.5-coder-7b' || c.catalogId === 'qwen2.5-coder-3b',
    )) {
      expect(classLineFor(c.ollamaRef)).toBe(
        'Runs short plans. The harness carries the checklist.',
      );
    }
    expect(classLineFor('qwen2.5-coder:14b')).toBe(
      'Plans and runs multi-step work with subagents.',
    );
    expect(classLineFor('qwen2.5-coder:32b')).toBe('Full planning and delegation.');
  });
});

describe('phone fit is minRamGB against physical memory', () => {
  const pocket = (id: string, minRamGB: number, sizeGB: number): CatalogModel =>
    ({
      id,
      name: id,
      tagline: 't',
      categories: ['reasoning'],
      orchestratorCapable: true,
      source: { kind: 'huggingface', ref: id, pullCommand: 'x' },
      sizeGB,
      quantization: 'Q4_K_M',
      contextTokens: 8192,
      license: { id: 'Apache-2.0', name: 'Apache 2.0' },
      curation: { rank: 1, note: 't' },
      blessed: false,
      onDevice: { url: 'https://huggingface.co/x/y.gguf', sizeGB, minRamGB },
    }) as CatalogModel;
  const models = [pocket('qwen3-4b-phone', 6, 2.5), pocket('qwen2.5-1.5b-phone', 4, 1.1)];

  it('fits at 6, 8, and 12 GB when the floor is 6', () => {
    expect(phoneFits(6, 6)).toBe(true);
    expect(phoneFits(6, 8)).toBe(true);
    expect(phoneFits(6, 12)).toBe(true);
    expect(phoneFits(6, 4)).toBe(false);
    // Unknown memory never says no.
    expect(phoneFits(6, 0)).toBe(true);
  });

  it('resolves the 4B on a 6, 8, or 12 GB phone and the 1.5B on a 4 GB one', () => {
    for (const ram of [6, 8, 12]) {
      expect(resolvePhoneSeat(models, ram)?.model.id, `${ram} GB`).toBe('qwen3-4b-phone');
    }
    expect(resolvePhoneSeat(models, 4)?.model.id).toBe('qwen2.5-1.5b-phone');
    expect(resolvePhoneSeat([], 8)).toBeUndefined();
  });
});

describe('firstSeatNeeded: the empty chat shows the seat only with no brain', () => {
  const base = {
    desktopStatusKnown: true,
    desktopConfigured: false,
    stackReady: false,
    cloudReady: false,
    hubPaired: false,
  };
  it('desktop: needs a seat when the engine has no model and no key', () => {
    expect(firstSeatNeeded({ ...base, platform: 'electron' })).toBe(true);
    expect(firstSeatNeeded({ ...base, platform: 'electron', desktopConfigured: true })).toBe(false);
    expect(firstSeatNeeded({ ...base, platform: 'electron', cloudReady: true })).toBe(false);
    // Until the engine status has been read, never flash the card.
    expect(firstSeatNeeded({ ...base, platform: 'electron', desktopStatusKnown: false })).toBe(
      false,
    );
  });
  it('phone: needs a seat when the stack, a key, and a paired computer are all missing', () => {
    expect(firstSeatNeeded({ ...base, platform: 'ios' })).toBe(true);
    expect(firstSeatNeeded({ ...base, platform: 'ios', stackReady: true })).toBe(false);
    expect(firstSeatNeeded({ ...base, platform: 'ios', hubPaired: true })).toBe(false);
    expect(firstSeatNeeded({ ...base, platform: 'ios', cloudReady: true })).toBe(false);
  });
  it('a plain browser never shows it', () => {
    expect(firstSeatNeeded({ ...base, platform: 'web' })).toBe(false);
  });
});

describe('readDesktopHardware prefers the structured bridge call, falls back to the summary', () => {
  it('uses hardware() when the bridge has it', async () => {
    const hw = await readDesktopHardware({
      hardware: async () => ({ ramGB: 32, gpu: true, gpuVramGB: 12, platform: 'linux' }),
      status: async () => ({ hardwareSummary: 'no dedicated GPU detected, 8 GB system RAM' }),
    });
    expect(hw).toEqual({ ramGB: 32, gpu: true, gpuVramGB: 12, platform: 'linux' });
  });
  it('parses the summary on an older bridge', async () => {
    const hw = await readDesktopHardware({
      status: async () => ({ hardwareSummary: 'no dedicated GPU detected, 8 GB system RAM' }),
    });
    expect(hw).toEqual({ ramGB: 8, gpu: false });
  });
  it('is undefined when neither answers', async () => {
    const hw = await readDesktopHardware({
      hardware: async () => {
        throw new Error('no');
      },
      status: async () => {
        throw new Error('no');
      },
    });
    expect(hw).toBeUndefined();
  });
});
