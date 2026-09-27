// The hub provider (Vault M5, CTO J9): the paired computer's one vault, over
// the daemon's /vault routes (os-code/protocol's vault wire) through
// nativeFetch, shown as "Your computer". Compare-and-swap replaces a lease.
//
// WAVE 0 CONTRACT. Built by stream G. Until then it is not registered in
// lib/gitos/index.ts (providerFor('hub') is undefined, probeReady('hub') is
// false), `hubIndexTarget` is real, and `createHubProvider` throws.
import type { VaultIndexTarget } from '../vaultIndexHost.js';
import type { StorageProvider } from './providers.js';

/** The resource id the hub's vault is addressed by. */
export const HUB_VAULT_RESOURCE_ID = 'vault';
/** What is kept sealed for out-of-reach reading (J9). */
export const HUB_STASH_MAX_NOTES = 200;
export const HUB_STASH_MAX_BYTES = 8 * 1024 * 1024;

export interface HubProviderOptions {
  /** The paired hub's base URL (`settings.daemon.baseUrl`). */
  baseUrl: string;
  /** The bearer this device pairs with. */
  token: () => Promise<string | undefined>;
  /** The hub's id for the signed-in person (admin, legacy shared token, or
   *  member), so two members never share an index or a stash. */
  hubUserId: string;
  /** Test seam; defaults to nativeFetch. */
  fetch?: typeof fetch;
}

/** The index target for a hub vault: one per hub and per person on it. */
export function hubIndexTarget(baseUrl: string, hubUserId: string): VaultIndexTarget {
  return {
    providerId: 'hub',
    resourceId: HUB_VAULT_RESOURCE_ID,
    owner: `${baseUrl.replace(/\/+$/, '')}#${hubUserId}`,
  };
}

/** The hub provider. `compareAndSwap: true`; no lease. Out of reach, the tree
 *  is read-only from the stash and an open cached note's save waits in the
 *  pending queue with its base version. */
export function createHubProvider(opts: HubProviderOptions): StorageProvider {
  void opts;
  throw new Error('The hub provider is not built yet (Vault M5, stream G).');
}

/** Whether the hub vault can be used now: paired and answering. False until
 *  stream G. */
export function isHubAvailable(): Promise<boolean> {
  return Promise.resolve(false);
}
