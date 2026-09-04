// The catalog builder CLI. CI ONLY. Run with tsx:
//   pnpm --filter os-code build:catalog
// It reads the editorial seed (catalog.sample.json) and the curation inputs,
// gathers source METADATA (never weights), enriches, gates, and writes the
// published catalog.json. On any regression breach it writes nothing and exits
// non-zero, leaving the previously published catalog serving.
//
// This file is the only one in the builder that touches the filesystem or the
// network. Everything it calls (enrich, gate, stars, licenses) is pure and
// unit-tested with fixtures.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogSchema } from '../../src/market/schema.js';
import { enrichCatalog } from './enrich.js';
import { regressionGate, validateCatalog } from './gate.js';
import { gatherMetadata, HuggingFaceSource } from './sources.js';
import { derivePresets } from './presets.js';
import { discoverModels, HuggingFaceDiscovery } from './discover.js';
import { mergeCommunity, SupabaseReviewSource } from './reviews.js';
import type { BuildInputs, ModelMetadata, Overlay } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OSC_ROOT = resolve(HERE, '..', '..');

const SEED_PATH = join(OSC_ROOT, 'catalog.sample.json');
const CURATION_DIR = join(OSC_ROOT, 'curation');
const OUT_PATH = process.env.CATALOG_OUT ?? join(OSC_ROOT, 'build', 'catalog.json');

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function main(): Promise<void> {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  const seedCatalog = CatalogSchema.parse(seed);

  const benchmarks = readJson<Record<string, Record<string, number>>>(
    join(CURATION_DIR, 'benchmarks.json'),
    {},
  );
  const evals = readJson<Record<string, number>>(join(CURATION_DIR, 'eval.json'), {});
  const overlay = readJson<Overlay>(join(CURATION_DIR, 'recommended.json'), {});

  // Gather source metadata unless the run is explicitly offline. A source that
  // does not answer contributes nothing (popularity and timestamps degrade to
  // omitted), which never fails the build.
  let metadata: Record<string, ModelMetadata> = {};
  const online = process.env.CATALOG_OFFLINE !== '1';
  if (online) {
    const refs = seedCatalog.models.map((m) => ({
      ref: m.source.ref,
      kind: m.source.kind,
      // Popularity is HF only; an Ollama model reads its HF GGUF home.
      popularityRef: m.source.popularityRef,
    }));
    try {
      metadata = await gatherMetadata(refs, { huggingface: new HuggingFaceSource() });
    } catch (err) {
      console.warn(`Metadata gather failed, building without popularity: ${String(err)}`);
    }
    // Bug C: a swallowed fetch failure used to look identical to "source has no
    // entry", which is how the first live CI run published popularity empty on
    // every model. An ONLINE run that resolves zero popularity is almost
    // certainly a broken fetcher, not a real state. Warn loudly (a soft
    // build-log signal, NOT a hard gate) so it is caught, and keep publishing so
    // a source outage never takes the storefront down.
    if (Object.keys(metadata).length === 0) {
      console.warn(
        'WARNING: online build resolved 0 popularity entries. Publishing anyway, but the storefront will show empty popularity. Check the source fetchers before trusting this run.',
      );
    }
  }

  // Read the previously published catalog as the regression baseline, keeping
  // three cases distinct so the gate can act on them (H3): absent (undefined,
  // genuine first run) skips the previous-catalog checks; present-and-JSON is
  // passed parsed; present-but-not-JSON (a truncated download, an HTML error
  // page seeded over it) is passed as the raw text, which the schema parse
  // rejects, so the gate treats it as a breach instead of silently skipping.
  // A plain readJson-with-fallback would collapse the last case into "absent."
  let previous: unknown | undefined;
  if (existsSync(OUT_PATH)) {
    const raw = readFileSync(OUT_PATH, 'utf8');
    try {
      previous = JSON.parse(raw);
    } catch {
      previous = raw;
    }
  }

  // Live discovery: newly released and trending GGUF repos join the seed as
  // clearly labelled, unrated entries, so the browse list grows without a
  // hand edit. On by default when online; CATALOG_DISCOVER=0 turns it off. The
  // seed wins every id collision, and last time's discoveries carry forward so
  // a quiet source day never empties the shelf.
  let seedModels = seedCatalog.models;
  if (online && process.env.CATALOG_DISCOVER !== '0') {
    let previousModels: typeof seedModels = [];
    const parsedPrevious = CatalogSchema.safeParse(previous);
    if (parsedPrevious.success) previousModels = parsedPrevious.data.models;
    try {
      const found = await discoverModels(new HuggingFaceDiscovery(), {
        today: new Date().toISOString().slice(0, 10),
        previous: previousModels,
        reserved: new Set(seedModels.map((m) => m.id)),
      });
      for (const s of found.skipped) console.log(`discovery skipped ${s.repo}: ${s.reason}`);
      console.log(`discovery added ${found.models.length} models`);
      seedModels = [...seedModels, ...found.models];
    } catch (err) {
      console.warn(`Discovery failed, building from the seed only: ${String(err)}`);
    }
  }

  const inputs: BuildInputs = {
    seed: { ...seedCatalog, models: seedModels },
    metadata,
    benchmarks,
    evals,
    overlay,
    previous,
  };

  const { catalog, drops } = enrichCatalog(inputs);

  for (const drop of drops) {
    console.log(`dropped ${drop.id}: ${drop.reason}`);
  }

  // Bake the community-review snapshot into the catalog (the scale path): one
  // aggregate read per build lets a browse row show a crowd star with no
  // per-view request to Supabase. Only when online AND the reviews backend is
  // configured; a failure degrades to an empty snapshot (no field written), and
  // an unconfigured build simply ships without it, so the app falls back to the
  // live browse RPC exactly as before. reviewsSnapshotAt is stamped ONLY when
  // the snapshot ran, because its presence is the signal the app trusts to drive
  // browse from the baked aggregates alone.
  const reviewSource = new SupabaseReviewSource();
  if (online && reviewSource.configured) {
    const aggregates = await reviewSource.snapshot();
    catalog.models = mergeCommunity(catalog.models, aggregates);
    catalog.reviewsSnapshotAt = new Date().toISOString().slice(0, 10);
    console.log(`review snapshot: baked ${aggregates.length} model aggregates`);
  } else if (online) {
    console.log('review snapshot: reviews backend not configured, building without it');
  }

  // Prefab stacks reassess themselves from the current model set: derive them
  // from whatever models survived enrichment and the current eval scores, so
  // they stay current with no hand-authoring. Fall back to the seed's presets
  // only if derivation yields nothing (an empty or unexpected model set).
  const derived = derivePresets(catalog.models, evals);
  if (derived.length) catalog.presets = derived;

  console.log(`kept ${catalog.models.length} models, ${catalog.presets.length} presets`);

  // Validate against the schema, then run the regression gate. A breach fails
  // the job and writes nothing.
  const validated = validateCatalog(catalog);
  // CATALOG_ALLOW_LARGE_DROP=1 waives the count-collapse guard for a build that
  // deliberately prunes the roster (a denylist tightening, a cap cut). Off by
  // default, so a real source outage still safe-fails and keeps serving.
  const allowLargeDrop = process.env.CATALOG_ALLOW_LARGE_DROP === '1';
  const gate = regressionGate(validated, previous, { online, allowLargeDrop });
  if (!gate.ok) {
    console.error(
      'REGRESSION GATE FAILED. Publishing nothing; the previous catalog keeps serving.',
    );
    for (const breach of gate.breaches) {
      console.error(`  [${breach.check}] ${breach.detail}`);
    }
    process.exit(1);
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(validated, null, 2)}\n`);
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(`Catalog build failed: ${String(err)}`);
  process.exit(1);
});
