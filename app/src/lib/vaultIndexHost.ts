// The app's host for the Vault index (Vault M3, tech review H3 and H6). The index
// itself is the shared pure core (`VaultIndex` in os-code/protocol): one entry
// per note, the links between notes, and BM25 search. This module owns
// everything around it that does I/O, so the store only gains call sites:
//
//   - the scheduler: a cold build or a reconcile reads only what changed, in
//     bounded parallel per provider, and does its CPU work in slices of 8 ms
//     or less, yielding between them, so the editor never waits on it;
//   - provider reads, through the seam (read and stat only; never a write);
//   - persistence: the desktop folder's index goes to a file main owns
//     (osc:vaultIndexLoad and osc:vaultIndexSave, the renderer sends only the
//     blob), every iPhone vault's index is sealed with the device key into
//     the Caches folder, and every other vault is kept in memory only;
//   - progress, published through useSyncExternalStore (not AppState, so the
//     store does not grow), shown only once a build has run 1.5 s;
//   - a rootKey hook, which the iPhone folder (plan 2.10a) fills so two
//     folders picked under one resource never share an index.
//
// Nothing here trusts the index for a write: it answers backlinks, linked
// mentions and search, and every answer is rebuilt from the files. A stale
// entry costs one read on the next reconcile, never a wrong save.
import { useSyncExternalStore } from 'react';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import {
  INDEX_CHECKPOINT_MS,
  INDEX_CHECKPOINT_NOTES,
  INDEX_FILE_MAX_BYTES,
  INDEX_PROGRESS_EVERY_MS,
  INDEX_PROGRESS_SHOW_AFTER_MS,
  INDEX_READ_CONCURRENCY,
  INDEX_SLICE_MS,
  VaultIndex,
  buildPathIndex,
  excerptAt,
  loadIndex,
  normalizeNotePath,
  readFrontmatter,
  resolveMarkdownLink,
  resolveWikilink,
  scanNote,
  serializeIndex,
  utf8Bytes,
  type IndexPhase,
  type IndexProgress,
  type VaultBacklink,
  type VaultIndexCore,
  type VaultIndexState,
  type VaultListedNote,
  type VaultSearchHit,
  type VaultSearchOptions,
} from 'os-code/protocol';
import { openBlob, platform, sealBlob } from './platform.js';
import { vaultM3Bridge } from './gitos/deviceFolder.js';
import { vaultBlobs } from './vaultBlobs.js';
import {
  versionOf,
  type StorageProvider,
  type StorageProviderId,
  type StoredFile,
  type StoredFileMeta,
} from './gitos/providers.js';

/** The shared core the index runs on: the same scanner, frontmatter reader
 *  and resolver the reader and the engine use. */
export const VAULT_INDEX_CORE: VaultIndexCore = {
  scanNote,
  readFrontmatter,
  buildPathIndex,
  resolveWikilink,
  resolveMarkdownLink,
  normalizeNotePath,
};

/** Which vault an index belongs to. `owner` is the signed-in account for the
 *  team vault, so one member's index is never read under another's. */
export interface VaultIndexTarget {
  providerId: StorageProviderId;
  resourceId: string;
  owner?: string;
}

/** What the host reads through: the seam's read, and stat for the watcher
 *  path. Never a write. */
export type VaultIndexReader = Pick<StorageProvider, 'read'> &
  Partial<Pick<StorageProvider, 'stat'>>;

// ---------------------------------------------------------------------------
// The rootKey hook (2.10a)

/** A root's identity beyond its resource: the iPhone folder fills this with
 *  the picked folder's own key, so a new pick under the same resource starts
 *  its own index. Undefined for every other storage. */
export type VaultRootKeyHook = (target: VaultIndexTarget) => string | undefined;

let rootKeyHook: VaultRootKeyHook | undefined;

/** Set (or clear) the rootKey hook. The native track calls this once. */
export function setVaultIndexRootKey(hook: VaultRootKeyHook | undefined): void {
  rootKeyHook = hook;
}

function rootKeyOf(target: VaultIndexTarget): string {
  try {
    return rootKeyHook?.(target) ?? '';
  } catch {
    return '';
  }
}

/** The index key: sha256 of the provider, resource, root and owner, in hex.
 *  Never a path, so nothing about where a vault lives is written into a
 *  file name. */
