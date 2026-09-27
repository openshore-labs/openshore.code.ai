// A vault note on a desktop folder: the one way a note is versioned, read, and
// written, shared by the engine's vault tools, the routine scheduler, and the
// Electron main process (which imports it from os-code/dist, the way it
// imports loadVaultDir). Node-side on purpose, so it lives outside
// src/harness/, whose purity guard covers that folder. (Vault v1, CTO F1, F2.)
//
// The version is the bigint lstat token "ino:mtimeNs:size", built only by
// noteVersion and compared with === only. The inode catches every rename-over
// (an editor's atomic save, a sync client, our own writes); mtimeNs catches an
// in-place writer like Obsidian. Known residual: the same inode rewritten to
// the same size inside one file system timestamp tick (a few ms on Linux's
// coarse clock) keeps its token. The opposite error, a token that moves while
// the bytes stay the same (a touch, a sync client's identical rewrite), is the
// caller's to absorb by comparing text.
//
// Every save to an existing note is a temp file in the same folder, synced,
// then renamed over the note, so a reader sees the old body or the new one,
// never a torn write, and a crash leaves the note whole. A new note is
// published with link(), which never replaces anything. The note's mode is
// carried, and so is its creation date where the OS allows it: macOS moves a
// birth time back when mtime is set earlier than it, and Windows keeps it
// through NTFS tunneling on the rename. On Linux no API sets it, so it resets
// on each save. Not carried: Finder tags and other xattrs (Node has no xattr
// API). A write that lands between the guard check and the rename is
// overwritten: no lock is shared with other editors, so the check runs as late
// as it can, after the temp file is complete and synced.
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

/** A write's precondition. `ifMatch` replaces the note only while its version
 *  is still this one; `ifAbsent` creates it only while nothing has the name. */
export type NoteGuard = { ifMatch: string } | { ifAbsent: true };

/** A note as read: its text and the version and time of exactly those bytes. */
export interface NoteRead {
  text: string;
  version: string;
  updatedAt: string;
}

/** A note's metadata from one lstat. `size` is in bytes. */
export interface NoteStat {
  version: string;
  updatedAt: string;
  size: number;
}

export type WriteNoteResult =
  | { ok: true; version: string; updatedAt: string }
  | { ok: false; conflict: 'changed' | 'missing' | 'exists'; theirs?: NoteRead };

/** A folder (or another non-file) sits where a note was asked for. */
export class NotANoteError extends Error {
  constructor(path: string) {
    super(`${basename(path)} is a folder, not a note.`);
    this.name = 'NotANoteError';
  }
}

/** The name every temp file carries: a dot name, so the vault list, Obsidian,
 *  and the watcher skip it, in the note's own folder, so the rename is atomic.
 *  Main's list walk sweeps stale ones (sweepNoteTemps). */
export const NOTE_TEMP_PATTERN = /^\..+\.oscode-[0-9a-f]{8}\.tmp$/;

/** A temp file older than this was left by a crash, never by a save in flight. */
const STALE_TEMP_MS = 60 * 60 * 1000;

/** Rename failures Windows raises while antivirus or another process briefly
 *  holds the file; retried a few times before the save gives up. */
const WIN_RENAME_RETRY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const WIN_RENAME_TRIES = 5;
const WIN_RENAME_BACKOFF_MS = 40;

/** Volumes with no hard links (exFAT, SMB, some FUSE mounts): a new note is
 *  created with O_EXCL there instead, which still never replaces. */
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS']);

/** Tests only: runs once the temp file is complete and synced, before the
 *  guard check and the publish. A throw here stands for a crash at that point,
 *  so it skips the cleanup a failed publish gets. */
export const noteFileHooksForTests: { afterTemp?: (tmp: string) => void } = {};

/** The one place a version is built. Feed it `lstat(real, { bigint: true })`
 *  or `fh.stat({ bigint: true })`, never a Date or a non-bigint stat. */
