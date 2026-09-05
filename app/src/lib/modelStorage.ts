// Storage and memory math for the marketplace, kept pure so the screen never
// has to reason about bytes. Three honest questions live here:
//
//   1. Does this model fit in the free space I have right now?  (storageFit)
//   2. How much memory does it want to actually run?            (estimatedRamGB)
//   3. If my machine is too small, what machine would run it?   (recommendMachine)
//
// The load-bearing rule, from the founder: nothing here ever returns "blocked."
// A model that will not fit on this device is not forbidden, it is a model you
// download to iCloud instead and draw from when you are online (defaultTarget).
// Size decides where the bytes land, never whether you are allowed to have them.
import type { CatalogModel } from 'os-code/protocol';

export const BYTES_PER_GB = 1e9;

export function gbToBytes(gb: number): number {
  return gb * BYTES_PER_GB;
}

export function bytesToGB(bytes: number): number {
  return bytes / BYTES_PER_GB;
}

/** A compact, honest byte size for a card: 512 MB, 3.4 GB, 1.1 TB. Never rounds
 *  a nearly-full number up to a friendlier lie (3.98 GB stays 4.0, not 4). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 GB';
  const tb = bytes / (BYTES_PER_GB * 1000);
  if (tb >= 1) return `${round1(tb)} TB`;
  const gb = bytes / BYTES_PER_GB;
  if (gb >= 1) return `${round1(gb)} GB`;
  const mb = bytes / 1e6;
  return `${Math.max(1, Math.round(mb))} MB`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// -------------------------------------------------------------- storage fit

// The headroom we refuse to eat into. iOS keeps some free space for itself and
// starts evicting and misbehaving near a full disk, so a "fits" answer always
// leaves this much behind. This is a floor on comfort, not on permission.
export const STORAGE_RESERVE_BYTES = 3 * BYTES_PER_GB;

export type StorageFit = 'plenty' | 'tight' | 'wont-fit';

/** Does a download of `neededBytes` fit in `freeBytes` of free space? 'plenty'
 *  leaves the reserve untouched, 'tight' spends into it (allowed, but flagged),
 *  'wont-fit' means the bytes are simply larger than the space. Never a verdict
 *  on whether the user may download it, only on where it can land. */
export function storageFit(neededBytes: number, freeBytes: number): StorageFit {
  if (neededBytes + STORAGE_RESERVE_BYTES <= freeBytes) return 'plenty';
  if (neededBytes <= freeBytes) return 'tight';
  return 'wont-fit';
}

// ------------------------------------------------------------- memory (RAM)

// A GGUF has to sit in memory to run, plus room for the KV cache and the OS. A
// model file of S GB wants roughly this much RAM to run without thrashing. The
// catalog's onDevice.minRamGB is the authority when present (the builder's
// honest floor); this factor is the fallback estimate for everything else.
const RAM_OVERHEAD_FACTOR = 1.3;
const MIN_RAM_GB = 4;

/** The memory a model wants to run, in GB. Prefers the catalog's published
 *  floor (onDevice.minRamGB); otherwise estimates from the download size. */
export function estimatedRamGB(model: CatalogModel): number {
  const floor = model.onDevice?.minRamGB;
  if (floor && floor > 0) return Math.round(floor);
  return Math.max(MIN_RAM_GB, Math.round(model.sizeGB * RAM_OVERHEAD_FACTOR));
}

// ------------------------------------------------------- recommended machine

// Real machine memory sizes, so a recommendation names a machine someone can
// actually buy or pair, never an odd in-between number.
const MACHINE_TIERS_GB = [8, 16, 24, 32, 48, 64, 96, 128];

// A machine runs a model comfortably when the model's wanted RAM is at most
// this fraction of the machine's memory (the rest goes to the OS, the app, and
// the KV cache under a long context). The inverse sets the recommendation.
const COMFORT_FRACTION = 0.6;

