// Export the vault as REAL files on the iPhone: every note written as a plain
// .md under Documents/Vault, which iOS surfaces in the Files app ("On My
// iPhone / OpenShore / Vault"). It is a one-way copy you hold, the true-compat
// escape hatch the CTO required for keeping the bytes in the sealed store.
//
// Only the iPhone exports (0.11). On the desktop the Filesystem plugin has no
// native side, so a write lands in the renderer's IndexedDB, not on disk; the
// desktop's way out is moving the vault to This folder, plain files Obsidian
// opens, and it never reports a count. On the iPhone the export writes
// against a manifest of what it wrote last time: it never removes the folder,
// never touches a file it did not write (so Obsidian's .obsidian/ and anything
// added by hand survive), removes only its own files for notes deleted or
// renamed since, and reports "N of M" when some notes could not be read.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { platform, storeGetJson, storeSetJson, type Platform } from './platform.js';
import type { StorageProviderId } from './gitos/providers.js';

const EXPORT_ROOT = 'Vault';
// Path to the fingerprint of the text this device last exported there.
const MANIFEST_KEY = 'oscode.vault.export.manifest';
type Manifest = Record<string, string>;

/** Whether a note path may be written under the export root. A team vault
 *  note comes from other people's devices, and the write below is recursive,
 *  so a path like "../../x.md" or "/etc/x" would land outside the vault
 *  folder. The server refuses such paths at write time (migration 0015,
 *  BE-10); this is the same rule on the device, so a note stored before that
 *  migration, or by a future backend, still cannot escape. */
export function isSafeExportPath(path: string): boolean {
  if (!path || path.trim() === '') return false;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  const parts = path.split('/');
  return parts.every((p) => p !== '' && p !== '.' && p !== '..');
}

/** The storage sheet's way out for this platform and storage: export on the
 *  iPhone, a move to This folder on the desktop (none once it is there), and
 *  nothing in the browser, which has no files to write. */
export function vaultWayOut(
  on: Platform,
  providerId: StorageProviderId,
): 'export' | 'folder' | undefined {
  if (on === 'ios') return 'export';
  if (on === 'electron') return providerId === 'files' ? undefined : 'folder';
  return undefined;
}

export interface VaultExportResult {
  /** Notes written this time. */
  written: number;
  /** Notes the vault holds, the readable ones and the ones that were not. */
  total: number;
  /** This device's own files, for notes gone since, that were removed. */
  removed: number;
}

// A cheap fingerprint of exported text (FNV-1a, plus the length), so a file
// changed since the export is told apart from the one this device wrote.
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${(h >>> 0).toString(16)}`;
}

/** Write every note to Documents/Vault/<path>. Returns undefined anywhere but
 *  the iPhone (the desktop moves to This folder instead). `failed` are the
 *  notes that could not be read this time: they count toward the total, and
 *  a file this device wrote for one earlier is kept, not treated as stale.
 *  Throws on a real write failure, so the caller can say so. */
export async function exportVaultToFiles(
  notes: Array<{ path: string; text: string }>,
  failed: readonly string[] = [],
): Promise<VaultExportResult | undefined> {
  if (platform() !== 'ios') return undefined;
  const before = (await storeGetJson<Manifest>(MANIFEST_KEY).catch(() => undefined)) ?? {};
  const next: Manifest = {};
  // A note that could not be read is still in the vault: its old file stays.
  for (const path of failed) if (before[path]) next[path] = before[path];
  const current = new Set([...notes.map((n) => n.path), ...failed]);
  let written = 0;
  let removed = 0;
  let done = false;
  try {
    for (const note of notes) {
      if (!isSafeExportPath(note.path)) continue;
      await Filesystem.writeFile({
        path: `${EXPORT_ROOT}/${note.path}`,
        data: note.text,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      next[note.path] = fingerprint(note.text);
      written += 1;
    }
    // Remove only this device's own files for notes gone since the last
    // export, and only while each still holds exactly what was written. A
    // file changed there since is someone's work: it stays, and it stops
    // being ours to remove.
    for (const [path, print] of Object.entries(before)) {
      if (current.has(path) || !isSafeExportPath(path)) continue;
      if (path.split('/').some((segment) => segment.startsWith('.'))) continue;
      const file = `${EXPORT_ROOT}/${path}`;
      try {
        const { data } = await Filesystem.readFile({
          path: file,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        if (typeof data !== 'string' || fingerprint(data) !== print) continue;
        await Filesystem.deleteFile({ path: file, directory: Directory.Documents });
        removed += 1;
      } catch {
        // Already gone (removed by hand, or the folder was cleared): nothing to do.
      }
    }
    done = true;
  } finally {
    // A write that failed partway still records what landed, and keeps the
    // earlier entries it did not reach, so no file of ours is forgotten.
    await storeSetJson(MANIFEST_KEY, done ? next : { ...before, ...next }).catch(() => {});
  }
  return { written, total: notes.length + failed.length, removed };
}

/** The toast after an export, "N of M" when some notes did not make it. */
export function vaultExportLine(r: VaultExportResult): string {
  const where = 'to Files, under OpenShore / Vault';
  if (r.total === 0) return 'Nothing to export yet. Write a note first.';
  if (r.written === 0) {
    return 'None of your notes could be read right now, so nothing was exported. Try again shortly.';
  }
  if (r.written < r.total) {
    return `${r.written} of ${r.total} notes exported ${where}. The rest could not be read right now; export again to bring them.`;
  }
  const noun = r.written === 1 ? 'note' : 'notes';
  // A one-way copy: the next export writes every note again, so an edit made
  // to one of these files elsewhere does not survive it (copy-3).
  return `${r.written} ${noun} exported ${where}. It is a one-way copy: exporting again replaces these files.`;
}
