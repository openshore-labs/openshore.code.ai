// The First Seat's pure core: one fit model shared with the engine, the class
// line the engine writes, the phone's memory rule, and the one rule for when
// the empty chat shows a seat at all. No React, no platform calls, so every
// verdict is unit-tested against the engine's own budget (firstSeat.test.ts
// runs budgetFor and fitsBudget side by side with this file across a grid of
// machines). The reference machine is the founder's CPU-only box: 8 GB, no
// GPU, where the 7B must read too big and the 3B is the seat.
import type { CatalogModel } from 'os-code/protocol';
import { fitFor, type FitLabel } from '../components/marketplace.js';
import { POCKET_ANCHORS } from './packs.js';

/** What we know about the machine, in the person's units. Mirrors the engine's
 *  `hardwareFacts` (router/resourceBudget.ts) and the desktop bridge's
 *  `hardware()` once it lands; until then `hardwareFromSummary` parses the
 *  engine's one-line summary into the same shape. */
export interface HardwareRead {
  /** System memory in GB. 0 when only a GPU line was available. */
  ramGB: number;
  /** A usable dedicated GPU was detected. */
  gpu: boolean;
  /** Dedicated GPU memory in GB, when a GPU was detected. */
  gpuVramGB?: number;
  /** 'linux', 'darwin', 'win32', 'ios'. Informational. */
  platform?: string;
}

export type FitVerdict = FitLabel | 'unknown';

/** VRAM at or below this is an integrated-GPU carve-out, not a real budget.
 *  The same floor the engine uses. */
const DEDICATED_VRAM_FLOOR_GB = 4;

/** Parse the engine's summary line ("no dedicated GPU detected, 8 GB system
 *  RAM (...)" or "NVIDIA RTX 4090 (24 GB). ...") into a hardware read. Never
 *  guesses: an unreadable summary is undefined, not 16 GB. */
export function hardwareFromSummary(summary?: string): HardwareRead | undefined {
  if (!summary) return undefined;
  const gpuGB = [...summary.matchAll(/\((\d+)\s*GB\)/g)].reduce((a, m) => a + Number(m[1]), 0);
  const sys = /(\d+)\s*GB system RAM/.exec(summary);
  if (gpuGB > 0) return { ramGB: sys ? Number(sys[1]) : 0, gpu: true, gpuVramGB: gpuGB };
  if (sys) return { ramGB: Number(sys[1]), gpu: false };
  return undefined;
}

/** The engine's effective budget in GB: the dedicated VRAM when there is a real
 *  GPU, otherwise the larger of a tiny iGPU carve-out and half of system RAM. */
export function effectiveBudgetGB(hw: HardwareRead): number {
  const vram = hw.gpu ? (hw.gpuVramGB ?? 0) : 0;
  const ramBudget = Math.floor(hw.ramGB / 2);
  return vram >= DEDICATED_VRAM_FLOOR_GB ? vram : Math.max(vram, ramBudget);
}

/** fits / tight / too-big for a download of `sizeGB` on this machine, the
 *  engine's verdict exactly (fitsBudget over budgetFor). */
export function fitVerdict(sizeGB: number, hw: HardwareRead): FitLabel {
  return fitFor(sizeGB, effectiveBudgetGB(hw));
}

/** Or 'unknown' when the machine has not been read. */
export function fitVerdictOrUnknown(sizeGB: number, hw?: HardwareRead): FitVerdict {
  return hw ? fitVerdict(sizeGB, hw) : 'unknown';
}

/** "8 GB, no GPU" or "32 GB, 12 GB GPU". */
export function hardwareDesc(hw: HardwareRead): string {
  const gpu = hw.gpu ? `${hw.gpuVramGB ?? 0} GB GPU` : 'no GPU';
  return hw.ramGB > 0 ? `${hw.ramGB} GB, ${gpu}` : gpu;
}

/** The line above the store's fit pills. */
export function hardwareLine(hw: HardwareRead): string {
  return `This computer: ${hardwareDesc(hw)}`;
}

/** One honest fit line for a card or a button. */
export function fitLine(verdict: FitVerdict, hw?: HardwareRead): string {
  if (verdict === 'unknown' || !hw) return 'Could not read this computer yet.';
  const desc = hardwareDesc(hw);
  switch (verdict) {
    case 'fits':
      return `Fits this computer (${desc}).`;
    case 'tight':
      return `A tight fit on this computer (${desc}). It runs, with little headroom.`;
    case 'too-big':
      return `Too big for this computer (${desc}).`;
  }
}

// --------------------------------------------------------------- model class

export type ModelClass = 'tiny' | 'small' | 'mid' | 'large';

