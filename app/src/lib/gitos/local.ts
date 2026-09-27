// The Local storage provider: this device, through the app's existing sealed
// key-value store, so vault bytes are encrypted at rest under the device DEK
// exactly like chats and settings. Per-path keys keep each write atomic (the
// platform store replaces a key's value whole), and a per-resource index doc
// makes list() cheap without reading every body.
//
// Layout in the store:
//   oscode.gitos.index.<resourceId>            -> { files: StoredFileMeta[] }
//   oscode.gitos.file.<resourceId>.<path>      -> { text, updatedAt, v? }
//   oscode.gitos.lease.<resourceId>            -> Lease
//   oscode.gitos.trash.<resourceId>.<id>       -> TrashDoc (Vault M6, CTO K6)
//   oscode.gitos.trashlist.<resourceId>        -> { entries: TrashEntry[] }
//
// Compare-and-swap (Vault M2 2.1, CTO G1). A note's version is `v`, a random
// token made fresh on every write and kept in the body. It is compared with
// === only. Not updatedAt, since two writes can land in one millisecond; not
// a counter, since a delete and a re-create would start it over and an old
// draft would match a different note. A body written before M2 has no `v`,
// and its version is its updatedAt, exactly what versionOf answered in M1, so
// every draft stashed or open then stays valid. The body is the truth; the
// index is a list hint, written after the body, so it can never claim a
// version the body does not have.
//
// Rename and Trash (Vault M6, CTO K3, K6). A rename is a key move inside the
// same chain that keeps the body whole, `v` included, so the version at the
// new name is the version the note had. Trash moves a body (or every body
// under a folder) into one sealed trash key with its `v`, so a restore puts
// back the same version; a taken name comes back beside it as
// "{title} (restored)" (R3). Each step writes the new key before it deletes
// the old one, so a crash between them leaves two copies, never none.
// Folders are not stored here: they are the paths the tree derives, so this
// provider has no listFolders, createFolder or renameFolder (K5 keeps an empty
// folder in device settings and renames a folder note by note), and it keeps
// notes only, so no attachments.
//
// Vault settings (Vault M7, CTO L7, L16). The vault's own settings are one
// sealed key (`oscode.gitos.config.<resourceId>.vault`), a body like a
// note's, with its own fresh `v` on every write. `writeConfig` is the
// settings sheet's compare-and-swap write, in the same chain as the notes.
// No note path reaches it: a write under any dot folder (`.oscode/`,
// `.obsidian/`) is refused (L8), so a model's write can never pose as the
// settings file.
import {
  VAULT_CONFIG_MAX_BYTES,
  foldPath,
  isAgentWritablePath,
  isVaultConfigName,
  utf8Length,
  type ConfigRead,
  type VaultConfigName,
  type VaultSettingsConfigName,
} from 'os-code/protocol';
import { storeDelete, storeGetJson, storeKeys, storeSetJson } from '../platform.js';
import {
  VAULT_SETTINGS_NAME_REFUSED,
  VAULT_SETTINGS_TOO_LARGE,
  vaultDotPathLine,
  vaultNotFolderLine,
} from '../vaultCopy.js';
import { asConfigRead } from './config.js';
import { isVaultFolderPath } from './folderClient.js';
import {
  VAULT_SETTINGS_PATH,
  isNotePath,
  restoredPath,
  type Lease,
  type RemoveGuard,
  type RemoveResult,
  type RenameGuard,
  type RenameResult,
  type RestoreResult,
  type StorageProvider,
  type StoredFile,
  type StoredFileMeta,
  type TrashEntry,
  type TrashResult,
  type TrashTarget,
  type WriteGuard,
  type WriteResult,
} from './providers.js';

// Shared with the team vault (lib/gitos/providers.ts), kept importable here.
export { VAULT_SETTINGS_PATH, restoredPath };

const indexKey = (resourceId: string) => `oscode.gitos.index.${resourceId}`;
const filePrefix = (resourceId: string) => `oscode.gitos.file.${resourceId}.`;
const fileKey = (resourceId: string, path: string) => `${filePrefix(resourceId)}${path}`;
const leaseKey = (resourceId: string) => `oscode.gitos.lease.${resourceId}`;
/** The vault's own config (`oscode/vault`), sealed like a note body; only
 *  `writeConfig` writes it (Vault M7). */
