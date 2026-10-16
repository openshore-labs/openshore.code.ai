// The on-disk folder storage provider (desktop only). The vault is a real
// folder of markdown files on this computer, the SAME directory the agent's
// daemon tools write (~/OpenShore/Vault, or config vault.dir), so a note the agent
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
//
// Vault settings (Vault M7, tech review L7): `writeConfig` is one guarded IPC,
// osc:vaultWriteConfig, to main's `writeVaultConfigFile`, which makes
// `.oscode` if it is missing and writes `vault.json` through the jail without
// following a link. Only `oscode/vault` is ever sent.
import {
  VAULT_CONFIG_MAX_BYTES,
  isVaultConfigName,
  utf8Length,
  type ConfigRead,
  type VaultConfigName,
} from 'os-code/protocol';
import { bridge, type OscodeBridge, type VaultChange } from '../electronBridge.js';
import { platform } from '../platform.js';
import {
  VAULT_CAP_UPDATE_LINE,
  VAULT_SETTINGS_NAME_REFUSED,
  VAULT_SETTINGS_TOO_LARGE,
  VAULT_SETTINGS_WRITE_REFUSED,
} from '../vaultCopy.js';
import { asConfigRead } from './config.js';
import { makeFolderProvider, type FolderTransport } from './folderClient.js';
import { VAULT_SETTINGS_PATH } from './local.js';
import type { StorageProvider, StoredFile, WriteResult } from './providers.js';

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

/** The Vault M6 bridge calls (tech review K13), one IPC each. */
type M6Call =
  | 'vaultRename'
  | 'vaultFolders'
  | 'vaultFolderCreate'
  | 'vaultFolderRename'
  | 'vaultTrash'
  | 'vaultTrashList'
  | 'vaultTrashRestore'
  | 'vaultTrashEmpty'
  | 'vaultAttachments'
  | 'vaultReadBytes'
  | 'vaultOpenAttachment';

/** One M6 call, checked before use: main and this page ship together, so a
 *  missing call means a build out of step, said in plain words. */
function m6<K extends M6Call>(name: K): NonNullable<OscodeBridge[K]> {
  const b = fs();
  const f = b[name];
  if (typeof f !== 'function') throw new Error(VAULT_CAP_UPDATE_LINE);
  return (f as (...args: unknown[]) => unknown).bind(b) as NonNullable<OscodeBridge[K]>;
}

/** The Electron transport: each call is one guarded IPC to main, which jails
 *  the path to the vault folder and applies the note rule again. The guard
 *  travels as the third argument of osc:vaultWrite. The M6 members (rename,
 *  folders, Trash in `<vault>/.trash/<original path>`, attachments) are
 *  main's osc:vault* handlers over the same `folderFs` code the daemon
 *  serves (stream B), so This folder and Your computer behave alike. */
export const electronFolderTransport: FolderTransport = {
  list: () => fs().vaultList(),
  stat: (path) => fs().vaultStat(path),
  read: (path) => fs().vaultRead(path),
  write: (path, text, guard) =>
    guard ? fs().vaultWrite(path, text, guard) : fs().vaultWrite(path, text),
  remove: (path, guard) => (guard ? fs().vaultRemove(path, guard) : fs().vaultRemove(path)),
  rename: (from, to, guard) => m6('vaultRename')(from, to, guard),
  listFolders: () => m6('vaultFolders')(),
  createFolder: (path) => m6('vaultFolderCreate')(path),
  renameFolder: (from, to) => m6('vaultFolderRename')(from, to),
  trash: (target) => m6('vaultTrash')(target),
  listTrash: () => m6('vaultTrashList')(),
  restore: (id) => m6('vaultTrashRestore')(id),
  emptyTrash: (ids) => (ids ? m6('vaultTrashEmpty')(ids) : m6('vaultTrashEmpty')()),
  listAttachments: () => m6('vaultAttachments')(),
  readBytes: (path, opts) => (opts ? m6('vaultReadBytes')(path, opts) : m6('vaultReadBytes')(path)),
};

/** Open an attachment of the desktop vault in the system viewer (a PDF, an
 *  image): main jails the path and opens pdf and image extensions only.
 *  `{ ok: false }` off the desktop or when main refuses. */
export async function openDeviceAttachment(path: string): Promise<{ ok: boolean }> {
  const b = bridge();
  if (!isDeviceFolderAvailable() || typeof b?.vaultOpenAttachment !== 'function') {
    return { ok: false };
  }
  try {
    return { ok: (await b.vaultOpenAttachment(path))?.ok === true };
  } catch {
    return { ok: false };
  }
}

