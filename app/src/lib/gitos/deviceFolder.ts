// The on-disk folder storage provider (desktop only). The vault is a real
// folder of markdown files on this computer, the SAME directory the agent's
// daemon tools write (~/OSCode/Vault, or config vault.dir), so a note the agent
// saves shows up here and a note you write here is one the agent can read. The
// actual filesystem work happens in the Electron main process behind the
// bridge; this provider is the shared folder client (folderClient.ts) over an
// Electron transport.
//
// There is one on-disk vault per machine, so this provider ignores resourceId
// and always addresses that folder. You, the agent, and Obsidian can all touch
// it, so every write carries a guard that main checks against the note's
// version (compare-and-swap, Vault M1 1.1): a save typed against an older
// version comes back as a conflict, never a silent overwrite.
import { bridge, type VaultChange } from '../electronBridge.js';
import { platform } from '../platform.js';
import { makeFolderProvider, type FolderTransport } from './folderClient.js';

/** Whether the on-disk folder vault is usable right now: the Electron file
 *  bridge is present (so, the desktop app, not the phone or a browser). */
export function isDeviceFolderAvailable(): boolean {
  return platform() === 'electron' && typeof bridge()?.vaultList === 'function';
}

function fs() {
  const b = bridge();
  if (!b || typeof b.vaultList !== 'function') {
    throw new Error('The on-disk vault is only available in OpenShore on your computer.');
  }
  return b;
}

/** The Electron transport: each call is one guarded IPC to main, which jails
 *  the path to the vault folder and applies the note rule again. The guard
 *  travels as the third argument of osc:vaultWrite. */
export const electronFolderTransport: FolderTransport = {
  list: () => fs().vaultList(),
  stat: (path) => fs().vaultStat(path),
  read: (path) => fs().vaultRead(path),
  write: (path, text, guard) =>
    guard ? fs().vaultWrite(path, text, guard) : fs().vaultWrite(path, text),
  remove: (path) => fs().vaultRemove(path),
};

export const deviceFolderProvider = makeFolderProvider(electronFolderTransport, {
  id: 'files',
  label: 'This folder',
  blurb:
    'Plain .md files on this computer. Your agent writes here too, and Obsidian opens the folder.',
  ready: false,
  pending: 'Open OpenShore on your computer to keep the vault as a folder.',
});

/** Turn the vault folder watcher on (with the open note's path, which Linux
 *  also watches the folder of) or off. A no-op off the desktop. Best effort:
 *  the watcher is a hint, and the room re-checks on focus anyway. */
export function watchDeviceFolder(on: boolean, openPath?: string): void {
  const b = bridge();
  if (!isDeviceFolderAvailable() || typeof b?.vaultWatch !== 'function') return;
  void b.vaultWatch(on, openPath).catch(() => {});
}

/** Listen for the changes the watcher saw. Returns an unsubscribe; a no-op
 *  off the desktop. */
export function onDeviceFolderChanged(cb: (change: VaultChange) => void): () => void {
  const b = bridge();
  if (!isDeviceFolderAvailable() || typeof b?.onVaultChanged !== 'function') return () => {};
  return b.onVaultChanged(cb);
}
