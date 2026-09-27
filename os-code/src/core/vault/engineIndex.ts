// The engine's Vault index (Vault M4, CTO I7; plan 4.6): one index per vault
// root, process-wide, keyed by vaultIndexKey (H3) and saved to that root's own
// file under the engine state folder (oscHome()/vault-index). Two roots never
// share an index, a file, or a search, so a member's session on a shared hub
// (5.2) can never read another root through it. A session reaches only its
// own toolContext.vaultRoot; no tool takes a root.
//
// Lifecycle: the first ask for a root loads its saved index in the background
// (a head start only), then reconciles against a fresh listing by version
// (noteVersion, F1), reading only notes whose version moved, eight at a time.
// A write the engine made (vaultWrite) is fed in directly with the text in
// hand. Saves debounce to INDEX_CHECKPOINT_MS and write the whole index by
// temp file and atomic rename (saveVaultIndexFile). Electron main may save the
// same file for the same folder: both write a whole index, and the next
// reconcile on either side heals whatever the other wrote, so the last writer
// wins and nothing is ever torn.
//
// Node-side on purpose, so it lives outside src/harness/, whose purity guard
// covers that folder. The index itself is the pure harness/vault/index.ts.
import {
  INDEX_CHECKPOINT_MS,
  VaultIndex,
  loadIndex,
  serializeIndex,
  type VaultIndexCore,
} from '../../harness/vault/index.js';
import { readFrontmatter } from '../../harness/vault/frontmatter.js';
import { normalizeNotePath } from '../../harness/vault/paths.js';
import {
  buildPathIndex,
  resolveMarkdownLink,
  resolveWikilink,
} from '../../harness/vault/resolve.js';
import { scanNote } from '../../harness/vault/scan.js';
import type { VaultListedNote } from '../../harness/vault/types.js';
import { Jail } from '../security/jail.js';
import {
  VAULT_INDEX_FILE_MAX_BYTES,
  loadVaultIndexFile,
  saveVaultIndexFile,
  vaultIndexKey,
} from './indexFile.js';
import { LIST_CONCURRENCY, eachLimited, listVaultNotes } from './listNotes.js';
import { readNote } from './noteFile.js';

/** The shared core the engine's index runs on: the same scanner, frontmatter
 *  reader and resolver the app's index and the vault tools use. */
export const ENGINE_VAULT_CORE: VaultIndexCore = {
  scanNote,
  readFrontmatter,
  buildPathIndex,
  resolveWikilink,
  resolveMarkdownLink,
  normalizeNotePath,
};

/** A refresh (a new task, a search) starts a reconcile only when the last one
 *  finished longer ago than this. The engine has no folder watcher, so this is
 *  how an edit made in Obsidian reaches the index: one listing of lstats, and
 *  a read only for notes whose version moved. */
export const RECONCILE_MIN_GAP_MS = 30_000;

/** Resolve true when `p` settles within `ms`, false when the time runs out or
 *  the signal aborts first. Never rejects. */
export function settlesWithin(
  p: Promise<unknown>,
  ms: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) return resolve(false);
    let done = false;
    const finish = (value: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = (): void => finish(false);
    const timer = setTimeout(() => finish(false), Math.max(0, ms));
    signal?.addEventListener('abort', onAbort);
    p.then(
      () => finish(true),
      () => finish(true),
    );
  });
}

/** One vault root's index on the engine. Built only by engineVaultIndex. */
export class EngineVaultIndex {
  readonly root: string;
  /** vaultIndexKey(root): the map key and the saved file's name. */
  readonly key: string;
  /** Settles once the saved index has been looked at (loaded or not). */
  readonly loaded: Promise<void>;

  private indexValue: VaultIndex;
  private loadedFlag = false;
  private reconciledFlag = false;
  private firstReconcile: Promise<void>;
  private reconciling: Promise<void> | undefined;
  private lastReconcileAt = 0;
  /** Paths written here since the current reconcile began: the reconcile
   *  keeps what the write did rather than its own older read. */
  private touched = new Set<string>();
  /** Writes that landed before the saved index loaded, applied over it. */
  private pendingWrites = new Map<string, { meta: VaultListedNote; text: string } | null>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> = Promise.resolve();
  private closed = false;
  private generation = 0;

