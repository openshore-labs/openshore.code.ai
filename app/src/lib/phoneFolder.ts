// One OpenShore folder on the iPhone and the iPad (folder and sync plan, M2):
// what the app saves sits in Documents/OpenShore, a subfolder per part of the
// app, so the Files app shows it (Info.plist: UIFileSharingEnabled,
// LSSupportsOpeningDocumentsInPlace). The phone has no Projects folder:
// projects run on a computer (Runs on). Machine state (settings, keys,
// tokens, the vault index) stays in the app's own hidden data, never here.
//
//   OpenShore/
//     Vault/      your notes (This device's vault, lib/gitos/phoneVault.ts)
//     Chats/      kept for chats as files (M3); empty until then
//     Models/     downloaded model files (the oscode-llama plugin), left out
//                 of backups
//     Exports/    what you export (lib/vaultExport.ts)
//     README.md   what each folder is
//
// The desktop's own is os-code's config/openshoreFolder.ts (M1); the two keep
// one set of names.
import { capacitorPhoneFs, PHONE_OPENSHORE_DIR, type PhoneFs } from './gitos/phoneFolder.js';
import { startPhoneVaultMove } from './gitos/phoneVault.js';
import { platform } from './platform.js';

/** Each part of the app's folder on the phone, in the order the README lists
 *  them. */
export const PHONE_SECTIONS = {
  vault: 'Vault',
  chats: 'Chats',
  models: 'Models',
  exports: 'Exports',
} as const;
export type PhoneSection = keyof typeof PHONE_SECTIONS;

/** One part's folder, relative to Documents, e.g. "OpenShore/Exports". */
export function phoneSectionDir(section: PhoneSection): string {
  return `${PHONE_OPENSHORE_DIR}/${PHONE_SECTIONS[section]}`;
}

// Each line says only what is true in this build: chats are not files yet
// (M3 writes them), so Chats says it is waiting for them.
const README_LINES: Record<PhoneSection, string> = {
  vault: 'Your notes, plain markdown, one file each. Other apps can open them from here.',
  chats:
    'For your chats as markdown files. Until OpenShore saves them here, chats stay inside the app.',
  models:
    'Model files OpenShore downloaded to this device. They are left out of backups, since they can be downloaded again.',
  exports: 'Anything you export or save out of OpenShore.',
};

export const PHONE_README = [
  '# OpenShore',
  '',
  'Everything you save through OpenShore on this device, one folder for each part of the app.',
  '',
  ...(Object.keys(PHONE_SECTIONS) as PhoneSection[]).map(
    (s) => `- **${PHONE_SECTIONS[s]}**: ${README_LINES[s]}`,
  ),
  '',
  'Projects run on your computer, so they have no folder here. Settings, keys and other app state are kept apart from your files, inside the app, and never here.',
  '',
].join('\n');

/** Earlier README texts this app wrote, which a newer one may replace. A
 *  README that is none of them is the person's own edit and is left as it
 *  is. */
export const PHONE_README_EARLIER: readonly string[] = [];

/**
 * Make Documents/OpenShore and its parts, and write the README the first
 * time (or over an earlier one this app wrote). Never throws: a folder that
 * cannot be made shows up later where it is used.
 */
export async function ensurePhoneFolder(fs: PhoneFs = capacitorPhoneFs()): Promise<void> {
  try {
    for (const s of Object.keys(PHONE_SECTIONS) as PhoneSection[]) {
      await fs.mkdir(phoneSectionDir(s));
    }
    const readme = `${PHONE_OPENSHORE_DIR}/README.md`;
    const there = await fs.readText(readme);
    const st = there === null ? await fs.stat(readme) : null;
    if ((there === null && !st) || (there !== null && PHONE_README_EARLIER.includes(there))) {
      await fs.writeText(readme, PHONE_README);
    }
  } catch {
    // A full disk: each part reports for itself when used.
  }
}

let prepared: Promise<void> | undefined;

/**
 * At launch on the iPhone and the iPad, once the sealed store is unlocked:
 * the folder's layout, then the one-time move of the sealed vault into
 * OpenShore/Vault. Runs once per launch; a no-op anywhere else. Never
 * rejects.
 */
export function preparePhoneFolder(): Promise<void> {
  if (platform() !== 'ios') return Promise.resolve();
  // The move is started (and so the vault's calls held) at once, before the
  // layout is made, so nothing reads the vault between the two.
  prepared ??= startPhoneVaultMove(ensurePhoneFolder()).then(
    () => undefined,
    () => undefined,
  );
  return prepared;
}
