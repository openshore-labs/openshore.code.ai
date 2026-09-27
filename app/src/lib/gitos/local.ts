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
import { isNotePath, type Lease, type StorageProvider, type StoredFileMeta } from './providers.js';

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
 *  effort: when the keys cannot be listed, the index stands as it is. Runs in
 *  the chain, since it may rewrite the index. */
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
    const body = await storeGetJson<{ text: string; updatedAt: string }>(key).catch(
      () => undefined,
    );
    if (typeof body?.text !== 'string') continue;
    orphans.push({ path, updatedAt: body.updatedAt, size: body.text.length });
  }
  if (!orphans.length) return index;
  const files = byPath([...index.files, ...orphans]);
  await storeSetJson(indexKey(resourceId), { files });
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

  async stat(resourceId, path) {
    return (await localProvider.list(resourceId)).find((f) => f.path === path);
  },

  async read(resourceId, path) {
    const body = await storeGetJson<{ text: string; updatedAt: string }>(fileKey(resourceId, path));
    return body ? { path, text: body.text, updatedAt: body.updatedAt } : undefined;
  },

  async write(resourceId, path, text) {
    return chained(resourceId, async () => {
      const updatedAt = new Date().toISOString();
      await storeSetJson(fileKey(resourceId, path), { text, updatedAt });
      const index = await readIndex(resourceId);
      const meta: StoredFileMeta = { path, updatedAt, size: text.length };
      const files = byPath([...index.files.filter((f) => f.path !== path), meta]);
      await storeSetJson(indexKey(resourceId), { files });
      return { path, text, updatedAt };
    });
  },

  async remove(resourceId, path) {
    await chained(resourceId, async () => {
      await storeDelete(fileKey(resourceId, path));
      const index = await readIndex(resourceId);
      await storeSetJson(indexKey(resourceId), {
        files: index.files.filter((f) => f.path !== path),
      });
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
