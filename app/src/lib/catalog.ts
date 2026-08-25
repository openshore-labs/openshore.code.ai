// Catalog loading per platform: the desktop engine's loader (remote feed,
// cache, bundled fallback) through the bridge; the daemon's copy from a paired
// phone; the published feed fetched directly when fully standalone; the bundled
// sample as the last resort. Always something to show, and on a standalone
// phone the storefront now carries the real ratings, popularity, and staff
// picks the published catalog holds (the bundled sample has none of those).
import { CatalogSchema, type Catalog } from 'os-code/protocol';
import bundled from 'os-code/catalog.sample.json';
import { bridge } from './electronBridge.js';
import { isDesktop, storeGetJson, storeSetJson } from './platform.js';
import { nativeFetch } from './nativeFetch.js';
import type { DaemonTarget } from '../drivers/remoteDriver.js';

export interface LoadedCatalog {
  catalog: Catalog;
  note?: string;
}

// The same feed the desktop engine defaults to (config.catalog.url). Cloudflare
// Pages serves it with no CORS headers, so the fetch goes through nativeFetch
// (native URLSession on iOS) rather than a WebView fetch the origin would block.
const PUBLISHED_CATALOG_URL = 'https://openshore.ai/os-code/catalog.json';
const CATALOG_CACHE_KEY = 'oscode.cache.catalog.v1';
// Mirrors the engine's config.catalog.refreshHours default (24h).
const REFRESH_MS = 24 * 60 * 60 * 1000;

interface CachedCatalog {
  catalog: unknown;
  fetchedAt: number;
}

export async function loadAppCatalog(daemon?: DaemonTarget): Promise<LoadedCatalog> {
  if (isDesktop() && bridge()) {
    try {
      return await bridge()!.catalog();
    } catch {}
  }
  if (daemon) {
    try {
      const res = await fetch(`${daemon.baseUrl}/catalog`, {
        headers: { authorization: `Bearer ${daemon.token}` },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const body = (await res.json()) as { catalog: unknown; note?: string };
        return { catalog: CatalogSchema.parse(body.catalog), note: body.note };
      }
    } catch {}
  }
  // Standalone (or the daemon was unreachable): serve the published feed
  // directly, cached in Preferences so a later open is instant and an offline
  // open still shows the last good catalog.
  return loadPublishedCatalog();
}

async function loadPublishedCatalog(): Promise<LoadedCatalog> {
  const cached = await readCache();
  if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) {
    const parsed = safeParse(cached.catalog);
    if (parsed) return { catalog: parsed };
  }

  try {
    const res = await nativeFetch(PUBLISHED_CATALOG_URL, { responseType: 'json' });
    if (res.ok) {
      const catalog = CatalogSchema.parse(await res.json());
      await storeSetJson(CATALOG_CACHE_KEY, { catalog, fetchedAt: Date.now() } as CachedCatalog);
      return { catalog };
    }
  } catch {}

  // The fetch failed or answered non-2xx. A stale cache still beats the bundled
  // starter, so fall back to it (with an honest note) before the bundle.
  if (cached) {
    const parsed = safeParse(cached.catalog);
    if (parsed)
      return { catalog: parsed, note: 'Showing the last saved catalog. Reconnect to refresh.' };
  }
  return {
    catalog: CatalogSchema.parse(bundled),
    note: 'Showing the built-in starter catalog.',
  };
}

async function readCache(): Promise<CachedCatalog | undefined> {
  try {
    const raw = await storeGetJson<CachedCatalog>(CATALOG_CACHE_KEY);
    if (raw && typeof raw.fetchedAt === 'number' && raw.catalog) return raw;
  } catch {}
  return undefined;
}

function safeParse(value: unknown): Catalog | undefined {
  const result = CatalogSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
