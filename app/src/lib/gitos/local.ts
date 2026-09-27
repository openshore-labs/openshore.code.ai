// The Local storage provider: this device, through the app's existing sealed
// key-value store, so vault bytes are encrypted at rest under the device DEK
// exactly like chats and settings. Per-path keys keep each write atomic (the
// platform store replaces a key's value whole), and a per-resource index doc
// makes list() cheap without reading every body.
//
// Layout in the store:
//   oscode.gitos.index.<resourceId>            -> { files: StoredFileMeta[] }
//   oscode.gitos.file.<resourceId>.<path>      -> { text, updatedAt, v? }
//   oscode.gitos.lease.<resourceId>            -> Lease
//
// Compare-and-swap (Vault M2 2.1, CTO G1). A note's version is `v`, a random
// token made fresh on every write and kept in the body. It is compared with
// === only. Not updatedAt, since two writes can land in one millisecond; not
// a counter, since a delete and a re-create would start it over and an old
// draft would match a different note. A body written before M2 has no `v`,
// and its version is its updatedAt, exactly what versionOf answered in M1, so
// every draft stashed or open then stays valid. The body is the truth; the
// index is a list hint, written after the body, so it can never claim a
// version the body does not have.
import { storeDelete, storeGetJson, storeKeys, storeSetJson } from '../platform.js';
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

const indexKey = (resourceId: string) => `oscode.gitos.index.${resourceId}`;
const filePrefix = (resourceId: string) => `oscode.gitos.file.${resourceId}.`;
const fileKey = (resourceId: string, path: string) => `${filePrefix(resourceId)}${path}`;
const leaseKey = (resourceId: string) => `oscode.gitos.lease.${resourceId}`;

interface IndexDoc {
  files: StoredFileMeta[];
}

async function readIndex(resourceId: string): Promise<IndexDoc> {
  return (await storeGetJson<IndexDoc>(indexKey(resourceId))) ?? { files: [] };
}

interface Body {
  text: string;
  updatedAt: string;
  /** The version token; absent on a body written before M2. */
  v?: string;
}

/** A body's version: its token, or its updatedAt when written before M2. */
const verOf = (b: Body): string => b.v ?? b.updatedAt;

/** Body size in bytes, as the seam says, not UTF-16 code units. */
const byteSize = (text: string): number => new TextEncoder().encode(text).length;

/** A fresh version token. The fallback keeps it random where randomUUID is
 *  missing (an insecure context), never a clock or a counter. */
