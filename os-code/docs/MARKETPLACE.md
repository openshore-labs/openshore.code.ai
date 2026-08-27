# The OS Code Marketplace

The marketplace is a CATALOG, not a weight host. OpenShore publishes a static
JSON manifest that points at Hugging Face and the Ollama library with honest
license flags and computed ratings. The client pulls weights straight from the
source. OpenShore never rehosts, proxies, or touches weights, and there is no
ratings server: every star is computed from published benchmarks and the local
eval, never collected from a crowd.

This document covers the extended schema, the server-side builder, the star
normalization tables, the client sorts and filters, and the editorial workflow.

## Schema diff (already shipped)

`src/market/schema.ts` gained optional, backward-compatible fields on
`CatalogModelSchema`. Old clients strip them; the bundled `catalog.sample.json`
(which has none) still validates. New fields:

- `ratings`: `{ perCapability, osCodeFit, provenance }`. `perCapability` is a
  SPARSE `partialRecord` (only the categories a model targets). `osCodeFit` is a
  0..5 star. `provenance` records which benchmark(s) earned each capability star.
- `popularity`: `{ downloads, likes, source }`. A sort input, labelled as
  popularity, never as quality.
- `createdAt` / `updatedAt`: ISO strings from source metadata. A weird format
  degrades to ignored rather than rejecting the catalog.
- `recommended`: `{ isRecommended, note? }`, the founder's editorial pick.

Shared types added: `CapabilityEnum` (the router/roles.ts taxonomy, promoted so
the ratings map and the categories field cannot drift) and a `StarSchema` that
pins 0..5 in 0.5 steps.

## The builder (`scripts/build-catalog/`, CI only)

The builder runs in CI ONLY and never ships in the client. The isolation guard
(`test/scripts.isolation.test.ts`) fails the suite if any file under `src/` or
`protocol.ts` imports from `scripts/`. The dependency arrow points one way:
`scripts/` may import from `src/`, never the reverse. It runs via `tsx` under its
own `tsconfig.scripts.json`, so `tsc` for the client bundle never compiles it.

Run it:

```
pnpm --filter os-code build:catalog
```

Pipeline, in order:

1. Read the editorial seed (`catalog.sample.json`) and the curation inputs
   (`curation/benchmarks.json`, `curation/eval.json`, `curation/recommended.json`).
2. Gather source METADATA ONLY (id, downloads, likes, timestamps, tags, license
   tag) behind the `MetadataSource` interface (`sources.ts`). A source that does
   not answer contributes nothing; popularity and timestamps degrade to omitted.
   Set `CATALOG_OFFLINE=1` to skip the network entirely (used by local runs and
   tests). NEVER weights.
3. Enrich each seed model (`enrich.ts`): license from the allow-list, ratings
   from benchmarks, `osCodeFit` from the eval, popularity and timestamps from
   metadata, the editorial overlay merged in.
4. Apply the curated storefront gate per model (drop, with a logged reason).
5. `CatalogSchema.parse` the result.
6. Run the bad-build regression gate (`gate.ts`) against the last published
   catalog. On any breach: fail the job, write nothing, leave the previous
   catalog serving.
7. Write `build/catalog.json` (gitignored; CI publishes it).

### Star normalization tables (`stars.ts`)

Stars are a DATA TABLE, the same shape as `PRICES` in `src/auth/usage.ts`. One
row per benchmark ties a benchmark to a router/roles.ts capability and a
descending scale of `(minScore -> stars)`. Tuning a threshold is one edit.

Scales in use: `PCT` (0..100 accuracy, most benchmarks), `TEN` (0..10 judge
scores like MT-Bench), `ELO` (Chatbot Arena), `MTEB` (a tighter embedding band),
`UNIT` (0..1 image fidelity like GenEval), `TPS` (tokens per second, for fast).

Rules that keep ratings honest:

- A capability is rated ONLY when the model targets it AND at least one of its
  benchmarks has a score. Otherwise no star is emitted. A star is never invented.
- When several benchmarks inform a dimension, their stars average and snap to a
  0.5 step. Every contributing benchmark is recorded as provenance.
- `osCodeFit = round(evalReport.average * 5)`. A `ratings` block is emitted only
  when a real eval report exists, so `osCodeFit` is always honest. A low
  `osCodeFit` on a specialist (a pure embedder cannot orchestrate) is correct
  information, not a penalty.

### CTO must-fixes

- **License fail-closed** (`licenses.table.ts`): id, name, and url come ONLY
  from the fixed SPDX allow-list. A missing or unmapped license id drops the
  model from the curated gate. The builder NEVER synthesizes a license from a
  source tag. Human license notes come ONLY from the editorial overlay.
- **Curated storefront gate** (`enrich.ts`): a model is published only if it has
  an allow-listed license, a sourceable public download (a ref and a pull
  command), AND it clears the quality bar. Orchestrators clear on the eval bar
  (`osCodeFit >= 3`); specialists clear on a strong benchmark-derived capability
  star (`>= 3.5`).
- **Bad-build regression gate** (`gate.ts`), after the schema parse and before
  publish. Invariants: non-empty models; every preset orchestrator and
  specialist id resolves; no previously blessed model dropped; model count not
  down more than 25 percent versus the last published catalog. Any breach fails
  the job and publishes nothing.
