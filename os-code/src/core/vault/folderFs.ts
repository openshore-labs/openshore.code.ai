// A desktop folder vault's file work (Vault M5, tech review J7): list, stat, read,
// write and remove notes in one folder, every path checked as a note and
// jailed to the folder. Moved here from app/electron/vaultFs.ts (which now
// re-exports it) so Electron main's osc:vault* handlers and the daemon's
// vault routes (daemon/vaultRoutes.ts) run the very same code on a folder:
// plain Node, no Electron, testable on its own. Every note is read,
// versioned, and written through the engine's one note file module
// (noteFile.ts), the same one the agent's vaultWrite uses, so no two writers
// drift on how a note is saved (Vault M1, tech review F1, F2, F5).
//
// Callers are untrusted input (the renderer, UI-6; a paired phone), so every
// path is checked twice here: it must be a note (`.md`, no dot segment, so
// `.obsidian/` plugin data and attachments never cross; tech review F7.4) and it must
// resolve inside the vault folder (the Jail, symlink-safe). A write's guard
// is validated the same way.
import { existsSync, realpathSync, rmSync, type BigIntStats } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Jail } from '../security/jail.js';
import {
  checkNewNoteName,
  foldPath,
  isAgentWritablePath,
  isNotePath,
} from '../../harness/vault/paths.js';
import {
  VAULT_ATTACHMENT_MAX_BYTES,
  attachmentMime,
  bytesMatchMime,
  isAttachmentPath,
} from '../../harness/vault/attachments.js';
import type {
  AttachmentMeta,
  BytesRead,
  ReadBytesOptions,
  VaultTrashEntry,
} from '../../harness/vault/types.js';
import {
  NOTE_TEMP_PATTERN,
  noteVersion,
  readNote,
  readNoteBytes,
  statNote,
  sweepNoteTemps,
  writeNote,
  type NoteGuard,
} from './noteFile.js';

/** A note as it crosses the bridge (the seam's StoredFile). */
export interface VaultFile {
  path: string;
  text: string;
  updatedAt: string;
  version: string;
}

/** A note's metadata as it crosses the bridge (the seam's StoredFileMeta);
 *  size is in bytes. */
export interface VaultFileMeta {
  path: string;
  updatedAt: string;
  size: number;
  version: string;
}

/** The seam's WriteResult, as main answers osc:vaultWrite. */
export type VaultWriteResult =
  | { ok: true; file: VaultFile }
  | { ok: false; conflict: 'changed' | 'missing' | 'exists'; theirs?: VaultFile };

/** The seam's RemoveResult, as main answers osc:vaultRemove. */
export type VaultRemoveResult =
  { ok: true } | { ok: false; conflict: 'changed'; theirs?: VaultFile };

/** The seam's note rule, the vault core's own isNotePath (Vault M3, tech review H4),
 *  which the app's providers hold too: a `.md` path with no dot segment, no
 *  backslash, not rooted. On Windows it also refuses what that file system
 *  cannot hold (a colon, which names a drive or an NTFS stream, the other
 *  forbidden characters, a reserved name, a segment ending in a dot or a
 *  space); elsewhere an agent's "Decision: auth?.md" is an ordinary note. */
export function isVaultNotePath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return isNotePath(path, { windows: platform === 'win32' });
}

/** The longest version token main accepts in a guard. A real one is three
 *  decimal numbers, far shorter. */
const MAX_GUARD_VERSION = 200;

/** A write guard from the renderer, checked: `{ ifMatch }` with a string of
 *  at most 200 characters, or `{ ifAbsent: true }`; never both, never
 *  anything else. Undefined when no guard was sent. */
export function parseVaultGuard(v: unknown): NoteGuard | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('blocked: guard must be an object');
  }
  const g = v as Record<string, unknown>;
  const hasMatch = g.ifMatch !== undefined;
  const hasAbsent = g.ifAbsent !== undefined;
  if (hasMatch && hasAbsent) throw new Error('blocked: guard takes ifMatch or ifAbsent, not both');
  if (hasMatch) {
    if (typeof g.ifMatch !== 'string' || g.ifMatch.length > MAX_GUARD_VERSION) {
      throw new Error('blocked: guard.ifMatch must be a short string');
    }
    return { ifMatch: g.ifMatch };
  }
  if (g.ifAbsent === true) return { ifAbsent: true };
  throw new Error('blocked: guard must be { ifMatch } or { ifAbsent: true }');
}

/** A remove guard from the renderer, checked: `{ ifMatch }` with a string of
 *  at most 200 characters and nothing else. Undefined when none was sent. */
export function parseVaultRemoveGuard(v: unknown): { ifMatch: string } | undefined {
  const g = parseVaultGuard(v);
  if (g && !('ifMatch' in g)) throw new Error('blocked: a remove guard takes ifMatch only');
  return g;
}

/** The absolute path of a note in the vault folder, refusing anything that is
 *  not a note or would leave the folder. The folder itself is never made
 *  here: main's vaultDir() makes only the default one (ensureVaultRoot), and
 *  a folder that went missing stays missing. */
export function vaultNoteAbs(root: string, path: string): string {
  if (typeof path !== 'string' || !isVaultNotePath(path)) {
    throw new Error('blocked: only notes (.md, outside dot folders) cross the vault bridge');
  }
  return new Jail(root).resolve(path);
}

/** How a list walks: `sweep` (default true) removes temp files a crash left
 *  behind; Bring reads a folder it must leave byte for byte, so it walks
 *  without. `limit` stops the walk once that many notes are found. */
export interface VaultListOptions {
  sweep?: boolean;
  limit?: number;
}

/** How many lstats one folder runs at once during a list. */
const LIST_STAT_BATCH = 8;

