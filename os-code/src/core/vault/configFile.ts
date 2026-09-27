// readConfig for the desktop folder vault (Vault M3, CTO H5), the Node side.
// Main's `osc:vaultReadConfig(name)` calls readVaultConfigFile with the vault
// root and the logical name the renderer sent; no path ever crosses.
//
// The name maps through the allow-list in harness/vault/configDir.ts (anything
// else is `refused`), the config folder comes from detectConfigDir, and the
// file resolves through the Jail. Both the folder and the file must lstat as
// what they claim (a directory, a regular file), never a symlink, so a link
// planted in the vault cannot read outside it. The version is the same lstat
// token a note carries (noteVersion).
//
// The one writer (Vault M7, CTO L7) is writeVaultConfigFile, for the person's
// settings sheet only: main's `osc:vaultWriteConfig` and the hub's PUT. No
// agent tool imports it (a grep test holds that), and every agent write path
// refuses `.oscode/` on its own (L8).
import { constants, type BigIntStats } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Jail, JailViolation } from '../security/jail.js';
import {
  VAULT_CONFIG_FILES,
  VAULT_CONFIG_MAX_BYTES,
  detectConfigDir,
  isVaultConfigName,
  type ConfigDirCandidate,
} from '../../harness/vault/configDir.js';
import type { ConfigRead, ConfigWriteGuard, ConfigWriteResult } from '../../harness/vault/types.js';
import { noteVersion } from './noteFile.js';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
/** Dot folders looked at, at most, so a root full of them stays cheap. */
const MAX_CANDIDATES = 64;
/** File names read from a candidate folder, at most. */
const MAX_FILES = 512;

function codeOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** The root's dot folders (real directories, never symlinks) and the names
 *  of the files directly in each, for detectConfigDir. */
export async function listConfigDirCandidates(root: string): Promise<ConfigDirCandidate[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ConfigDirCandidate[] = [];
  for (const e of entries) {
    if (out.length >= MAX_CANDIDATES) break;
    if (!e.isDirectory() || !e.name.startsWith('.')) continue;
    let files: string[] = [];
    try {
      const inner = await readdir(join(root, e.name), { withFileTypes: true });
      files = inner
        .filter((f) => f.isFile())
        .slice(0, MAX_FILES)
        .map((f) => f.name);
    } catch {}
    out.push({ name: e.name, files });
  }
  return out;
}

/** Read one allowed config file from a desktop folder vault. */
export async function readVaultConfigFile(vaultDir: string, name: unknown): Promise<ConfigRead> {
  if (!isVaultConfigName(name)) return { ok: false, reason: 'refused' };
  const spec = VAULT_CONFIG_FILES[name];
  let root: string;
  try {
    root = await realpath(vaultDir);
  } catch {
    return { ok: false, reason: 'absent' };
  }
  const dirName =
    spec.dir === 'oscode'
      ? '.oscode'
      : detectConfigDir(await listConfigDirCandidates(root), 'desktop');
  if (!dirName) return { ok: false, reason: 'absent' };

  let abs: string;
  try {
    abs = new Jail(root).resolve(join(dirName, spec.file));
  } catch (err) {
    if (err instanceof JailViolation) return { ok: false, reason: 'refused' };
    throw err;
  }

  try {
    const dirSt = await lstat(join(root, dirName));
    if (!dirSt.isDirectory()) return { ok: false, reason: 'refused' };
    const st = await lstat(abs, { bigint: true });
    if (!st.isFile()) return { ok: false, reason: 'refused' };
    if (st.size > BigInt(VAULT_CONFIG_MAX_BYTES)) return { ok: false, reason: 'too-large' };
    const fh = await open(abs, constants.O_RDONLY | NOFOLLOW);
    try {
      const fst = await fh.stat({ bigint: true });
      // The file that was opened must be the one that was checked.
      if (!fst.isFile() || fst.ino !== st.ino) return { ok: false, reason: 'refused' };
      const buf = Buffer.alloc(VAULT_CONFIG_MAX_BYTES + 1);
      let got = 0;
      while (got < buf.length) {
        const { bytesRead } = await fh.read(buf, got, buf.length - got, got);
        if (bytesRead === 0) break;
        got += bytesRead;
      }
      if (got > VAULT_CONFIG_MAX_BYTES) return { ok: false, reason: 'too-large' };
      return { ok: true, text: buf.subarray(0, got).toString('utf8'), version: noteVersion(fst) };
    } finally {
      await fh.close();
    }
  } catch (err) {
    const code = codeOf(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, reason: 'absent' };
    if (code === 'ELOOP') return { ok: false, reason: 'refused' };
    throw err;
  }
}

/** Volumes with no hard links (exFAT, SMB, some FUSE mounts): a new file is
 *  created with O_EXCL there instead, which still never replaces. */
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS']);

/** A new settings file on a volume with no hard links. */
async function createExclusive(
  abs: string,
  bytes: Buffer,
  conflict: (kind: 'exists') => Promise<ConfigWriteResult>,
): Promise<ConfigWriteResult> {
  let fh;
  try {
    fh = await open(
      abs,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
      0o644,
    );
  } catch (err) {
    if (codeOf(err) === 'EEXIST') return conflict('exists');
    throw err;
  }
  try {
    await fh.writeFile(bytes);
    await fh.sync();
    const version = noteVersion(await fh.stat({ bigint: true }));
    await fh.close();
    return { ok: true, version };
  } catch (err) {
    await fh.close().catch(() => undefined);
    await unlink(abs).catch(() => undefined);
    throw err;
  }
}

