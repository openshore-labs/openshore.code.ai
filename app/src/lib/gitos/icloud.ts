// The iCloud storage provider: the same seam the Local provider satisfies,
// backed by the app's iCloud Drive ubiquity container through the native
// OscodeIcloud plugin. Files are plain markdown under Documents/<resourceId>,
// so every device syncs them for free.
//
// The lease is a file in the container (like the Local provider), so
// single-writer semantics ride the same bytes iCloud already syncs. iCloud is
// not a real locking service, so this is best-effort coordination for v1, the
// honest limit the CTO flagged for cloud-drive backends.
import { Icloud } from './icloudPlugin.js';
import { isNotePath, type Lease, type StorageProvider, type StoredFile } from './providers.js';

const LEASE_PATH = '.oscode/lease.json';

export const icloudProvider: StorageProvider = {
  id: 'icloud',
  label: 'iCloud Drive',
  blurb: 'Your iCloud, synced by iOS across your devices.',
  // Readiness is decided at runtime by isIcloudAvailable(), not this flag: the
  // registry probes the device before offering iCloud, so a signed-out phone
  // or an unprovisioned build never shows it as selectable.
  ready: false,
  pending: 'Sign in to iCloud and turn on iCloud Drive in Settings on this iPhone to use it.',

  // Only notes list (0.6): the plugin already skips hidden paths and non-.md
  // files, and this seam filter holds even if it did not, so our own lease,
  // Obsidian's .obsidian/, and an image never open as a note.
  async list(resourceId) {
    const { files } = await Icloud.list({ resourceId });
    return files.filter((f) => isNotePath(f.path)).sort((a, b) => a.path.localeCompare(b.path));
  },

  async stat(resourceId, path) {
    return (await this.list(resourceId)).find((f) => f.path === path);
  },

  async read(resourceId, path) {
    const res = await Icloud.read({ resourceId, path });
    return res.found
      ? { path, text: res.text ?? '', updatedAt: res.updatedAt ?? new Date().toISOString() }
      : undefined;
  },

  async write(resourceId, path, text): Promise<StoredFile> {
    const { updatedAt } = await Icloud.write({ resourceId, path, text });
    return { path, text, updatedAt };
  },

  async remove(resourceId, path) {
    await Icloud.remove({ resourceId, path });
  },

  async acquireLease(resourceId, holder, ttlMs) {
    const now = Date.now();
    const existing = await Icloud.read({ resourceId, path: LEASE_PATH });
    if (existing.found && existing.text) {
      try {
        const current = JSON.parse(existing.text) as Lease;
        if (current.holder !== holder && new Date(current.expiresAt).getTime() > now) {
          return current;
        }
      } catch {
        // A corrupt lease file is treated as no lease.
      }
    }
    const lease: Lease = { holder, expiresAt: new Date(now + ttlMs).toISOString() };
    await Icloud.write({ resourceId, path: LEASE_PATH, text: JSON.stringify(lease) });
    return lease;
  },

  async releaseLease(resourceId, holder) {
    const existing = await Icloud.read({ resourceId, path: LEASE_PATH });
    if (!existing.found || !existing.text) return;
    try {
      const current = JSON.parse(existing.text) as Lease;
      if (current.holder === holder) await Icloud.remove({ resourceId, path: LEASE_PATH });
    } catch {
      // Leave an unparseable lease alone.
    }
  },
};

/** Runtime probe: is iCloud usable on this device right now? */
export async function isIcloudAvailable(): Promise<boolean> {
  try {
    return (await Icloud.available()).available;
  } catch {
    return false;
  }
}