export function noteVersion(st: BigIntStats): string {
  return `${st.ino}:${st.mtimeNs}:${st.size}`;
}

function updatedAtOf(st: BigIntStats): string {
  return new Date(Number(st.mtimeMs)).toISOString();
}

function codeOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** ENOENT (and ENOTDIR, a parent that is a file) read as "not there". */
function isMissing(err: unknown): boolean {
  const code = codeOf(err);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function lstatOrNull(path: string): Promise<BigIntStats | null> {
  try {
    return await lstat(path, { bigint: true });
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function unlinkQuiet(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}

function tempNameFor(target: string): string {
  // A very long note name would push the temp name past the 255-byte limit.
  const stem = basename(target);
  const short = Buffer.byteLength(stem) > 200 ? stem.slice(0, 50) : stem;
  return join(dirname(target), `.${short}.oscode-${randomBytes(4).toString('hex')}.tmp`);
}

/** One read through one fd: the bytes and the stat that describe them. */
async function readOnce(real: string): Promise<{ bytes: Buffer; st: BigIntStats } | null> {
  let fh;
  try {
    fh = await open(real, 'r');
  } catch (err) {
    if (isMissing(err)) return null;
    if (codeOf(err) === 'EISDIR') throw new NotANoteError(real);
    throw err;
  }
  try {
    const st = await fh.stat({ bigint: true });
    if (!st.isFile()) throw new NotANoteError(real);
    return { bytes: await fh.readFile(), st };
  } finally {
    await fh.close();
  }
}

/** Read a note's raw bytes with the version of exactly those bytes, through
 *  its link when it is one. Null when nothing is there. The torn-read guard:
 *  the path is looked at again after the read, and when its token moved (a
 *  replace or an in-place save landed during the read) it is read once more. */
export async function readNoteBytes(
  absPath: string,
): Promise<{ bytes: Buffer; version: string; updatedAt: string } | null> {
  const real = await realpathOrNull(absPath);
  if (!real) return null;
  let read = await readOnce(real);
  if (!read) return null;
  const after = await lstatOrNull(real);
  if (!after || noteVersion(after) !== noteVersion(read.st)) {
    read = await readOnce(real);
    if (!read) return null;
  }
  return { bytes: read.bytes, version: noteVersion(read.st), updatedAt: updatedAtOf(read.st) };
}

/** Read a note as text with its version. Null when nothing is there; a folder
 *  named like a note throws NotANoteError. */
export async function readNote(absPath: string): Promise<NoteRead | null> {
  const read = await readNoteBytes(absPath);
  return (
    read && { text: read.bytes.toString('utf8'), version: read.version, updatedAt: read.updatedAt }
  );
}

/** A note's version, time, and size from one lstat of its real path. Null
 *  when nothing is there, or when what is there is not a file. */
export async function statNote(absPath: string): Promise<NoteStat | null> {
  const real = await realpathOrNull(absPath);
  if (!real) return null;
  const st = await lstatOrNull(real);
  if (!st || !st.isFile()) return null;
  return { version: noteVersion(st), updatedAt: updatedAtOf(st), size: Number(st.size) };
}

/** Write the full text to a fresh temp file beside `target`, carrying the
 *  original's mode and (on macOS) its creation date, and sync it. The version
 *  comes from the temp fd, never from a stat of the path after the publish,
 *  or a write landing after the publish would be adopted as ours. */
async function writeTemp(
  target: string,
  text: string,
  orig?: BigIntStats,
): Promise<{ tmp: string; version: string; updatedAt: string }> {
  const tmp = tempNameFor(target);
  const fh = await open(tmp, 'wx');
  let closed = false;
  try {
    await fh.writeFile(Buffer.from(text, 'utf8'));
    if (orig && process.platform !== 'win32') await fh.chmod(Number(orig.mode) & 0o7777);
    if (orig && process.platform === 'darwin' && orig.birthtimeNs > 0n) {
      // APFS and HFS+ move the birth time back to an earlier mtime; then the
      // mtime goes forward to now, and the birth time stays.
      await fh.utimes(orig.atime, orig.birthtime);
      await fh.utimes(orig.atime, new Date());
    }
    await fh.sync();
    const st = await fh.stat({ bigint: true });
    closed = true;
    await fh.close();
    return { tmp, version: noteVersion(st), updatedAt: updatedAtOf(st) };
  } catch (err) {
    if (!closed) await fh.close().catch(() => undefined);
    await unlinkQuiet(tmp);
    throw err;
  }
}

async function renameOver(tmp: string, dest: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, dest);
      return;
    } catch (err) {
      const retry =
        process.platform === 'win32' &&
        attempt < WIN_RENAME_TRIES &&
        WIN_RENAME_RETRY.has(codeOf(err) ?? '');
      if (!retry) throw err;
      await new Promise((resolve) => setTimeout(resolve, WIN_RENAME_BACKOFF_MS));
    }
  }
}

