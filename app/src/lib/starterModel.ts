// The one-tap starter for a desktop with no model yet. Since 2026-09-21 the
// starter IS DeepBlue (lib/harborMaster.ts): the same preference list,
// largest size that fits this computer, resolved with the engine's own budget.
// This module keeps the older StarterCandidate shape for its callers (the
// Starter bundle, the Stack screen's pick sheet) so nothing that pinned it has
// to move; the sizes themselves live in one place. The 7B is right on a 16 GB
// laptop or a GPU box; on a CPU box under about 12 GB it does not fit in real
// memory (the reference box proved it: 0%, swapping), and the 3B is the seat
// there (measured 75% on the coding loop, best of 2, 2026-09-15). Every id is
// pinned against the engine's bundled catalog by starterModel.test.ts and
// harborMaster.test.ts, so a catalog rename can never leave the button
// pointing at nothing.
import type { FitVerdict, HardwareRead } from './firstSeat.js';
import {
  HARBOR_MASTER_DEFAULT_SIZE,
  HARBOR_MASTER_SIZES,
  resolveHarborMaster,
  type HarborMasterSize,
} from './harborMaster.js';

export interface StarterCandidate {
  /** Catalog id, what bridge.installModel() takes. */
  catalogId: string;
  /** Ollama ref, what bridge.setOrchestrator() takes once it is pulled. */
  ollamaRef: string;
  name: string;
  sizeGB: number;
}

function asCandidate(size: HarborMasterSize): StarterCandidate {
  return {
    catalogId: size.catalogId,
    ollamaRef: size.ollamaRef,
    name: size.weightsName,
    sizeGB: size.sizeGB,
  };
}

/** DeepBlue's sizes, largest first, in the starter shape. */
export const STARTER_CANDIDATES: readonly StarterCandidate[] = HARBOR_MASTER_SIZES.map(asCandidate);

/** The default pick, for callers that only need a name to pin: the size offered
 *  before the machine has been read (the catalog's rank 1, the 7B). */
export const STARTER_MODEL: StarterCandidate = asCandidate(HARBOR_MASTER_DEFAULT_SIZE);

/** Resolve the starter for a machine: the largest candidate that is not too
 *  big, with its fit. With no hardware read yet, the default pick and an honest
 *  'unknown'. When nothing fits, the smallest with its true verdict, so the
 *  button never lies about what it will do. */
export function resolveStarter(hw?: HardwareRead): { pick: StarterCandidate; fit: FitVerdict } {
  const { size, fit } = resolveHarborMaster(hw);
  return { pick: asCandidate(size), fit };
}
