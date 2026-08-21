// Pure marketplace logic: search, sort, filter, and hardware fit. No React and
// no platform calls, so it is unit-tested directly. The screen renders what
// these functions return. The sort and filter contracts here define how a
// partial or old catalog still lands in a sensible curated order.
import type { CatalogModel } from 'os-code/protocol';
import type { CapabilityCategory } from 'os-code/protocol';
import { CAPABILITIES } from 'os-code/protocol';

// Browse axes. Three of these are honest, differently-sourced lenses on the
// same catalog: 'staff' is the editorial shortlist (chosen), 'popular' is the
// world's downloads/likes (counted, never quality), and 'used' is the user's
// OWN local turn counts (private, this machine only). 'recommended' stays the
// default, 'newest' and 'fit' are utility.
export type SortKey = 'recommended' | 'staff' | 'popular' | 'used' | 'newest' | 'fit';

export type FitLabel = 'fits' | 'tight' | 'too-big';

export type LicensePosture = 'commercial-ok' | 'non-commercial' | 'gated';

// The commercial posture per SPDX id, mirroring the builder's allow-list flags
// (scripts/build-catalog/licenses.table.ts). The builder is the authority; this
// is a presentation mirror, since the shipped license shape carries id and name
// but not the machine flag. An unknown id reads as gated (the honest default:
// we do not claim commercial freedom we cannot vouch for).
const LICENSE_POSTURE: Record<string, LicensePosture> = {
  'Apache-2.0': 'commercial-ok',
  MIT: 'commercial-ok',
  'BSD-3-Clause': 'commercial-ok',
  'CC-BY-4.0': 'commercial-ok',
  'CC-BY-NC-4.0': 'non-commercial',
  'Llama-3.1-Community': 'gated',
  'Llama-3.2-Community': 'gated',
  Gemma: 'gated',
};

export function licensePosture(model: CatalogModel): LicensePosture {
  return LICENSE_POSTURE[model.license.id] ?? 'gated';
}

export function licenseLabel(model: CatalogModel): string {
  const posture = licensePosture(model);
  const tail =
    posture === 'commercial-ok'
      ? 'commercial OK'
      : posture === 'non-commercial'
        ? 'non-commercial'
        : 'gated';
  return `${model.license.id}, ${tail}`;
}

// ---------------------------------------------------------------- hardware fit

// Mirrors src/router/resourceBudget.ts so the client speaks the same fit
// language as the engine, without importing the Node-only detection module.
export function comfortableModelGB(memoryGB: number): number {
  const fraction = memoryGB >= 24 ? 0.5 : memoryGB >= 16 ? 0.55 : 0.75;
  return Math.max(2, Math.floor(memoryGB * fraction));
}

export function fitFor(sizeGB: number, memoryGB: number): FitLabel {
  const needed = sizeGB * 1.2;
  const maxModelGB = comfortableModelGB(memoryGB);
  if (needed <= maxModelGB) return 'fits';
  if (needed <= maxModelGB * 1.35) return 'tight';
  return 'too-big';
}

// -------------------------------------------------------------------- search

/** A light subsequence fuzzy match: every query character appears in order.
 *  Case-insensitive, whitespace-insensitive on the query. */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return i === q.length;
}

/** The haystack for a model: name, id family, and tagline. */
export function searchText(model: CatalogModel): string {
  return `${model.name} ${model.id} ${model.tagline}`;
}

// -------------------------------------------------------------------- ratings

export function starIn(model: CatalogModel, cap: CapabilityCategory): number | undefined {
  return model.ratings?.perCapability?.[cap];
}

export function osCodeFit(model: CatalogModel): number | undefined {
  return model.ratings?.osCodeFit;
}

/** Popularity as a single sortable number. Downloads dominate; likes break ties.
 *  Labelled as popularity everywhere it surfaces, never as quality. Code
 *  defensively: the builder that populates this field is landing in parallel, so
 *  popularity may be undefined on any given model, and this returns undefined
 *  (which the sort sends last) rather than a fabricated zero. */
export function popularityScore(model: CatalogModel): number | undefined {
  const p = model.popularity;
  if (!p) return undefined;
  return p.downloads + p.likes * 50;
}

/** A compact, honest count for display: 1.2M, 3.4k, 920. Never rounds up to a
 *  friendlier lie. */