  constructor(root: string, key: string) {
    this.root = root;
    this.key = key;
    this.indexValue = new VaultIndex(ENGINE_VAULT_CORE);
    this.loaded = this.load();
    this.firstReconcile = this.loaded.then(() => this.reconcile());
  }

  /** The index as it stands: loaded, reconciling, or reconciled. */
  get index(): VaultIndex {
    return this.indexValue;
  }

  /** The saved index has been looked at (a missing file counts). */
  get isLoaded(): boolean {
    return this.loadedFlag;
  }

  /** At least one reconcile has finished, so the index matches the folder as
   *  of that listing. */
  get isReconciled(): boolean {
    return this.reconciledFlag;
  }

  /** Wait at most `ms` for the saved index to load; true when it has. */
  whenLoaded(ms: number, signal?: AbortSignal): Promise<boolean> {
    if (this.loadedFlag) return Promise.resolve(true);
    return settlesWithin(this.loaded, ms, signal);
  }

  /** Wait at most `ms` for the first reconcile; true when it has finished. */
  whenReconciled(ms: number, signal?: AbortSignal): Promise<boolean> {
    if (this.reconciledFlag) return Promise.resolve(true);
    return settlesWithin(this.firstReconcile, ms, signal);
  }

  /** Start a reconcile in the background when none is running and the last
   *  one is older than RECONCILE_MIN_GAP_MS. */
  refresh(now = Date.now()): void {
    if (this.closed || this.reconciling || !this.reconciledFlag) return;
    if (now - this.lastReconcileAt < RECONCILE_MIN_GAP_MS) return;
    void this.reconcile();
  }

  /** Reconcile against a fresh listing. One runs at a time; a call while one
   *  is running shares it. */
  reconcile(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.reconciling ??= this.runReconcile().finally(() => {
      this.reconciling = undefined;
    });
    return this.reconciling;
  }

  /** A note the engine wrote (or removed, with null text): the text is in
   *  hand, so nothing is read. */
  noteWrite(meta: VaultListedNote, text: string | null): void {
    if (this.closed) return;
    this.touched.add(meta.path);
    if (!this.loadedFlag) {
      this.pendingWrites.set(meta.path, text === null ? null : { meta, text });
    }
    if (text === null) this.indexValue.applyRemove(meta.path);
    else this.indexValue.applyWrite(meta, text);
    this.scheduleSave();
  }

  /** Read the notes whose term vectors were not persisted (the saved file
   *  went over its cap), so search sees their bodies. */
  async ensureTerms(signal?: AbortSignal): Promise<void> {
    const missing = this.indexValue.missingTerms();
    if (missing.length === 0) return;
    const index = this.indexValue;
    await eachLimited(
      missing,
      LIST_CONCURRENCY,
      async (path) => {
        const read = await this.readBody(path);
        if (read && index === this.indexValue && !this.closed) {
          index.applyWrite(metaOf(path, read), read.text);
        }
      },
      () => !this.closed && !signal?.aborted,
    );
  }

  /** Save now: the vectors too when they fit the cap, else without them, and
   *  nothing when even that is over. Saves run one at a time; a failed save
   *  costs a rebuild later, never a note. */
  save(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const run = this.saving.then(async () => {
      try {
        const s = serializeIndex(this.indexValue, { maxBytes: VAULT_INDEX_FILE_MAX_BYTES });
        if (!s.fits) return;
        await saveVaultIndexFile(this.root, s.json);
      } catch {
        // The index is a cache.
      }
    });
    this.saving = run;
    return run;
  }

  /** Stop: a pass in flight stops at its next step; a pending save is
   *  written first so the last write is kept. */
  async close(): Promise<void> {
    if (this.closed) return;
    const pending = this.saveTimer !== undefined;
    if (pending) await this.save();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.closed = true;
    this.generation++;
    await this.saving.catch(() => undefined);
  }

  // ---- internals ----------------------------------------------------------

