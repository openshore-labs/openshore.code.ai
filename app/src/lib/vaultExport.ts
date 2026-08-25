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
 *  undefined where no real filesystem exists (web dev). */
export async function exportVaultToFiles(
  notes: Array<{ path: string; text: string }>,
): Promise<number | undefined> {
  if (platform() === 'web') return undefined;
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