function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${n}`;
}

/** A plain-language popularity line for a card, or undefined when the model has
 *  no popularity data yet. Middle dot for the label/data pair (survives
 *  truncation, never reads as part of a count). Never presented as quality. */
export function popularityLabel(model: CatalogModel): string | undefined {
  const p = model.popularity;
  if (!p) return undefined;
  const src = p.source === 'huggingface' ? 'Hugging Face' : 'Ollama';
  return `${compactCount(p.downloads)} downloads · ${compactCount(p.likes)} likes on ${src}`;
}

/** The user's OWN local turn count for a model, or undefined if they have never
 *  run it. Matches on the catalog id first, then the pullable source ref, since
 *  the engine records turns under whichever name the stack was configured with.
 *  This is per-machine private usage; it is never cross-user data. */
export function usageTurns(model: CatalogModel, usage?: Map<string, number>): number | undefined {
  if (!usage) return undefined;
  return usage.get(model.id) ?? usage.get(model.source.ref);
}

function timestamp(model: CatalogModel): number | undefined {
  const raw = model.createdAt ?? model.updatedAt;
  if (!raw) return undefined;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? undefined : t;
}

// ---------------------------------------------------------------------- sort

// A comparator that always sends a missing value LAST, whatever the direction,
// with curation.rank as the stable tiebreaker. This is what keeps a partial or
// old catalog (no popularity, no timestamps) rendering in curated order instead
// of collapsing into an arbitrary heap.
function byValueThenRank(
  a: CatalogModel,
  b: CatalogModel,
  value: (m: CatalogModel) => number | undefined,
  direction: 'desc' | 'asc',
): number {
  const va = value(a);
  const vb = value(b);
  if (va === undefined && vb === undefined) return a.curation.rank - b.curation.rank;
  if (va === undefined) return 1; // a missing -> after b
  if (vb === undefined) return -1; // b missing -> after a
  if (va === vb) return a.curation.rank - b.curation.rank;
  return direction === 'desc' ? vb - va : va - vb;
}

export function sortModels(
  models: CatalogModel[],
  sort: SortKey,
  memoryGB: number,
  usageByModel?: Map<string, number>,
): CatalogModel[] {
  const list = [...models];
  switch (sort) {
    case 'recommended':
    case 'staff':
      // Recommended first, then curation.rank. Popularity never outranks the
      // curated order here: this is the default and the editorial voice. The
      // 'staff' axis reuses this ordering; the screen narrows its list to only
      // the picks (the opinionated shortlist), so what remains stays ranked.
      return list.sort((a, b) => {
        const ra = a.recommended?.isRecommended ? 0 : 1;
        const rb = b.recommended?.isRecommended ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return a.curation.rank - b.curation.rank;
      });
    case 'popular':
      return list.sort((a, b) => byValueThenRank(a, b, popularityScore, 'desc'));
    case 'used':
      // The user's own local usage: most-run first, models never run sent last
      // (undefined value), curation.rank breaking ties. Private, per-machine.
      return list.sort((a, b) => byValueThenRank(a, b, (m) => usageTurns(m, usageByModel), 'desc'));
    case 'newest':
      return list.sort((a, b) => byValueThenRank(a, b, timestamp, 'desc'));
    case 'fit':
      // Best fit first: prefer models that fit, then that are smaller, then
      // curated order. A too-big model sorts after a tight one.
      return list.sort((a, b) => {
        const rank = { fits: 0, tight: 1, 'too-big': 2 } as const;
        const fa = rank[fitFor(a.sizeGB, memoryGB)];
        const fb = rank[fitFor(b.sizeGB, memoryGB)];
        if (fa !== fb) return fa - fb;
        if (a.sizeGB !== b.sizeGB) return a.sizeGB - b.sizeGB;
        return a.curation.rank - b.curation.rank;
      });
  }
}

// -------------------------------------------------------------------- filters

export interface Facets {
  query: string;
  capability?: CapabilityCategory;
  fits: boolean; // runs on my machine (fits or tight)
  posture?: LicensePosture;
  maxSizeGB?: number;
  onDeviceOnly: boolean;
  orchestratorOnly: boolean;
  source?: 'ollama' | 'huggingface';
  /** Minimum star in the chosen capability (only meaningful with capability). */
  minStar?: number;
}

export const EMPTY_FACETS: Facets = {
  query: '',
  fits: false,
  onDeviceOnly: false,
  orchestratorOnly: false,
};

export function filterModels(
  models: CatalogModel[],
  facets: Facets,
  memoryGB: number,
): CatalogModel[] {
  return models.filter((m) => {
    if (facets.query && !fuzzyMatch(facets.query, searchText(m))) return false;
    if (facets.capability && !m.categories.includes(facets.capability)) return false;
    if (facets.fits && fitFor(m.sizeGB, memoryGB) === 'too-big') return false;
    if (facets.posture && licensePosture(m) !== facets.posture) return false;
    if (facets.maxSizeGB !== undefined && m.sizeGB > facets.maxSizeGB) return false;
    if (facets.onDeviceOnly && !m.onDevice) return false;
    if (facets.orchestratorOnly && !m.orchestratorCapable) return false;
    if (facets.source && m.source.kind !== facets.source) return false;
    if (facets.capability && facets.minStar !== undefined) {
      const s = starIn(m, facets.capability);
      if (s === undefined || s < facets.minStar) return false;
    }
    return true;
  });
}

export function activeFacetCount(facets: Facets): number {
  let n = 0;
  if (facets.capability) n++;
  if (facets.fits) n++;
  if (facets.posture) n++;
  if (facets.maxSizeGB !== undefined) n++;
  if (facets.onDeviceOnly) n++;
  if (facets.orchestratorOnly) n++;
  if (facets.source) n++;
  if (facets.minStar !== undefined && facets.capability) n++;
  return n;
}

// --------------------------------------------------------------- browse (store)
// The App-Store-style "Apps" front: a featured row and themed shelves the user
// scrolls, shown when nothing is being searched or filtered. Search or any facet
// falls back to the full sortable list. All of this is derived from the same
// catalog the list uses, so a shelf can never show a model the list would hide.

/** A two-letter wordmark for a model's glyph tile: the first two letters of the
 *  first word that starts with a letter ("Qwen 2.5" -> "Qw"). Distinct enough to
 *  read as a logo, stable across catalog refreshes. */
export function modelMonogram(name: string): string {
  const word = name.split(/\s+/).find((w) => /^[a-z]/i.test(w)) ?? name;
  const two = word.replace(/[^a-z]/gi, '').slice(0, 2) || name.slice(0, 2);
  return two.charAt(0).toUpperCase() + two.slice(1).toLowerCase();
}

/** The editorial title for a capability shelf. The taxonomy's plain labels are
 *  lowercase phrases ("great at code"); a shelf header wants sentence case. */
export function capabilityShelfTitle(cap: CapabilityCategory): string {
  const plain = CAPABILITIES[cap].plain;
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** The featured hero row. The founder's editorial picks lead; when the feed has
 *  none yet (a fresh or partial catalog), the top of the curated order stands in
 *  so the store is never empty. */
export function featuredModels(models: CatalogModel[], limit = 8): CatalogModel[] {
  const picks = models.filter((m) => m.recommended?.isRecommended);
  const base = picks.length ? picks : models;
  return [...base].sort((a, b) => a.curation.rank - b.curation.rank).slice(0, limit);
}

export interface Shelf {
  key: string;
  title: string;
  subtitle?: string;
  /** Tapping the shelf header opens the full list scoped to this capability. */
  capability?: CapabilityCategory;
  /** ...or to this sort axis, when the shelf is a lens rather than a category. */
  sort?: SortKey;
  models: CatalogModel[];
}

const SHELF_CAP_ORDER: CapabilityCategory[] = [
  'reasoning',
  'coding',
  'writing',
  'analysis',
  'vision',
  'image-gen',
  'embedding',
  'fast',
];

const SHELF_MIN = 3; // a shelf needs at least this many models to earn its row
const SHELF_MAX = 12; // and never scrolls past this many

/** Build the store's shelves from the catalog: pocket models first (when any
 *  exist), then the world's popular picks, then one shelf per capability that
 *  has enough models to fill a row. Overlap across shelves is intended, exactly
 *  as an app can sit in several App Store collections. */
export function buildShelves(models: CatalogModel[], memoryGB: number): Shelf[] {
  const shelves: Shelf[] = [];

  const pocket = sortModels(
    models.filter((m) => m.onDevice),
    'recommended',
    memoryGB,
  );
  if (pocket.length) {
    shelves.push({
      key: 'pocket',
      title: 'Runs on your phone',
      subtitle: 'Fully on-device, no desktop needed.',
      sort: 'recommended',
      models: pocket.slice(0, SHELF_MAX),
    });
  }

  const popular = sortModels(models, 'popular', memoryGB).filter(
    (m) => popularityScore(m) !== undefined,
  );
  if (popular.length >= SHELF_MIN) {
    shelves.push({
      key: 'popular',
      title: 'Popular right now',
      subtitle: 'What the world is downloading. Popularity, not quality.',
      sort: 'popular',
      models: popular.slice(0, SHELF_MAX),
    });
  }

  for (const cap of SHELF_CAP_ORDER) {
    const inCap = sortModels(
      models.filter((m) => m.categories.includes(cap)),
      'recommended',
      memoryGB,
    );
    if (inCap.length < SHELF_MIN) continue;
    shelves.push({
      key: `cap-${cap}`,
      title: capabilityShelfTitle(cap),
      subtitle: CAPABILITIES[cap].blurb,
      capability: cap,
      models: inCap.slice(0, SHELF_MAX),
    });
  }

  return shelves;
}
