// The one-tap starter for a desktop with no model yet: a preference list,
// best first, resolved against THIS computer's memory with the engine's own
// budget. The 7B is right on a 16 GB laptop or a GPU box; on a CPU box under
// about 12 GB it does not fit in real memory (the reference box proved it:
// 0%, swapping), and the 3B is the seat there (measured 75% on the coding loop,
// best of 2, 2026-09-15). Every id is pinned against the engine's bundled
// catalog by starterModel.test.ts, so a catalog rename can never leave the
// button pointing at nothing.
import { fitVerdict, type FitVerdict, type HardwareRead } from './firstSeat.js';

export interface StarterCandidate {
  /** Catalog id, what bridge.installModel() takes. */
  catalogId: string;
  /** Ollama ref, what bridge.setOrchestrator() takes once it is pulled. */
  ollamaRef: string;
  name: string;
  sizeGB: number;
}

export const STARTER_CANDIDATES: readonly StarterCandidate[] = [
  {
    catalogId: 'qwen2.5-coder-7b',
    ollamaRef: 'qwen2.5-coder:7b',
    name: 'Qwen 2.5 Coder 7B',
    sizeGB: 4.7,
  },
  {
    catalogId: 'qwen2.5-coder-3b',
    ollamaRef: 'qwen2.5-coder:3b',
    name: 'Qwen 2.5 Coder 3B',
    sizeGB: 1.9,
  },
];

/** The first preference, for callers that only need a name to pin. */
export const STARTER_MODEL: StarterCandidate = STARTER_CANDIDATES[0]!;

/** Resolve the starter for a machine: the first candidate that is not too big,
 *  with its fit. With no hardware read yet, the first preference and an honest
 *  'unknown'. When nothing fits, the smallest with its true verdict, so the
 *  button never lies about what it will do. */
export function resolveStarter(hw?: HardwareRead): { pick: StarterCandidate; fit: FitVerdict } {
  if (!hw) return { pick: STARTER_CANDIDATES[0]!, fit: 'unknown' };
  for (const pick of STARTER_CANDIDATES) {
    const fit = fitVerdict(pick.sizeGB, hw);
    if (fit !== 'too-big') return { pick, fit };
  }
  const smallest = STARTER_CANDIDATES[STARTER_CANDIDATES.length - 1]!;
  return { pick: smallest, fit: fitVerdict(smallest.sizeGB, hw) };
}
