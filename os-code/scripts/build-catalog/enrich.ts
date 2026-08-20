// The pure build core: take the editorial seed plus the gathered inputs
// (metadata, benchmarks, evals, overlay) and produce the enriched catalog,
// dropping any model that does not clear the curated storefront gate. No
// filesystem, no network here, so the whole thing is unit-tested with
// fixtures. index.ts gathers the inputs and writes the output.
import { CatalogSchema, type Catalog, type CatalogModel } from '../../src/market/schema.js';
import type { CapabilityCategory } from '../../src/router/roles.js';
import { resolveLicense } from './licenses.table.js';
import { osCodeFitFromEval, rateModel } from './stars.js';
import type { BuildInputs, DropRecord } from './types.js';

// The curated storefront thresholds. An orchestrator earns its place on the
// eval bar; a specialist earns it on a strong benchmark-derived capability star.
export const MIN_ORCHESTRATOR_FIT = 3;
export const MIN_SPECIALIST_STAR = 3.5;

export interface EnrichResult {
  catalog: Catalog;
  drops: DropRecord[];
}

/** Build the enriched catalog from the seed and inputs. Every dropped model is
 *  recorded with a reason for the build log. */
export function enrichCatalog(inputs: BuildInputs): EnrichResult {
  const seed = CatalogSchema.parse(inputs.seed);
  const drops: DropRecord[] = [];
  const kept: CatalogModel[] = [];

  for (const base of seed.models) {
    const built = buildModel(base, inputs);
    if ('drop' in built) {
      drops.push({ id: base.id, reason: built.drop });
      continue;
    }
    kept.push(built.model);
  }

  // A preset survives only if every model it names survived the gate. A preset
  // that lost a member would render a broken stack, so it is dropped whole.
  const ids = new Set(kept.map((m) => m.id));
  const presets = seed.presets.filter((p) => {
    const refs = [p.stack.orchestrator, ...Object.values(p.stack.specialists)].filter(
      (r): r is string => typeof r === 'string' && r.length > 0,
    );
    return refs.every((r) => ids.has(r));
  });

  const today = new Date().toISOString().slice(0, 10);
  const built: Catalog = {
    version: seed.version,
    updated: today,
    models: kept,
    presets,
  };
  // P2-19: only advance `updated` when catalog content OTHER than `updated`
  // itself actually changed since the last publish. Stamping today's date on
  // every run makes the weekly refresh look like a change even when nothing
  // moved, which triggers a no-op bot commit + Pages deploy every week. Carry
  // the previous stamp forward on a true no-op.
  const catalog: Catalog = { ...built, updated: chooseUpdated(built, inputs.previous, today) };
  return { catalog, drops };
}

/** The date stamp to publish. Keeps the previous catalog's `updated` when the
 *  only thing that would change is the stamp itself; advances to `today` on any
 *  real content change or when there is no comparable previous catalog. */
function chooseUpdated(next: Catalog, previousRaw: unknown, today: string): string {
  if (previousRaw === undefined) return today;
  let prev: Catalog;
  try {
    prev = CatalogSchema.parse(previousRaw);
  } catch {
    // An unparseable previous catalog cannot be compared; treat as changed. (The
    // regression gate turns this same case into a breach, so nothing publishes.)
    return today;
  }
  return contentSignature(prev) === contentSignature(next) ? prev.updated : today;
}

/** A stable comparison key for a catalog with the `updated` stamp neutralized,
 *  so two catalogs that differ ONLY in `updated` compare equal. Both sides are
 *  schema-parsed first, so key order is normalized and the comparison holds
 *  regardless of how the previous catalog's JSON happened to be serialized. */
function contentSignature(catalog: Catalog): string {
  return JSON.stringify({ ...CatalogSchema.parse(catalog), updated: '' });
}

type BuildOutcome = { model: CatalogModel } | { drop: string };

