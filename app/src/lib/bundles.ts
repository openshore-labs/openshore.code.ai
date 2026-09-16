// Stack bundles: one tap fills Your stack with a coherent set of local models
// for a profile, instead of choosing model by model. Each bundle names an
// orchestrator plus specialists by engine role, all as catalog ids, so the
// Marketplace can sum the real download size from the catalog and install
// them in order. Pocket runs on the phone itself; the rest run on the desktop
// engine through Ollama. Desktop bundles mirror the engine's own presets where
// one exists (starter, coding, big-rig), so `osc init` and the app agree.
// bundles.test.ts pins every id against os-code/catalog.sample.json.
import { fitVerdict, type HardwareRead } from './firstSeat.js';

export type BundleRole = 'coding' | 'writing' | 'analysis' | 'vision' | 'embedding' | 'fast';

export interface StackBundle {
  id: string;
  name: string;
  /** One honest line: who it is for. */
  tagline: string;
  /** Where these models run. */
  platform: 'phone' | 'desktop';
  /** Catalog id of the Reasoning LLM (orchestrator). */
  orchestrator: string;
  /** A preference list for the orchestrator, best first, resolved against the
   *  machine's memory by resolveBundle. `orchestrator` is the first entry. */
  orchestratorCandidates?: string[];
  /** Catalog ids of specialists, by engine role. */
  specialists: Partial<Record<BundleRole, string>>;
  /** GPU memory this comfortably needs, 0 when it runs on CPU or a phone. */
  minVramGB: number;
}

export const STACK_BUNDLES: StackBundle[] = [
  {
    id: 'pocket',
    name: 'Pocket',
    tagline: 'Chat anywhere, offline, on this iPhone. Private by construction.',
    platform: 'phone',
    orchestrator: 'qwen3-4b-phone',
    specialists: {},
    minVramGB: 0,
  },
  {
    id: 'starter',
    name: 'Starter',
    tagline:
      'One coding model that does everything, sized to this computer. The right first stack.',
    platform: 'desktop',
    orchestrator: 'qwen2.5-coder-7b',
    // The same preference list as the one-tap starter (lib/starterModel.ts):
    // the 7B where it fits, the 3B on a CPU box under about 12 GB.
    orchestratorCandidates: ['qwen2.5-coder-7b', 'qwen2.5-coder-3b'],
    specialists: {},
    minVramGB: 0,
  },
  {
    id: 'coding',
    name: 'Coding',
    tagline:
      'A stronger brain, repo search that finds code by meaning, and a fast hand for small edits.',
    platform: 'desktop',
    orchestrator: 'qwen2.5-coder-14b',
    specialists: { embedding: 'nomic-embed-text', fast: 'qwen2.5-coder-1.5b' },
    minVramGB: 12,
  },
  {
    id: 'creative',
    name: 'Creative',
    tagline: 'Writing, docs, and analysis first, with a light touch of vision and search.',
    platform: 'desktop',
    orchestrator: 'qwen2.5-7b',
    specialists: { writing: 'gemma2-2b', vision: 'moondream', embedding: 'nomic-embed-text' },
    minVramGB: 8,
  },
  {
    id: 'performance',
    name: 'Performance',
    tagline: 'The strongest local brain plus every specialist. For a big rig.',
    platform: 'desktop',
    orchestrator: 'qwen2.5-coder-32b',
    specialists: { vision: 'llava-7b', embedding: 'nomic-embed-text', fast: 'qwen2.5-coder-1.5b' },
    minVramGB: 24,
  },
];

/** Every catalog id a bundle installs, orchestrator first. */
export function bundleModelIds(b: StackBundle): string[] {
  return [b.orchestrator, ...Object.values(b.specialists)];
}

/** Total download in GB from the catalog's sizes; undefined when any model is
 *  missing from the catalog, so the UI says "size unknown" instead of lying. */
export function bundleTotalGB(
  b: StackBundle,
  sizeOf: (catalogId: string) => number | undefined,
): number | undefined {
  let total = 0;
  for (const id of bundleModelIds(b)) {
    const gb = sizeOf(id);
    if (gb === undefined) return undefined;
    total += gb;
  }
  return Math.round(total * 10) / 10;
}

export function bundlesFor(platform: 'phone' | 'desktop'): StackBundle[] {
  return STACK_BUNDLES.filter((b) => b.platform === platform);
}

/** Resolve a bundle's orchestrator against the machine: the first candidate
 *  that is not too big by the engine's budget, else the smallest with its true
 *  verdict. A bundle with no candidate list, or no hardware read, is returned
 *  as is. `sizeOf` reads the catalog's download size. */
export function resolveBundle(
  b: StackBundle,
  hw: HardwareRead | undefined,
  sizeOf: (catalogId: string) => number | undefined,
): StackBundle {
  const candidates = b.orchestratorCandidates;
  if (!candidates?.length || !hw) return b;
  for (const id of candidates) {
    const gb = sizeOf(id);
    if (gb !== undefined && fitVerdict(gb, hw) !== 'too-big') return { ...b, orchestrator: id };
  }
  return { ...b, orchestrator: candidates[candidates.length - 1]! };
}