/** What main answers when it saves the vault index (the engine's
 *  VaultIndexSaveResult): it refuses anything over 32 MB. */
export type VaultIndexSaveAnswer = { ok: true; bytes: number } | { ok: false; reason: 'too-large' };

/** The bridge calls the Vault M3 index and config work adds (tech review H3, H5),
 *  one IPC each: osc:vaultIndexLoad, osc:vaultIndexSave, osc:vaultReadConfig.
 *  Main owns the file and the path (`oscHome()/vault-index/<key>.json`, the
 *  vault's config folder); the renderer sends only a blob or a logical name.
 *  Every one is optional and checked before use, so a desktop build whose
 *  main does not answer them yet keeps the index in memory and reads config
 *  as unsupported. */
export interface VaultM3Bridge {
  vaultIndexLoad?(): Promise<string | null>;
  vaultIndexSave?(blob: string): Promise<VaultIndexSaveAnswer>;
  vaultReadConfig?(name: VaultConfigName): Promise<ConfigRead>;
}

/** The index and config calls, when this is the desktop and main has them. */
export function vaultM3Bridge(): VaultM3Bridge | undefined {
  if (!isDeviceFolderAvailable()) return undefined;
  return bridge() as unknown as VaultM3Bridge | undefined;
}

const folderProvider = makeFolderProvider(electronFolderTransport, {
  id: 'files',
  label: 'This folder',
  blurb:
    'Plain .md files on this computer. Your agent writes here too, and Obsidian opens the folder.',
  ready: false,
  pending: 'Open OpenShore on your computer to keep the vault as a folder.',
});

export const deviceFolderProvider: StorageProvider = {
  ...folderProvider,
  // Main maps the name through its own allow-list, finds the config folder,
  // and reads the file through the jail; only a regular file is ever read.
  // The name is checked here too, so nothing else is ever sent.
  async readConfig(_resourceId, name: VaultConfigName): Promise<ConfigRead> {
    if (!isVaultConfigName(name)) return { ok: false, reason: 'refused' };
    const b = vaultM3Bridge();
    if (typeof b?.vaultReadConfig !== 'function') return { ok: false, reason: 'unsupported' };
    return asConfigRead(await b.vaultReadConfig(name));
  },

  // The settings sheet's write (L7). Main answers a ConfigWriteResult; a
  // conflict comes back as theirs, a refusal or a malformed answer throws in
  // plain words, and nothing is written twice.
  async writeConfig(_resourceId, name, text, guard): Promise<WriteResult> {
    if (name !== 'oscode/vault') throw new Error(VAULT_SETTINGS_NAME_REFUSED);
    if (utf8Length(text) > VAULT_CONFIG_MAX_BYTES) throw new Error(VAULT_SETTINGS_TOO_LARGE);
    const b = fs();
    if (typeof b.vaultWriteConfig !== 'function') throw new Error(VAULT_CAP_UPDATE_LINE);
    const exact = 'ifAbsent' in guard ? { ifAbsent: true as const } : { ifMatch: guard.ifMatch };
    return configWriteAnswer(await b.vaultWriteConfig(name, text, exact), text);
  },
};

/** The settings file as the seam carries it. */
function settingsFile(text: string, version: string): StoredFile {
  return { path: VAULT_SETTINGS_PATH, text, updatedAt: new Date().toISOString(), version };
}

/** Main's ConfigWriteResult as the seam's WriteResult, checked field by field
 *  (main and this page ship together, but a wrong shape must never read as
 *  saved). `text` is what was sent, the file's text on success. */
export function configWriteAnswer(r: unknown, text: string): WriteResult {
  const v = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
  if (v.ok === true && typeof v.version === 'string' && v.version) {
    return { ok: true, file: settingsFile(text, v.version) };
  }
  if (v.ok === false) {
    const c = v.conflict;
    if (c === 'changed' || c === 'missing' || c === 'exists' || c === 'downloading') {
      const cur = v.current as { text?: unknown; version?: unknown } | undefined;
      const theirs =
        c !== 'missing' && typeof cur?.text === 'string' && typeof cur.version === 'string'
          ? settingsFile(cur.text, cur.version)
          : undefined;
      return theirs ? { ok: false, conflict: c, theirs } : { ok: false, conflict: c };
    }
    if (v.reason === 'too-large') throw new Error(VAULT_SETTINGS_TOO_LARGE);
    if (v.reason === 'refused') throw new Error(VAULT_SETTINGS_WRITE_REFUSED);
  }
  throw new Error(VAULT_CAP_UPDATE_LINE);
}

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