/** Every note in the folder, with its version from one bigint lstat, sorted
 *  by path. Dot entries (`.obsidian/`, `.trash/`, our temp files) and
 *  non-notes are skipped, and so is any path the note rule refuses, so the
 *  list holds only notes that open. A link is never followed (a Dirent
 *  reports the link itself). Temp files a crash left behind are swept as the
 *  walk passes their folder, unless `sweep` is false.
 *
 *  The walk is asynchronous (Vault M3, tech review H3 "Cold build"): a vault of
 *  thousands of notes never holds main's event loop, so the window and every
 *  other IPC keep answering while it lists. It visits folders in the same
 *  order the synchronous walk did, and `limit` stops it at the same note. */
export async function listVaultFolder(
  root: string,
  options: VaultListOptions = {},
): Promise<VaultFileMeta[]> {
  const walked = await walkVault(root, {
    sweep: options.sweep !== false,
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });
  return walked.notes;
}

/** What one walk of a vault folder gathers (Vault M6, tech review K13: the note list,
 *  the attachment list and the folder list share it). */
interface VaultWalk {
  notes: VaultFileMeta[];
  attachments: AttachmentMeta[];
  folders: string[];
  /** Bytes in every regular file the walk saw, notes or not. */
  bytes: number;
  /** Regular files the walk saw that are neither notes nor attachments. */
  others: number;
}

interface VaultWalkOptions {
  sweep?: boolean;
  /** Stop once this many notes are found. */
  limit?: number;
  /** Gather attachments (`isAttachmentPath`) as well as notes. */
  attachments?: boolean;
  /** Gather the folders too. */
  folders?: boolean;
  /** Count attachments and other files (a folder move or trash says them). */
  counts?: boolean;
  /** Walk only this folder of the vault (paths stay vault-relative). */
  under?: string;
}

async function walkVault(root: string, options: VaultWalkOptions = {}): Promise<VaultWalk> {
  const out: VaultWalk = { notes: [], attachments: [], folders: [], bytes: 0, others: 0 };
  if (!existsSync(root)) return out;
  const sweep = options.sweep === true;
  const limit = options.limit ?? Infinity;
  const relOf = (abs: string): string => relative(root, abs).split(sep).join('/');
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    // The sweep reads the folder again, so it runs only where a temp is.
    if (sweep && entries.some((e) => NOTE_TEMP_PATTERN.test(e.name))) sweepNoteTemps(dir);
    const statForList = async (abs: string): Promise<VaultFileMeta | undefined> => {
      try {
        const st = await lstat(abs, { bigint: true });
        if (!st.isFile()) return undefined;
        return {
          path: relOf(abs),
          updatedAt: new Date(Number(st.mtimeMs)).toISOString(),
          size: Number(st.size),
          version: noteVersion(st),
        };
      } catch {
        return undefined; // Gone between the listing and the stat.
      }
    };
    let batch: string[] = [];
    const flush = async (): Promise<void> => {
      const metas = await Promise.all(batch.map(statForList));
      batch = [];
      for (const meta of metas) {
        if (out.notes.length >= limit) return;
        if (meta) {
          out.notes.push(meta);
          out.bytes += meta.size;
        }
      }
    };
    for (const entry of entries) {
      if (out.notes.length >= limit) break;
      if (entry.name.startsWith('.')) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await flush();
        if (out.notes.length >= limit) return;
        if (options.folders) out.folders.push(relOf(abs));
        await walk(abs);
      } else if (entry.isFile()) {
        const rel = relOf(abs);
        if (isVaultNotePath(rel)) {
          batch.push(abs);
          if (batch.length >= LIST_STAT_BATCH) await flush();
        } else if (options.attachments || options.counts) {
          // A folder move or trash counts what goes with the notes.
          const meta = await statForList(abs);
          if (!meta) continue;
          out.bytes += meta.size;
          const mime = isAttachmentPath(rel) ? attachmentMime(rel) : undefined;
          if (mime) out.attachments.push({ ...meta, mime });
          else out.others += 1;
        }
      }
    }
    await flush();
  };
  await walk(options.under ? join(root, options.under) : root);
  out.notes.sort((a, b) => a.path.localeCompare(b.path));
  out.attachments.sort((a, b) => a.path.localeCompare(b.path));
  out.folders.sort((a, b) => a.localeCompare(b));
  return out;
}

/** One note's text with the version of exactly those bytes, or null. */
export async function readVaultFile(root: string, path: string): Promise<VaultFile | null> {
  const note = await readNote(vaultNoteAbs(root, path));
  return note && { path, text: note.text, updatedAt: note.updatedAt, version: note.version };
}

/** One note's metadata from one lstat, or null (osc:vaultStat). */
export async function statVaultFile(root: string, path: string): Promise<VaultFileMeta | null> {
  const st = await statNote(vaultNoteAbs(root, path));
  return st && { path, updatedAt: st.updatedAt, size: st.size, version: st.version };
}

/** The real path of `abs`: its own realpath when it exists, else the
 *  realpath of its nearest existing parent with the rest joined on, so a
 *  link anywhere along the way is followed the way a write would follow it. */
export function deepestRealpath(abs: string): string {
  let existing = resolve(abs);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(existing);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return resolve(abs);
      tail.push(basename(existing));
      existing = parent;
    }
  }
}

/** Whether a write to `abs` lands somewhere the agent may write in the vault
 *  at `root` (Vault M7, tech review L8), judged on the RESOLVED path: the target's
 *  real path, or its nearest existing parent's, relative to the real root,
 *  must pass `isAgentWritablePath`. So a planted `x.md -> .oscode/vault.json`,
 *  or a folder linked into `.oscode/` or `.obsidian/`, is refused though its
 *  typed name is clean. Outside the root is refused too. */
export function resolvedAgentWritable(root: string, abs: string): boolean {
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    rootReal = resolve(root);
  }
  const rel = relative(rootReal, deepestRealpath(abs));
  if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return false;
  return isAgentWritablePath(rel.split(sep).join('/'));
}