const configKey = (resourceId: string) => `oscode.gitos.config.${resourceId}.vault`;
const trashPrefix = (resourceId: string) => `oscode.gitos.trash.${resourceId}.`;
const trashKey = (resourceId: string, id: string) => `${trashPrefix(resourceId)}${id}`;
const trashListKey = (resourceId: string) => `oscode.gitos.trashlist.${resourceId}`;

interface IndexDoc {
  files: StoredFileMeta[];
}

async function readIndex(resourceId: string): Promise<IndexDoc> {
  return (await storeGetJson<IndexDoc>(indexKey(resourceId))) ?? { files: [] };
}

interface Body {
  text: string;
  updatedAt: string;
  /** The version token; absent on a body written before M2. */
  v?: string;
}

/** A body's version: its token, or its updatedAt when written before M2. */
const verOf = (b: Body): string => b.v ?? b.updatedAt;

/** Body size in bytes, as the seam says, not UTF-16 code units. */
const byteSize = (text: string): number => new TextEncoder().encode(text).length;

/** A fresh version token. The fallback keeps it random where randomUUID is
 *  missing (an insecure context), never a clock or a counter. */
function newVersion(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function readBody(resourceId: string, path: string): Promise<Body | undefined> {
  const body = await storeGetJson<Body>(fileKey(resourceId, path));
  return typeof body?.text === 'string' ? body : undefined;
}

const metaOf = (path: string, b: Body): StoredFileMeta => ({
  path,
  updatedAt: b.updatedAt,
  size: byteSize(b.text),
  version: verOf(b),
});

/** A body's own fields and nothing else, `v` only when it has one. */
const keepBody = (b: Body): Body => ({
  text: b.text,
  updatedAt: b.updatedAt,
  ...(b.v !== undefined ? { v: b.v } : {}),
});

const fileOf = (path: string, b: Body): StoredFile => ({
  path,
  text: b.text,
  updatedAt: b.updatedAt,
  version: verOf(b),
});

const byPath = (files: StoredFileMeta[]) => files.sort((a, b) => a.path.localeCompare(b.path));

// One promise chain per resource (data-8). A write is a body write and then a
// read-modify-write of the index, and the sealed store awaits between them, so
// two unchained writes each read the same index and the later one drops the
// other's entry: the bytes stay, but the note never lists again. Every write,
// remove, and index rebuild runs in this chain, one after another. Reading a
// body does not need to.
const indexChains = new Map<string, Promise<unknown>>();

function chained<T>(resourceId: string, fn: () => Promise<T>): Promise<T> {
  const prev = indexChains.get(resourceId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  indexChains.set(resourceId, run);
  run
    .finally(() => {
      if (indexChains.get(resourceId) === run) indexChains.delete(resourceId);
    })
    .catch(() => {});
  return run;
}

/** The index with every orphaned note put back: a body stored under this
 *  resource's key prefix with no index entry (a write cut off between its two
 *  steps, or one an earlier unchained race dropped). The scan lists key names
 *  and reads only the orphans, then writes the rebuilt index back. Best
 *  effort: when the keys cannot be listed, the index stands as it is, and
 *  when the write-back fails (the store is full, the usual way an orphan is
 *  made) the orphans still list this time and the write is tried again on
 *  the next list. Runs in the chain, since it may rewrite the index. */
async function recoveredIndex(resourceId: string): Promise<IndexDoc> {
  const index = await readIndex(resourceId);
  const prefix = filePrefix(resourceId);
  let keys: string[];
  try {
    keys = await storeKeys(prefix);
  } catch {
    return index;
  }
  const known = new Set(index.files.map((f) => f.path));
  const orphans: StoredFileMeta[] = [];
  for (const key of keys) {
    const path = key.slice(prefix.length);
    if (known.has(path) || !isNotePath(path)) continue;
    const body = await storeGetJson<Body>(key).catch(() => undefined);
    if (typeof body?.text !== 'string') continue;
    orphans.push(metaOf(path, body));
  }
  if (!orphans.length) return index;
  const files = byPath([...index.files, ...orphans]);
  try {
    await storeSetJson(indexKey(resourceId), { files });
  } catch {
    // Retried on the next list; a full store must not stop the vault listing.
  }
  return { files };
}

// ---- Vault M6: rename and Trash helpers (run inside the chain) -------------

/** One note as Trash keeps it: the body whole, `v` included. */
interface TrashedNote extends Body {
  path: string;
}

/** A trash key's value. A note is K6's `{ path, text, updatedAt, v,
 *  trashedAt }`; a folder keeps every note that was under it. */
type TrashDoc =
  | ({ kind: 'note'; trashedAt: string } & TrashedNote)
  | { kind: 'folder'; path: string; trashedAt: string; notes: TrashedNote[] };

interface TrashListDoc {
  entries: TrashEntry[];
}

const notesOf = (doc: TrashDoc): TrashedNote[] =>
  doc.kind === 'folder'
    ? doc.notes
    : [{ path: doc.path, text: doc.text, updatedAt: doc.updatedAt, v: doc.v }];

function entryOf(id: string, doc: TrashDoc): TrashEntry {
  return {
    id,
    path: doc.path,
    kind: doc.kind,
    size: notesOf(doc).reduce((n, b) => n + byteSize(b.text), 0),
    trashedAt: doc.trashedAt,
  };
}

function isTrashDoc(v: unknown): v is TrashDoc {
  const d = v as Partial<TrashDoc> | null;
  if (typeof d !== 'object' || d === null || typeof d.path !== 'string') return false;
  if (d.kind === 'note') return typeof (d as { text?: unknown }).text === 'string';
  return d.kind === 'folder' && Array.isArray((d as { notes?: unknown }).notes);
}

const newestFirst = (entries: TrashEntry[]) =>
  entries.sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''));

