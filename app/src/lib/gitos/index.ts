// gitOS: one seam, many homes for your bytes. This is the registry face of
// it: resolve a provider by id, and expose the roster the pickers render.
// "gitOS" is the internal system name; the user-facing surfaces are
// Repositories (code) and Vault (notes), per the CMO naming ruling.
import { localProvider } from './local.js';
import { PROVIDER_ROSTER, type StorageProvider, type StorageProviderId } from './providers.js';

export * from './providers.js';

const PROVIDERS_BY_ID: Partial<Record<StorageProviderId, StorageProvider>> = {
  local: localProvider,
};

/** The provider for an id, or undefined while its wiring is not landed.
 *  Callers must treat undefined as "not ready", never as an error to retry. */
export function providerFor(id: StorageProviderId): StorageProvider | undefined {
  return PROVIDERS_BY_ID[id];
}

/** Roster entries whose provider is live right now. */
export function readyProviders(): StorageProvider[] {
  return PROVIDER_ROSTER.filter((r) => r.ready)
    .map((r) => PROVIDERS_BY_ID[r.id])
    .filter((p): p is StorageProvider => Boolean(p));
}
