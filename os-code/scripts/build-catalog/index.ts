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
import { toV1 } from './v1.js';
import {
  dropUnpinned,
  GitHubReleasePins,
  HuggingFaceFilePins,
  pinCatalogFiles,
} from './pinFiles.js';
import type { BuildInputs, EvalEntries, ModelMetadata, Overlay } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OSC_ROOT = resolve(HERE, '..', '..');

const SEED_PATH = join(OSC_ROOT, 'catalog.sample.json');
const CURATION_DIR = join(OSC_ROOT, 'curation');
// Two files (the model library, 2026-10-12): catalog.v2.json is the library
// catalog; catalog.json is the same narrowed for apps released before it
// (v1.ts). The regression baseline is the previous v2 file, falling back to
// the previous v1 file on the first library build.
const OUT_PATH = process.env.CATALOG_OUT ?? join(OSC_ROOT, 'build', 'catalog.json');
const OUT_V2_PATH = process.env.CATALOG_OUT_V2 ?? join(dirname(OUT_PATH), 'catalog.v2.json');
// Live discovery's finds, for the curators to read: candidates, never shelves.
const CANDIDATES_PATH = join(dirname(OUT_PATH), 'candidates.json');

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function main(): Promise<void> {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  let seedCatalog = CatalogSchema.parse(seed);

  const benchmarks = readJson<Record<string, Record<string, number>>>(
    join(CURATION_DIR, 'benchmarks.json'),
    {},
  );
  const evals = readJson<EvalEntries>(join(CURATION_DIR, 'eval.json'), {});
  const overlay = readJson<Overlay>(join(CURATION_DIR, 'recommended.json'), {});

  // Gather source metadata unless the run is explicitly offline. A source that
  // does not answer contributes nothing (popularity and timestamps degrade to
  // omitted), which never fails the build.
  let metadata: Record<string, ModelMetadata> = {};
  const online = process.env.CATALOG_OFFLINE !== '1';
  if (online) {
    // Popularity is HF only; an Ollama model reads its HF GGUF home. A model
    // from GitHub, Civitai or a publisher's site carries no popularity number
    // (never a guessed one).
    const refs = seedCatalog.models.flatMap((m) =>
      m.source.kind === 'ollama' || m.source.kind === 'huggingface'
        ? [{ ref: m.source.ref, kind: m.source.kind, popularityRef: m.source.popularityRef }]
        : [],
    );
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

  // Every file a media model downloads is pinned to the SHA-256 its source
  // publishes (and a Hugging Face file to its commit) before anything is
  // built; a model with a file left unpinned is taken out, its picks with it
  // (pinFiles.ts, security review 2026-10-12). Offline nothing can be read,
  // so only a curator's own pins in the seed survive.
  if (online) {
    seedCatalog = await pinCatalogFiles(seedCatalog, {
      huggingface: new HuggingFaceFilePins(),
      github: new GitHubReleasePins(),
    });
  }
  const pinned = dropUnpinned(seedCatalog);
  for (const drop of pinned.drops) console.log(`dropped ${drop.id}: ${drop.reason}`);
  seedCatalog = pinned.catalog;

  // Read the previously published catalog as the regression baseline, keeping
  // three cases distinct so the gate can act on them (H3): absent (undefined,
  // genuine first run) skips the previous-catalog checks; present-and-JSON is
  // passed parsed; present-but-not-JSON (a truncated download, an HTML error
  // page seeded over it) is passed as the raw text, which the schema parse
  // rejects, so the gate treats it as a breach instead of silently skipping.
  // A plain readJson-with-fallback would collapse the last case into "absent."
  let previous: unknown | undefined;
  const baselinePath = existsSync(OUT_V2_PATH) ? OUT_V2_PATH : OUT_PATH;
  if (existsSync(baselinePath)) {
    const raw = readFileSync(baselinePath, 'utf8');
    try {
      previous = JSON.parse(raw);
    } catch {
      previous = raw;
    }
  }

  // Live discovery: newly released and trending GGUF repos. Since the model
  // library (founder, 2026-10-12: limit the models per category) they are NOT
  // published; they are written to candidates.json for the curators to read
  // when they choose the next picks. On by default when online;
  // CATALOG_DISCOVER=0 turns it off.
  const seedModels = seedCatalog.models;
  if (online && process.env.CATALOG_DISCOVER !== '0') {
    try {
      const found = await discoverModels(new HuggingFaceDiscovery(), {
        today: new Date().toISOString().slice(0, 10),
        previous: [],
        reserved: new Set(seedModels.map((m) => m.id)),
      });
      for (const s of found.skipped) console.log(`discovery skipped ${s.repo}: ${s.reason}`);
      console.log(`discovery found ${found.models.length} candidates (not published)`);
      mkdirSync(dirname(CANDIDATES_PATH), { recursive: true });
      writeFileSync(CANDIDATES_PATH, `${JSON.stringify(found.models, null, 2)}\n`);
    } catch (err) {
      console.warn(`Discovery failed: ${String(err)}`);
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
  writeFileSync(OUT_V2_PATH, `${JSON.stringify(validated, null, 2)}\n`);
  console.log(`Wrote ${OUT_V2_PATH}`);
  const v1 = validateCatalog(toV1(validated));
  writeFileSync(OUT_PATH, `${JSON.stringify(v1, null, 2)}\n`);
  console.log(`Wrote ${OUT_PATH} (${v1.models.length} models for apps before the library)`);
}

main().catch((err) => {
  console.error(`Catalog build failed: ${String(err)}`);
  process.exit(1);
});