/** The engine's class lines, verbatim (os-code/src/harness/profile.ts,
 *  classBlurb). The test pins them against the engine file so the card can
 *  never drift from what the transcript and the Bench say. */
export const CLASS_LINES: Record<ModelClass, string> = {
  tiny: 'Runs single steps. Best for quick edits and questions.',
  small: 'Runs short plans. The harness carries the checklist.',
  mid: 'Plans and runs multi-step work with subagents.',
  large: 'Full planning and delegation.',
};

/** The engine's thresholds, by parameter count in billions. */
export function modelClassFor(paramsB: number): ModelClass {
  if (paramsB < 3) return 'tiny';
  if (paramsB < 8) return 'small';
  if (paramsB < 32) return 'mid';
  return 'large';
}

/** Parse "qwen2.5-coder:7b" -> 7, "...1.5b..." -> 1.5, "...135m" -> 0.135. */
export function paramsBFromRef(ref: string): number | undefined {
  const b = ref.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (b) return Number(b[1]);
  const m = ref.match(/(\d+(?:\.\d+)?)\s*m\b/i);
  if (m) return Number(m[1]) / 1000;
  return undefined;
}

/** The class line for a model ref, small when the size cannot be read (the
 *  engine defaults the same way, so the discipline applies, never skipped). */
export function classLineFor(ref: string): string {
  const b = paramsBFromRef(ref);
  return CLASS_LINES[b === undefined ? 'small' : modelClassFor(b)];
}

// ---------------------------------------------------------------- the phone

/** Does a pocket model run on this phone? The catalog's minRamGB is the
 *  builder's honest floor, so the rule is that floor against physical memory.
 *  Unknown memory (0) never says no. */
export function phoneFits(minRamGB: number, deviceRamGB: number): boolean {
  if (!deviceRamGB) return true;
  return minRamGB <= deviceRamGB;
}

/** The phone's first seat: the first pocket anchor the catalog carries that
 *  fits this phone's memory, falling down the preference list. Undefined when
 *  the catalog has none of them. */
export function resolvePhoneSeat(
  models: CatalogModel[],
  deviceRamGB: number,
): { model: CatalogModel; fit: 'fits' | 'too-big' } | undefined {
  const byId = new Map(models.map((m) => [m.id, m]));
  const present = POCKET_ANCHORS.map((id) => byId.get(id)).filter((m): m is CatalogModel =>
    Boolean(m?.onDevice),
  );
  const fitting = present.find((m) => phoneFits(m.onDevice!.minRamGB, deviceRamGB));
  if (fitting) return { model: fitting, fit: 'fits' };
  const smallest = present[present.length - 1];
  return smallest ? { model: smallest, fit: 'too-big' } : undefined;
}

// ------------------------------------------------------------- when it shows

export interface SeatSignals {
  platform: 'electron' | 'ios' | 'web';
  /** The desktop engine's status has been read at least once. */
  desktopStatusKnown: boolean;
  /** The engine has a Reasoning LLM configured. */
  desktopConfigured: boolean;
  /** The app-side stack can answer (a downloaded on-device anchor). */
  stackReady: boolean;
  /** A cloud key is connected. */
  cloudReady: boolean;
  /** A computer is paired to this phone. */
  hubPaired: boolean;
}

/** The empty chat shows the First Seat only when nothing on this device can
 *  answer. On the desktop that is the engine with no model and no key, once
 *  the engine has been read (never a flash before). On the phone it is no
 *  ready stack, no key, and no paired computer. A plain browser shows none. */
export function firstSeatNeeded(s: SeatSignals): boolean {
  if (s.cloudReady) return false;
  switch (s.platform) {
    case 'electron':
      return s.desktopStatusKnown && !s.desktopConfigured;
    case 'ios':
      return !s.stackReady && !s.hubPaired;
    default:
      return false;
  }
}

// ------------------------------------------------------------- the bridge

/** The slice of the desktop bridge this reads. `hardware()` is the structured
 *  call stream A adds; an older bridge only has the summary in status(). */
export interface HardwareBridge {
  hardware?: () => Promise<HardwareRead>;
  status: () => Promise<{ hardwareSummary: string }>;
}

/** Read this computer's hardware, structured first, summary as the fallback,
 *  undefined when neither answers. */
export async function readDesktopHardware(b: HardwareBridge): Promise<HardwareRead | undefined> {
  if (typeof b.hardware === 'function') {
    try {
      const hw = await b.hardware();
      if (hw && typeof hw.ramGB === 'number') return hw;
    } catch {}
  }
  try {
    const s = await b.status();
    return hardwareFromSummary(s.hardwareSummary);
  } catch {
    return undefined;
  }
}
