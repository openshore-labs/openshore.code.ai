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
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { Jail, JailViolation } from '../security/jail.js';
import {
  VAULT_CONFIG_FILES,
  VAULT_CONFIG_MAX_BYTES,
  detectConfigDir,
  isVaultConfigName,
  type ConfigDirCandidate,
} from '../../harness/vault/configDir.js';
import type { ConfigRead } from '../../harness/vault/types.js';
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