/** Write a note through the engine's writeNote: temp file then rename, and the
 *  guard checked after the temp file is complete, as late as it can be. A
 *  conflict is a result that leaves the note as it was. The resolved path is
 *  checked for every caller (main's IPC, the daemon's notes PUT): a note that
 *  is a link into a dot folder (`.oscode/`, `.obsidian/`) is never written
 *  through (Vault M7, tech review L8); the settings file has its own writer. */
export async function writeVaultFile(
  root: string,
  path: string,
  text: string,
  guard?: NoteGuard,
): Promise<VaultWriteResult> {
  const abs = vaultNoteAbs(root, path);
  if (!resolvedAgentWritable(root, abs)) {
    throw new Error('blocked: this note leads into a settings folder, so it is not written here');
  }
  const r = await writeNote(abs, text, guard);
  if (r.ok) {
    return { ok: true, file: { path, text, updatedAt: r.updatedAt, version: r.version } };
  }
  const theirs = r.theirs && { path, ...r.theirs };
  return theirs ? { ok: false, conflict: r.conflict, theirs } : { ok: false, conflict: r.conflict };
}

function changedRemove(
  path: string,
  note: { text: string; updatedAt: string; version: string },
): VaultRemoveResult {
  return {
    ok: false,
    conflict: 'changed',
    theirs: { path, text: note.text, updatedAt: note.updatedAt, version: note.version },
  };
}

/** Remove a note, when it is there. A note already gone is ok. With a guard,
 *  the note is removed only while its version is still `ifMatch`; otherwise
 *  the answer is 'changed' with what is there now, and the note stays. The
 *  version is read through the engine's readNote and checked again with one
 *  lstat right before the unlink, so the window a writer can land in is the
 *  gap between that lstat and the unlink, not the whole read. A write landing
 *  in it is lost with the note; wave 1 may close it with a rename-aside
 *  (Vault M2, tech review G7). */
export async function removeVaultFile(
  root: string,
  path: string,
  guard?: { ifMatch: string },
): Promise<VaultRemoveResult> {
  const abs = vaultNoteAbs(root, path);
  if (guard) {
    const note = await readNote(abs);
    if (!note) return { ok: true };
    if (note.version !== guard.ifMatch) return changedRemove(path, note);
    const now = await statNote(abs);
    if (!now) return { ok: true };
    if (now.version !== guard.ifMatch) {
      const fresh = await readNote(abs);
      return fresh ? changedRemove(path, fresh) : { ok: true };
    }
  }
  if (existsSync(abs)) rmSync(abs);
  return { ok: true };
}

// ===========================================================================
// Vault M6 (tech review K3, K5, K6, K11, K13): rename, folders, Trash, attachments.
//
// The same code serves Electron main (osc:vault*) and the daemon's routes.
// Every path is checked against the note rule, the folder rule (the note rule
// applied to a child, so a folder never has a dot segment) or
// `isAttachmentPath`, then the Jail. `.trash` is reached only by the trash
// functions here, and a link is never followed or moved: a symlinked source
// is refused, and every folder made on the way is checked to be a real one.
// Nothing here ever replaces a name that is taken: a note moves by link()
// (which cannot replace) then unlink, a folder by claiming the destination
// with mkdir() (which cannot either) then renaming onto that empty claim.

/** Volumes with no hard links (exFAT, SMB, some FUSE mounts). A move there
 *  falls back to lstat-absent then rename, the race documented as in F2. */
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS']);

/** The trash folder Obsidian uses, at the vault root. */
export const VAULT_TRASH_DIR = '.trash';
/** Our record of what went into Trash and from where, inside `.trash`. A dot
 *  name, so no walk lists it. Lost or damaged, Trash still lists every note
 *  in it as a note from where it lies. */
const TRASH_MANIFEST = '.oscode-trash.json';
/** The most " 2" to " 99" (Trash) or " (restored N)" names tried. */
const MAX_NAME_TRIES = 99;

/** The seam's RenameResult. */
export type VaultRenameResult =
  | { ok: true; file: VaultFileMeta }
  | { ok: false; conflict: 'changed' | 'missing' | 'exists' | 'downloading'; theirs?: VaultFile };

/** The seam's CreateFolderResult. */
export type VaultCreateFolderResult = { ok: true } | { ok: false; conflict: 'exists' };

/** The seam's FolderMoveResult. */
export type VaultFolderMoveResult =
  | { ok: true; moved: Array<{ from: string; to: string; version: string }>; attachments: number }
  | { ok: false; conflict: 'exists' | 'missing' };

/** The seam's TrashTarget. */
export type VaultTrashTarget =
  { kind: 'note'; path: string; ifMatch: string } | { kind: 'folder'; path: string };

/** The seam's TrashResult. */
export type VaultTrashResult =
  | { ok: true; entry: VaultTrashEntry; notes: number; attachments: number }
  | { ok: false; conflict: 'changed' | 'downloading'; theirs?: VaultFile };

/** The seam's RestoreResult. A folder's `file` is the folder, with an empty
 *  version and the bytes it holds as its size. */
export type VaultRestoreResult =
  { ok: true; file: VaultFileMeta; renamed: boolean } | { ok: false; conflict: 'missing' };

function codeOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function isMissing(err: unknown): boolean {
  const code = codeOf(err);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function lstatOrNull(path: string): Promise<BigIntStats | null> {
  try {
    return await lstat(path, { bigint: true });
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

function metaOfStat(path: string, st: BigIntStats): VaultFileMeta {
  return {
    path,
    updatedAt: new Date(Number(st.mtimeMs)).toISOString(),
    size: Number(st.size),
    version: noteVersion(st),
  };
}

/** The folder rule: an existing folder's path is one a note inside it could
 *  have, so no dot segment, no backslash, not rooted, no empty segment. */
export function isVaultFolderPath(path: unknown): path is string {
  if (typeof path !== 'string' || !path || path.endsWith('/')) return false;
  return path.split('/').every(Boolean) && isVaultNotePath(`${path}/x.md`);
}

/** A folder's absolute path, refusing anything the folder rule refuses or
 *  that would leave the vault. */
export function vaultFolderAbs(root: string, path: string): string {
  if (!isVaultFolderPath(path)) {
    throw new Error('blocked: that is not a vault folder (no dot folders, no backslash)');
  }
  return new Jail(root).resolve(path);
}

/** An attachment's absolute path, refusing anything `isAttachmentPath`
 *  refuses or that would leave the vault. */
export function vaultAttachmentAbs(root: string, path: string): string {
  if (typeof path !== 'string' || !isAttachmentPath(path)) {
    throw new Error('blocked: only images and PDFs outside dot folders cross as attachments');
  }
  return new Jail(root).resolve(path);
}

/** A new note name, checked by the one new-name rule. */
function assertNewNoteName(path: unknown): asserts path is string {
  if (typeof path !== 'string') throw new Error('blocked: path must be a string');
  const check = checkNewNoteName(path);
  if (!check.ok) throw new Error(`blocked: ${check.error}`);
  if (check.path !== path) throw new Error(`blocked: that name is not a clean note name`);
}

/** A new folder name: the new-name rule on a note inside it. */
function assertNewFolderName(path: unknown): asserts path is string {
  if (typeof path !== 'string' || !path || /^\/|\/$|\/\//.test(path)) {
    throw new Error('blocked: that is not a clean folder name');
  }
  const probe = `${path}/x.md`;
  const check = checkNewNoteName(probe);
  if (!check.ok || check.path !== probe) {
    throw new Error('blocked: that is not a clean folder name');
  }
}

/** The name in `dirAbs` that folds (NFC, then case) the same as `name`, when
 *  there is one: the storage's own truth, so `Plan.md` is taken by `plan.md`
 *  on any volume. */
async function takenIn(dirAbs: string, name: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(dirAbs);
  } catch (err) {
    if (isMissing(err)) return undefined;
    throw err;
  }
  const folded = foldPath(name);
  return names.find((n) => foldPath(n) === folded);
}

/** `relDir` with each folder that already exists under a name that folds the
 *  same (case, composition) spelled the way the storage has it, so a move to
 *  `work/x.md` lands in the `Work` folder that is there, as a volume that
 *  folds case would do, and never beside it as a near twin. */
async function canonicalDir(rootReal: string, relDir: string): Promise<string> {
  const out: string[] = [];
  let cur = rootReal;
  let exists = true;
  for (const seg of relDir.split('/').filter(Boolean)) {
    let name = seg;
    if (exists) {
      const found = await takenIn(cur, seg);
      const st = found === undefined ? null : await lstatOrNull(join(cur, found));
      if (found !== undefined && st?.isDirectory()) name = found;
      else exists = false;
    }
    out.push(name);
    cur = join(cur, name);
  }
  return out.join('/');
}

function parentOf(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i === -1 ? '' : rel.slice(0, i);
}

function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** Make every folder of `rel` under the jail root, each one checked to be a
 *  real folder (never a link, never a file). */
async function ensureRealDirs(rootReal: string, rel: string): Promise<void> {
  let cur = rootReal;
  for (const seg of rel.split('/').filter(Boolean)) {
    cur = join(cur, seg);
    let st = await lstatOrNull(cur);
    if (!st) {
      await mkdir(cur).catch((err: unknown) => {
        if (codeOf(err) !== 'EEXIST') throw err;
      });
      st = await lstatOrNull(cur);
    }
    if (!st || !st.isDirectory()) {
      throw new Error(`blocked: ${seg} is not a folder here`);
    }
  }
}

/** Link `src` to `dst`, which never replaces. `renamed` when the volume has
 *  no hard links and the file was renamed instead (after an lstat found
 *  `dst` absent; a name landing in that gap would be replaced, the F2 race). */
async function linkNoReplace(src: string, dst: string): Promise<'linked' | 'renamed' | 'exists'> {
  try {
    await link(src, dst);
    return 'linked';
  } catch (err) {
    const code = codeOf(err);
    if (code === 'EEXIST') return 'exists';
    if (!code || !LINK_UNSUPPORTED.has(code)) throw err;
    if (await lstatOrNull(dst)) return 'exists';
    await rename(src, dst);
    return 'renamed';
  }
}

/** Move a folder onto `dst` without replacing anything: claim `dst` with
 *  mkdir (which fails when anything has the name), then rename onto that
 *  empty claim. Windows will not rename onto a folder, so the claim is
 *  dropped first there. False when `dst` is taken. */
async function moveDirNoReplace(src: string, dst: string): Promise<boolean> {
  try {
    await mkdir(dst);
  } catch (err) {
    if (codeOf(err) === 'EEXIST') return false;
    throw err;
  }
  try {
    await rename(src, dst);
  } catch (err) {
    const code = codeOf(err);
    if (code !== 'EPERM' && code !== 'EEXIST' && code !== 'EACCES') {
      await rmdir(dst).catch(() => undefined);
      throw err;
    }
    // Windows: the claim must go before the rename. A folder that filled
    // the claim meanwhile is someone else's and stays.
    try {
      await rmdir(dst);
    } catch {
      return false;
    }
    await rename(src, dst);
  }
  return true;
}

async function theirsOf(path: string, abs: string): Promise<VaultFile | undefined> {
  const note = await readNote(abs).catch(() => null);
  return note
    ? { path, text: note.text, updatedAt: note.updatedAt, version: note.version }
    : undefined;
}

function tempBeside(abs: string): string {
  return join(
    dirname(abs),
    `.${basename(abs).slice(0, 50)}.oscode-${randomBytes(4).toString('hex')}.tmp`,
  );
}

/**
 * Rename one note (tech review K3). Guarded by the source's version and never
 * replacing: `exists` when a name that folds the same is taken in the
 * destination folder, `missing` when the source is gone, `changed` when its
 * version moved (theirs is what is there now). A case-only rename of the same
 * note is allowed and goes through a temp name, so a case-insensitive volume
 * takes it. Parents of `to` are made. `to` passes the new-name rule. The move
 * is link(from, to), a second look at the source's version, then unlink; a
 * source that moved in between keeps its name and the new link goes. The
 * answer carries the version at `to`, which the caller adopts.
 */
export async function renameVaultFile(
  root: string,
  from: string,
  to: string,
  guard: { ifMatch: string },
): Promise<VaultRenameResult> {
  const src = vaultNoteAbs(root, from);
  assertNewNoteName(to);
  const rootReal = new Jail(root).root;
  new Jail(root).resolve(to);
  // Parents are matched to the folders already there (by folded name).
  to = joinRel(await canonicalDir(rootReal, parentOf(to)), basename(to));
  const dst = vaultNoteAbs(root, to);

  const st = await lstatOrNull(src);
  if (!st) return { ok: false, conflict: 'missing' };
  if (st.isSymbolicLink()) throw new Error('blocked: a linked note is not renamed from here');
  if (!st.isFile()) throw new Error(`blocked: ${basename(from)} is a folder, not a note`);
  const changed = async (): Promise<VaultRenameResult> => {
    const theirs = await theirsOf(from, src);
    return theirs ? { ok: false, conflict: 'changed', theirs } : { ok: false, conflict: 'missing' };
  };
  if (noteVersion(st) !== guard.ifMatch) return changed();
  if (from === to) return { ok: true, file: metaOfStat(to, st) };

  // Taken? Judged by the folded name in the destination folder. The one
  // exception is the source itself (a case-only rename on a volume that
  // folds case), recognized by its inode.
  const taken = await takenIn(dirname(dst), basename(dst));
  let caseOnly = false;
  if (taken !== undefined) {
    const there = await lstatOrNull(join(dirname(dst), taken));
    if (there && there.ino === st.ino && there.dev === st.dev && foldPath(from) === foldPath(to)) {
      caseOnly = true;
    } else {
      const theirs = await theirsOf(joinRel(parentOf(to), taken), join(dirname(dst), taken));
      return theirs ? { ok: false, conflict: 'exists', theirs } : { ok: false, conflict: 'exists' };
    }
  }
  await ensureRealDirs(rootReal, parentOf(to));

  if (caseOnly) {
    // The same file under another case: aside to a temp name, then linked to
    // the new spelling (the old one is gone by then, so it is free).
    const tmp = tempBeside(src);
    await rename(src, tmp);
    const moved = await lstatOrNull(tmp);
    if (!moved || noteVersion(moved) !== guard.ifMatch) {
      await rename(tmp, src);
      return changed();
    }
    const how = await linkNoReplace(tmp, dst);
    if (how === 'exists') {
      await rename(tmp, src);
      const theirs = await theirsOf(to, dst);
      return theirs ? { ok: false, conflict: 'exists', theirs } : { ok: false, conflict: 'exists' };
    }
    if (how === 'linked') await unlink(tmp);
  } else {
    const how = await linkNoReplace(src, dst);
    if (how === 'exists') {
      const theirs = await theirsOf(to, dst);
      return theirs ? { ok: false, conflict: 'exists', theirs } : { ok: false, conflict: 'exists' };
    }
    if (how === 'linked') {
      const now = await lstatOrNull(src);
      if (!now || noteVersion(now) !== guard.ifMatch) {
        // Replaced by a writer between the look and the link: the new name
        // holds their file, not ours, so it goes and the source stays.
        await unlink(dst).catch(() => undefined);
        return changed();
      }
      await unlink(src);
    }
  }
  const after = await lstatOrNull(dst);
  if (!after) return { ok: false, conflict: 'missing' };
  return { ok: true, file: metaOfStat(to, after) };
}

/** Every real folder in the vault, empty ones too, sorted. Dot folders and
 *  links are left out, as the note list leaves them. */
export async function listVaultFolders(root: string): Promise<string[]> {
  return (await walkVault(root, { folders: true })).folders;
}

/** Make one folder, parents too. `exists` when a name that folds the same is
 *  taken where it would go. */
export async function createVaultFolder(
  root: string,
  path: string,
): Promise<VaultCreateFolderResult> {
  assertNewFolderName(path);
  const jail = new Jail(root);
  jail.resolve(path);
  const parent = await canonicalDir(jail.root, parentOf(path));
  const abs = vaultFolderAbs(root, joinRel(parent, basename(path)));
  if (await takenIn(dirname(abs), basename(abs))) return { ok: false, conflict: 'exists' };
  await ensureRealDirs(jail.root, parent);
  try {
    await mkdir(abs);
  } catch (err) {
    if (codeOf(err) === 'EEXIST') return { ok: false, conflict: 'exists' };
    throw err;
  }
  return { ok: true };
}

/**
 * Rename (or move) a folder with one directory rename (tech review K5). `missing`
 * when `from` is not a real folder; `exists` when `to` is taken (a case-only
 * rename of the same folder is allowed). A folder never moves into itself.
 * The answer lists every note that moved with its version there, and how many
 * attachments went with them.
 */
export async function renameVaultFolder(
  root: string,
  from: string,
  to: string,
): Promise<VaultFolderMoveResult> {
  const src = vaultFolderAbs(root, from);
  assertNewFolderName(to);
  const jail = new Jail(root);
  jail.resolve(to);
  if (foldPath(to).startsWith(`${foldPath(from)}/`)) {
    throw new Error('blocked: a folder cannot move into itself');
  }
  to = joinRel(await canonicalDir(jail.root, parentOf(to)), basename(to));
  const dst = vaultFolderAbs(root, to);
  const st = await lstatOrNull(src);
  if (!st || !st.isDirectory()) return { ok: false, conflict: 'missing' };
  if (from === to) return { ok: false, conflict: 'exists' };

  const taken = await takenIn(dirname(dst), basename(dst));
  let caseOnly = false;
  if (taken !== undefined) {
    const there = await lstatOrNull(join(dirname(dst), taken));
    if (there && there.ino === st.ino && there.dev === st.dev) caseOnly = true;
    else return { ok: false, conflict: 'exists' };
  }
  const before = await walkVault(root, { under: from, counts: true });
  await ensureRealDirs(jail.root, parentOf(to));
  if (caseOnly) {
    const tmp = tempBeside(src);
    await rename(src, tmp);
    if (!(await moveDirNoReplace(tmp, dst))) {
      await rename(tmp, src);
      return { ok: false, conflict: 'exists' };
    }
  } else if (!(await moveDirNoReplace(src, dst))) {
    return { ok: false, conflict: 'exists' };
  }
  const moved: Array<{ from: string; to: string; version: string }> = [];
  for (const note of before.notes) {
    const next = `${to}${note.path.slice(from.length)}`;
    const now = await lstatOrNull(join(jail.root, ...next.split('/')));
    if (now?.isFile()) moved.push({ from: note.path, to: next, version: noteVersion(now) });
  }
  return { ok: true, moved, attachments: before.attachments.length };
}

// ---------------------------------------------------------------------------
// Trash (tech review K6; R3 for Restore's name)

interface TrashRecord {
  id: string;
  path: string;
  kind: 'note' | 'folder';
  trashedAt: string;
}

/** A Trash id: a path under `.trash` with no dot segment, no backslash, not
 *  rooted, no empty segment. */
export function isVaultTrashId(id: unknown): id is string {
  if (typeof id !== 'string' || !id || id.length > 4096) return false;
  if (id.includes('\\') || id.includes('\0')) return false;
  return id.split('/').every((s) => s !== '' && !s.startsWith('.'));
}

/** The real `.trash` folder, or null when there is none (or it is a link or
 *  a file, which is never used). */
async function trashDir(root: string, make: boolean): Promise<string | null> {
  const jail = new Jail(root);
  const abs = join(jail.root, VAULT_TRASH_DIR);
  let st = await lstatOrNull(abs);
  if (!st && make) {
    await mkdir(abs).catch((err: unknown) => {
      if (codeOf(err) !== 'EEXIST') throw err;
    });
    st = await lstatOrNull(abs);
  }
  if (!st) return null;
  if (!st.isDirectory()) throw new Error('blocked: the vault .trash is not a folder');
  return abs;
}

async function readTrashManifest(trash: string): Promise<TrashRecord[]> {
  let raw: string;
  try {
    const st = await lstat(join(trash, TRASH_MANIFEST));
    if (!st.isFile() || st.size > 4 * 1024 * 1024) return [];
    raw = await readFile(join(trash, TRASH_MANIFEST), 'utf8');
  } catch {
    return [];
  }
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
    if (!kind || !isVaultTrashId(r.id) || typeof r.path !== 'string') continue;
    const pathOk = kind === 'note' ? isVaultNotePath(r.path) : isVaultFolderPath(r.path);
    if (!pathOk) continue;
    out.push({
      id: r.id,
      path: r.path,
      kind,
      trashedAt: typeof r.trashedAt === 'string' ? r.trashedAt : '',
    });
  }
  return out;
}

async function writeTrashManifest(trash: string, records: TrashRecord[]): Promise<void> {
  const abs = join(trash, TRASH_MANIFEST);
  if (!records.length) {
    await unlink(abs).catch(() => undefined);
    return;
  }
  const tmp = tempBeside(abs);
  await writeFile(tmp, `${JSON.stringify({ version: 1, entries: records }, null, 2)}\n`);
  await rename(tmp, abs);
}

/** A name in Trash for `rel`: the same path, or ` 2` to ` 99` beside it. */
function trashNameAt(rel: string, n: number, note: boolean): string {
  if (n === 1) return rel;
  if (note) return `${rel.slice(0, -3)} ${n}${rel.slice(-3)}`;
  return `${rel} ${n}`;
}

/** Remove empty folders from `relDir` up to (not including) `.trash`. */
async function pruneTrashDirs(trash: string, relDir: string, keep: ReadonlySet<string>) {
  let cur = relDir;
  while (cur && cur !== '.') {
    if (keep.has(cur)) return;
    try {
      await rmdir(join(trash, ...cur.split('/')));
    } catch {
      return;
    }
    const i = cur.lastIndexOf('/');
    cur = i === -1 ? '' : cur.slice(0, i);
  }
}

/**
 * Move a note or a folder to `<vault>/.trash/<original path>` (tech review K6), the
 * folders on the way kept so Restore knows where it goes; a taken name gets
 * ` 2` to ` 99`. A note is guarded by its version (`changed` with theirs when
 * it moved, or without when it is gone); a folder is moved as it is, since
 * Trash is recoverable. The entry, and how many notes and attachments went in.
 */
export async function trashVaultPath(
  root: string,
  target: VaultTrashTarget,
): Promise<VaultTrashResult> {
  const isNote = target.kind === 'note';
  const src = isNote ? vaultNoteAbs(root, target.path) : vaultFolderAbs(root, target.path);
  const st = await lstatOrNull(src);
  if (!st) return { ok: false, conflict: 'changed' };
  if (st.isSymbolicLink()) throw new Error('blocked: a link is not moved to Trash from here');
  if (isNote && !st.isFile()) throw new Error(`blocked: ${basename(target.path)} is a folder`);
  if (!isNote && !st.isDirectory()) return { ok: false, conflict: 'changed' };
  if (target.kind === 'note' && noteVersion(st) !== target.ifMatch) {
    const theirs = await theirsOf(target.path, src);
    return theirs ? { ok: false, conflict: 'changed', theirs } : { ok: false, conflict: 'changed' };
  }
  const counted = isNote ? undefined : await walkVault(root, { under: target.path, counts: true });
  const trash = (await trashDir(root, true))!;
  const parent = target.path.includes('/')
    ? target.path.slice(0, target.path.lastIndexOf('/'))
    : '';
  await ensureRealDirs(trash, parent);

  let id: string | undefined;
  for (let n = 1; n <= MAX_NAME_TRIES && !id; n++) {
    const candidate = trashNameAt(target.path, n, isNote);
    const dst = join(trash, ...candidate.split('/'));
    if (await takenIn(dirname(dst), basename(dst))) continue;
    if (isNote) {
      const how = await linkNoReplace(src, dst);
      if (how === 'exists') continue;
      if (how === 'linked') {
        const now = await lstatOrNull(src);
        if (!now || noteVersion(now) !== (target as { ifMatch: string }).ifMatch) {
          await unlink(dst).catch(() => undefined);
          await pruneTrashDirs(trash, parent, new Set());
          const theirs = await theirsOf(target.path, src);
          return theirs
            ? { ok: false, conflict: 'changed', theirs }
            : { ok: false, conflict: 'changed' };
        }
        await unlink(src);
      }
      id = candidate;
    } else if (await moveDirNoReplace(src, dst)) {
      id = candidate;
    }
  }
  if (!id) throw new Error(`Trash already holds ${MAX_NAME_TRIES} of "${basename(target.path)}".`);
  const trashedAt = new Date().toISOString();
  const records = await readTrashManifest(trash);
  records.push({ id, path: target.path, kind: target.kind, trashedAt });
  await writeTrashManifest(trash, records);
  const entry: VaultTrashEntry = {
    id,
    path: target.path,
    kind: target.kind,
    size: isNote ? Number(st.size) : counted!.bytes,
    trashedAt,
  };
  return isNote
    ? { ok: true, entry, notes: 1, attachments: 0 }
    : { ok: true, entry, notes: counted!.notes.length, attachments: counted!.attachments.length };
}

/** Bytes of every regular file under `abs`, no link followed. */
async function bytesUnder(abs: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) total += Number((await lstatOrNull(p))?.size ?? 0);
    }
  };
  await walk(abs);
  return total;
}

