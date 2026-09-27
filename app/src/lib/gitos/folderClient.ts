// One client for a vault that is a real folder of markdown files, over a
// transport that does the file system work somewhere else: the Electron main
// process on the desktop today (deviceFolder.ts), and the iPhone's
// coordinated folder later (plan 2.10a), so the two keep one set of rules and
// one version token (Vault M1, CTO F1, F4).
//
// What the client adds on top of the transport: only notes cross it (the seam's
// isNotePath rule: `.md`, no dot segment, so `.obsidian/` and attachments never
// list, open, or take a write), a missing note reads as undefined, and every
// write answers with the seam's WriteResult. The transport enforces the guard
// (compare-and-swap) where the bytes are, since only it can check the version
// and publish in one step; a folder provider therefore declares
// `compareAndSwap: true`.
import {
  isNotePath,
  type Lease,
  type RemoveGuard,
  type RemoveResult,
  type StorageProvider,
  type StoredFile,
  type StoredFileMeta,
  type WriteGuard,
  type WriteResult,
} from './providers.js';

/** The file system calls a folder client needs, addressed by a note path
 *  relative to the vault folder. `null` means nothing is there. */
export interface FolderTransport {
  list(): Promise<StoredFileMeta[]>;
  stat(path: string): Promise<StoredFileMeta | null>;
  read(path: string): Promise<StoredFile | null>;
  write(path: string, text: string, guard?: WriteGuard): Promise<WriteResult>;
  remove(path: string, guard?: RemoveGuard): Promise<RemoveResult>;
}

/** The fixed facts of a folder provider: its id, label, and copy lines. */
export type FolderProviderMeta = Pick<
  StorageProvider,
  'id' | 'label' | 'blurb' | 'ready' | 'pending'
>;

function refuseNonNote(path: string): Error {
  return new Error(`"${path}" is not a note, so the vault does not write it.`);
}

/** A WriteResult as the seam promises it, whatever the transport handed
 *  back: a success names the path it wrote and carries the text. */
function asWriteResult(path: string, text: string, r: WriteResult): WriteResult {
  if (r.ok) return { ok: true, file: { ...r.file, path: r.file.path || path, text } };
  return r.theirs
    ? { ok: false, conflict: r.conflict, theirs: r.theirs }
    : { ok: false, conflict: r.conflict };
}

/** A RemoveResult as the seam promises it: a conflict carries theirs only
 *  when the transport sent one. */
function asRemoveResult(r: RemoveResult): RemoveResult {
  if (r.ok) return { ok: true };
  return r.theirs
    ? { ok: false, conflict: r.conflict, theirs: r.theirs }
    : { ok: false, conflict: r.conflict };
}

export function makeFolderProvider(
  transport: FolderTransport,
  meta: FolderProviderMeta,
): StorageProvider {
  return {
    ...meta,
    compareAndSwap: true,

    // The transport already skips dot entries and non-notes; the seam rule
    // holds here too (0.6), so only notes ever list.
    async list(): Promise<StoredFileMeta[]> {
      return (await transport.list()).filter((f) => isNotePath(f.path));
    },

    async stat(_resourceId, path): Promise<StoredFileMeta | undefined> {
      if (!isNotePath(path)) return undefined;
      return (await transport.stat(path)) ?? undefined;
    },

    async read(_resourceId, path): Promise<StoredFile | undefined> {
      if (!isNotePath(path)) return undefined;
      return (await transport.read(path)) ?? undefined;
    },

    async write(_resourceId, path, text, guard): Promise<WriteResult> {
      if (!isNotePath(path)) throw refuseNonNote(path);
      return asWriteResult(path, text, await transport.write(path, text, guard));
    },

    // The transport checks the guard where the bytes are (Vault M2 wave 0):
    // a stale remove answers 'changed' and the note stays.
    async remove(_resourceId, path, guard): Promise<RemoveResult> {
      if (!isNotePath(path)) throw refuseNonNote(path);
      return asRemoveResult(await transport.remove(path, guard));
    },

    // The folder is shared with the agent and Obsidian, so there is no
    // exclusive lease to take: grant it, and let compare-and-swap settle
    // writes.
    async acquireLease(_resourceId, holder, ttlMs): Promise<Lease> {
      return { holder, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
    },

    async releaseLease(): Promise<void> {
      // Nothing held.
    },
  };
}
