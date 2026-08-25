// gitOS: one seam, many homes for your bytes. This is the registry face of
// it: resolve a provider by id, and expose the roster the pickers render.
// "gitOS" is the internal system name; the user-facing surfaces are
// Repositories (code) and Vault (notes), per the CMO naming ruling.
import { localProvider } from './local.js';
import { icloudProvider, isIcloudAvailable } from './icloud.js';
import { gdriveProvider } from './gdrive.js';
import { isGdriveConnected } from './gdriveAuth.js';
import { orgVaultProvider, isOrgVaultAvailable } from './orgVault.js';
import { deviceFolderProvider, isDeviceFolderAvailable } from './deviceFolder.js';
import { PROVIDER_ROSTER, type StorageProvider, type StorageProviderId } from './providers.js';

export * from './providers.js';
export { isGdriveConfigured, connectGdrive, disconnectGdrive } from './gdriveAuth.js';
export { setOrgVaultAuth, isOrgVaultAvailable, resetOrgVault } from './orgVault.js';
export { isDeviceFolderAvailable } from './deviceFolder.js';

const PROVIDERS_BY_ID: Partial<Record<StorageProviderId, StorageProvider>> = {
  local: localProvider,
  files: deviceFolderProvider,
  icloud: icloudProvider,
  gdrive: gdriveProvider,
  org: orgVaultProvider,
};

/** The provider for an id, or undefined while its wiring is not landed.
 *  Callers must treat undefined as "not ready", never as an error to retry. */
export function providerFor(id: StorageProviderId): StorageProvider | undefined {
  return PROVIDERS_BY_ID[id];
}

/** Whether a provider is usable right now. Local always is; iCloud is decided
 *  at runtime by the device (signed in and provisioned); Google Drive by
 *  whether an account is connected; the rest are not wired yet. Never
 *  reports a provider ready that would fail on use. */
export async function probeReady(id: StorageProviderId): Promise<boolean> {
  if (id === 'local') return true;
  if (id === 'files') return isDeviceFolderAvailable();
  if (id === 'icloud') return isIcloudAvailable();
  if (id === 'gdrive') return isGdriveConnected();
  if (id === 'org') return isOrgVaultAvailable();
  return false;
}

/** Roster entries whose provider is usable right now, probed live. */
export async function readyProviderIds(): Promise<StorageProviderId[]> {
  const ids = PROVIDER_ROSTER.map((r) => r.id);
  const flags = await Promise.all(ids.map(probeReady));
  return ids.filter((_, i) => flags[i]);
}
