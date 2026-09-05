// Stack bundles: one tap fills Your stack with a coherent set of local models
// for a profile, instead of choosing model by model. Each bundle names an
// orchestrator plus specialists by engine role, all as catalog ids, so the
// Marketplace can sum the real download size from the catalog and install
// them in order. Pocket runs on the phone itself; the rest run on the desktop
// engine through Ollama. Desktop bundles mirror the engine's own presets where
// one exists (starter, coding, big-rig), so `osc init` and the app agree.
// bundles.test.ts pins every id against os-code/catalog.sample.json.
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
    tagline: 'One strong coding model that does everything. The right first stack.',
    platform: 'desktop',
    orchestrator: 'qwen2.5-coder-7b',
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