function buildModel(base: CatalogModel, inputs: BuildInputs): BuildOutcome {
  // Gate 1, license fail-closed: id/name/url come ONLY from the allow-list. An
  // unmapped or missing license id drops the model. We never synthesize one.
  const licenseRow = resolveLicense(base.license.id);
  if (!licenseRow) {
    return { drop: `license "${base.license.id}" is not on the SPDX allow-list` };
  }

  // Gate 2, sourceable public download: a ref and a pull command, both present.
  if (!base.source.ref.trim() || !base.source.pullCommand.trim()) {
    return { drop: 'no sourceable public download (missing ref or pull command)' };
  }

  const overlay = inputs.overlay[base.id];

  // The human license note comes ONLY from the editorial overlay. The seed's
  // own note is not carried through: notes are editorial, not machine-derived.
  const license: CatalogModel['license'] = {
    id: licenseRow.id,
    name: licenseRow.name,
    ...(licenseRow.url ? { url: licenseRow.url } : {}),
    ...(overlay?.licenseNote ? { note: overlay.licenseNote } : {}),
  };

  // Ratings. osCodeFit needs a real eval report; without one there is no honest
  // fit to claim, so no ratings block is emitted. perCapability stars come from
  // published benchmarks, only for categories the model targets.
  const evalAvg = inputs.evals[base.id];
  const hasEval = typeof evalAvg === 'number' && Number.isFinite(evalAvg);
  const scores = inputs.benchmarks[base.id] ?? {};
  const capStars = rateModel(base.categories, scores);

  let ratings: CatalogModel['ratings'] | undefined;
  if (hasEval) {
    const perCapability: Partial<Record<CapabilityCategory, number>> = {};
    const provenance: Partial<Record<CapabilityCategory, [string, ...string[]]>> = {};
    for (const s of capStars) {
      perCapability[s.capability] = s.stars;
      provenance[s.capability] = s.provenance as [string, ...string[]];
    }
    ratings = { perCapability, osCodeFit: osCodeFitFromEval(evalAvg), provenance };
  }

  // Gate 3, quality: orchestrators clear on the eval bar, specialists on a
  // strong capability star. Either way the star is computed, never invented.
  const maxCapStar = capStars.reduce((m, s) => Math.max(m, s.stars), 0);
  const clearsQuality = base.orchestratorCapable
    ? hasEval && osCodeFitFromEval(evalAvg) >= MIN_ORCHESTRATOR_FIT
    : maxCapStar >= MIN_SPECIALIST_STAR;
  if (!clearsQuality) {
    return {
      drop: base.orchestratorCapable
        ? `orchestrator did not clear the eval bar (osCodeFit below ${MIN_ORCHESTRATOR_FIT}, or no eval report)`
        : `specialist did not clear the capability bar (no rated capability at ${MIN_SPECIALIST_STAR} or above)`,
    };
  }

  // Popularity and timestamps, from source metadata. Numbers only, labelled as
  // popularity (a sort input), never as quality.
  const meta = inputs.metadata[base.source.ref];
  const popularity =
    meta && (meta.downloads !== undefined || meta.likes !== undefined)
      ? { downloads: meta.downloads ?? 0, likes: meta.likes ?? 0, source: meta.source }
      : undefined;

  const recommended = overlay
    ? { isRecommended: overlay.isRecommended, ...(overlay.note ? { note: overlay.note } : {}) }
    : undefined;

  // An overlay rank overrides curation.rank, so the founder's editorial order is
  // what the default sort reads. The schema stores order in curation.rank, so
  // this is the schema-safe home for an editorial rank.
  const curation =
    overlay?.rank !== undefined ? { ...base.curation, rank: overlay.rank } : base.curation;

  const model: CatalogModel = {
    ...base,
    license,
    curation,
    ...(ratings ? { ratings } : {}),
    ...(popularity ? { popularity } : {}),
    ...(meta?.createdAt ? { createdAt: meta.createdAt } : {}),
    ...(meta?.lastModified ? { updatedAt: meta.lastModified } : {}),
    ...(recommended ? { recommended } : {}),
  };
  return { model };
}
