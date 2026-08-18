// Catalog loading per platform: the desktop engine's loader (remote feed,
// cache, bundled fallback) through the bridge; the daemon's copy from the
// phone; the bundled sample when fully standalone. Always something to show.
import { CatalogSchema, type Catalog } from 'os-code/protocol';
import bundled from 'os-code/catalog.sample.json';
import { bridge } from './electronBridge.js';
import { isDesktop } from './platform.js';
import type { DaemonTarget } from '../drivers/remoteDriver.js';

export interface LoadedCatalog {
  catalog: Catalog;
  note?: string;
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
  return {
    catalog: CatalogSchema.parse(bundled),
    note: 'Showing the built-in starter catalog.',
  };
}
