// One client for a vault that is a real folder of markdown files, over a
// transport that does the file system work somewhere else: the Electron main
// process on the desktop today (deviceFolder.ts), and the iPhone's
// coordinated folder later (plan 2.10a), so the two keep one set of rules and
// one version token (Vault M1, tech review F1, F4).
//
// What the client adds on top of the transport: only notes cross it (the seam's
// isNotePath rule: `.md`, no dot segment, so `.obsidian/` and attachments never
// list, open, or take a write), a missing note reads as undefined, and every
// write answers with the seam's WriteResult. The transport enforces the guard
// (compare-and-swap) where the bytes are, since only it can check the version
// and publish in one step; a folder provider therefore declares
// `compareAndSwap: true`.
//
// Vault M6 (tech review K2, K3, K5, K6, K11): the rename, folder, Trash and attachment
// members are optional on the transport, and the client declares a seam
// member only when its transport has it. So the desktop lights them through
// the bridge, and the iPhone folder (the held native branch, K19) lights the
// same rows by adding the same transport members, with no UI change.
import {
  VAULT_ATTACHMENT_MAX_BYTES,
  type AttachmentMeta,
  type AttachmentMime,
  type BytesRead,
  type ReadBytesOptions,
} from 'os-code/protocol';
import {
  VAULT_FOLDER_INTO_ITSELF,
  vaultNotAttachmentLine,
  vaultNotFolderLine,
} from '../vaultCopy.js';
import {
  isNotePath,
  type CreateFolderResult,
  type EmptyTrashResult,
  type FolderMoveResult,
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

/** The file system calls a folder client needs, addressed by a note path
 *  relative to the vault folder. `null` means nothing is there. */
export interface FolderTransport {
  list(): Promise<StoredFileMeta[]>;
  stat(path: string): Promise<StoredFileMeta | null>;
  read(path: string): Promise<StoredFile | null>;
  write(path: string, text: string, guard?: WriteGuard): Promise<WriteResult>;
  remove(path: string, guard?: RemoveGuard): Promise<RemoveResult>;
  // Vault M6, each optional: the client declares the seam member only when
  // the transport has it.
  rename?(from: string, to: string, guard: RenameGuard): Promise<RenameResult>;
  listFolders?(): Promise<string[]>;
  createFolder?(path: string): Promise<CreateFolderResult>;
  renameFolder?(from: string, to: string): Promise<FolderMoveResult>;
  trash?(target: TrashTarget): Promise<TrashResult>;
  listTrash?(): Promise<TrashEntry[]>;
  restore?(id: string): Promise<RestoreResult>;
  emptyTrash?(ids?: string[]): Promise<EmptyTrashResult>;
  listAttachments?(): Promise<AttachmentMeta[]>;
  readBytes?(path: string, opts?: ReadBytesOptions): Promise<BytesRead>;
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

// ---- Vault M6 path rules and result shapes ---------------------------------

/** A folder the vault can act on: relative, forward slashes, no empty or dot
 *  segment. So never the vault's root, never `.trash` or `.obsidian`, and
 *  never a path that climbs out. */
export function isVaultFolderPath(path: string): boolean {
  if (!path || path.includes('\\') || path.startsWith('/') || path.endsWith('/')) return false;
  return path.split('/').every((s) => s.length > 0 && !s.startsWith('.'));
}

/** A path that may name an attachment: the folder shape rule, an extension,
 *  and not a note. The allow-listed extension and the magic bytes are
 *  checked where the bytes are (main and the daemon, `isAttachmentPath` and
 *  `bytesMatchMime`); this only keeps a wrong shape from crossing at all. */
export function isPlainAttachmentPath(path: string): boolean {
  return isVaultFolderPath(path) && !/\.md$/i.test(path) && /\.[a-z0-9]+$/i.test(path);
}

/** The attachment types the Vault reads (K11), as `AttachmentMime` names them. */
export const ATTACHMENT_MIMES: ReadonlySet<string> = new Set<AttachmentMime>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'application/pdf',
]);

/** The byte cap one read takes: the caller's `max`, never above 20 MB. */
export function bytesCap(opts?: ReadBytesOptions): number {
  const max = opts?.max;
  return typeof max === 'number' && Number.isFinite(max) && max >= 0
    ? Math.min(max, VAULT_ATTACHMENT_MAX_BYTES)
    : VAULT_ATTACHMENT_MAX_BYTES;
}

const BYTES_REFUSALS = new Set(['absent', 'too-large', 'downloading', 'unsupported', 'refused']);

/** A BytesRead as the seam promises it, whatever the transport handed back:
 *  an allowed type, a version, and never more bytes than the cap. */
