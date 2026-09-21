// Harbor Master: the third and most capable member of the Harbor family, and
// the one that runs on your computer. Harbor Light is built into the phone app
// and guides; Harbor is a 1.1 GB on-device download and a first coding agent;
// Harbor Master is a real coding agent that plans and edits your repositories
// on the desktop engine, pulled through Ollama and sized to the machine it lands
// on, out of the box and never behind the Marketplace. Docked, the phone reaches
// it as "My computer". Founder brief 2026-09-21: "a third and final more
// advanced out-of-the-box model", "download to your hub and get started Docked
// super quick".
//
// The id is a stable slot decoupled from the weights, exactly like harbor and
// harbor-mini: today every size points at stock Qwen 2.5 Coder weights (the
// catalog's own picks, the 7B rank 1), and when OpenShore's tuned weights ship
// (docs/house-model-proposal.md) only the refs, the size labels, and the
// attribution change. The display name is one constant, so the CMO can rename
// it without touching the slot.
//
// Honesty bar (CLAUDE.md, the claim ladder): copy never says "as smart as
// Claude", "a compact Opus", "trains itself", or "always on". Today the
// attribution says the weights are stock Qwen 2.5 Coder; "tuned for OpenShore"
// is written only when an adapter actually ships.
import { fitVerdict, type FitVerdict, type HardwareRead } from './firstSeat.js';

export const HARBOR_MASTER_MODEL_ID = 'harbor-master';
export const HARBOR_MASTER_MODEL_NAME = 'Harbor Master';

/** The byline under the Harbor Master row in Settings. One capability line, no
 *  em dash, under 140 characters, and only claims the engine keeps today. */
export const HARBOR_MASTER_BYLINE =
  'The most capable Harbor. A real coding agent that plans and edits your repositories, running on your computer through Ollama.';

/** The attribution sentence for the "Local models, honestly" sheet. Names the
 *  real weights behind the slot; changes in the same commit as the refs. */
export const HARBOR_MASTER_ATTRIBUTION =
  'On the desktop, Harbor Master is Qwen 2.5 Coder, sized to your computer (14B, 7B, or 3B), used under the Apache License 2.0.';

/** One size of Harbor Master. The catalog id is what the engine's installer
 *  takes; the Ollama ref is what seats it as the Reasoning LLM once pulled;
 *  weightsName is the honest name of what is really behind the slot. */
export interface HarborMasterSize {
  catalogId: string;
  ollamaRef: string;
  weightsName: string;
  sizeGB: number;
}

/** Largest first: the pick is the biggest size that is not too big for this
 *  computer. The 3B is the floor seat (measured 75% on the coding loop on a
 *  CPU-only 8 GB box, best of 2, 2026-09-15); the 7B is the catalog's rank 1
 *  and the 16 GB laptop or 8 GB GPU pick; the 14B is "the one to grow into"
 *  on a hub with room. Every id is pinned against the engine's bundled catalog
 *  by harborMaster.test.ts. */
export const HARBOR_MASTER_SIZES: readonly HarborMasterSize[] = [
  {
    catalogId: 'qwen2.5-coder-14b',
    ollamaRef: 'qwen2.5-coder:14b',
    weightsName: 'Qwen 2.5 Coder 14B',
    sizeGB: 9.0,
  },
  {
    catalogId: 'qwen2.5-coder-7b',
    ollamaRef: 'qwen2.5-coder:7b',
    weightsName: 'Qwen 2.5 Coder 7B',
    sizeGB: 4.7,
  },
  {
    catalogId: 'qwen2.5-coder-3b',
    ollamaRef: 'qwen2.5-coder:3b',
    weightsName: 'Qwen 2.5 Coder 3B',
    sizeGB: 1.9,
  },
];

/** The size offered before the machine has been read: the middle one, the
 *  catalog's rank 1, never the biggest on a guess. */
export const HARBOR_MASTER_DEFAULT_SIZE: HarborMasterSize = HARBOR_MASTER_SIZES[1]!;

/** Resolve Harbor Master for a machine: the largest size that is not too big,
 *  with its fit. With no hardware read yet, the default size and an honest
 *  'unknown'. When nothing fits, the smallest with its true verdict, so the
 *  card never lies about what it will do. */
export function resolveHarborMaster(hw?: HardwareRead): {
  size: HarborMasterSize;
  fit: FitVerdict;
} {
  if (!hw) return { size: HARBOR_MASTER_DEFAULT_SIZE, fit: 'unknown' };
  for (const size of HARBOR_MASTER_SIZES) {
    const fit = fitVerdict(size.sizeGB, hw);
    if (fit !== 'too-big') return { size, fit };
  }
  const smallest = HARBOR_MASTER_SIZES[HARBOR_MASTER_SIZES.length - 1]!;
  return { size: smallest, fit: fitVerdict(smallest.sizeGB, hw) };
}

/** Is this Ollama ref one of Harbor Master's sizes? Ollama lists a pulled
 *  model by its tagged name, so the match is exact. */
export function isHarborMasterRef(ref: string): boolean {
  return HARBOR_MASTER_SIZES.some((s) => s.ollamaRef === ref);
}

/** The largest Harbor Master size present in the engine's Ollama list, or
 *  undefined when none is. Presence is read from the engine, never remembered
 *  by the app, so the Settings row cannot drift from what Ollama holds. */
export function harborMasterInstalled(
  ollamaModels: readonly string[] | undefined,
): HarborMasterSize | undefined {
  if (!ollamaModels?.length) return undefined;
  return HARBOR_MASTER_SIZES.find((s) => ollamaModels.includes(s.ollamaRef));
}

/** The one line a card shows under the name: what is really behind the slot
 *  and what it costs to download. */
export function harborMasterSizeLine(size: HarborMasterSize): string {
  return `On ${size.weightsName}. ${size.sizeGB} GB download.`;
}