/** The one config name the writer accepts (L7). */
const WRITABLE_CONFIG = 'oscode/vault';

/** What sits in the file now, for a conflict's `current`. */
async function currentOf(root: string): Promise<{ text: string; version: string } | undefined> {
  const read = await readVaultConfigFile(root, WRITABLE_CONFIG).catch(() => undefined);
  return read?.ok ? { text: read.text, version: read.version } : undefined;
}

/** Write a guard parsed from untrusted input, or undefined when it is not
 *  exactly `{ ifMatch: string }` or `{ ifAbsent: true }`. */
function checkedGuard(guard: unknown): ConfigWriteGuard | undefined {
  if (!guard || typeof guard !== 'object' || Array.isArray(guard)) return undefined;
  const g = guard as Record<string, unknown>;
  const match = g.ifMatch !== undefined;
  const absent = g.ifAbsent !== undefined;
  if (match === absent) return undefined;
  if (match) {
    return typeof g.ifMatch === 'string' && g.ifMatch.length <= 200
      ? { ifMatch: g.ifMatch }
      : undefined;
  }
  return g.ifAbsent === true ? { ifAbsent: true } : undefined;
}

/**
 * Write the vault's own settings file, `.oscode/vault.json` (Vault M7, CTO
 * L7), for the person's settings sheet. Every other name (each `obsidian/*`)
 * is `refused`: Obsidian's config is read, never written. `.oscode` is made
 * when missing and must lstat as a real directory (a link is `refused`); the
 * file, when there, must be a regular file. The text goes to a temp file in
 * `.oscode` opened O_EXCL and O_NOFOLLOW, synced, and then, with the guard
 * checked as late as it can be, renamed over the file (`ifMatch`) or linked
 * to a name that must still be free (`ifAbsent`, never replacing). A
 * conflict is a result that leaves the file as it was, with what is there
 * now. The version is the lstat token a note carries (noteVersion).
 */
export async function writeVaultConfigFile(
  vaultDir: string,
  name: unknown,
  text: unknown,
  guardIn: unknown,
): Promise<ConfigWriteResult> {
  if (name !== WRITABLE_CONFIG || typeof text !== 'string') return { ok: false, reason: 'refused' };
  const guard = checkedGuard(guardIn);
  if (!guard) return { ok: false, reason: 'refused' };
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > VAULT_CONFIG_MAX_BYTES) return { ok: false, reason: 'too-large' };
  let root: string;
  try {
    root = await realpath(vaultDir);
  } catch {
    return { ok: false, reason: 'refused' };
  }
  const spec = VAULT_CONFIG_FILES[WRITABLE_CONFIG];
  const jail = new Jail(root);
  let dirAbs: string;
  let abs: string;
  try {
    dirAbs = jail.resolve('.oscode');
    abs = jail.resolve(join('.oscode', spec.file));
  } catch (err) {
    if (err instanceof JailViolation) return { ok: false, reason: 'refused' };
    throw err;
  }
  await mkdir(dirAbs).catch((err: unknown) => {
    if (codeOf(err) !== 'EEXIST') throw err;
  });
  const dirSt = await lstat(dirAbs);
  if (!dirSt.isDirectory()) return { ok: false, reason: 'refused' };

  const there = async (): Promise<BigIntStats | null> => {
    try {
      return await lstat(abs, { bigint: true });
    } catch (err) {
      if (codeOf(err) === 'ENOENT') return null;
      throw err;
    }
  };
  const before = await there();
  if (before && !before.isFile()) return { ok: false, reason: 'refused' };
  const conflict = async (kind: 'changed' | 'missing' | 'exists'): Promise<ConfigWriteResult> => {
    const current = kind === 'missing' ? undefined : await currentOf(root);
    return current ? { ok: false, conflict: kind, current } : { ok: false, conflict: kind };
  };
  if ('ifAbsent' in guard && before) return conflict('exists');
  if ('ifMatch' in guard) {
    if (!before) return conflict('missing');
    if (noteVersion(before) !== guard.ifMatch) {
      return conflict('changed');
    }
  }

  const tmp = join(dirAbs, `.${spec.file}.oscode-${randomBytes(4).toString('hex')}.tmp`);
  const fh = await open(
    tmp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
    before ? Number(before.mode) & 0o7777 : 0o644,
  );
  let version: string;
  try {
    await fh.writeFile(bytes);
    await fh.sync();
    version = noteVersion(await fh.stat({ bigint: true }));
  } catch (err) {
    await fh.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  await fh.close();
  try {
    if ('ifAbsent' in guard) {
      try {
        await link(tmp, abs);
      } catch (err) {
        if (codeOf(err) === 'EEXIST') return await conflict('exists');
        if (!LINK_UNSUPPORTED.has(codeOf(err) ?? '')) throw err;
        return await createExclusive(abs, bytes, conflict);
      }
      return { ok: true, version };
    }
    // The guard once more, as late as it can be: the file must still be the
    // regular file the person saw.
    const now = await there();
    if (!now) return await conflict('missing');
    if (!now.isFile()) return { ok: false, reason: 'refused' };
    if (noteVersion(now) !== guard.ifMatch) {
      return await conflict('changed');
    }
    await rename(tmp, abs);
    return { ok: true, version };
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}
