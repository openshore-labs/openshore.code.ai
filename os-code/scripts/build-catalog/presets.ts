// Prefab stacks, derived from the model set instead of hand-authored, so they
// reassess themselves every time the catalog is rebuilt: as new models land and
// eval scores shift, the presets pick the current best coder for each size tier
// and pair it with the right specialists. Pure and deterministic, so a build is
// reproducible and the result is unit-tested against fixtures. The builder runs
// this after enrichment and the regression gate validates the output, so a
// preset can never reference a model that is not in the catalog.
import type { CatalogModel, CatalogPreset } from '../../src/market/schema.js';

export function derivePresets(
  models: CatalogModel[],
  evals: Record<string, number>,
): CatalogPreset[] {
  const score = (m: CatalogModel) => evals[m.id] ?? 0;
  const bySizeThenScore = (a: CatalogModel, b: CatalogModel) =>
    score(b) - score(a) || a.sizeGB - b.sizeGB;
  const smallestFirst = (a: CatalogModel, b: CatalogModel) => a.sizeGB - b.sizeGB;

  // Discovered models are unrated by definition, so a prefab stack never names
  // one: presets are built from the curated roster only.
  const curated = models.filter((m) => !m.discovery);
  const desktop = curated.filter((m) => m.source.kind === 'ollama' && !m.onDevice);
  const phone = curated.filter((m) => Boolean(m.onDevice));
  const coders = desktop.filter((m) => m.categories.includes('coding')).sort(bySizeThenScore);
  const bestCoderUnder = (maxGB: number) => coders.find((m) => m.sizeGB <= maxGB);
  const embedding = desktop.find((m) => m.categories.includes('embedding'));
  const vision = desktop.filter((m) => m.categories.includes('vision')).sort(smallestFirst)[0];
  const fast = desktop
    .filter(
      (m) => m.categories.includes('fast') || (m.categories.includes('coding') && m.sizeGB <= 2),
    )
    .sort(smallestFirst)[0];

  const presets: CatalogPreset[] = [];

  const pocket = [...phone].sort(bySizeThenScore)[0];
  if (pocket) {
    presets.push({
      id: 'pocket',
      name: 'Pocket',
      tagline: 'Chat anywhere, offline, on your iPhone. Private by construction.',
      minVramGB: 0,
      stack: { orchestrator: pocket.id, specialists: {} },
    });
  }

  const starter = bestCoderUnder(6);
  if (starter) {
    presets.push({
      id: 'starter',
      name: 'Starter',
      tagline: 'One strong coding model that does everything. The right first stack.',
      minVramGB: 0,
      stack: { orchestrator: starter.id, specialists: {} },
    });
  }

  const codingOrch = bestCoderUnder(10) ?? starter;
  if (codingOrch) {
    const specialists: CatalogPreset['stack']['specialists'] = {};
    if (embedding) specialists.embedding = embedding.id;
    if (fast && fast.id !== codingOrch.id) specialists.fast = fast.id;
    presets.push({
      id: 'coding',
      name: 'Coding',
      tagline: 'A stronger brain, repo search by meaning, and a fast hand for small edits.',
      minVramGB: 12,
      stack: { orchestrator: codingOrch.id, specialists },
    });
  }

  const perfOrch = coders[0];
  if (perfOrch) {
    const specialists: CatalogPreset['stack']['specialists'] = {};
    if (vision) specialists.vision = vision.id;
    if (embedding) specialists.embedding = embedding.id;
    if (fast && fast.id !== perfOrch.id) specialists.fast = fast.id;
    presets.push({
      id: 'performance',
      name: 'Performance',
      tagline: 'The strongest local brain plus every specialist. For a big rig.',
      minVramGB: 24,
      stack: { orchestrator: perfOrch.id, specialists },
    });
  }

  return presets;
}
