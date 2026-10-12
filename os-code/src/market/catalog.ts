// Catalog loading: remote manifest (configurable URL) with a local cache and
// the bundled sample as the always-works fallback. The curated feed is one of
// the surfaces the paid plan gates server-side; the client logic is the same
// either way.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_URL, CATALOG_URL_BEFORE_LIBRARY, type OscConfig } from '../config/schema.js';
import type { EgressPolicy } from '../core/security/egress.js';
import { oscHome } from '../config/load.js';
import { CatalogSchema, type Catalog, type CatalogModel } from './schema.js';
import { withLibrary } from './library.js';
import { fitsBudget, type ResourceBudget } from '../router/resourceBudget.js';
import { logger } from '../util/log.js';

const log = logger('catalog');

function cachePath(): string {
  return join(oscHome(), 'catalog.json');
}

/** The bundled sample ships next to package.json; find it from here. */
export function bundledCatalogPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', '..', 'catalog.sample.json'),
    join(here, '..', '..', '..', 'catalog.sample.json'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('The bundled catalog.sample.json is missing from the install.');
}

export interface LoadedCatalog {
  catalog: Catalog;
  source: 'remote' | 'cache' | 'bundled';
  note?: string;
}

/** The bundled sample, parsed once: the last resort, and the library a
 *  catalog from before the library borrows (withLibrary). */
let bundledCatalog: Catalog | undefined;
function bundled(): Catalog {
  bundledCatalog ??= CatalogSchema.parse(JSON.parse(readFileSync(bundledCatalogPath(), 'utf8')));
  return bundledCatalog;
}

/** Where the catalog is fetched from: the config's address, with the old
 *  default read as the new one (a config written before the library named
 *  it only because it was the default). */
export function catalogUrl(config: OscConfig): string {
  return config.catalog.url === CATALOG_URL_BEFORE_LIBRARY ? CATALOG_URL : config.catalog.url;
}

export async function loadCatalog(config: OscConfig, egress: EgressPolicy): Promise<LoadedCatalog> {
  const loaded = await loadCatalogFile(config, egress);
  return { ...loaded, catalog: withLibrary(loaded.catalog, bundled()) };
}

async function loadCatalogFile(config: OscConfig, egress: EgressPolicy): Promise<LoadedCatalog> {
  // Fresh cache wins: no network chatter on every browse.
  try {
    const stat = statSync(cachePath());
    const ageHours = (Date.now() - stat.mtimeMs) / 3_600_000;
    if (ageHours < config.catalog.refreshHours) {
      const catalog = CatalogSchema.parse(JSON.parse(readFileSync(cachePath(), 'utf8')));
      return { catalog, source: 'cache' };
    }
  } catch {}

  // Remote refresh.
  try {
    const res = await egress.fetch(catalogUrl(config), 'catalog', {
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/json' },
    });
    if (res.ok) {
      const catalog = CatalogSchema.parse(await res.json());
      mkdirSync(oscHome(), { recursive: true });
      writeFileSync(cachePath(), JSON.stringify(catalog, null, 2));
      return { catalog, source: 'remote' };
    }
    log.info('catalog fetch non-ok', { status: res.status });
  } catch (err) {
    log.info('catalog fetch failed', { err: String(err) });
  }

  // Stale cache beats bundled; bundled beats nothing.
  try {
    const catalog = CatalogSchema.parse(JSON.parse(readFileSync(cachePath(), 'utf8')));
    return {
      catalog,
      source: 'cache',
      note: 'Could not refresh the catalog; showing the cached copy.',
    };
  } catch {}
  return {
    catalog: bundled(),
    source: 'bundled',
    note: 'Showing the built-in starter catalog (offline or feed unreachable).',
  };
}

export type FitLabel = 'fits' | 'tight' | 'too-big';

export interface RatedModel {
  model: CatalogModel;
  fit: FitLabel;
}

/** Models rated against the machine, curated order preserved. */
export function rateModels(catalog: Catalog, budget: ResourceBudget): RatedModel[] {
  return [...catalog.models]
    .sort((a, b) => a.curation.rank - b.curation.rank)
    .map((model) => ({ model, fit: fitsBudget(model.sizeGB, budget) }));
}

export function findModel(catalog: Catalog, id: string): CatalogModel | undefined {
  return catalog.models.find((m) => m.id === id || m.source.ref === id);
}
