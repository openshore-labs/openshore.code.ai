// Blob URLs for the Vault's images (Vault M6, CTO K11). A note never names the
// URL an image loads from: the reader resolves the attachment path, asks this
// registry for it, and the registry reads the bytes through the provider and
// hands back a `blob:` URL it made itself. So a note cannot point an image at a
// `blob:` or `data:` URL, and nothing here is ever persisted, written into a
// note, or sent to a model.
//
// Keyed by provider, resource, path and version (a new version is a new key),
// refcounted by the images mounted on screen, revoked 30 s after the last one
// lets go (a quick back and forth keeps the same URL), and held under 64 MB by
// evicting the least recently used unmounted entries. `revokeAll()` drops
// everything at once: a repoint, a sign-out, `shutVaultIndex`, leaving the
// room, and iOS backgrounding call it.

import type { AttachmentMime, BytesRead, BytesReadRefusal } from 'os-code/protocol';

/** The most the registry keeps alive before it evicts unmounted entries. */
export const VAULT_BLOB_CAP_BYTES = 64 * 1024 * 1024;
/** How long an entry outlives its last mounted image. */
export const VAULT_BLOB_GRACE_MS = 30_000;

/** Why an image has no URL: the provider's refusal, or `gone` when the
 *  registry was cleared while the bytes were still on their way. */
export type BlobFailure = BytesReadRefusal | 'gone';

export type BlobAcquired = { ok: true; url: string } | { ok: false; reason: BlobFailure };

/** The one key for an attachment's bytes. */
export function vaultBlobKey(scope: string, path: string, version: string): string {
  return `${scope}\n${path}\n${version}`;
}

export interface VaultBlobRegistry {
  /** A URL for `key`, reading it with `load` only when no live entry has it.
   *  Every call holds one reference until `release(key)`, failed or not. */
  acquire(key: string, load: () => Promise<BytesRead>): Promise<BlobAcquired>;
  /** Drop one reference; the last one starts the grace clock. */
  release(key: string): void;
  /** Revoke every URL now and forget every entry. */
  revokeAll(): void;
  /** For tests and the budget line: bytes held by live URLs, and entries. */
  stats(): { bytes: number; entries: number };
}

export interface VaultBlobDeps {
  createUrl?: (bytes: Uint8Array, mime: AttachmentMime) => string;
  revokeUrl?: (url: string) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  capBytes?: number;
  graceMs?: number;
}

interface Entry {
  refs: number;
  pending: Promise<BlobAcquired>;
  url?: string;
  size: number;
  used: number;
  timer?: unknown;
}

export function createVaultBlobs(deps: VaultBlobDeps = {}): VaultBlobRegistry {
  const createUrl =
    deps.createUrl ??
    ((bytes: Uint8Array, mime: AttachmentMime) =>
      URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })));
  const revokeUrl = deps.revokeUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const cap = deps.capBytes ?? VAULT_BLOB_CAP_BYTES;
  const grace = deps.graceMs ?? VAULT_BLOB_GRACE_MS;

  const entries = new Map<string, Entry>();
  let clock = 0;

  const drop = (key: string, entry: Entry): void => {
    if (entry.timer !== undefined) clearTimer(entry.timer);
    if (entry.url) revokeUrl(entry.url);
    entries.delete(key);
  };

  const held = (): number => {
    let n = 0;
    for (const e of entries.values()) if (e.url) n += e.size;
    return n;
  };

  // Least recently used first, and only entries no image holds: a mounted
  // image never loses its URL to the budget.
  const trim = (): void => {
    let bytes = held();
    if (bytes <= cap) return;
    const idle = [...entries.entries()]
      .filter(([, e]) => e.refs === 0 && e.url)
      .sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of idle) {
      if (bytes <= cap) break;
      bytes -= e.size;
      drop(key, e);
    }
  };

  return {
    acquire(key, load) {
      const live = entries.get(key);
      if (live) {
        live.refs += 1;
        live.used = ++clock;
        if (live.timer !== undefined) {
          clearTimer(live.timer);
          live.timer = undefined;
        }
        return live.pending;
      }
      const entry: Entry = {
        refs: 1,
        size: 0,
        used: ++clock,
        pending: Promise.resolve({ ok: false, reason: 'gone' }),
      };
      entries.set(key, entry);
      entry.pending = (async (): Promise<BlobAcquired> => {
        let read: BytesRead;
        try {
          read = await load();
        } catch {
          read = { ok: false, reason: 'refused' };
        }
        // Cleared while the bytes were on their way: make no URL nobody owns.
        if (entries.get(key) !== entry) return { ok: false, reason: 'gone' };
        if (!read.ok) return { ok: false, reason: read.reason };
        entry.url = createUrl(read.bytes, read.mime);
        entry.size = read.bytes.byteLength;
        trim();
        return { ok: true, url: entry.url };
      })();
      return entry.pending;
    },
    release(key) {
      const entry = entries.get(key);
      if (!entry || entry.refs === 0) return;
      entry.refs -= 1;
      if (entry.refs > 0) return;
      // A failed read keeps nothing worth a grace period.
      if (!entry.url) {
        void entry.pending.then(() => {
          if (entries.get(key) === entry && entry.refs === 0 && !entry.url) entries.delete(key);
          else if (entries.get(key) === entry && entry.refs === 0) arm(key, entry);
        });
        return;
      }
      arm(key, entry);
    },
    revokeAll() {
      for (const [key, e] of [...entries.entries()]) drop(key, e);
    },
    stats() {
      return { bytes: held(), entries: entries.size };
    },
  };

  function arm(key: string, entry: Entry): void {
    if (entry.timer !== undefined) clearTimer(entry.timer);
    entry.timer = setTimer(() => {
      entry.timer = undefined;
      if (entries.get(key) === entry && entry.refs === 0) drop(key, entry);
    }, grace);
    trim();
  }
}

/** The app's one registry. */
export const vaultBlobs: VaultBlobRegistry = createVaultBlobs();