/** Best effort: make the rename itself durable. Windows cannot open a folder. */
async function syncFolder(dir: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    const fh = await open(dir, 'r');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    // Some file systems refuse a directory fsync; the rename still landed.
  }
}

/** What sits at a name a create found taken, read back for the caller. */
async function takenBy(dest: string): Promise<WriteNoteResult> {
  const st = await lstatOrNull(dest);
  if (st?.isDirectory()) throw new NotANoteError(dest);
  const theirs = await readNote(dest).catch(() => null);
  return theirs ? { ok: false, conflict: 'exists', theirs } : { ok: false, conflict: 'exists' };
}

/** A new note on a volume with no hard links: O_EXCL, which never replaces. */
async function createExclusive(dest: string, text: string): Promise<WriteNoteResult> {
  let fh;
  try {
    fh = await open(dest, 'wx');
  } catch (err) {
    if (codeOf(err) === 'EEXIST') return takenBy(dest);
    throw err;
  }
  try {
    await fh.writeFile(Buffer.from(text, 'utf8'));
    await fh.sync();
    const st = await fh.stat({ bigint: true });
    await fh.close();
    return { ok: true, version: noteVersion(st), updatedAt: updatedAtOf(st) };
  } catch (err) {
    // The name was created by this call alone (O_EXCL), so a half-written
    // note is ours to take back.
    await fh.close().catch(() => undefined);
    await unlinkQuiet(dest);
    throw err;
  }
}

async function createNote(dest: string, text: string): Promise<WriteNoteResult> {
  const dir = dirname(dest);
  await mkdir(dir, { recursive: true });
  const { tmp, version, updatedAt } = await writeTemp(dest, text);
  noteFileHooksForTests.afterTemp?.(tmp);
  try {
    await link(tmp, dest);
  } catch (err) {
    await unlinkQuiet(tmp);
    // A case variant on a case-insensitive volume raises EEXIST on its own.
    if (codeOf(err) === 'EEXIST') return takenBy(dest);
    if (!LINK_UNSUPPORTED.has(codeOf(err) ?? '')) throw err;
    return createExclusive(dest, text);
  }
  await unlinkQuiet(tmp);
  await syncFolder(dir);
  return { ok: true, version, updatedAt };
}

/**
 * Write a note. With `{ ifMatch }` the note is replaced only while its version
 * is still that token: gone returns 'missing' (never recreated), moved returns
 * 'changed' with theirs. With `{ ifAbsent: true }` the note is created only
 * while nothing has the name, else 'exists' with theirs. A conflict is a
 * result, never a throw, and leaves the file byte for byte. With no guard it
 * is a plain atomic replace (or create), for tests and legacy callers only.
 * A folder named like the note throws NotANoteError.
 */
