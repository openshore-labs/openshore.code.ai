// The on-disk folder storage provider (desktop only). The vault is a real
// folder of markdown files on this computer, the SAME directory the agent's
// daemon tools write (~/OSCode/Vault, or config vault.dir), so a note the agent
// saves shows up here and a note you write here is one the agent can read. The
// actual filesystem work happens in the Electron main process behind the
// bridge; this provider is a thin client over those IPC calls.
//
// There is one on-disk vault per machine, so this provider ignores resourceId
// and always addresses that folder. Concurrency is last-write-wins at the file
// level (you, the agent, and Obsidian can all touch it); fine for one person's
// machine, and the files are the single source of truth.
import { bridge } from '../electronBridge.js';
import { platform } from '../platform.js';
import type { Lease, StorageProvider, StoredFile, StoredFileMeta } from './providers.js';

/** Whether the on-disk folder vault is usable right now: the Electron file
 *  bridge is present (so, the desktop app, not the phone or a browser). */
export function isDeviceFolderAvailable(): boolean {
  return platform() === 'electron' && typeof bridge()?.vaultList === 'function';
}

function fs() {
  const b = bridge();
  if (!b || typeof b.vaultList !== 'function') {
    throw new Error('The on-disk vault is only available in the desktop app.');
  }
  return b;
}

export const deviceFolderProvider: StorageProvider = {
  id: 'files',
  label: 'This folder',
  blurb:
    'Plain .md files on this computer. Your agent writes here too, and Obsidian opens the folder.',
  ready: false,
  pending: 'Open OpenShore on your computer to keep the vault as a folder.',

  async list(): Promise<StoredFileMeta[]> {
    return fs().vaultList();
  },

  async stat(_resourceId, path): Promise<StoredFileMeta | undefined> {
    return (await fs().vaultList()).find((f) => f.path === path);
  },

  async read(_resourceId, path): Promise<StoredFile | undefined> {
    return (await fs().vaultRead(path)) ?? undefined;
  },

  async write(_resourceId, path, text): Promise<StoredFile> {
    return fs().vaultWrite(path, text);
  },

  async remove(_resourceId, path): Promise<void> {
    await fs().vaultRemove(path);
  },

  // The folder is shared with the agent and Obsidian, so there is no exclusive
  // lease to take: grant it and let the filesystem settle writes.
  async acquireLease(_resourceId, holder, ttlMs): Promise<Lease> {
    return { holder, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
  },

  async releaseLease(): Promise<void> {
    // Nothing held.
  },
};