  private async load(): Promise<void> {
    try {
      const json = await loadVaultIndexFile(this.root);
      if (json !== null && !this.closed) {
        const loaded = loadIndex(json, ENGINE_VAULT_CORE);
        if (loaded.status === 'loaded') {
          // Writes that landed while the file loaded win over the file.
          for (const [path, w] of this.pendingWrites) {
            if (w) loaded.index.applyWrite(w.meta, w.text);
            else loaded.index.applyRemove(path);
          }
          this.indexValue = loaded.index;
        }
      }
    } catch {
      // A file that cannot be read is a cold build, never an error.
    }
    this.pendingWrites.clear();
    this.loadedFlag = true;
  }

  private async runReconcile(): Promise<void> {
    await this.loaded;
    if (this.closed) return;
    const gen = this.generation;
    const live = (): boolean => !this.closed && gen === this.generation;
    this.touched = new Set();
    let listed: VaultListedNote[];
    try {
      listed = await listVaultNotes(this.root);
    } catch {
      return;
    }
    if (!live()) return;
    const index = this.indexValue;
    let changed = false;
    index.beginBuild();
    try {
      const plan = index.applyListing(listed);
      changed = plan.drop.length > 0 || plan.placeholder.length > 0;
      let checkpointAt = Date.now();
      await eachLimited(
        plan.read,
        LIST_CONCURRENCY,
        async (path) => {
          let read: Awaited<ReturnType<EngineVaultIndex['readBody']>>;
          try {
            read = await this.readBody(path, true);
          } catch {
            // A read that failed keeps the old entry for the next reconcile.
            return;
          }
          if (!live() || this.touched.has(path)) return;
          if (read) index.applyWrite(metaOf(path, read), read.text);
          else index.applyRemove(path);
          changed = true;
          if (Date.now() - checkpointAt >= INDEX_CHECKPOINT_MS) {
            checkpointAt = Date.now();
            void this.save();
          }
        },
        live,
      );
      if (live()) index.resolve();
    } finally {
      index.endBuild();
    }
    if (!live()) return;
    this.lastReconcileAt = Date.now();
    this.reconciledFlag = true;
    if (changed) await this.save();
  }

  /** One note's text and version, jailed to the root (a link swapped in
   *  after the listing cannot reach outside it). Null when it is gone; with
   *  `strict`, other failures throw so the caller keeps the old entry. */
  private async readBody(
    path: string,
    strict = false,
  ): Promise<{ text: string; version: string; updatedAt: string } | null> {
    try {
      return await readNote(new Jail(this.root).resolve(path));
    } catch (err) {
      if (strict) throw err;
      return null;
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.save();
    }, INDEX_CHECKPOINT_MS);
    this.saveTimer.unref?.();
  }
}

function metaOf(
  path: string,
  read: { text: string; version: string; updatedAt: string },
): VaultListedNote {
  return {
    path,
    version: read.version,
    updatedAt: read.updatedAt,
    size: Buffer.byteLength(read.text, 'utf8'),
  };
}

/** Every open root's index, by key. */
const handles = new Map<string, EngineVaultIndex>();

/** The index of a vault root, made (and its load and reconcile started in the
 *  background) on first ask. The same root, however spelled, is one index;
 *  two roots are two. */
export async function engineVaultIndex(root: string): Promise<EngineVaultIndex> {
  const key = await vaultIndexKey(root);
  let handle = handles.get(key);
  if (!handle) {
    handle = new EngineVaultIndex(root, key);
    handles.set(key, handle);
  }
  return handle;
}

/** The index of a root only when one is already open, else undefined. A write
 *  never opens an index on its own: the next reconcile picks the note up. */
export async function openEngineVaultIndex(root: string): Promise<EngineVaultIndex | undefined> {
  return handles.get(await vaultIndexKey(root));
}

/** Close and forget every open index (tests, and a daemon shutting down). */
export async function closeEngineVaultIndexes(): Promise<void> {
  const all = [...handles.values()];
  handles.clear();
  await Promise.all(all.map((h) => h.close()));
}
