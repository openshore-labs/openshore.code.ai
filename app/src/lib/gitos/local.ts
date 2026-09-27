// The Local storage provider: this device, through the app's existing sealed
// key-value store, so vault bytes are encrypted at rest under the device DEK
// exactly like chats and settings. Per-path keys keep each write atomic (the
// platform store replaces a key's value whole), and a per-resource index doc
// makes list() cheap without reading every body.
//
// Layout in the store:
//   oscode.gitos.index.<resourceId>            -> { files: StoredFileMeta[] }
//   oscode.gitos.file.<resourceId>.<path>      -> { text, updatedAt }
//   oscode.gitos.lease.<resourceId>            -> Lease
import { storeDelete, storeGetJson, storeKeys, storeSetJson } from '../platform.js';
import {
  isNotePath,
  type Lease,
  type RemoveGuard,
  type RemoveResult,
  type StorageProvider,
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
}

async function readBody(resourceId: string, path: string): Promise<Body | undefined> {
  return storeGetJson<Body>(fileKey(resourceId, path));
}

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
    orphans.push({ path, updatedAt: body.updatedAt, size: body.text.length });
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
    return typeof body?.text === 'string'
      ? { path, updatedAt: body.updatedAt, size: body.text.length }
      : undefined;
  },

  async read(resourceId, path) {
    const body = await readBody(resourceId, path);
    return body ? { path, text: body.text, updatedAt: body.updatedAt } : undefined;
  },

  // The guard is accepted and not yet enforced (Vault M1 F4; M2 adds the
  // check), so this provider does not declare compareAndSwap.
  async write(resourceId, path, text, _guard?: WriteGuard): Promise<WriteResult> {
    return chained(resourceId, async () => {
      const updatedAt = new Date().toISOString();
      await storeSetJson(fileKey(resourceId, path), { text, updatedAt });
      const index = await readIndex(resourceId);
      const meta: StoredFileMeta = { path, updatedAt, size: text.length };
      const files = byPath([...index.files.filter((f) => f.path !== path), meta]);
      await storeSetJson(indexKey(resourceId), { files });
      return { ok: true as const, file: { path, text, updatedAt } };
    });
  },

  // The guard is accepted and not yet enforced (M2 2.1 adds the check, CTO
  // G1), so a stale remove still removes here.
  async remove(resourceId, path, _guard?: RemoveGuard): Promise<RemoveResult> {
    return chained(resourceId, async () => {
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