/** The Trash list with any orphaned trash key put back (a trash cut off
 *  between its key and the list), the way recoveredIndex does for notes. */
async function recoveredTrash(resourceId: string): Promise<TrashListDoc> {
  const listed = (await storeGetJson<TrashListDoc>(trashListKey(resourceId)))?.entries ?? [];
  const prefix = trashPrefix(resourceId);
  let keys: string[];
  try {
    keys = (await storeKeys(prefix)).filter((k) => k.startsWith(prefix));
  } catch {
    return { entries: listed };
  }
  const known = new Set(listed.map((e) => e.id));
  const found: TrashEntry[] = [];
  for (const key of keys) {
    const id = key.slice(prefix.length);
    if (known.has(id)) continue;
    const doc = await storeGetJson<unknown>(key).catch(() => undefined);
    if (isTrashDoc(doc)) found.push(entryOf(id, doc));
  }
  if (!found.length) return { entries: listed };
  const entries = newestFirst([...listed, ...found]);
  await storeSetJson(trashListKey(resourceId), { entries }).catch(() => {});
  return { entries };
}

/** The note that has `path` by the folded rule (case and NFC), or undefined:
 *  the exact key first, then any listed note that folds the same. `except`
 *  is a path that does not count (the source of a case-only rename). */
async function takenAt(
  resourceId: string,
  files: StoredFileMeta[],
  path: string,
  except?: string,
): Promise<StoredFile | undefined> {
  if (path !== except) {
    const exact = await readBody(resourceId, path);
    if (exact) return fileOf(path, exact);
  }
  const folded = foldPath(path);
  for (const f of files) {
    if (f.path === except || foldPath(f.path) !== folded) continue;
    const body = await readBody(resourceId, f.path);
    if (body) return fileOf(f.path, body);
  }
  return undefined;
}

/** Where a trashed note comes back: its own path while free, else beside it. */
async function restoreTarget(
  resourceId: string,
  files: StoredFileMeta[],
  path: string,
): Promise<string | undefined> {
  if (!(await takenAt(resourceId, files, path))) return path;
  for (let n = 1; n <= 99; n++) {
    const beside = restoredPath(path, n);
    if (!(await takenAt(resourceId, files, beside))) return beside;
  }
  return undefined;
}

