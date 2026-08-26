// Export the vault as REAL files: every note written as a plain .md under
// Documents/Vault, which iOS surfaces in the Files app ("On My iPhone / OS
// Code / Vault"). That folder is exactly what Obsidian mobile opens as a
// vault, so the handoff is literal, not a metaphor. This is the true-compat
// escape hatch the CTO required for keeping v1 bytes in the sealed store:
// the files are always one tap from being plain markdown you hold.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { platform } from './platform.js';

const EXPORT_ROOT = 'Vault';

/** Write every note to Documents/Vault/<path>. Returns the note count, or
 *  undefined where no real filesystem exists (web dev). Throws on a real device
 *  write failure, so the caller can tell a genuine error apart from the web
 *  no-op. Clears the export root first so notes deleted or renamed since the
 *  last export do not linger as ghost files Obsidian would still show (R-13). */
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
  for (const note of notes) {
    await Filesystem.writeFile({
      path: `${EXPORT_ROOT}/${note.path}`,
      data: note.text,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }
  return notes.length;
}