/** Every note in Trash that no record covers: something Obsidian (or anyone)
 *  put there, listed from where it lies. */
async function looseTrashNotes(
  trash: string,
  records: readonly TrashRecord[],
): Promise<VaultTrashEntry[]> {
  const out: VaultTrashEntry[] = [];
  const noteIds = new Set(records.filter((r) => r.kind === 'note').map((r) => r.id));
  const folderIds = new Set(records.filter((r) => r.kind === 'folder').map((r) => r.id));
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!folderIds.has(r)) await walk(p, r);
      } else if (e.isFile() && !noteIds.has(r) && isVaultNotePath(r)) {
        const st = await lstatOrNull(p);
        if (!st) continue;
        out.push({
          id: r,
          path: r,
          kind: 'note',
          size: Number(st.size),
          trashedAt: new Date(Number(st.ctimeMs)).toISOString(),
        });
      }
    }
  };
  await walk(trash, '');
  return out;
}

/** What Trash holds, newest first. A record whose file is gone is left out. */
export async function listVaultTrash(root: string): Promise<VaultTrashEntry[]> {
  if (!existsSync(root)) return [];
  const trash = await trashDir(root, false);
  if (!trash) return [];
  const records = await readTrashManifest(trash);
  const live: TrashRecord[] = [];
  const out: VaultTrashEntry[] = [];
  for (const r of records) {
    const st = await lstatOrNull(join(trash, ...r.id.split('/')));
    if (!st || (r.kind === 'note' ? !st.isFile() : !st.isDirectory())) continue;
    live.push(r);
    const size =
      r.kind === 'note' ? Number(st.size) : await bytesUnder(join(trash, ...r.id.split('/')));
    out.push({
      id: r.id,
      path: r.path,
      kind: r.kind,
      size,
      ...(r.trashedAt ? { trashedAt: r.trashedAt } : {}),
    });
  }
  out.push(...(await looseTrashNotes(trash, live)));
  out.sort(
    (a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? '') || a.id.localeCompare(b.id),
  );
  return out;
}