- **Editorial overlay** (`curation/recommended.json`): a map of modelId to
  `{ isRecommended, note?, rank?, licenseNote? }`. An overlay `rank` overrides
  `curation.rank`, which is the schema-safe home for the founder's editorial
  order. `licenseNote` is the only place a human license note may come from.
- **Schema validation**: `CatalogSchema.parse` before writing.

Unit tests: `catalog.builder.stars.test.ts` (normalization, provenance,
never-invent), `catalog.builder.license.test.ts` (fail-closed, note from overlay
only), `catalog.builder.gate.test.ts` (curated gate and regression gate).

## Client (`app/src/screens/MarketplaceScreen.tsx`)

Search, a filter rail, a sort segmented control, rich cards, a card detail, and
compare. The download and install flows are unchanged: pocket models pull
straight to the device, desktop models pull through Ollama, weights always come
from the source.

### Sorts (`app/src/components/marketplace.ts`)

- **OpenShore Recommended** (DEFAULT): recommended first, then `curation.rank`.
  Popularity never outranks curation here.
- **Most popular**: Hugging Face and Ollama downloads plus likes, labelled as
  popularity, not quality.
- **Newest**: `createdAt` / `updatedAt` descending.
- **Best fit for my machine**: reuses the engine budget fractions.

Undefined ordering (CTO must-fix): a missing value always sorts LAST, whatever
the direction, with `curation.rank` as the stable tiebreaker. A partial or old
catalog (no popularity, no timestamps) still renders in curated order instead of
collapsing into an arbitrary heap.

### Filters and facets

Capability category (the 8), runs-on-my-machine (fit from the machine tier),
license posture (commercial-ok / non-commercial / gated, read from the SPDX id),
size range, on-device capable, orchestrator-capable, source (Ollama / Hugging
Face), and a minimum star in a chosen capability.

### Cards and detail

Cards carry the `osCodeFit` verdict above the per-capability lanes, true
half-star tracks, a hardware-fit traffic-signal pill, an OpenShore pick badge
where set, an on-device tag, and a quiet license line. Tapping a lane reveals its
provenance benchmarks. The detail disclosure shows the curation note, the full
benchmarks, the honest license note, the exact pull command, and the preset
stacks the model belongs to. Compare selects 2 or 3 models for a side-by-side
table with a faint teal wash on the winning cell.

## Editorial workflow

To admit or promote a model:

1. Add or edit its base entry in `catalog.sample.json` (the editorial seed).
2. Commit its published benchmark scores to `curation/benchmarks.json`
   (native units, keyed by the router/roles.ts benchmark names).
3. Run the eval harness (`osc eval`) and commit its average to
   `curation/eval.json`. This is what gives the model an honest `osCodeFit` and,
   for an orchestrator, what clears the curated gate.
4. Set the pick and any license note in `curation/recommended.json`.
5. Confirm the license id is on the allow-list in
   `scripts/build-catalog/licenses.table.ts`. If not, add a row (id, name, url,
   commercial posture) or the model will be dropped fail-closed.
6. Run `pnpm --filter os-code build:catalog` and review the drop log.

## CI publishing (built: `.github/workflows/catalog.yml`)

The publish pipeline is wired. `.github/workflows/catalog.yml` runs weekly, on a
change to the curation inputs / builder / schema, or on demand
(`workflow_dispatch`). Each run:

1. Builds the engine and runs the builder + isolation guard tests.
2. Seeds the regression baseline by fetching the currently live catalog from
   `config.catalog.url` into `os-code/build/catalog.json` (a first-run 404 is
   fine: no baseline means nothing to regress against).
3. Runs `pnpm --filter os-code build:catalog` (which reads that baseline as
   `previous`, gates, and overwrites it on success; a breach exits non-zero and
   publishes nothing, so the live catalog keeps serving).
4. Publishes by committing the result to the marketing repo at
   `src/static/os-code/catalog.json`. openshore.ai is a Cloudflare Pages site
   built from `OpenShore.ai-marketing-site`, whose Eleventy build passes
   `src/static` through to the site root, so that file is served at
   `openshore.ai/os-code/catalog.json`, which is exactly the default
   `config.catalog.url`. The Cloudflare Pages deploy ships it.
5. Always uploads the built catalog as a run artifact, so a no-publish run (no
   token, or an unchanged catalog) still leaves the output inspectable.

### The one secret the founder must add

- **`MARKETING_DEPLOY_TOKEN`** (repository secret on `openshore.code.ai`): a
  fine-grained personal access token scoped to `openshore-labs/OpenShore.ai-marketing-site`
  with **Contents: read and write**. Without it the job still builds and gates
  the catalog (and uploads the artifact) but skips the publish step. Nothing
  else needs wiring: `config.catalog.url` already points at the published URL.
  (This moved from `Open-Shore-LLC-Homepage` when OpenShore got its own
  standalone site at openshore.ai; the existing token is scoped to the old
  repo only, so a new one must be issued for the new repo.)

An initial `catalog.json` is committed in the marketing repo alongside this
change, so the URL is live from the first Cloudflare deploy without waiting for
a scheduled run.

## What else the founder must wire

- **Seed the curation files**: the committed `curation/*.json` are a working
  sample. Extend them as the roster grows.
- **A note on the commercial posture mirror**: the shipped license shape carries
  id and name but not the machine posture flag, so the client mirrors the
  allow-list postures in `app/src/components/marketplace.ts`. Keep the two in
  step when a license row changes.