function newVersion(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function readBody(resourceId: string, path: string): Promise<Body | undefined> {
  const body = await storeGetJson<Body>(fileKey(resourceId, path));
  return typeof body?.text === 'string' ? body : undefined;
}

const metaOf = (path: string, b: Body): StoredFileMeta => ({
  path,
  updatedAt: b.updatedAt,
  size: byteSize(b.text),
  version: verOf(b),
});

const fileOf = (path: string, b: Body): StoredFile => ({
  path,
  text: b.text,
  updatedAt: b.updatedAt,
  version: verOf(b),
});

const byPath = (files: StoredFileMeta[]) => files.sort((a, b) => a.path.localeCompare(b.path));

// One promise chain per resource (data-8). A write is a body write and then a
// read-modify-write of the index, and the sealed store awaits between them, so
// two unchained writes each read the same index and the later one drops the
// other's entry: the bytes stay, but the note never lists again. Every write,
// remove, and index rebuild runs in this chain, one after another. Reading a
// body does not need to.
const indexChains = new Map<string, Promise<unknown>>();

function chained<T>(resourceId: string, fn: () => Promise<T>): Promise<T> {
  const prev = indexChains.get(resourceId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  indexChains.set(resourceId, run);
  run
    .finally(() => {
      if (indexChains.get(resourceId) === run) indexChains.delete(resourceId);
    })
    .catch(() => {});
  return run;
}

/** The index with every orphaned note put back: a body stored under this
 *  resource's key prefix with no index entry (a write cut off between its two
 *  steps, or one an earlier unchained race dropped). The scan lists key names
 *  and reads only the orphans, then writes the rebuilt index back. Best
 *  effort: when the keys cannot be listed, the index stands as it is, and
 *  when the write-back fails (the store is full, the usual way an orphan is
 *  made) the orphans still list this time and the write is tried again on
 *  the next list. Runs in the chain, since it may rewrite the index. */
async function recoveredIndex(resourceId: string): Promise<IndexDoc> {
  const index = await readIndex(resourceId);
  const prefix = filePrefix(resourceId);
  let keys: string[];
  try {
    keys = await storeKeys(prefix);
  } catch {
    return index;
  }
  const known = new Set(index.files.map((f) => f.path));
  const orphans: StoredFileMeta[] = [];
  for (const key of keys) {
    const path = key.slice(prefix.length);
    if (known.has(path) || !isNotePath(path)) continue;
    const body = await storeGetJson<Body>(key).catch(() => undefined);
    if (typeof body?.text !== 'string') continue;
    orphans.push(metaOf(path, body));
  }
  if (!orphans.length) return index;
  const files = byPath([...index.files, ...orphans]);
  try {
    await storeSetJson(indexKey(resourceId), { files });
  } catch {
    // Retried on the next list; a full store must not stop the vault listing.
  }
  return { files };
}

export const localProvider: StorageProvider = {
  id: 'local',
  label: 'This device',
  blurb: 'Stored here, sealed at rest. Private by construction.',
  ready: true,
  compareAndSwap: true,

  async list(resourceId) {
    const { files } = await chained(resourceId, () => recoveredIndex(resourceId));
    return files.filter((f) => isNotePath(f.path));
  },

  // A create and a draft replay ask stat whether bytes live at a path before
  // they write there, so it answers from the body itself, the source of
  // truth, not the filtered list: a hidden legacy note (".NET migration.md",
  // stored before 0.6) or an orphan the index lost must read as there, or the
  // write that follows empties it. It never touches the index, so a full
  // store cannot make it throw.
  async stat(resourceId, path) {
    const body = await readBody(resourceId, path);
    return body ? metaOf(path, body) : undefined;
  },

  async read(resourceId, path) {
    const body = await readBody(resourceId, path);
    return body ? fileOf(path, body) : undefined;
  },

  // The guard is checked against the BODY, inside the per-resource chain, so
  // nothing can land between the check and the write: Electron holds a single
  // instance lock and Capacitor runs one WebView, so this chain really does
  // serialize every writer. Body first, then the index entry. A crash between
  // the two leaves a stale list version, and the recheck corrects it because
  // it reads the body through stat.
  async write(resourceId, path, text, guard?: WriteGuard): Promise<WriteResult> {
    return chained(resourceId, async () => {
      if (guard) {
        const current = await readBody(resourceId, path);
        if ('ifAbsent' in guard) {
          if (current) {
            return {
              ok: false as const,
              conflict: 'exists' as const,
              theirs: fileOf(path, current),
            };
          }
        } else if (!current) {
          return { ok: false as const, conflict: 'missing' as const };
        } else if (verOf(current) !== guard.ifMatch) {
          return {
            ok: false as const,
            conflict: 'changed' as const,
            theirs: fileOf(path, current),
          };
        }
      }
      const body: Body = { text, updatedAt: new Date().toISOString(), v: newVersion() };
      await storeSetJson(fileKey(resourceId, path), body);
      const index = await readIndex(resourceId);
      const files = byPath([...index.files.filter((f) => f.path !== path), metaOf(path, body)]);
      await storeSetJson(indexKey(resourceId), { files });
      return { ok: true as const, file: fileOf(path, body) };
    });
  },

  // Same chain and order as write: read the body, compare, delete the body,
  // then fix the index. A note already gone is ok; the person wanted it gone.
  async remove(resourceId, path, guard?: RemoveGuard): Promise<RemoveResult> {
    return chained(resourceId, async () => {
      if (guard) {
        const current = await readBody(resourceId, path);
        if (current && verOf(current) !== guard.ifMatch) {
          return {
            ok: false as const,
            conflict: 'changed' as const,
            theirs: fileOf(path, current),
          };
        }
      }
      await storeDelete(fileKey(resourceId, path));
      const index = await readIndex(resourceId);
      await storeSetJson(indexKey(resourceId), {
        files: index.files.filter((f) => f.path !== path),
      });
      return { ok: true as const };
    });
  },

  // On this device there is exactly one writer, so the lease grants (or
  // renews) unless a DIFFERENT live holder already has it, which only happens
  // if a stale record survived a crash; the TTL clears that on its own.
  async acquireLease(resourceId, holder, ttlMs) {
    const now = Date.now();
    const current = await storeGetJson<Lease>(leaseKey(resourceId));
    if (current && current.holder !== holder && new Date(current.expiresAt).getTime() > now) {
      return current;
    }
    const lease: Lease = { holder, expiresAt: new Date(now + ttlMs).toISOString() };
    await storeSetJson(leaseKey(resourceId), lease);
    return lease;
  },

  async releaseLease(resourceId, holder) {
    const current = await storeGetJson<Lease>(leaseKey(resourceId));
    if (current?.holder === holder) await storeDelete(leaseKey(resourceId));
  },
};
