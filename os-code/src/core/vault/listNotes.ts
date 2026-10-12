// The engine's listing of a desktop folder vault (Vault M4, tech review I7): every
// note with the version the index reconciles by. The version is noteVersion's
// bigint lstat token (F1), the same one Electron main and the vault tools
// build, so an index saved by either side reconciles here without a read.
//
// Unlike main's walk (listVaultFolder), this never sweeps temp files: the
// engine only reads the folder. Dot entries and non-notes are skipped, links
// are never followed (a Dirent reports the link itself), and the walk is
// asynchronous with a bounded number of lstats at once, so a large vault
// never holds the daemon's other sessions.
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { compareCodePoints, INDEX_READ_CONCURRENCY } from '../../harness/vault/index.js';
import { isNotePath } from '../../harness/vault/paths.js';
import type { VaultListedNote } from '../../harness/vault/types.js';
import { noteVersion } from './noteFile.js';

/** How many lstats (and, in the index, reads) run at once on a folder vault. */
export const LIST_CONCURRENCY = INDEX_READ_CONCURRENCY.folder;

/** Folder entries a listing visits before it stops, so a vault on a huge or
 *  network-mounted folder cannot hold the engine for long. Above the index's
 *  own note cap, so `partial` is still judged on the listing. */
export const LIST_WALK_CEILING = 100_000;

export interface ListVaultNotesOptions {
  /** Stop after this many folder entries (default LIST_WALK_CEILING). */
  ceiling?: number;
  signal?: AbortSignal;
}

/** Run `fn` over `items`, at most `limit` at a time. */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  live: () => boolean = () => true,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && live()) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Every note under `root`, vault-relative and "/"-separated, with its
 *  version, time and size, in code-point order. A folder that cannot be read
 *  is skipped; a root that is not there lists nothing. */
export async function listVaultNotes(
  root: string,
  options: ListVaultNotesOptions = {},
): Promise<VaultListedNote[]> {
  const ceiling = options.ceiling ?? LIST_WALK_CEILING;
  const found: string[] = [];
  const pending: string[] = [''];
  let visited = 0;
  while (pending.length && visited < ceiling && !options.signal?.aborted) {
    const rel = pending.shift()!;
    let entries;
    try {
      entries = await readdir(rel ? join(root, rel) : root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (++visited > ceiling) break;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && isNotePath(path)) found.push(path);
    }
  }
  const out: VaultListedNote[] = [];
  await eachLimited(
    found,
    LIST_CONCURRENCY,
    async (path) => {
      try {
        const st = await lstat(join(root, path), { bigint: true });
        if (!st.isFile()) return;
        out.push({
          path,
          updatedAt: new Date(Number(st.mtimeMs)).toISOString(),
          size: Number(st.size),
          version: noteVersion(st),
        });
      } catch {
        // Gone between the listing and the stat.
      }
    },
    () => !options.signal?.aborted,
  );
  return out.sort((a, b) => compareCodePoints(a.path, b.path));
}
