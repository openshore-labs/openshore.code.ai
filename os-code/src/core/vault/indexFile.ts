// The desktop folder vault's persisted index (Vault M3, CTO H3 "Persistence"):
// one file per vault root under oscHome()/vault-index, named by a hash of the
// root's real path, so the renderer never names a path (CTO F7) and the engine
// can reuse the same file for the same folder (4.6). The blob is whatever
// serializeIndex wrote; this module only stores it. Node-side on purpose, so
// it lives outside src/harness/, whose purity guard covers that folder.
//
// The folder is 0700 and the file 0600 (the index holds note titles, tags and
// links). A save is a temp file in the same folder, synced, then renamed over
// the old one, so a reader sees the old index or the new, never a torn one. A
// blob over the cap is refused on save and on load, so a bad file can never
// make main read 100 MB into memory.
import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { oscHome } from '../../config/home.js';
import { INDEX_FILE_MAX_BYTES } from '../../harness/vault/index.js';

/** The desktop's cap on the persisted index, in UTF-8 bytes. */
export const VAULT_INDEX_FILE_MAX_BYTES = INDEX_FILE_MAX_BYTES.desktop;

/** The folder that holds every vault root's index file. */
export function vaultIndexDir(): string {
  return join(oscHome(), 'vault-index');
}

/** The key of a vault root: sha256 of its real path, first 32 hex digits. A
 *  root that does not resolve (gone, unreadable) keys on the path given. */
export async function vaultIndexKey(vaultDir: string): Promise<string> {
  let real = vaultDir;
  try {
    real = await realpath(vaultDir);
  } catch {}
  return createHash('sha256').update(real, 'utf8').digest('hex').slice(0, 32);
}

/** The index file of a vault root. */
export async function vaultIndexPath(vaultDir: string): Promise<string> {
  return join(vaultIndexDir(), `${await vaultIndexKey(vaultDir)}.json`);
}

export type VaultIndexSaveResult = { ok: true; bytes: number } | { ok: false; reason: 'too-large' };

/** Read a vault root's saved index blob, or null when there is none (or it is
 *  not a regular file, or it is over the cap). */
export async function loadVaultIndexFile(vaultDir: string): Promise<string | null> {
  const file = await vaultIndexPath(vaultDir);
  try {
    const st = await lstat(file);
    if (!st.isFile() || st.size > VAULT_INDEX_FILE_MAX_BYTES) return null;
    const text = await readFile(file, 'utf8');
    return Buffer.byteLength(text, 'utf8') > VAULT_INDEX_FILE_MAX_BYTES ? null : text;
  } catch {
    return null;
  }
}

/** Save a vault root's index blob: 0700 folder, 0600 file, temp then rename.
 *  Refuses a blob over the cap. */
export async function saveVaultIndexFile(
  vaultDir: string,
  blob: string,
): Promise<VaultIndexSaveResult> {
  const bytes = Buffer.byteLength(blob, 'utf8');
  if (bytes > VAULT_INDEX_FILE_MAX_BYTES) return { ok: false, reason: 'too-large' };
  const dir = vaultIndexDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode does not touch a folder that already exists; hold it anyway.
  await chmod(dir, 0o700).catch(() => undefined);
  const file = await vaultIndexPath(vaultDir);
  const tmp = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
  const fh = await open(tmp, 'wx', 0o600);
  try {
    await fh.writeFile(blob, 'utf8');
    await fh.sync();
  } catch (err) {
    await fh.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  await fh.close();
  try {
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  return { ok: true, bytes };
}

/** Forget a vault root's saved index (a folder forgotten, a reset). */
export async function deleteVaultIndexFile(vaultDir: string): Promise<boolean> {
  try {
    await unlink(await vaultIndexPath(vaultDir));
    return true;
  } catch {
    return false;
  }
}