export async function vaultIndexKey(target: VaultIndexTarget, rootKey?: string): Promise<string> {
  const material = JSON.stringify([
    target.providerId,
    target.resourceId,
    rootKey ?? rootKeyOf(target),
    target.owner ?? '',
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// The seed hook (Vault M5, tech review J9)

/** A head start for a vault this device has never indexed: the hub's copy of
 *  the engine's own saved index (`GET /vault/index`). Null or a rejection is
 *  a cold build, never an error. */
export type VaultIndexSeed = (target: VaultIndexTarget) => Promise<string | null> | null;

const seeds = new Map<StorageProviderId, VaultIndexSeed>();

/** Register (or, with undefined, clear) the seed for one storage. The hub
 *  provider registers itself (lib/gitos/hub.ts). */
export function registerVaultIndexSeed(
  providerId: StorageProviderId,
  seed: VaultIndexSeed | undefined,
): void {
  if (seed) seeds.set(providerId, seed);
  else seeds.delete(providerId);
}

async function seedFor(target: VaultIndexTarget): Promise<string | null> {
  try {
    return (await seeds.get(target.providerId)?.(target)) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Persistence

/** Where an index is kept between launches. */
export interface VaultIndexStore {
  kind: 'desktop-file' | 'phone-cache' | 'memory';
  /** The serialized index's cap; over it, the vectors stay in memory. */
  maxBytes: number;
  load(): Promise<string | null>;
  /** True when it was kept. */
  save(json: string): Promise<boolean>;
  remove(): Promise<void>;
}

/** Memory only: the index lives as long as the app does. */
export function memoryIndexStore(): VaultIndexStore {
  return {
    kind: 'memory',
    maxBytes: INDEX_FILE_MAX_BYTES.desktop,
    load: async () => null,
    save: async () => false,
    remove: async () => {},
  };
}

/** The desktop folder's index, in the file main owns. Null when main does not
 *  answer the index IPCs (a build before them): the index stays in memory. */
export function desktopIndexStore(): VaultIndexStore | null {
  const b = vaultM3Bridge();
  if (typeof b?.vaultIndexLoad !== 'function' || typeof b.vaultIndexSave !== 'function') {
    return null;
  }
  const load = b.vaultIndexLoad.bind(b);
  const save = b.vaultIndexSave.bind(b);
  return {
    kind: 'desktop-file',
    maxBytes: INDEX_FILE_MAX_BYTES.desktop,
    async load() {
      const blob = await load();
      return typeof blob === 'string' ? blob : null;
    },
    async save(json) {
      const r = await save(json);
      return r?.ok === true;
    },
    // Main keys the file by the folder's real path; a folder vault is never
    // signed out of, so there is nothing to forget from here.
    remove: async () => {},
  };
}

/** The folder in Caches that holds every iPhone vault's index. */
export const PHONE_INDEX_DIR = 'oscode-vault-index';

/** An iPhone vault's index: sealed with the device key, in Caches (never
 *  backed up; if iOS purges it, the next open costs one cold build). A key
 *  that cannot seal right now keeps the index in memory, never in the
 *  clear. */
export function phoneIndexStore(key: string): VaultIndexStore {
  const path = `${PHONE_INDEX_DIR}/${key}`;
  const temp = `${path}.tmp`;
  return {
    kind: 'phone-cache',
    maxBytes: INDEX_FILE_MAX_BYTES.phone,
    async load() {
      try {
        const { data } = await Filesystem.readFile({
          path,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        return typeof data === 'string' ? await openBlob(data) : null;
      } catch {
        return null;
      }
    },
    async save(json) {
      const sealed = await sealBlob(json);
      if (sealed === null) return false;
      try {
        await Filesystem.writeFile({
          path: temp,
          data: sealed,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        await Filesystem.rename({
          from: temp,
          to: path,
          directory: Directory.Cache,
          toDirectory: Directory.Cache,
        });
        return true;
      } catch {
        return false;
      }
    },
    async remove() {
      for (const p of [path, temp]) {
        try {
          await Filesystem.deleteFile({ path: p, directory: Directory.Cache });
        } catch {
          // Already gone.
        }
      }
    },
  };
}

/** The store for a vault on this device: every iPhone vault goes to Caches,
 *  the desktop folder to main's file, everything else stays in memory. */
export function indexStoreFor(target: VaultIndexTarget, key: string): VaultIndexStore {
  const where = platform();
  if (where === 'ios') return phoneIndexStore(key);
  if (where === 'electron' && target.providerId === 'files') {
    return desktopIndexStore() ?? memoryIndexStore();
  }
  return memoryIndexStore();
}

// ---------------------------------------------------------------------------
// Progress, through useSyncExternalStore

/** What the Vault's list header reads. `visible` turns on only once a build
 *  has run INDEX_PROGRESS_SHOW_AFTER_MS, so a quick reconcile never flashes a
 *  line. */
export interface VaultIndexStatus {
  state: VaultIndexState;
  progress: IndexProgress | null;
  visible: boolean;
}

const IDLE: VaultIndexStatus = { state: 'empty', progress: null, visible: false };
let status: VaultIndexStatus = IDLE;
const listeners = new Set<() => void>();

function publish(next: VaultIndexStatus): void {
  if (
    next.state === status.state &&
    next.visible === status.visible &&
    next.progress?.phase === status.progress?.phase &&
    next.progress?.done === status.progress?.done &&
    next.progress?.total === status.progress?.total &&
    next.progress?.failed === status.progress?.failed
  ) {
    return;
  }
  status = next;
  for (const l of listeners) l();
}

export function subscribeVaultIndex(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function vaultIndexStatus(): VaultIndexStatus {
  return status;
}

/** The index's status for the Vault room. "Indexing N of M notes" shows
 *  while `visible`. */
export function useVaultIndexStatus(): VaultIndexStatus {
  return useSyncExternalStore(subscribeVaultIndex, vaultIndexStatus, vaultIndexStatus);
}

/** The progress line, or undefined while there is nothing to say. */
export function vaultIndexLine(s: VaultIndexStatus): string | undefined {
  if (!s.visible || !s.progress || s.progress.total === 0) return undefined;
  const { done, total } = s.progress;
  return `Indexing ${done.toLocaleString()} of ${total.toLocaleString()} ${total === 1 ? 'note' : 'notes'}`;
}

// ---------------------------------------------------------------------------
// The host

export interface VaultIndexHostOptions {
  /** Where the index is kept. Default: indexStoreFor(target, key). */
  store?: VaultIndexStore;
  /** Reads at once. Default: INDEX_READ_CONCURRENCY for the provider. */
  concurrency?: number;
  /** Yield to the event loop between CPU slices. Default: a macrotask. */
  yieldNow?: () => Promise<void>;
  now?: () => number;
  /** Publish progress to the Vault room. Default true; false for a host a
   *  test or the engine runs on the side. */
  publish?: boolean;
  maxNotes?: number;
}

/** A linked mention: a note that links here, with a passage around its
 *  first link. The shape backlinksTo answers. */
export interface LinkedMention {
  path: string;
  excerpt: string;
}

/** How many linking notes Linked mentions reads, and how many at once. */
export const MENTIONS_MAX = 50;
export const MENTIONS_CONCURRENCY = 4;
/** A write or a remove saves the index this long after the last one. */
export const INDEX_SAVE_DEBOUNCE_MS = 3000;

function concurrencyFor(id: StorageProviderId): number {
  switch (id) {
    case 'files':
      return INDEX_READ_CONCURRENCY.folder;
    case 'local':
      return INDEX_READ_CONCURRENCY.local;
    case 'org':
      return INDEX_READ_CONCURRENCY.team;
    case 'icloud':
      return INDEX_READ_CONCURRENCY.icloud;
    case 'gdrive':
      return INDEX_READ_CONCURRENCY.drive;
    default:
      return 2;
  }
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function metaOf(file: StoredFile): VaultListedNote {
  return {
    path: file.path,
    updatedAt: file.updatedAt,
    size: utf8Bytes(file.text),
    ...(file.version !== undefined ? { version: file.version } : {}),
  };
}

/** Run `fn` over `items`, `limit` at a time, in order of start. */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  live: () => boolean,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && live()) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

export class VaultIndexHost {
  readonly target: VaultIndexTarget;
  readonly rootKey: string;
  private readonly reader: VaultIndexReader;
  private readonly opts: VaultIndexHostOptions;
  private readonly now: () => number;
  private readonly yieldNow: () => Promise<void>;
  private readonly concurrency: number;
  private indexValue: VaultIndex;
  private storeValue: VaultIndexStore | undefined;
  private opening: Promise<void> | undefined;
  /** Bumped by every reconcile and by close; a pass whose number moved on
   *  stops at its next step. */
  private generation = 0;
  private closed = false;
  /** Paths written or removed while a pass was reading, so a slower read of
   *  an older version never lands over them. */
  private touched = new Set<string>();
  private sliceStart = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private showTimer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> = Promise.resolve();
  private building: { startedAt: number; progress: IndexProgress; emittedAt: number } | undefined;

  constructor(
    target: VaultIndexTarget,
    reader: VaultIndexReader,
    opts: VaultIndexHostOptions = {},
  ) {
    this.target = { ...target };
    this.rootKey = rootKeyOf(target);
    this.reader = reader;
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.yieldNow = opts.yieldNow ?? macrotask;
    this.concurrency = opts.concurrency ?? concurrencyFor(target.providerId);
    this.indexValue = new VaultIndex(VAULT_INDEX_CORE, { maxNotes: opts.maxNotes });
    this.storeValue = opts.store;
  }

  /** The live index. Replaced once, when a saved index loads. */
  get index(): VaultIndex {
    return this.indexValue;
  }

  get state(): VaultIndexState {
    return this.indexValue.state;
  }

  private live(gen: number): boolean {
    return !this.closed && gen === this.generation;
  }

  private async store(): Promise<VaultIndexStore> {
    if (!this.storeValue) {
      const key = await vaultIndexKey(this.target, this.rootKey);
      this.storeValue = indexStoreFor(this.target, key);
    }
    return this.storeValue;
  }

  /** Load the saved index, once. What loads is only a head start: the next
   *  listing reconciles it, so a stale entry costs one read. */
  open(): Promise<void> {
    this.opening ??= (async () => {
      try {
        const store = await this.store();
        // Nothing kept here yet: the storage's own head start, if it has one.
        const json = (await store.load()) ?? (await seedFor(this.target));
        if (json === null || this.closed) return;
        const loaded = loadIndex(json, VAULT_INDEX_CORE, { maxNotes: this.opts.maxNotes });
        // A write that landed while the file loaded wins over the file.
        if (loaded.status === 'loaded' && this.indexValue.size === 0) {
          this.indexValue = loaded.index;
        }
      } catch {
        // A file that cannot be read is a cold build, never an error.
      }
      this.publishIdle();
    })();
    return this.opening;
  }

  // ---- updates ------------------------------------------------------------

  /** Reconcile against a fresh listing: drop what is gone, index evicted
   *  files by title only, and read only notes whose version moved (never by
   *  mtime or size). A newer reconcile supersedes this one. */
  async reconcile(listed: readonly StoredFileMeta[]): Promise<void> {
    await this.open();
    if (this.closed) return;
    const gen = ++this.generation;
    this.touched = new Set();
    const index = this.indexValue;
    index.beginBuild();
    const plan = index.applyListing(listed);
    const total = plan.read.length;
    this.startProgress(total);
    let done = 0;
    let failed = 0;
    let sinceCheckpoint = 0;
    let checkpointAt = this.now();
    this.sliceStart = this.now();
    try {
      await eachLimited(
        plan.read,
        this.concurrency,
        async (path) => {
          let file: StoredFile | undefined;
          let threw = false;
          try {
            file = await this.reader.read(this.target.resourceId, path);
          } catch {
            threw = true;
            failed++;
          }
          if (!this.live(gen)) return;
          // A note written or removed here meanwhile keeps what that did; a
          // read that failed keeps the old entry for the next reconcile; a
          // note gone since the listing is dropped.
          if (!this.touched.has(path) && !threw) {
            if (file) index.applyWrite(metaOf({ ...file, path }), file.text);
            else index.applyRemove(path);
          }
          done++;
          sinceCheckpoint++;
          this.progress(gen, 'read', done, total, failed);
          if (
            sinceCheckpoint >= INDEX_CHECKPOINT_NOTES ||
            this.now() - checkpointAt >= INDEX_CHECKPOINT_MS
          ) {
            sinceCheckpoint = 0;
            checkpointAt = this.now();
            void this.save();
          }
          await this.slice();
        },
        () => this.live(gen),
      );
      if (!this.live(gen)) return;
      this.progress(gen, 'index', done, total, failed, true);
      index.resolve();
    } finally {
      if (gen === this.generation) {
        index.endBuild();
        this.endProgress();
      }
    }
    if (this.live(gen) && (total > 0 || plan.drop.length > 0 || plan.placeholder.length > 0)) {
      await this.save();
    }
  }

  /** A write this device made (patchVaultFiles): the text is in hand, so
   *  nothing is read. */
  applyWrite(file: StoredFile): void {
    if (this.closed) return;
    this.touched.add(file.path);
    this.indexValue.applyWrite(metaOf(file), file.text);
    this.scheduleSave();
  }

  applyRemove(path: string): void {
    if (this.closed) return;
    this.touched.add(path);
    if (this.indexValue.applyRemove(path)) this.scheduleSave();
  }

  /** A note this device renamed or moved (Vault M6): the entry moves with its
   *  links, tags and terms, taking the version the rename answered with, and
   *  nothing is read. */
  applyRename(from: string, to: StoredFileMeta): void {
    if (this.closed) return;
    this.touched.add(from);
    this.touched.add(to.path);
    if (this.indexValue.applyRename(from, to)) this.scheduleSave();
  }

  /** A note that was just read to open it (or reloaded by the poll): indexed
   *  only when its version moved. Reads nothing else. */
  noteRead(file: StoredFile): void {
    const entry = this.indexValue.entry(file.path);
    if (entry && !entry.evicted && entry.version === versionOf(file)) return;
    this.applyWrite(file);
  }

  /** The folder watcher's hint: stat each changed path, read only when its
   *  version moved, and drop what is gone. `tree` (it cannot say which)
   *  relists and reconciles. */
  async watched(
    change: { paths: readonly string[]; tree: boolean; rootGone?: boolean },
    relist: () => Promise<StoredFileMeta[]>,
  ): Promise<void> {
    if (this.closed || change.rootGone) return;
    if (change.tree || typeof this.reader.stat !== 'function') {
      await this.reconcile(await relist());
      return;
    }
    const gen = this.generation;
    for (const path of change.paths) {
      if (this.closed || gen !== this.generation) return;
      let meta: StoredFileMeta | undefined;
      try {
        meta = await this.reader.stat(this.target.resourceId, path);
      } catch {
        continue;
      }
      if (!meta) {
        this.applyRemove(path);
        continue;
      }
      const entry = this.indexValue.entry(path);
      if (entry && entry.version === versionOf(meta)) continue;
      if (meta.evicted) {
        if (!entry) this.indexValue.applyPlaceholder(meta);
        continue;
      }
      try {
        const file = await this.reader.read(this.target.resourceId, path);
        if (file) this.applyWrite({ ...file, path });
        else this.applyRemove(path);
      } catch {
        // Read on the next reconcile.
      }
    }
  }

  // ---- queries ------------------------------------------------------------

  backlinks(path: string): VaultBacklink[] {
    return this.indexValue.backlinks(path);
  }

  /** Linked mentions: the notes that link to `path`, each with a passage
   *  around its first link. Reads only the linking notes (the first 50,
   *  four at a time), through `read` when the caller has a body cache. The
   *  index keeps offsets, never excerpts. */
  async linkedMentions(
    path: string,
    read?: (path: string) => Promise<string | undefined>,
  ): Promise<{ mentions: LinkedMention[]; failed: string[]; more: number }> {
    const back = this.indexValue.backlinks(path);
    const take = back.slice(0, MENTIONS_MAX);
    const texts = new Map<string, string>();
    const failed: string[] = [];
    const readBody =
      read ??
      (async (p: string) => (await this.reader.read(this.target.resourceId, p))?.text ?? undefined);
    await eachLimited(
      take,
      MENTIONS_CONCURRENCY,
      async (b) => {
        try {
          const text = await readBody(b.source);
          if (text === undefined) failed.push(b.source);
          else texts.set(b.source, text);
        } catch {
          failed.push(b.source);
        }
      },
      () => !this.closed,
    );
    const mentions: LinkedMention[] = [];
    for (const b of take) {
      const text = texts.get(b.source);
      if (text === undefined) continue;
      mentions.push({ path: b.source, excerpt: excerptAt(text, b.at[0] ?? 0).text });
    }
    return { mentions, failed, more: back.length - take.length };
  }

  /** BM25 search. When the saved index went over its cap and kept its term
   *  vectors in memory only, the first search reads those notes again to
   *  rebuild them. */
  async search(query: string, opts?: number | VaultSearchOptions): Promise<VaultSearchHit[]> {
    const missing = this.indexValue.missingTerms();
    if (missing.length > 0) {
      const gen = this.generation;
      await eachLimited(
        missing,
        this.concurrency,
        async (path) => {
          try {
            const file = await this.reader.read(this.target.resourceId, path);
            if (file && this.generation === gen && !this.touched.has(path)) {
              this.indexValue.applyWrite(metaOf({ ...file, path }), file.text);
            }
          } catch {
            // Left out of this search; tried again on the next.
          }
          await this.slice();
        },
        () => !this.closed && this.generation === gen,
      );
    }
    return this.indexValue.search(query, opts);
  }

  // ---- lifecycle ----------------------------------------------------------

  /** Save now: the vectors too when they fit the cap, else without them, and
   *  nothing when even that is over. Saves run one at a time. */
  save(): Promise<void> {
    const run = this.saving.then(async () => {
      if (this.closed) return;
      try {
        const store = await this.store();
        if (store.kind === 'memory') return;
        const s = serializeIndex(this.indexValue, { maxBytes: store.maxBytes });
        if (!s.fits) return;
        await store.save(s.json);
      } catch {
        // The index is a cache: a save that fails costs a rebuild, never a
        // note.
      }
    });
    this.saving = run;
    return run;
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.save();
    }, INDEX_SAVE_DEBOUNCE_MS);
  }

  /** Write a pending save now, and keep the index open: leaving the Vault
   *  room keeps the personal index warm for the chats (Vault M5, tech review J1). */
  async flush(): Promise<void> {
    if (this.closed || this.saveTimer === undefined) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    await this.save();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Stop: any pass in flight stops at its next step. A pending save is
   *  written first, so a switch never loses the last write. */
  async close(): Promise<void> {
    if (this.closed) return;
    const pending = this.saveTimer !== undefined;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (pending) await this.save();
    this.closed = true;
    this.generation++;
    this.clearShowTimer();
    if (this.building) {
      this.building = undefined;
      this.publishIdle();
    }
  }

  /** Forget this vault's index here and where it was kept (sign-out). */
  async drop(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.closed = true;
    this.generation++;
    this.clearShowTimer();
    this.building = undefined;
    await this.saving.catch(() => {});
    try {
      await (await this.store()).remove();
    } catch {
      // Caches the OS may purge anyway.
    }
    this.indexValue = new VaultIndex(VAULT_INDEX_CORE, { maxNotes: this.opts.maxNotes });
  }

  // ---- pacing and progress ------------------------------------------------

  /** Yield once this slice of CPU work has run INDEX_SLICE_MS. */
  private async slice(): Promise<void> {
    if (this.now() - this.sliceStart < INDEX_SLICE_MS) return;
    await this.yieldNow();
    this.sliceStart = this.now();
  }

  private get publishing(): boolean {
    return this.opts.publish !== false;
  }

  private startProgress(total: number): void {
    const at = this.now();
    this.building = {
      startedAt: at,
      progress: { phase: 'read', done: 0, total, failed: 0 },
      emittedAt: at,
    };
    this.clearShowTimer();
    if (!this.publishing) return;
    this.emit();
    // Turn the line on at 1.5 s even when no read lands to emit it.
    this.showTimer = setTimeout(() => {
      this.showTimer = undefined;
      this.emit();
    }, INDEX_PROGRESS_SHOW_AFTER_MS);
  }

  private progress(
    gen: number,
    phase: IndexPhase,
    done: number,
    total: number,
    failed: number,
    force = false,
  ): void {
    if (!this.building || gen !== this.generation) return;
    this.building.progress = { phase, done, total, failed };
    const at = this.now();
    if (!force && at - this.building.emittedAt < INDEX_PROGRESS_EVERY_MS) return;
    this.building.emittedAt = at;
    this.emit();
  }

  private endProgress(): void {
    this.building = undefined;
    this.clearShowTimer();
    this.publishIdle();
  }

  private emit(): void {
    if (!this.publishing || !this.building) return;
    const b = this.building;
    publish({
      state: 'building',
      progress: { ...b.progress },
      visible: this.now() - b.startedAt >= INDEX_PROGRESS_SHOW_AFTER_MS,
    });
  }

  private publishIdle(): void {
    if (!this.publishing || this.building) return;
    publish({
      state: this.closed ? 'empty' : this.indexValue.state,
      progress: null,
      visible: false,
    });
  }

  private clearShowTimer(): void {
    if (this.showTimer) clearTimeout(this.showTimer);
    this.showTimer = undefined;
  }
}

// ---------------------------------------------------------------------------
// The one index on screen, and the personal one kept warm
//
// The Vault room asks for the index of the vault on screen (vaultIndexFor)
// and closes it when it is left (closeVaultIndex). Chats read the personal
// vault's index for their context pack (Vault M5, tech review J1), so leaving the room
// must not leave them a cold one: closing the PERSONAL index parks it, its
// last write saved, and the next vaultIndexFor for the same target (the room
// again, or the pack) takes it back warm. The team vault is never in a
// chat's context (D15) and belongs to one account, so it closes for real.
// A storage move, a sign-out, or a pairing change closes everything
// (shutVaultIndex, or vaultIndexFor with another target).

let current: VaultIndexHost | undefined;
let parked: VaultIndexHost | undefined;

function sameTarget(a: VaultIndexTarget, rootA: string, b: VaultIndexTarget): boolean {
  return (
    a.providerId === b.providerId &&
    a.resourceId === b.resourceId &&
    (a.owner ?? '') === (b.owner ?? '') &&
    rootA === rootKeyOf(b)
  );
}

/** Whether an index may stay open while no room shows it: every vault but
 *  the team vault. */
function keepsWarm(target: VaultIndexTarget): boolean {
  return target.providerId !== 'org';
}

/** The index for the vault on screen, opened on first use. A different
 *  target closes the old one (its last write saved) and opens the new one,
 *  whose saved index loads as a head start. The personal index parked by a
 *  room that was left comes back warm. */
export function vaultIndexFor(
  target: VaultIndexTarget,
  reader: VaultIndexReader,
  opts?: VaultIndexHostOptions,
): VaultIndexHost {
  if (current && sameTarget(current.target, current.rootKey, target)) return current;
  if (parked && !parked.isClosed && sameTarget(parked.target, parked.rootKey, target)) {
    void current?.close();
    current = parked;
    parked = undefined;
    return current;
  }
  void current?.close();
  void parked?.close();
  parked = undefined;
  current = new VaultIndexHost(target, reader, opts);
  void current.open();
  return current;
}

/** The index open now, if any. */
export function currentVaultIndex(): VaultIndexHost | undefined {
  return current;
}

/** The personal index, on screen or kept warm since the room was left: what
 *  a chat's pack reads. Never the team vault's. */
export function warmVaultIndex(): VaultIndexHost | undefined {
  const host = current ?? parked;
  return host && !host.isClosed && keepsWarm(host.target) ? host : undefined;
}

/** The Vault room was left. The personal index stays warm for the chats
 *  (its last write saved now); the team index closes. */
export async function closeVaultIndex(): Promise<void> {
  const host = current;
  current = undefined;
  if (host && keepsWarm(host.target) && !host.isClosed) {
    if (parked && parked !== host) void parked.close();
    parked = host;
    await host.flush();
  } else {
    await host?.close();
  }
  publish(IDLE);
}

/** Close every index, the warm one too: a storage move, a sign-out, or a
 *  pairing change (Vault M5, tech review J1). */
export async function shutVaultIndex(): Promise<void> {
  // The images a vault showed go with it (tech review K11): no blob URL outlives
  // the vault it was made from.
  vaultBlobs.revokeAll();
  const hosts = [current, parked];
  current = undefined;
  parked = undefined;
  for (const host of hosts) await host?.close();
  publish(IDLE);
}

/** Forget a vault's index here and where it was kept: the team index on
 *  sign-out, wherever team drafts are forgotten. */
export async function dropVaultIndex(target: VaultIndexTarget): Promise<void> {
  for (const which of ['current', 'parked'] as const) {
    const host = which === 'current' ? current : parked;
    if (host && sameTarget(host.target, host.rootKey, target)) {
      if (which === 'current') current = undefined;
      else parked = undefined;
      await host.drop();
      publish(IDLE);
      return;
    }
  }
  try {
    const key = await vaultIndexKey(target);
    await indexStoreFor(target, key).remove();
  } catch {
    // Nothing kept.
  }
}
