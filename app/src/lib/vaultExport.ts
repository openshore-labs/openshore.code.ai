// Export the vault as REAL files: every note written as a plain .md under
// Documents/Vault, which iOS surfaces in the Files app ("On My iPhone / OS
// Code / Vault"). That folder is exactly what Obsidian mobile opens as a
// vault, so the handoff is literal, not a metaphor. This is the true-compat
// escape hatch the CTO required for keeping v1 bytes in the sealed store:
// the files are always one tap from being plain markdown you hold.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { platform } from './platform.js';

const EXPORT_ROOT = 'Vault';

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

/** Write every note to Documents/Vault/<path>. Returns the note count, or
 *  undefined where no real filesystem exists (web dev). Throws on a real device
 *  write failure, so the caller can tell a genuine error apart from the web
 *  no-op. Clears the export root first so notes deleted or renamed since the
 *  last export do not linger as ghost files Obsidian would still show (R-13).
 *  Notes whose path could escape the root are skipped and not counted. */
export async function exportVaultToFiles(
  notes: Array<{ path: string; text: string }>,
): Promise<number | undefined> {
  if (platform() === 'web') return undefined;
  try {
    await Filesystem.rmdir({
      path: EXPORT_ROOT,
      directory: Directory.Documents,
      recursive: true,
    });
  } catch {
    // Nothing to remove on the first export; ignore.
  }
  let written = 0;
  for (const note of notes) {
    if (!isSafeExportPath(note.path)) continue;
    await Filesystem.writeFile({
      path: `${EXPORT_ROOT}/${note.path}`,
      data: note.text,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    written += 1;
  }
  return written;
}
