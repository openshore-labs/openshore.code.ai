// gitOS: one seam, many homes for your bytes. This is the registry face of
// it: resolve a provider by id, and expose the roster the pickers render.
// "gitOS" is the internal system name; the user-facing surfaces are
// Repositories (code) and Vault (notes), per the CMO naming ruling.
import { localProvider } from './local.js';
import { icloudProvider, isIcloudAvailable } from './icloud.js';
import { gdriveProvider } from './gdrive.js';
import { orgVaultProvider, isOrgVaultAvailable } from './orgVault.js';
import { deviceFolderProvider, isDeviceFolderAvailable } from './deviceFolder.js';
import { hubProvider, isHubAvailable } from './hub.js';
import { PROVIDER_ROSTER, type StorageProvider, type StorageProviderId } from './providers.js';

export * from './providers.js';
export {
  isGdriveConfigured,
  isGdriveConnected,
  connectGdrive,
  disconnectGdrive,
} from './gdriveAuth.js';
export {
  setOrgVaultAuth,
  isOrgVaultAvailable,
  resetOrgVault,
  orgVaultBaseRev,
  seedOrgVaultBaseRev,
} from './orgVault.js';
export {
  HUB_VAULT_RESOURCE_ID,
  HubAwayError,
  HubRefusal,
  createHubProvider,
  forgetHubStash,
  hubIndexTarget,
  hubPairPlan,
  hubPersonKey,
  hubReach,
  hubUnpairTarget,
  hubVaultLink,
  isHubAvailable,
  setHubVaultLink,
  subscribeHubReach,
  type HubPairPlan,
  type HubProvider,
  type HubProviderOptions,
  type HubReach,
} from './hub.js';
export {
  isDeviceFolderAvailable,
  onDeviceFolderChanged,
  watchDeviceFolder,
} from './deviceFolder.js';

const PROVIDERS_BY_ID: Partial<Record<StorageProviderId, StorageProvider>> = {
  local: localProvider,
  files: deviceFolderProvider,
  icloud: icloudProvider,
  gdrive: gdriveProvider,
  org: orgVaultProvider,
  hub: hubProvider,
};

/** The provider for an id, or undefined while its wiring is not landed.
 *  Callers must treat undefined as "not ready", never as an error to retry. */
export function providerFor(id: StorageProviderId): StorageProvider | undefined {
  return PROVIDERS_BY_ID[id];
}

/** Whether a provider can take a vault right now. Local always can; iCloud
 *  is decided at runtime by the device (signed in and provisioned); Your
 *  computer only while one is paired; the rest are not wired yet. Google Drive is held back for v1 (D1, 0.18): its
 *  conflict copy is undone by the next autosave, so it is never ready for a
 *  new vault, connected or not. A vault already there still lists and reads
 *  through providerFor and moves off through vaultMoveTo. Never reports a
 *  provider ready that would fail on use. */
export async function probeReady(id: StorageProviderId): Promise<boolean> {
  if (id === 'local') return true;
  if (id === 'files') return isDeviceFolderAvailable();
  if (id === 'icloud') return isIcloudAvailable();
  if (id === 'gdrive') return false;
  if (id === 'org') return isOrgVaultAvailable();
  // Your computer: ready only while one is paired (setHubVaultLink). Away,
  // it is still usable from what was kept, read-only, so reach does not
  // decide.
  if (id === 'hub') return isHubAvailable();
  return false;
}

/** Roster entries whose provider is usable right now, probed live. */
export async function readyProviderIds(): Promise<StorageProviderId[]> {
  const ids = PROVIDER_ROSTER.map((r) => r.id);
  const flags = await Promise.all(ids.map(probeReady));
  return ids.filter((_, i) => flags[i]);
}