/** The name a restore tries at step `n`: the original, then
 *  "{title} (restored)", then "{title} (restored 2)" and on (R3). */
function restoreNameAt(path: string, n: number, note: boolean): string {
  if (n === 0) return path;
  const stem = note ? path.slice(0, -3) : path;
  const tag = n === 1 ? ' (restored)' : ` (restored ${n})`;
  return `${stem}${tag}${note ? path.slice(-3) : ''}`;
}

/**
 * Put one Trash entry back where it came from (tech review K6, R3). Never overwrites:
 * a taken name lands beside it as "{title} (restored)", and the folders on
 * the way are made again. `missing` when the entry is not in Trash.
 */
export async function restoreVaultTrash(root: string, id: string): Promise<VaultRestoreResult> {
  if (!isVaultTrashId(id)) throw new Error('blocked: that is not a Trash entry');
  const trash = await trashDir(root, false);
  if (!trash) return { ok: false, conflict: 'missing' };
  const entry = (await listVaultTrash(root)).find((e) => e.id === id);
  if (!entry) return { ok: false, conflict: 'missing' };
  const isNote = entry.kind === 'note';
  const src = new Jail(trash).resolve(id);
  const jail = new Jail(root);
  const parent = await canonicalDir(jail.root, parentOf(entry.path));
  const home = joinRel(parent, basename(entry.path));
  await ensureRealDirs(jail.root, parent);

  let landed: string | undefined;
  for (let n = 0; n <= MAX_NAME_TRIES && !landed; n++) {
    const candidate = restoreNameAt(home, n, isNote);
    const dst = jail.resolve(candidate);
    if (await takenIn(dirname(dst), basename(dst))) continue;
    if (isNote) {
      const how = await linkNoReplace(src, dst);
      if (how === 'exists') continue;
      if (how === 'linked') await unlink(src);
      landed = candidate;
    } else if (await moveDirNoReplace(src, dst)) {
      landed = candidate;
    }
  }
  if (!landed) throw new Error(`Every restored name for "${basename(entry.path)}" is taken.`);

  const records = await readTrashManifest(trash);
  const rest = records.filter((r) => r.id !== id);
  await writeTrashManifest(trash, rest);
  const idDir = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
  await pruneTrashDirs(trash, idDir, new Set(rest.map((r) => r.id)));

  const abs = jail.resolve(landed);
  const st = await lstatOrNull(abs);
  if (!st) return { ok: false, conflict: 'missing' };
  const file: VaultFileMeta = isNote
    ? metaOfStat(landed, st)
    : {
        path: landed,
        updatedAt: new Date(Number(st.mtimeMs)).toISOString(),
        size: await bytesUnder(abs),
        version: '',
      };
  return { ok: true, file, renamed: landed !== home };
}