export async function writeNote(
  absTarget: string,
  text: string,
  guard?: NoteGuard,
): Promise<WriteNoteResult> {
  if (guard && 'ifAbsent' in guard) return createNote(absTarget, text);
  const ifMatch = guard?.ifMatch;
  // Through the link, so a linked note stays a link and its target changes.
  const real = await realpathOrNull(absTarget);
  const orig = real ? await lstatOrNull(real) : null;
  if (!real || !orig) {
    if (ifMatch !== undefined) return { ok: false, conflict: 'missing' };
    await mkdir(dirname(absTarget), { recursive: true });
  } else if (!orig.isFile()) {
    throw new NotANoteError(absTarget);
  }
  const target = real && orig ? real : absTarget;
  const { tmp, version, updatedAt } = await writeTemp(target, text, orig ?? undefined);
  noteFileHooksForTests.afterTemp?.(tmp);
  try {
    if (ifMatch !== undefined) {
      const now = await lstatOrNull(target);
      if (!now) {
        await unlinkQuiet(tmp);
        return { ok: false, conflict: 'missing' };
      }
      if (noteVersion(now) !== ifMatch) {
        await unlinkQuiet(tmp);
        const theirs = await readNote(target).catch(() => null);
        return theirs
          ? { ok: false, conflict: 'changed', theirs }
          : { ok: false, conflict: 'changed' };
      }
    }
    await renameOver(tmp, target);
  } catch (err) {
    // The save failed before it landed: the note is as it was, and the text
    // is the caller's to keep.
    await unlinkQuiet(tmp);
    throw err;
  }
  await syncFolder(dirname(target));
  return { ok: true, version, updatedAt };
}

/**
 * Create a new note synchronously, published whole with link() and never
 * replacing anything: the `ifAbsent` path of writeNote for a caller that must
 * finish in one tick (the routine scheduler records its run note that way, so
 * two runs in one minute can never replace each other and a reader never sees
 * a half-written note). 'exists' when the name is taken.
 */
export function writeNewNoteSync(
  absDest: string,
  text: string,
): { ok: true } | { ok: false; conflict: 'exists' } {
  mkdirSync(dirname(absDest), { recursive: true });
  const bytes = Buffer.from(text, 'utf8');
  const tmp = tempNameFor(absDest);
  const fd = openSync(tmp, 'wx');
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } catch (err) {
    closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      // Already gone.
    }
    throw err;
  }
  closeSync(fd);
  let linkErr: unknown;
  try {
    linkSync(tmp, absDest);
  } catch (err) {
    linkErr = err;
  }
  try {
    unlinkSync(tmp);
  } catch {
    // Already gone; the sweep would take it otherwise.
  }
  if (linkErr === undefined) return { ok: true };
  if (codeOf(linkErr) === 'EEXIST') return { ok: false, conflict: 'exists' };
  if (!LINK_UNSUPPORTED.has(codeOf(linkErr) ?? '')) throw linkErr;
  try {
    writeFileSync(absDest, bytes, { flag: 'wx' });
    return { ok: true };
  } catch (err) {
    if (codeOf(err) === 'EEXIST') return { ok: false, conflict: 'exists' };
    throw err;
  }
}

/** Remove temp files a crash left in one folder (not its subfolders), once
 *  they are over an hour old, so a save in flight is never touched. Returns
 *  how many went. Main's list walk calls it for each folder it visits. Age is
 *  judged by ctime, never mtime: a macOS save sets its temp's mtime back to
 *  the note's creation date (writeTemp), and the utimes call that does it
 *  moves the ctime to now. */
export function sweepNoteTemps(dir: string, now = Date.now()): number {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!NOTE_TEMP_PATTERN.test(name)) continue;
    const abs = join(dir, name);
    try {
      const st = lstatSync(abs);
      if (!st.isFile() || now - st.ctimeMs <= STALE_TEMP_MS) continue;
      unlinkSync(abs);
      removed += 1;
    } catch {
      // Gone already, or not ours to remove.
    }
  }
  return removed;
}
