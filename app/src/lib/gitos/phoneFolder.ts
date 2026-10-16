// The phone's vault as real files (folder and sync plan, M2): on the iPhone
// and the iPad, This device keeps the personal vault as plain .md files in
// the app's Documents, under OpenShore/Vault, so the Files app shows them and
// other apps can open them in place (Info.plist has UIFileSharingEnabled and
// LSSupportsOpeningDocumentsInPlace). It is the shared folder client
// (folderClient.ts) over a transport that does the file work through
// @capacitor/filesystem, the way deviceFolder.ts is the same client over the
// Electron bridge, so the two keep one set of rules.
//
// The Filesystem calls go through `PhoneFs`, a small interface, so the whole
// transport runs in tests over an in-memory fake (test/support/fakePhoneFs.ts)
// and passes test/providerContract.test.ts like every other folder.
//
// Layout inside the vault folder, the desktop's own (os-code's folderFs.ts),
// so a vault copied between the two reads the same:
//   <note path>.md                 a note
//   .trash/<original path>         Trash, with " 2" to " 99" beside a taken name
//   .trash/.oscode-trash.json      what went into Trash, from where, and when
//   .oscode/vault.json             the vault's own settings
// A dot entry never lists as a note, a folder, or an attachment.
//
// Version token. The task's rule is a token from stat, `${mtime}:${size}`, the
// same in list, stat, read and write. A stat alone cannot tell two writes of
// the same size in one millisecond apart (two short edits, an autosave beside
// an agent write), and then a stale `ifMatch` would pass and replace someone's
// words. So the token adds a content hash: `${mtime}:${size}:${hash}`. The
// choice over a sealed ledger of version counters: the hash lives in the bytes
// themselves, so it needs no state that can drift from the folder, survives a
// relaunch and a reinstall, and catches an edit made in another app too. Its
// cost is a read: list() reuses a hash it already computed while the file's
// mtime and size still match it (an in-memory cache, never trusted for a
// guard), and every guard is checked against bytes read fresh inside the
// chain, so a cached hash can only ever cost a list a stale token, never a
// write its guard.
//
// One writer at a time. Every mutating call runs in one promise chain per
// folder, so a check and the write it guards are one step for everything in
// the app (Capacitor runs one WebView). Another app editing a file in place at
// the very same moment is outside the chain; the window is the few
// milliseconds between the check and the write, the race the desktop's
// lstat-absent fallback documents too. Capacitor's rename replaces a name that
// is taken, so every move here first checks the name is free, by the folded
// rule (case and composition), inside the chain.
import {
  VAULT_CONFIG_FILES,
  VAULT_CONFIG_MAX_BYTES,
  attachmentMime,
  bytesMatchMime,
  foldPath,
  isAttachmentPath,
  isVaultConfigName,
  utf8Length,
  type AttachmentMeta,
  type BytesRead,
  type ConfigRead,
  type ReadBytesOptions,
  type VaultConfigName,
  type VaultSettingsConfigName,
} from 'os-code/protocol';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import {
  VAULT_SETTINGS_NAME_REFUSED,
  VAULT_SETTINGS_TOO_LARGE,
  VAULT_SETTINGS_WRITE_REFUSED,
} from '../vaultCopy.js';
import { asConfigRead } from './config.js';
import {
  bytesCap,
  isVaultFolderPath,
  makeFolderProvider,
  type FolderTransport,
} from './folderClient.js';
import { VAULT_SETTINGS_PATH } from './local.js';
import {
  isNotePath,
  type CreateFolderResult,
  type EmptyTrashResult,
  type FolderMoveResult,
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

// ---- The file system seam --------------------------------------------------

/** One entry as the phone's file system reports it. `mtime` is milliseconds. */
export interface PhoneFsStat {
  type: 'file' | 'directory';
  size: number;
  mtime: number;
}

export interface PhoneFsEntry extends PhoneFsStat {
  name: string;
}

/** The Filesystem calls the phone folder needs, every path relative to the
 *  app's Documents. A read of nothing answers null (or [] for a folder), never
 *  a throw; a write that fails throws. */
export interface PhoneFs {
  stat(path: string): Promise<PhoneFsStat | null>;
  readdir(path: string): Promise<PhoneFsEntry[]>;
  readText(path: string): Promise<string | null>;
  /** The bytes as base64, the way the plugin hands back a binary file. */
  readBase64(path: string): Promise<string | null>;
  /** Write the whole file, making its folders. */
  writeText(path: string, text: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  /** Make a folder and its parents; an existing folder is fine. */
  mkdir(path: string): Promise<void>;
  /** Remove a folder: only an empty one unless `recursive`. */
  rmdir(path: string, recursive: boolean): Promise<void>;
  /** Move a file or a folder. It may replace a name that is taken, so callers
   *  check first. */
  rename(from: string, to: string): Promise<void>;
}

/** The real phone: @capacitor/filesystem over Directory.Documents. */
export function capacitorPhoneFs(): PhoneFs {
  const at = (path: string) => ({ path, directory: Directory.Documents });
  const statOf = (s: { type: string; size: number; mtime: number }): PhoneFsStat => ({
    type: s.type === 'directory' ? 'directory' : 'file',
    size: Number(s.size) || 0,
    mtime: Number(s.mtime) || 0,
  });
  return {
    async stat(path) {
      try {
        return statOf(await Filesystem.stat(at(path)));
      } catch {
        return null;
      }
    },
    async readdir(path) {
      try {
        const { files } = await Filesystem.readdir(at(path));
        return files.map((f) => ({ name: f.name, ...statOf(f) }));
      } catch {
        return [];
      }
    },
    async readText(path) {
      try {
        const { data } = await Filesystem.readFile({ ...at(path), encoding: Encoding.UTF8 });
        return typeof data === 'string' ? data : null;
      } catch {
        return null;
      }
    },
    async readBase64(path) {
      try {
        const { data } = await Filesystem.readFile(at(path));
        return typeof data === 'string' ? data : null;
      } catch {
        return null;
      }
    },
    async writeText(path, text) {
      await Filesystem.writeFile({
        ...at(path),
        data: text,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    },
    async deleteFile(path) {
      await Filesystem.deleteFile(at(path));
    },
    async mkdir(path) {
      try {
        await Filesystem.mkdir({ ...at(path), recursive: true });
      } catch (err) {
        // Already there is fine; anything else is a real failure.
        const st = await Filesystem.stat(at(path)).catch(() => undefined);
        if (st?.type !== 'directory') throw err;
      }
    },
    async rmdir(path, recursive) {
      await Filesystem.rmdir({ ...at(path), recursive });
    },
    async rename(from, to) {
      await Filesystem.rename({
        from,
        to,
        directory: Directory.Documents,
        toDirectory: Directory.Documents,
      });
    },
  };
}

// ---- Where things are ------------------------------------------------------

/** The app's own folder inside Documents (one name everywhere, R6). */
export const PHONE_OPENSHORE_DIR = 'OpenShore';
/** The personal vault's folder, relative to Documents. */
export const PHONE_VAULT_DIR = `${PHONE_OPENSHORE_DIR}/Vault`;

const TRASH_DIR = '.trash';
const TRASH_MANIFEST = '.oscode-trash.json';
/** The most " 2" to " 99" (Trash) or " (restored N)" names tried. */
const MAX_NAME_TRIES = 99;

// ---- Small helpers ---------------------------------------------------------

/** A 53-bit string hash (cyrb53): cheap, and with mtime and size beside it a
 *  collision would need the same millisecond, the same length and the same
 *  hash. Not a security hash; nothing here needs one. */
function contentHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const versionOfStat = (st: PhoneFsStat, hash: string) => `${st.mtime}:${st.size}:${hash}`;
const isoOf = (ms: number) => new Date(Number.isFinite(ms) ? ms : 0).toISOString();

function parentOf(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i === -1 ? '' : rel.slice(0, i);
}
function baseOf(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}
function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** A fresh random suffix, never a clock or a counter. */
function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

/** A Trash id: a path under `.trash` with no dot segment, no backslash, not
 *  rooted, no empty segment (folderFs's isVaultTrashId). */
export function isPhoneTrashId(id: unknown): id is string {
  if (typeof id !== 'string' || !id || id.length > 4096) return false;
  if (id.includes('\\') || id.includes('\0')) return false;
  return id.split('/').every((s) => s !== '' && !s.startsWith('.'));
}

/** A name in Trash for `rel`: the same path, or " 2" to " 99" beside it. */
function trashNameAt(rel: string, n: number, note: boolean): string {
  if (n === 1) return rel;
  if (note) return `${rel.slice(0, -3)} ${n}${rel.slice(-3)}`;
  return `${rel} ${n}`;
}

/** The name a restore tries at step `n`: the original, then "{title}
 *  (restored)", then "{title} (restored 2)" and on (R3). */
function restoreNameAt(path: string, n: number, note: boolean): string {
  if (n === 0) return path;
  const stem = note ? path.slice(0, -3) : path;
  const tag = n === 1 ? ' (restored)' : ` (restored ${n})`;
  return `${stem}${tag}${note ? path.slice(-3) : ''}`;
}

/** base64 to bytes, with no Node Buffer (this runs in the WebView). */
function fromBase64(data: string): Uint8Array {
  const clean = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface TrashRecord {
  id: string;
  path: string;
  kind: 'note' | 'folder';
  trashedAt: string;
  /** The sealed store's Trash id this entry came from (the one-time move),
   *  so a move cut off and run again never brings an entry in twice. */
  sealed?: string;
}

/** One sealed Trash entry as the one-time move hands it over. */
export interface AdoptedTrash {
  kind: 'note' | 'folder';
  path: string;
  trashedAt: string;
  notes: Array<{ path: string; text: string }>;
}

/** The transport, plus the settings file and the one-time move's Trash. */
export interface PhoneFolderTransport extends FolderTransport {
  readConfig(name: VaultConfigName): Promise<ConfigRead>;
  writeConfig(name: VaultSettingsConfigName, text: string, guard: WriteGuard): Promise<WriteResult>;
  /** Put a sealed Trash entry into this folder's Trash, once per `sealedId`.
   *  True once the folder's Trash records it (now or by an earlier run). */
  adoptTrash(entry: AdoptedTrash, sealedId: string): Promise<boolean>;
}

// ---- The transport ---------------------------------------------------------

/** The phone folder over `fs`, rooted at `root` inside Documents. */
export function createPhoneFolderTransport(
  fs: PhoneFs,
  root: string = PHONE_VAULT_DIR,
): PhoneFolderTransport {
  const abs = (rel: string) => (rel ? `${root}/${rel}` : root);
  const trashAbs = (rel = '') => abs(rel ? `${TRASH_DIR}/${rel}` : TRASH_DIR);

  // The hash each file had when it was last read or written here, with the
  // stat it had then. A hint for list() only.
  const hashes = new Map<string, { mtime: number; size: number; hash: string }>();

  let chain: Promise<unknown> = Promise.resolve();
  function chained<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.catch(() => {}).then(fn);
    chain = run.catch(() => {});
    return run;
  }

  /** The file's text, stat and version, read now. Null when no file is there. */
  async function readFresh(
    rel: string,
  ): Promise<{ text: string; st: PhoneFsStat; version: string } | null> {
    const st = await fs.stat(abs(rel));
    if (!st || st.type !== 'file') return null;
    const text = await fs.readText(abs(rel));
    if (text === null) return null;
    // The stat after the read, so the token never pairs new bytes with an
    // old mtime when a write lands between the two.
    const after = (await fs.stat(abs(rel))) ?? st;
    const hash = contentHash(text);
    hashes.set(rel, { mtime: after.mtime, size: after.size, hash });
    return { text, st: after, version: versionOfStat(after, hash) };
  }

  const fileOf = (rel: string, f: { text: string; st: PhoneFsStat; version: string }) => ({
    path: rel,
    text: f.text,
    updatedAt: isoOf(f.st.mtime),
    version: f.version,
  });

  /** A note's meta from its stat, reading it only when the cached hash does
   *  not match this stat. */
  async function metaOf(rel: string, st: PhoneFsStat): Promise<StoredFileMeta | null> {
    const known = hashes.get(rel);
    if (known && known.mtime === st.mtime && known.size === st.size) {
      return {
        path: rel,
        updatedAt: isoOf(st.mtime),
        size: st.size,
        version: versionOfStat(st, known.hash),
      };
    }
    const fresh = await readFresh(rel);
    if (!fresh) return null;
    return {
      path: rel,
      updatedAt: isoOf(fresh.st.mtime),
      size: fresh.st.size,
      version: fresh.version,
    };
  }

  /** Every file and folder under `relDir` (vault-relative), dot entries
   *  skipped at every level. */
  async function walk(
    relDir: string,
    from: (rel: string) => string = abs,
  ): Promise<{ files: Array<{ rel: string; st: PhoneFsStat }>; dirs: string[] }> {
    const files: Array<{ rel: string; st: PhoneFsStat }> = [];
    const dirs: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      for (const e of await fs.readdir(from(dir))) {
        if (!e.name || e.name.startsWith('.')) continue;
        const rel = joinRel(dir, e.name);
        if (e.type === 'directory') {
          dirs.push(rel);
          await visit(rel);
        } else {
          files.push({ rel, st: e });
        }
      }
    };
    await visit(relDir);
    return { files, dirs };
  }

  /** The name in `relDir` that folds the same as `name`, when there is one. */
  async function takenIn(
    relDir: string,
    name: string,
    from: (rel: string) => string = abs,
  ): Promise<string | undefined> {
    const folded = foldPath(name);
    return (await fs.readdir(from(relDir))).find((e) => foldPath(e.name) === folded)?.name;
  }

  /** `relDir` with each folder already there under a name that folds the same
   *  spelled the way the folder has it, so `work/x.md` lands in `Work`. */
  async function canonicalDir(relDir: string): Promise<string> {
    const out: string[] = [];
    let exists = true;
    for (const seg of relDir.split('/').filter(Boolean)) {
      let name = seg;
      if (exists) {
        const cur = out.join('/');
        const found = await takenIn(cur, seg);
        const st = found === undefined ? null : await fs.stat(abs(joinRel(cur, found)));
        if (found !== undefined && st?.type === 'directory') name = found;
        else exists = false;
      }
      out.push(name);
    }
    return out.join('/');
  }

  /** What has a note's name by the folded rule, as theirs: the exact name
   *  first, then a name in its folder that folds the same. */
  async function theirsAt(rel: string): Promise<StoredFile | undefined> {
    const exact = await readFresh(rel);
    if (exact) return fileOf(rel, exact);
    const dir = parentOf(rel);
    const taken = await takenIn(dir, baseOf(rel));
    if (taken === undefined) return undefined;
    const other = await readFresh(joinRel(dir, taken));
    return other ? fileOf(joinRel(dir, taken), other) : undefined;
  }

  /** Is anything at `rel`, by the folded rule? */
  async function isTaken(rel: string): Promise<boolean> {
    if (await fs.stat(abs(rel))) return true;
    return (await takenIn(parentOf(rel), baseOf(rel))) !== undefined;
  }

  // ---- Trash records -------------------------------------------------------

  async function readManifest(): Promise<TrashRecord[]> {
    const raw = await fs.readText(trashAbs(TRASH_MANIFEST));
    if (!raw || raw.length > 4 * 1024 * 1024) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    const list = (parsed as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(list)) return [];
    const out: TrashRecord[] = [];
    for (const r of list as Array<Record<string, unknown>>) {
      if (!r || typeof r !== 'object') continue;
      const kind = r.kind === 'folder' ? 'folder' : r.kind === 'note' ? 'note' : undefined;
      if (!kind || !isPhoneTrashId(r.id) || typeof r.path !== 'string') continue;
      if (kind === 'note' ? !isNotePath(r.path) : !isVaultFolderPath(r.path)) continue;
      out.push({
        id: r.id,
        path: r.path,
        kind,
        trashedAt: typeof r.trashedAt === 'string' ? r.trashedAt : '',
        ...(typeof r.sealed === 'string' ? { sealed: r.sealed } : {}),
      });
    }
    return out;
  }

  async function writeManifest(records: TrashRecord[]): Promise<void> {
    const at = trashAbs(TRASH_MANIFEST);
    if (!records.length) {
      if (await fs.stat(at)) await fs.deleteFile(at);
      return;
    }
    await fs.writeText(at, `${JSON.stringify({ version: 1, entries: records }, null, 2)}\n`);
  }

  /** Remove empty folders in Trash from `relDir` up, keeping any record's. */
  async function pruneTrashDirs(relDir: string, keep: ReadonlySet<string>): Promise<void> {
    let cur = relDir;
    while (cur) {
      if (keep.has(cur)) return;
      if ((await fs.readdir(trashAbs(cur))).length) return;
      try {
        await fs.rmdir(trashAbs(cur), false);
      } catch {
        return;
      }
      cur = parentOf(cur);
    }
  }

  async function bytesUnder(absDir: string): Promise<number> {
    let total = 0;
    const visit = async (dir: string): Promise<void> => {
      for (const e of await fs.readdir(dir)) {
        if (e.type === 'directory') await visit(`${dir}/${e.name}`);
        else total += e.size;
      }
    };
    await visit(absDir);
    return total;
  }

  /** What Trash holds, newest first: each record still there, then every
   *  note in Trash no record covers (put there by hand or by Obsidian). */
  async function listTrashNow(): Promise<{ entries: TrashEntry[]; records: TrashRecord[] }> {
    const records = await readManifest();
    const live: TrashRecord[] = [];
    const entries: TrashEntry[] = [];
    for (const r of records) {
      const st = await fs.stat(trashAbs(r.id));
      if (!st || (r.kind === 'note' ? st.type !== 'file' : st.type !== 'directory')) continue;
      live.push(r);
      entries.push({
        id: r.id,
        path: r.path,
        kind: r.kind,
        size: r.kind === 'note' ? st.size : await bytesUnder(trashAbs(r.id)),
        ...(r.trashedAt ? { trashedAt: r.trashedAt } : {}),
      });
    }
    const noteIds = new Set(live.filter((r) => r.kind === 'note').map((r) => r.id));
    const folderIds = new Set(live.filter((r) => r.kind === 'folder').map((r) => r.id));
    const visit = async (dir: string): Promise<void> => {
      for (const e of await fs.readdir(trashAbs(dir))) {
        if (!e.name || e.name.startsWith('.')) continue;
        const rel = joinRel(dir, e.name);
        if (e.type === 'directory') {
          if (!folderIds.has(rel)) await visit(rel);
        } else if (!noteIds.has(rel) && isNotePath(rel)) {
          entries.push({
            id: rel,
            path: rel,
            kind: 'note',
            size: e.size,
            trashedAt: isoOf(e.mtime),
          });
        }
      }
    };
    await visit('');
    entries.sort(
      (a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? '') || a.id.localeCompare(b.id),
    );
    return { entries, records: live };
  }

  /** The first free name in Trash for `path`, or undefined after 99. */
  async function freeTrashName(path: string, note: boolean): Promise<string | undefined> {
    for (let n = 1; n <= MAX_NAME_TRIES; n++) {
      const candidate = trashNameAt(path, n, note);
      if (await takenIn(parentOf(candidate), baseOf(candidate), trashAbs)) continue;
      if (await fs.stat(trashAbs(candidate))) continue;
      return candidate;
    }
    return undefined;
  }

  // ---- Settings files ------------------------------------------------------

  const configRel = (name: VaultConfigName) =>
    `.${VAULT_CONFIG_FILES[name].dir}/${VAULT_CONFIG_FILES[name].file}`;
  const settingsFile = (f: { text: string; st: PhoneFsStat; version: string }): StoredFile =>
    fileOf(VAULT_SETTINGS_PATH, f);

  return {
    // Notes only, dot entries and anything else left out (the client filters
    // again).
    async list() {
      const { files } = await walk('');
      const out: StoredFileMeta[] = [];
      for (const f of files) {
        if (!isNotePath(f.rel)) continue;
        const meta = await metaOf(f.rel, f.st);
        if (meta) out.push(meta);
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },

    async stat(path) {
      if (!isNotePath(path)) return null;
      const st = await fs.stat(abs(path));
      if (!st || st.type !== 'file') return null;
      return metaOf(path, st);
    },

    async read(path) {
      if (!isNotePath(path)) return null;
      const f = await readFresh(path);
      return f ? fileOf(path, f) : null;
    },

    // The guard is checked against the bytes read now, inside the chain: an
    // ifAbsent by the folded name (a case-insensitive disk would otherwise
    // write over "Plan.md" when asked for "plan.md"), an ifMatch by the
    // version of the file there.
    async write(path, text, guard?: WriteGuard): Promise<WriteResult> {
      if (!isNotePath(path))
        throw new Error(`"${path}" is not a note, so the vault does not write it.`);
      return chained(async (): Promise<WriteResult> => {
        if (guard && 'ifAbsent' in guard) {
          if (await isTaken(path)) {
            const theirs = await theirsAt(path);
            return theirs
              ? { ok: false, conflict: 'exists', theirs }
              : { ok: false, conflict: 'exists' };
          }
        } else if (guard) {
          const cur = await readFresh(path);
          if (!cur) return { ok: false, conflict: 'missing' };
          if (cur.version !== guard.ifMatch) {
            return { ok: false, conflict: 'changed', theirs: fileOf(path, cur) };
          }
        }
        await fs.writeText(abs(path), text);
        const st = await fs.stat(abs(path));
        if (!st) throw new Error(`"${path}" did not save. Try again.`);
        const hash = contentHash(text);
        hashes.set(path, { mtime: st.mtime, size: st.size, hash });
        return {
          ok: true,
          file: { path, text, updatedAt: isoOf(st.mtime), version: versionOfStat(st, hash) },
        };
      });
    },

    async remove(path, guard?: RemoveGuard): Promise<RemoveResult> {
      if (!isNotePath(path))
        throw new Error(`"${path}" is not a note, so the vault does not write it.`);
      return chained(async (): Promise<RemoveResult> => {
        const cur = await readFresh(path);
        if (!cur) return { ok: true };
        if (guard && cur.version !== guard.ifMatch) {
          return { ok: false, conflict: 'changed', theirs: fileOf(path, cur) };
        }
        await fs.deleteFile(abs(path));
        hashes.delete(path);
        return { ok: true };
      });
    },

    // ---- Vault M6 ------------------------------------------------------------

    // Never replaces: the new name must be free by the folded rule (a
    // case-only rename of the same note is allowed and goes through a temp
    // name, so a disk that folds case takes it), the source's version is
    // checked against its bytes, and parents are made.
    async rename(from, to, guard: RenameGuard): Promise<RenameResult> {
      return chained(async (): Promise<RenameResult> => {
        const src = await readFresh(from);
        if (!src) return { ok: false, conflict: 'missing' };
        if (src.version !== guard.ifMatch) {
          return { ok: false, conflict: 'changed', theirs: fileOf(from, src) };
        }
        const meta = (rel: string, st: PhoneFsStat): StoredFileMeta => ({
          path: rel,
          updatedAt: isoOf(st.mtime),
          size: st.size,
          version: versionOfStat(st, contentHash(src.text)),
        });
        if (from === to) return { ok: true, file: meta(to, src.st) };
        const dest = joinRel(await canonicalDir(parentOf(to)), baseOf(to));
        const taken = await takenIn(parentOf(dest), baseOf(dest));
        const caseOnly =
          taken !== undefined &&
          parentOf(dest) === parentOf(from) &&
          taken === baseOf(from) &&
          foldPath(from) === foldPath(dest);
        if (taken !== undefined && !caseOnly) {
          const theirs = await theirsAt(joinRel(parentOf(dest), taken));
          return theirs
            ? { ok: false, conflict: 'exists', theirs }
            : { ok: false, conflict: 'exists' };
        }
        if (parentOf(dest)) await fs.mkdir(abs(parentOf(dest)));
        if (caseOnly) {
          const tmp = joinRel(
            parentOf(from),
            `.${baseOf(from).slice(0, 50)}.oscode-${randomId()}.tmp`,
          );
          await fs.rename(abs(from), abs(tmp));
          await fs.rename(abs(tmp), abs(dest));
        } else {
          await fs.rename(abs(from), abs(dest));
        }
        hashes.delete(from);
        const st = await fs.stat(abs(dest));
        if (!st) return { ok: false, conflict: 'missing' };
        hashes.set(dest, { mtime: st.mtime, size: st.size, hash: contentHash(src.text) });
        return { ok: true, file: meta(dest, st) };
      });
    },

    async listFolders() {
      const { dirs } = await walk('');
      return dirs.sort();
    },

    async createFolder(path): Promise<CreateFolderResult> {
      return chained(async (): Promise<CreateFolderResult> => {
        const dest = joinRel(await canonicalDir(parentOf(path)), baseOf(path));
        if (await takenIn(parentOf(dest), baseOf(dest))) return { ok: false, conflict: 'exists' };
        await fs.mkdir(abs(dest));
        return { ok: true };
      });
    },

    // One folder move, the destination absent (a case-only rename of the same
    // folder is allowed, through a temp name). The answer names every note
    // that moved with its version there.
    async renameFolder(from, to): Promise<FolderMoveResult> {
      return chained(async (): Promise<FolderMoveResult> => {
        const st = await fs.stat(abs(from));
        if (!st || st.type !== 'directory') return { ok: false, conflict: 'missing' };
        if (foldPath(to).startsWith(`${foldPath(from)}/`)) return { ok: false, conflict: 'exists' };
        const dest = joinRel(await canonicalDir(parentOf(to)), baseOf(to));
        if (from === dest) return { ok: false, conflict: 'exists' };
        const taken = await takenIn(parentOf(dest), baseOf(dest));
        const caseOnly =
          taken !== undefined && parentOf(dest) === parentOf(from) && taken === baseOf(from);
        if (taken !== undefined && !caseOnly) return { ok: false, conflict: 'exists' };
        const before = await walk(from);
        if (parentOf(dest)) await fs.mkdir(abs(parentOf(dest)));
        if (caseOnly) {
          const tmp = joinRel(
            parentOf(from),
            `.${baseOf(from).slice(0, 50)}.oscode-${randomId()}.tmp`,
          );
          await fs.rename(abs(from), abs(tmp));
          await fs.rename(abs(tmp), abs(dest));
        } else {
          await fs.rename(abs(from), abs(dest));
        }
        const moved: Array<{ from: string; to: string; version: string }> = [];
        let attachments = 0;
        for (const f of before.files) {
          const old = joinRel(from, f.rel);
          const next = joinRel(dest, f.rel);
          if (!isNotePath(old)) {
            attachments += 1;
            continue;
          }
          const known = hashes.get(old);
          hashes.delete(old);
          if (known) hashes.set(next, known);
          const now = await fs.stat(abs(next));
          const meta = now ? await metaOf(next, now) : null;
          if (meta?.version) moved.push({ from: old, to: next, version: meta.version });
        }
        return { ok: true, moved, attachments };
      });
    },

    // A note under its guard, or a folder as it is (Trash is recoverable), to
    // `.trash/<original path>`, " 2" to " 99" beside a taken name.
    async trash(target: TrashTarget): Promise<TrashResult> {
      return chained(async (): Promise<TrashResult> => {
        const isNote = target.kind === 'note';
        let size = 0;
        let notes = 1;
        let attachments = 0;
        const gone: string[] = [];
        if (target.kind === 'note') {
          const cur = await readFresh(target.path);
          if (!cur) return { ok: false, conflict: 'changed' };
          if (cur.version !== target.ifMatch) {
            return { ok: false, conflict: 'changed', theirs: fileOf(target.path, cur) };
          }
          size = cur.st.size;
          gone.push(target.path);
        } else {
          const st = await fs.stat(abs(target.path));
          if (!st || st.type !== 'directory') return { ok: false, conflict: 'changed' };
          const under = await walk(target.path);
          notes = 0;
          for (const f of under.files) {
            size += f.st.size;
            if (isNotePath(joinRel(target.path, f.rel))) notes += 1;
            else attachments += 1;
            gone.push(joinRel(target.path, f.rel));
          }
        }
        const id = await freeTrashName(target.path, isNote);
        if (!id)
          throw new Error(`Trash already holds ${MAX_NAME_TRIES} of "${baseOf(target.path)}".`);
        if (parentOf(id)) await fs.mkdir(trashAbs(parentOf(id)));
        else await fs.mkdir(trashAbs());
        await fs.rename(abs(target.path), trashAbs(id));
        for (const p of gone) hashes.delete(p);
        const trashedAt = new Date().toISOString();
        const records = await readManifest();
        records.push({ id, path: target.path, kind: target.kind, trashedAt });
        await writeManifest(records);
        const entry: TrashEntry = { id, path: target.path, kind: target.kind, size, trashedAt };
        return { ok: true, entry, notes, attachments };
      });
    },

    async listTrash() {
      return (await listTrashNow()).entries;
    },

    // Never overwrites: back to its own path while that is free (folded),
    // else beside it as "{title} (restored)"; the folders on the way are
    // made again.
    async restore(id): Promise<RestoreResult> {
      return chained(async (): Promise<RestoreResult> => {
        if (!isPhoneTrashId(id)) return { ok: false, conflict: 'missing' };
        const entry = (await listTrashNow()).entries.find((e) => e.id === id);
        if (!entry) return { ok: false, conflict: 'missing' };
        const isNote = entry.kind === 'note';
        const parent = await canonicalDir(parentOf(entry.path));
        const home = joinRel(parent, baseOf(entry.path));
        let landed: string | undefined;
        for (let n = 0; n <= MAX_NAME_TRIES && !landed; n++) {
          const candidate = restoreNameAt(home, n, isNote);
          if (!(await isTaken(candidate))) landed = candidate;
        }
        if (!landed) throw new Error(`Every restored name for "${baseOf(entry.path)}" is taken.`);
        if (parent) await fs.mkdir(abs(parent));
        await fs.rename(trashAbs(id), abs(landed));
        const rest = (await readManifest()).filter((r) => r.id !== id);
        await writeManifest(rest);
        await pruneTrashDirs(parentOf(id), new Set(rest.map((r) => r.id)));
        const st = await fs.stat(abs(landed));
        if (!st) return { ok: false, conflict: 'missing' };
        const file: StoredFileMeta | null = isNote
          ? await metaOf(landed, st)
          : {
              path: landed,
              updatedAt: isoOf(st.mtime),
              size: await bytesUnder(abs(landed)),
              version: '',
            };
        if (!file) return { ok: false, conflict: 'missing' };
        return { ok: true, file, renamed: landed !== home };
      });
    },

    // For good: the entries named, or everything in Trash (`.trash` stays).
    async emptyTrash(ids?: string[]): Promise<EmptyTrashResult> {
      return chained(async (): Promise<EmptyTrashResult> => {
        const { entries } = await listTrashNow();
        const wanted = ids ? new Set(ids.filter(isPhoneTrashId)) : undefined;
        const targets = wanted ? entries.filter((e) => wanted.has(e.id)) : entries;
        for (const e of targets) {
          const st = await fs.stat(trashAbs(e.id));
          if (st?.type === 'directory') await fs.rmdir(trashAbs(e.id), true);
          else if (st) await fs.deleteFile(trashAbs(e.id));
        }
        if (!wanted) {
          for (const e of await fs.readdir(trashAbs())) {
            const at = trashAbs(e.name);
            if (e.type === 'directory') await fs.rmdir(at, true);
            else await fs.deleteFile(at);
          }
          return { removed: targets.length };
        }
        const gone = new Set(targets.map((e) => e.id));
        const rest = (await readManifest()).filter((r) => !gone.has(r.id));
        await writeManifest(rest);
        const keep = new Set(rest.map((r) => r.id));
        for (const id of gone) await pruneTrashDirs(parentOf(id), keep);
        return { removed: targets.length };
      });
    },

    // Images and PDFs the person put in the folder (through Files): listed
    // from the same walk, read with the type checked against the bytes.
    async listAttachments(): Promise<AttachmentMeta[]> {
      const { files } = await walk('');
      const out: AttachmentMeta[] = [];
      for (const f of files) {
        const mime = isAttachmentPath(f.rel) ? attachmentMime(f.rel) : undefined;
        if (!mime) continue;
        out.push({
          path: f.rel,
          size: f.st.size,
          updatedAt: isoOf(f.st.mtime),
          version: `${f.st.mtime}:${f.st.size}`,
          mime,
        });
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },

    async readBytes(path, opts?: ReadBytesOptions): Promise<BytesRead> {
      if (!isAttachmentPath(path)) return { ok: false, reason: 'refused' };
      const mime = attachmentMime(path);
      if (!mime) return { ok: false, reason: 'refused' };
      const cap = bytesCap(opts);
      const st = await fs.stat(abs(path));
      if (!st) return { ok: false, reason: 'absent' };
      if (st.type !== 'file') return { ok: false, reason: 'refused' };
      if (st.size > cap) return { ok: false, reason: 'too-large' };
      const data = await fs.readBase64(abs(path));
      if (data === null) return { ok: false, reason: 'absent' };
      let bytes: Uint8Array;
      try {
        bytes = fromBase64(data);
      } catch {
        return { ok: false, reason: 'refused' };
      }
      if (bytes.byteLength > cap) return { ok: false, reason: 'too-large' };
      if (!bytesMatchMime(bytes, mime)) return { ok: false, reason: 'unsupported' };
      return { ok: true, bytes, mime, version: `${st.mtime}:${st.size}` };
    },

    // ---- Vault M3 and M7: the config files ------------------------------------

    // Only a name on the allow-list is read, mapped to its one file; an
    // Obsidian vault copied in through Files keeps its `.obsidian` settings.
    async readConfig(name: VaultConfigName): Promise<ConfigRead> {
      if (!isVaultConfigName(name)) return { ok: false, reason: 'refused' };
      const f = await readFresh(configRel(name));
      if (!f) return { ok: false, reason: 'absent' };
      return asConfigRead({ ok: true, text: f.text, version: f.version });
    },

    // The settings sheet's write, the note write's contract on
    // `.oscode/vault.json`; only `oscode/vault` is ever written.
    async writeConfig(name, text, guard): Promise<WriteResult> {
      if (name !== 'oscode/vault') throw new Error(VAULT_SETTINGS_NAME_REFUSED);
      if (utf8Length(text) > VAULT_CONFIG_MAX_BYTES) throw new Error(VAULT_SETTINGS_TOO_LARGE);
      const rel = configRel('oscode/vault');
      return chained(async (): Promise<WriteResult> => {
        const cur = await readFresh(rel);
        if ('ifAbsent' in guard) {
          if (cur) return { ok: false, conflict: 'exists', theirs: settingsFile(cur) };
        } else if (!cur) {
          return { ok: false, conflict: 'missing' };
        } else if (cur.version !== guard.ifMatch) {
          return { ok: false, conflict: 'changed', theirs: settingsFile(cur) };
        }
        await fs.writeText(abs(rel), text);
        const st = await fs.stat(abs(rel));
        if (!st) throw new Error(VAULT_SETTINGS_WRITE_REFUSED);
        const hash = contentHash(text);
        hashes.set(rel, { mtime: st.mtime, size: st.size, hash });
        return {
          ok: true,
          file: {
            path: VAULT_SETTINGS_PATH,
            text,
            updatedAt: isoOf(st.mtime),
            version: versionOfStat(st, hash),
          },
        };
      });
    },

    // The one-time move's Trash: the sealed entry's notes written under a
    // free Trash name, then its record, which names the sealed id so a move
    // run again skips it. Cut off before the record, the notes still list in
    // Trash as loose notes, so nothing is lost either way.
    async adoptTrash(entry: AdoptedTrash, sealedId: string): Promise<boolean> {
      return chained(async () => {
        if ((await readManifest()).some((r) => r.sealed === sealedId)) return true;
        const isNote = entry.kind === 'note';
        if (isNote ? !isNotePath(entry.path) : !isVaultFolderPath(entry.path)) return false;
        const id = await freeTrashName(entry.path, isNote);
        if (!id) return false;
        for (const note of entry.notes) {
          if (!isNotePath(note.path)) continue;
          const rel = isNote
            ? id
            : note.path.startsWith(`${entry.path}/`)
              ? `${id}${note.path.slice(entry.path.length)}`
              : undefined;
          if (!rel) continue;
          await fs.writeText(trashAbs(rel), note.text);
        }
        if (!(await fs.stat(trashAbs(id)))) return false;
        const records = await readManifest();
        records.push({
          id,
          path: entry.path,
          kind: entry.kind,
          trashedAt: entry.trashedAt || new Date().toISOString(),
          sealed: sealedId,
        });
        await writeManifest(records);
        return true;
      });
    },
  };
}

// ---- The provider ------------------------------------------------------------

/** What This device says of itself on the phone, where it is a folder. */
export const PHONE_VAULT_META = {
  id: 'local' as const,
  label: 'This device',
  blurb: 'Plain .md files in the OpenShore folder, open in the Files app.',
  ready: true,
};

/** This device on the phone: the folder client over the phone transport, its
 *  settings file, and every call held until `gate()` settles (the one-time
 *  move from the sealed store, so nothing reads a half-moved vault). The
 *  resource id is ignored, as on the desktop folder: there is one vault on
 *  this device. */
export function createPhoneVaultProvider(
  transport: PhoneFolderTransport,
  gate: () => Promise<void> = () => Promise.resolve(),
): StorageProvider {
  const base: StorageProvider = {
    ...makeFolderProvider(transport, PHONE_VAULT_META),
    async readConfig(_resourceId, name) {
      if (!isVaultConfigName(name)) return { ok: false, reason: 'refused' };
      return asConfigRead(await transport.readConfig(name));
    },
    async writeConfig(_resourceId, name, text, guard) {
      return transport.writeConfig(name, text, guard);
    },
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    out[key] =
      typeof value === 'function'
        ? async (...args: unknown[]) => {
            await gate().catch(() => {});
            return (value as (...a: unknown[]) => unknown).apply(base, args);
          }
        : value;
  }
  return out as unknown as StorageProvider;
}