export interface MachineRec {
  /** The recommended memory size, in GB, rounded up to a real machine tier. */
  ramGB: number;
  /** Plain-language machine this names, e.g. "a Mac or PC with 32 GB of memory". */
  label: string;
  /** The always-true escape hatch: pair it and run it on that machine over
   *  Tailscale, or keep it in iCloud until you are at a machine that fits. */
  note: string;
}

/** The machine that would run a model wanting `requiredRamGB` comfortably. This
 *  is guidance, never a gate: the return always carries the note that you can
 *  pair such a machine over Tailscale rather than buy one. */
export function recommendMachine(requiredRamGB: number): MachineRec {
  const target = requiredRamGB / COMFORT_FRACTION;
  const ramGB =
    MACHINE_TIERS_GB.find((t) => t >= target) ?? MACHINE_TIERS_GB[MACHINE_TIERS_GB.length - 1]!;
  const capped = target > ramGB;
  let label: string;
  if (ramGB <= 16) {
    label = `a laptop with ${ramGB} GB of memory`;
  } else if (ramGB <= 48) {
    label = `a Mac or PC with ${ramGB} GB of memory, or a ${ramGB} GB GPU`;
  } else {
    label = capped
      ? `a workstation with ${ramGB} GB of memory or more`
      : `a workstation with ${ramGB} GB of memory`;
  }
  return {
    ramGB,
    label,
    note: 'Pair one over Tailscale and run it there, or keep it in iCloud until you are at a machine that fits.',
  };
}

/** Does this device have the memory to run the model comfortably? A machine
 *  recommendation only earns its place on the card when the answer is no. */
export function deviceRunsComfortably(requiredRamGB: number, deviceRamGB: number): boolean {
  if (!deviceRamGB) return false;
  return requiredRamGB <= deviceRamGB * COMFORT_FRACTION;
}

/** Does an on-device model run WELL on THIS phone right now, given its physical
 *  memory? Storage is not the limit on a phone; memory is, and iOS ends an app
 *  that reaches for too much of it. So a phone with plenty of free space can
 *  still be short on the memory a big model wants. Composes the RAM estimate
 *  with the comfortable budget so the marketplace can say "runs here" or
 *  "better on your computer" honestly, before a download or a load.
 *
 *  This is guidance for copy, never a gate: like everything in this module it
 *  returns an honest read, and the caller still lets the person have the model
 *  (foundation rule: nothing here is ever "blocked"). Unknown device memory (0,
 *  the web stub or an older native build) reads as runs-well, so a device we
 *  cannot measure is never wrongly told no. */
export function runsWellOnDevice(requiredRamGB: number, deviceRamGB: number): boolean {
  if (!deviceRamGB) return true;
  return deviceRunsComfortably(requiredRamGB, deviceRamGB);
}

// ---------------------------------------------------------- download target

// Where a downloaded model's bytes live. 'device' is this phone's own storage;
// 'icloud' is the app's iCloud Drive container, evicted when space is short and
// pulled back on demand when you are online (ensureLocal, native side).
export type DownloadTarget = 'device' | 'icloud';

export interface TargetContext {
  neededBytes: number;
  deviceFreeBytes: number;
  icloudAvailable: boolean;
}

/** The target to preselect for a download. Prefer the phone when the bytes fit
 *  with headroom; fall back to iCloud when they do not and iCloud is signed in;
 *  otherwise still the phone (the download is never blocked, only warned). */
export function defaultTarget(ctx: TargetContext): DownloadTarget {
  const fit = storageFit(ctx.neededBytes, ctx.deviceFreeBytes);
  if (fit === 'plenty') return 'device';
  if (ctx.icloudAvailable) return 'icloud';
  return 'device';
}

/** The two targets and whether each is offered right now. The device is always
 *  offered (you may always try); iCloud only when it is signed in on this
 *  device. Neither is ever removed for being "too big." */
export function availableTargets(icloudAvailable: boolean): DownloadTarget[] {
  return icloudAvailable ? ['device', 'icloud'] : ['device'];
}