/**
 * Delete Trash entries for good: the ids given, or everything in Trash. The
 * one destructive act here; the app asks first. Ids not in Trash are skipped.
 */
export async function emptyVaultTrash(
  root: string,
  ids?: readonly string[],
): Promise<{ removed: number }> {
  if (ids) for (const id of ids) if (!isVaultTrashId(id)) throw new Error('blocked: bad Trash id');
  if (!existsSync(root)) return { removed: 0 };
  const trash = await trashDir(root, false);
  if (!trash) return { removed: 0 };
  const entries = await listVaultTrash(root);
  const wanted = ids ? new Set(ids) : undefined;
  const targets = wanted ? entries.filter((e) => wanted.has(e.id)) : entries;
  const jail = new Jail(trash);
  let removed = 0;
  for (const e of targets) {
    await rm(jail.resolve(e.id), { recursive: true, force: true });
    removed += 1;
  }
  if (!wanted) {
    // Everything else in Trash goes too (what Obsidian put there that is not
    // a note), so Empty leaves it empty. `.trash` itself stays.
    for (const name of await readdir(trash)) {
      await rm(join(trash, name), { recursive: true, force: true });
    }
    return { removed };
  }
  const gone = new Set(targets.map((e) => e.id));
  const rest = (await readTrashManifest(trash)).filter((r) => !gone.has(r.id));
  await writeTrashManifest(trash, rest);
  const keep = new Set(rest.map((r) => r.id));
  for (const id of gone) {
    await pruneTrashDirs(trash, id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '', keep);
  }
  return { removed };
}