export function asBytesRead(r: unknown, cap: number): BytesRead {
  const v = r as {
    ok?: unknown;
    reason?: unknown;
    bytes?: unknown;
    mime?: unknown;
    version?: unknown;
  };
  if (!v || typeof v !== 'object') return { ok: false, reason: 'refused' };
  if (v.ok !== true) {
    const reason =
      typeof v.reason === 'string' && BYTES_REFUSALS.has(v.reason) ? v.reason : 'refused';
    return { ok: false, reason: reason as Extract<BytesRead, { ok: false }>['reason'] };
  }
  if (typeof v.mime !== 'string' || !ATTACHMENT_MIMES.has(v.mime)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (!(v.bytes instanceof Uint8Array) || typeof v.version !== 'string') {
    return { ok: false, reason: 'refused' };
  }
  if (v.bytes.byteLength > cap) return { ok: false, reason: 'too-large' };
  // A Node Buffer (a test, a future transport) becomes a plain view.
  const bytes = new Uint8Array(v.bytes.buffer, v.bytes.byteOffset, v.bytes.byteLength);
  return { ok: true, bytes, mime: v.mime as AttachmentMime, version: v.version };
}

/** An attachment listing with only well-formed rows. */
export function asAttachmentList(list: unknown): AttachmentMeta[] {
  if (!Array.isArray(list)) return [];
  return list.filter((a): a is AttachmentMeta => {
    const m = a as Partial<AttachmentMeta> | null;
    return (
      typeof m === 'object' &&
      m !== null &&
      typeof m.path === 'string' &&
      isPlainAttachmentPath(m.path) &&
      typeof m.size === 'number' &&
      typeof m.updatedAt === 'string' &&
      typeof m.version === 'string' &&
      typeof m.mime === 'string' &&
      ATTACHMENT_MIMES.has(m.mime)
    );
  });
}

function refuseFolder(path: string): Error {
  return new Error(vaultNotFolderLine(path));
}

/** A folder move the storage must never be asked for: into itself. */
export function isFolderIntoItself(from: string, to: string): boolean {
  return to === from || to.startsWith(`${from}/`);
}

/** A RenameResult as the seam promises it: a success names the path it
 *  landed at, and a conflict carries theirs only when there is one. */
function asRenameResult(to: string, r: RenameResult): RenameResult {
  if (r.ok) return { ok: true, file: { ...r.file, path: r.file.path || to } };
  return r.theirs
    ? { ok: false, conflict: r.conflict, theirs: r.theirs }
    : { ok: false, conflict: r.conflict };
}

/** The M6 members a transport lights, each checking paths on this side first
 *  so a wrong shape never reaches the storage. */
function m6Members(t: FolderTransport): Partial<StorageProvider> {
  const out: Partial<StorageProvider> = {};
  if (t.rename) {
    const rename = t.rename.bind(t);
    out.rename = async (_r, from, to, guard) => {
      if (!isNotePath(from)) throw refuseNonNote(from);
      if (!isNotePath(to)) throw refuseNonNote(to);
      return asRenameResult(to, await rename(from, to, guard));
    };
  }
  if (t.listFolders) {
    const listFolders = t.listFolders.bind(t);
    out.listFolders = async () => {
      const folders = await listFolders();
      return Array.isArray(folders) ? folders.filter(isVaultFolderPath) : [];
    };
  }
  if (t.createFolder) {
    const createFolder = t.createFolder.bind(t);
    out.createFolder = async (_r, path) => {
      if (!isVaultFolderPath(path)) throw refuseFolder(path);
      return createFolder(path);
    };
  }
  if (t.renameFolder) {
    const renameFolder = t.renameFolder.bind(t);
    out.renameFolder = async (_r, from, to) => {
      if (!isVaultFolderPath(from)) throw refuseFolder(from);
      if (!isVaultFolderPath(to)) throw refuseFolder(to);
      if (isFolderIntoItself(from, to)) throw new Error(VAULT_FOLDER_INTO_ITSELF);
      return renameFolder(from, to);
    };
  }
  if (t.trash) {
    const trash = t.trash.bind(t);
    out.trash = async (_r, target) => {
      if (target.kind === 'note') {
        if (!isNotePath(target.path)) throw refuseNonNote(target.path);
        return trash({ kind: 'note', path: target.path, ifMatch: target.ifMatch });
      }
      if (!isVaultFolderPath(target.path)) throw refuseFolder(target.path);
      return trash({ kind: 'folder', path: target.path });
    };
  }
  if (t.listTrash) {
    const listTrash = t.listTrash.bind(t);
    out.listTrash = async () => {
      const entries = await listTrash();
      return Array.isArray(entries) ? entries : [];
    };
  }
  if (t.restore) {
    const restore = t.restore.bind(t);
    out.restore = async (_r, id) => restore(id);
  }
  if (t.emptyTrash) {
    const emptyTrash = t.emptyTrash.bind(t);
    out.emptyTrash = async (_r, ids) => emptyTrash(ids);
  }
  if (t.listAttachments) {
    const listAttachments = t.listAttachments.bind(t);
    out.listAttachments = async () => asAttachmentList(await listAttachments());
  }
  if (t.readBytes) {
    const readBytes = t.readBytes.bind(t);
    out.readBytes = async (_r, path, opts) => {
      if (!isPlainAttachmentPath(path)) throw new Error(vaultNotAttachmentLine(path));
      const cap = bytesCap(opts);
      return asBytesRead(await readBytes(path, { max: cap }), cap);
    };
  }
  return out;
}

export function makeFolderProvider(
  transport: FolderTransport,
  meta: FolderProviderMeta,
): StorageProvider {
  return {
    ...meta,
    ...m6Members(transport),
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
