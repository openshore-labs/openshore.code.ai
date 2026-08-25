// The Local storage provider: this device, through the app's existing sealed
// key-value store, so vault bytes are encrypted at rest under the device DEK
// exactly like chats and settings. Per-path keys keep each write atomic (the
// platform store replaces a key's value whole), and a per-resource index doc
// makes list() cheap without scanning the keyspace.
//
// Layout in the store:
//   oscode.gitos.index.<resourceId>            -> { files: StoredFileMeta[] }
//   oscode.gitos.file.<resourceId>.<path>      -> { text, updatedAt }
//   oscode.gitos.lease.<resourceId>            -> Lease
import { storeDelete, storeGetJson, storeSetJson } from '../platform.js';
import type { Lease, StorageProvider, StoredFileMeta } from './providers.js';

const indexKey = (resourceId: string) => `oscode.gitos.index.${resourceId}`;
const fileKey = (resourceId: string, path: string) => `oscode.gitos.file.${resourceId}.${path}`;
const leaseKey = (resourceId: string) => `oscode.gitos.lease.${resourceId}`;

interface IndexDoc {
  files: StoredFileMeta[];
}

async function readIndex(resourceId: string): Promise<IndexDoc> {
  return (await storeGetJson<IndexDoc>(indexKey(resourceId))) ?? { files: [] };
}

export const localProvider: StorageProvider = {
  id: 'local',
  label: 'This device',
  blurb: 'Stored here, sealed at rest. Private by construction.',
  ready: true,

  async list(resourceId) {
    return (await readIndex(resourceId)).files;
  },

  async stat(resourceId, path) {
    return (await readIndex(resourceId)).files.find((f) => f.path === path);
  },

  async read(resourceId, path) {
    const body = await storeGetJson<{ text: string; updatedAt: string }>(fileKey(resourceId, path));
    return body ? { path, text: body.text, updatedAt: body.updatedAt } : undefined;
  },

  async write(resourceId, path, text) {
    const updatedAt = new Date().toISOString();
    await storeSetJson(fileKey(resourceId, path), { text, updatedAt });
    const index = await readIndex(resourceId);
    const meta: StoredFileMeta = { path, updatedAt, size: text.length };
    const files = [...index.files.filter((f) => f.path !== path), meta].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    await storeSetJson(indexKey(resourceId), { files });
    return { path, text, updatedAt };
  },

  async remove(resourceId, path) {
    await storeDelete(fileKey(resourceId, path));
    const index = await readIndex(resourceId);
    await storeSetJson(indexKey(resourceId), {
      files: index.files.filter((f) => f.path !== path),
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