// ---------------------------------------------------------------------------
// Attachments (tech review K11)

/** Every attachment in the vault (the note list's walk), sorted by path. */
export async function listVaultAttachments(root: string): Promise<AttachmentMeta[]> {
  return (await walkVault(root, { attachments: true })).attachments;
}

/**
 * One attachment's bytes, in the `ConfigRead` style (tech review K2, K11): `refused`
 * for a path that is not an attachment, leaves the vault, or is a link;
 * `absent`; `too-large` past 20 MB (or a lower `max`); `unsupported` when the
 * bytes are not the type the name says.
 */
export async function readVaultBytes(
  root: string,
  path: string,
  opts: ReadBytesOptions = {},
): Promise<BytesRead> {
  let abs: string;
  try {
    abs = vaultAttachmentAbs(root, path);
  } catch {
    return { ok: false, reason: 'refused' };
  }
  const mime = attachmentMime(path);
  if (!mime) return { ok: false, reason: 'refused' };
  const cap = Math.min(
    VAULT_ATTACHMENT_MAX_BYTES,
    typeof opts.max === 'number' && opts.max >= 0 ? opts.max : Infinity,
  );
  const st = await lstatOrNull(abs);
  if (!st) return { ok: false, reason: 'absent' };
  if (!st.isFile()) return { ok: false, reason: 'refused' };
  if (Number(st.size) > cap) return { ok: false, reason: 'too-large' };
  const read = await readNoteBytes(abs);
  if (!read) return { ok: false, reason: 'absent' };
  if (read.bytes.length > cap) return { ok: false, reason: 'too-large' };
  const bytes = new Uint8Array(read.bytes.buffer, read.bytes.byteOffset, read.bytes.length);
  if (!bytesMatchMime(bytes, mime)) return { ok: false, reason: 'unsupported' };
  return { ok: true, bytes, mime, version: read.version };
}

// ---------------------------------------------------------------------------
// Argument checks for the bridge and the wire (untrusted input, UI-6)

/** A rename guard: `{ ifMatch }` only, and it is required. */
export function parseVaultRenameGuard(v: unknown): { ifMatch: string } {
  const g = parseVaultRemoveGuard(v);
  if (!g) throw new Error('blocked: a rename takes { ifMatch }');
  return g;
}

/** A Trash target: a note with its version, or a folder. */
export function parseVaultTrashTarget(v: unknown): VaultTrashTarget {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('blocked: a Trash target must be an object');
  }
  const t = v as Record<string, unknown>;
  if (typeof t.path !== 'string') throw new Error('blocked: a Trash target needs a path');
  if (t.kind === 'note') {
    return { kind: 'note', path: t.path, ...parseVaultRenameGuard({ ifMatch: t.ifMatch }) };
  }
  if (t.kind === 'folder') return { kind: 'folder', path: t.path };
  throw new Error("blocked: a Trash target's kind is note or folder");
}

/** Trash ids for Empty: undefined for all, else at most 10,000 ids. */
export function parseVaultTrashIds(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > 10_000 || !v.every(isVaultTrashId)) {
    throw new Error('blocked: ids must be a list of Trash ids');
  }
  return v as string[];
}

/** readBytes options: `{ max }`, a number that only lowers the cap. */
export function parseReadBytesOptions(v: unknown): ReadBytesOptions {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v))
    throw new Error('blocked: options must be an object');
  const max = (v as Record<string, unknown>).max;
  if (max === undefined) return {};
  if (typeof max !== 'number' || !Number.isFinite(max) || max < 0) {
    throw new Error('blocked: max must be a number of bytes');
  }
  return { max };
}