export const localProvider: StorageProvider = {
  id: 'local',
  label: 'This device',
  blurb: 'Stored here, sealed at rest. Private by construction.',
  ready: true,
  compareAndSwap: true,

  async list(resourceId) {
    const { files } = await chained(resourceId, () => recoveredIndex(resourceId));
    return files.filter((f) => isNotePath(f.path));
  },

  // A create and a draft replay ask stat whether bytes live at a path before
  // they write there, so it answers from the body itself, the source of
  // truth, not the filtered list: a hidden legacy note (".NET migration.md",
  // stored before 0.6) or an orphan the index lost must read as there, or the
  // write that follows empties it. It never touches the index, so a full
  // store cannot make it throw.
  async stat(resourceId, path) {
    const body = await readBody(resourceId, path);
    return body ? metaOf(path, body) : undefined;
  },

  async read(resourceId, path) {
    const body = await readBody(resourceId, path);
    return body ? fileOf(path, body) : undefined;
  },

  // The guard is checked against the BODY, inside the per-resource chain, so
  // nothing can land between the check and the write: Electron holds a single
  // instance lock and Capacitor runs one WebView, so this chain really does
  // serialize every writer. Body first, then the index entry. A crash between
  // the two leaves a stale list version, and the recheck corrects it because
  // it reads the body through stat.
  async write(resourceId, path, text, guard?: WriteGuard): Promise<WriteResult> {
    if (!isAgentWritablePath(path)) throw new Error(vaultDotPathLine(path));
    return chained(resourceId, async () => {
      if (guard) {
        const current = await readBody(resourceId, path);
        if ('ifAbsent' in guard) {
          if (current) {
            return {
              ok: false as const,
              conflict: 'exists' as const,
              theirs: fileOf(path, current),
            };
          }
        } else if (!current) {
          return { ok: false as const, conflict: 'missing' as const };
        } else if (verOf(current) !== guard.ifMatch) {
          return {
            ok: false as const,
            conflict: 'changed' as const,
            theirs: fileOf(path, current),
          };
        }
      }
      const body: Body = { text, updatedAt: new Date().toISOString(), v: newVersion() };
      await storeSetJson(fileKey(resourceId, path), body);
      const index = await readIndex(resourceId);
      const files = byPath([...index.files.filter((f) => f.path !== path), metaOf(path, body)]);
      await storeSetJson(indexKey(resourceId), { files });
      return { ok: true as const, file: fileOf(path, body) };
    });
  },

  // Same chain and order as write: read the body, compare, delete the body,
  // then fix the index. A note already gone is ok; the person wanted it gone.
  async remove(resourceId, path, guard?: RemoveGuard): Promise<RemoveResult> {
    return chained(resourceId, async () => {
      if (guard) {
        const current = await readBody(resourceId, path);
        if (current && verOf(current) !== guard.ifMatch) {
          return {
            ok: false as const,
            conflict: 'changed' as const,
            theirs: fileOf(path, current),
          };
        }
      }
      await storeDelete(fileKey(resourceId, path));
      const index = await readIndex(resourceId);
      await storeSetJson(indexKey(resourceId), {
        files: index.files.filter((f) => f.path !== path),
      });
      return { ok: true as const };
    });
  },

  // ---- Vault M6 (CTO K3, K6) ------------------------------------------------

  // A key move in the chain: the source's version is checked against its
  // body, the new name must be free by the folded rule (a case-only rename of
  // the same note is allowed), and the body moves whole, so `v` holds.
  async rename(resourceId, from, to, guard: RenameGuard): Promise<RenameResult> {
    if (!isNotePath(from))
      throw new Error(`"${from}" is not a note, so the vault does not move it.`);
    if (!isNotePath(to)) throw new Error(`"${to}" is not a note name the vault can use.`);
    return chained(resourceId, async (): Promise<RenameResult> => {
      const src = await readBody(resourceId, from);
      if (!src) return { ok: false, conflict: 'missing' };
      if (verOf(src) !== guard.ifMatch) {
        return { ok: false, conflict: 'changed', theirs: fileOf(from, src) };
      }
      if (from === to) return { ok: true, file: metaOf(to, src) };
      // The recovered index, so an orphaned body still holds its name.
      const index = await recoveredIndex(resourceId);
      const theirs = await takenAt(resourceId, index.files, to, from);
      if (theirs) return { ok: false, conflict: 'exists', theirs };
      await storeSetJson(fileKey(resourceId, to), src);
      await storeDelete(fileKey(resourceId, from));
      const files = byPath([
        ...index.files.filter((f) => f.path !== from && f.path !== to),
        metaOf(to, src),
      ]);
      await storeSetJson(indexKey(resourceId), { files });
      return { ok: true, file: metaOf(to, src) };
    });
  },

  // A note is guarded by its version; a folder is every note under it, moved
  // as it is (Trash is recoverable). The trash key is written first, then the
  // bodies go, then the index and the Trash list. A note gone since it was
  // read answers `changed` with no theirs, as a stale remove would. A folder
  // with no notes here (an empty folder is device settings, K5) moves
  // nothing and lists nothing.
  async trash(resourceId, target: TrashTarget): Promise<TrashResult> {
    if (target.kind === 'note' && !isNotePath(target.path)) {
      throw new Error(`"${target.path}" is not a note, so the vault does not move it.`);
    }
    if (target.kind === 'folder' && !isVaultFolderPath(target.path)) {
      throw new Error(vaultNotFolderLine(target.path));
    }
    return chained(resourceId, async (): Promise<TrashResult> => {
      const trashedAt = new Date().toISOString();
      const id = newVersion();
      let doc: TrashDoc;
      if (target.kind === 'note') {
        const body = await readBody(resourceId, target.path);
        if (!body) return { ok: false, conflict: 'changed' };
        if (verOf(body) !== target.ifMatch) {
          return { ok: false, conflict: 'changed', theirs: fileOf(target.path, body) };
        }
        doc = { kind: 'note', path: target.path, trashedAt, ...keepBody(body) };
      } else {
        const under = `${target.path}/`;
        const { files } = await recoveredIndex(resourceId);
        const notes: TrashedNote[] = [];
        for (const f of files) {
          if (!f.path.startsWith(under)) continue;
          const body = await readBody(resourceId, f.path);
          if (body) notes.push({ path: f.path, ...keepBody(body) });
        }
        doc = { kind: 'folder', path: under.slice(0, -1), trashedAt, notes };
        if (!notes.length) return { ok: true, entry: entryOf(id, doc), notes: 0, attachments: 0 };
      }
      await storeSetJson(trashKey(resourceId, id), doc);
      const gone = new Set(notesOf(doc).map((n) => n.path));
      for (const path of gone) await storeDelete(fileKey(resourceId, path));
      const index = await readIndex(resourceId);
      await storeSetJson(indexKey(resourceId), {
        files: index.files.filter((f) => !gone.has(f.path)),
      });
      const entry = entryOf(id, doc);
      const list = await recoveredTrash(resourceId);
      await storeSetJson(trashListKey(resourceId), {
        entries: newestFirst([entry, ...list.entries.filter((e) => e.id !== id)]),
      });
      return { ok: true, entry, notes: gone.size, attachments: 0 };
    });
  },

  async listTrash(resourceId): Promise<TrashEntry[]> {
    return (await chained(resourceId, () => recoveredTrash(resourceId))).entries.map((e) => ({
      ...e,
    }));
  },

  // Never overwrites: each note goes back to its own path while that is free
  // (folded), else beside it as "{title} (restored)". The body keeps its `v`,
  // so a restored note is the same version it was. Bodies first, then the
  // index, then the trash key and the list.
  async restore(resourceId, id): Promise<RestoreResult> {
    return chained(resourceId, async (): Promise<RestoreResult> => {
      const doc = await storeGetJson<unknown>(trashKey(resourceId, id)).catch(() => undefined);
      if (!isTrashDoc(doc) || !notesOf(doc).length) {
        const list = await recoveredTrash(resourceId);
        if (list.entries.some((e) => e.id === id)) {
          await storeSetJson(trashListKey(resourceId), {
            entries: list.entries.filter((e) => e.id !== id),
          });
        }
        return { ok: false, conflict: 'missing' };
      }
      const index = await recoveredIndex(resourceId);
      const files = [...index.files];
      let first: StoredFileMeta | undefined;
      let renamed = false;
      for (const note of notesOf(doc)) {
        const at =
          (await restoreTarget(resourceId, files, note.path)) ??
          restoredPath(note.path, 100 + files.length);
        const body: Body = keepBody(note);
        await storeSetJson(fileKey(resourceId, at), body);
        const meta = metaOf(at, body);
        const i = files.findIndex((f) => f.path === at);
        if (i >= 0) files.splice(i, 1);
        files.push(meta);
        first ??= meta;
        if (at !== note.path) renamed = true;
      }
      await storeSetJson(indexKey(resourceId), { files: byPath(files) });
      await storeDelete(trashKey(resourceId, id));
      const list = await recoveredTrash(resourceId);
      await storeSetJson(trashListKey(resourceId), {
        entries: list.entries.filter((e) => e.id !== id),
      });
      return { ok: true, file: first!, renamed };
    });
  },

  // For good: the entries named, or all of Trash. `removed` counts entries.
  async emptyTrash(resourceId, ids?: string[]): Promise<{ removed: number }> {
    return chained(resourceId, async () => {
      const list = await recoveredTrash(resourceId);
      const wanted = ids ? new Set(ids) : undefined;
      const going = list.entries.filter((e) => !wanted || wanted.has(e.id));
      for (const e of going) await storeDelete(trashKey(resourceId, e.id));
      const gone = new Set(going.map((e) => e.id));
      await storeSetJson(trashListKey(resourceId), {
        entries: list.entries.filter((e) => !gone.has(e.id)),
      });
      return { removed: going.length };
    });
  },

  // On this device there is exactly one writer, so the lease grants (or
  // renews) unless a DIFFERENT live holder already has it, which only happens
  // if a stale record survived a crash; the TTL clears that on its own.
  async acquireLease(resourceId, holder, ttlMs) {
    const now = Date.now();
    const current = await storeGetJson<Lease>(leaseKey(resourceId));
    if (current && current.holder !== holder && new Date(current.expiresAt).getTime() > now) {
      return current;
    }
    const lease: Lease = { holder, expiresAt: new Date(now + ttlMs).toISOString() };
    await storeSetJson(leaseKey(resourceId), lease);
    return lease;
  },

  async releaseLease(resourceId, holder) {
    const current = await storeGetJson<Lease>(leaseKey(resourceId));
    if (current?.holder === holder) await storeDelete(leaseKey(resourceId));
  },

  // This device holds no Obsidian folder, so every obsidian/* name is absent
  // by design. The vault's own config is one sealed key, stored like a note
  // body (text and a version).
  async readConfig(resourceId, name: VaultConfigName): Promise<ConfigRead> {
    if (!isVaultConfigName(name)) return { ok: false, reason: 'refused' };
    if (name !== 'oscode/vault') return { ok: false, reason: 'absent' };
    const body = await readConfigBody(resourceId);
    if (!body) return { ok: false, reason: 'absent' };
    return asConfigRead({ ok: true, text: body.text, version: verOf(body) });
  },

  // ---- Vault M7 (CTO L7, L16) ------------------------------------------------

  // The settings sheet's write, the note write's contract on the sealed key:
  // the guard is checked against the stored body inside the chain, a conflict
  // hands back theirs and leaves it, and every write makes a fresh `v`.
  async writeConfig(
    resourceId,
    name: VaultSettingsConfigName,
    text: string,
    guard: WriteGuard,
  ): Promise<WriteResult> {
    if (name !== 'oscode/vault') throw new Error(VAULT_SETTINGS_NAME_REFUSED);
    if (utf8Length(text) > VAULT_CONFIG_MAX_BYTES) throw new Error(VAULT_SETTINGS_TOO_LARGE);
    return chained(resourceId, async (): Promise<WriteResult> => {
      const current = await readConfigBody(resourceId);
      if ('ifAbsent' in guard) {
        if (current) return { ok: false, conflict: 'exists', theirs: configFileOf(current) };
      } else if (!current) {
        return { ok: false, conflict: 'missing' };
      } else if (verOf(current) !== guard.ifMatch) {
        return { ok: false, conflict: 'changed', theirs: configFileOf(current) };
      }
      const body: Body = { text, updatedAt: new Date().toISOString(), v: newVersion() };
      await storeSetJson(configKey(resourceId), body);
      return { ok: true, file: configFileOf(body) };
    });
  },
};

/** The settings body, or undefined when there is none (or it is not one). */
async function readConfigBody(resourceId: string): Promise<Body | undefined> {
  const body = await storeGetJson<Body>(configKey(resourceId));
  return typeof body?.text === 'string' ? body : undefined;
}

const configFileOf = (b: Body): StoredFile => fileOf(VAULT_SETTINGS_PATH, b);
