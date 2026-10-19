// One OpenShore folder on the iPhone and the iPad (folder and sync plan, M2):
// what the app saves sits in the app's Documents, a subfolder per part of the
// app, which the Files app shows as On My iPhone > OpenShore (it names the
// app's Documents by the app; Info.plist: UIFileSharingEnabled,
// LSSupportsOpeningDocumentsInPlace). The sections sit right at the Documents
// root, so the path is one level, not "OpenShore > OpenShore" (founder intent:
// super organized; flattened 2026-10-16, DECISIONS). The phone has no
// Projects folder: projects run on a computer (Runs on). Machine state
// (settings, keys, tokens, the vault index) stays in the app's own hidden
// data, never here.
//
//   Documents/        (Files: On My iPhone > OpenShore)
//     Chats/          chats as markdown files (Save chats as files)
//     Vault/          your notes (This device's vault, lib/gitos/phoneVault.ts)
//     Local Library/  model files from the Local Library (the oscode-llama
//                     plugin), left out of backups
//     Exports/        what you export (lib/vaultExport.ts)
//     README.md       what each folder is
//
// Each folder is named for the room that shows it, as on the computer
// (founder, 2026-10-19). The first layout called Local Library "Models";
// launch renames it once (`moveModelsFolder`), and the plugin does the same
// on its own first look, so no model downloads again.
//
// Before M2 the export wrote its copy to Documents/Vault, the name the live
// vault now takes. So launch first moves that old export aside, once, to
// Exports/Vault (earlier export), and only then makes the live Vault. A
// marker in the sealed store says it ran, so it never touches the live vault
// afterwards. If the old export cannot be moved, the live vault is not made
// there: This device stays the sealed store this launch, and the next launch
// tries again.
//
// The desktop's own is os-code's config/openshoreFolder.ts (M1); the two keep
// one set of names.
import { capacitorPhoneFs, type PhoneFs } from './gitos/phoneFolder.js';
import { startPhoneVaultMove } from './gitos/phoneVault.js';
import { platform, storeGetJson, storeSetJson } from './platform.js';

/** Each part of the app's folder on the phone, in the order the README lists
 *  them. Each is a folder at the Documents root. */
export const PHONE_SECTIONS = {
  chats: 'Chats',
  vault: 'Vault',
  library: 'Local Library',
  exports: 'Exports',
} as const;
export type PhoneSection = keyof typeof PHONE_SECTIONS;

/** One part's folder, relative to Documents, e.g. "Exports". */
export function phoneSectionDir(section: PhoneSection): string {
  return PHONE_SECTIONS[section];
}

/** The README, at the Documents root. */
export const PHONE_README_PATH = 'README.md';

/** The name the first layout gave Local Library. */
export const EARLIER_MODELS_DIR = 'Models';

/** Where the pre-M2 export goes, inside Exports. */
export const EARLIER_EXPORT_NAME = 'Vault (earlier export)';

/** The sealed-store marker that the old export was dealt with (machine
 *  state, never in the folder). */
export const OLD_EXPORT_MARKER_KEY = 'oscode.phoneFolder.oldExportMoved';

// Each line says only what is true in this build.
const README_LINES: Record<PhoneSection, string> = {
  chats: 'Your chats, one markdown file each, filed by month. Turn this off in Settings, Chats.',
  vault:
    'Your notes, plain markdown, one file each. Notes for a project go in Vault/Projects/<project>. Other apps can open them from here.',
  library:
    'Model files OpenShore got from the Local Library for this device. They are left out of backups, since they can be downloaded again.',
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
export const PHONE_README_EARLIER: readonly string[] = [
  // The first layout (2026-10-16), with Models.
  '# OpenShore\n\nEverything you save through OpenShore on this device, one folder for each part of the app.\n\n- **Vault**: Your notes, plain markdown, one file each. Other apps can open them from here.\n- **Chats**: Your chats, one markdown file each, filed by month. Turn this off in Settings, Chats.\n- **Models**: Model files OpenShore downloaded to this device. They are left out of backups, since they can be downloaded again.\n- **Exports**: Anything you export or save out of OpenShore.\n\nProjects run on your computer, so they have no folder here. Settings, keys and other app state are kept apart from your files, inside the app, and never here.\n',
];

/** "Vault (earlier export)", then " 2" to " 99" beside a taken name. */
function earlierExportName(n: number): string {
  return n === 1 ? EARLIER_EXPORT_NAME : `${EARLIER_EXPORT_NAME} ${n}`;
}

/**
 * Move the pre-M2 export out of Documents/Vault, once, before the live vault
 * is ever made there. True when the way is clear (nothing there, already
 * done, or moved now and recorded); false when it is still there, so the
 * caller must not make the live vault.
 */
export async function moveEarlierExportAside(fs: PhoneFs): Promise<boolean> {
  try {
    if (await storeGetJson<{ at: string }>(OLD_EXPORT_MARKER_KEY)) return true;
  } catch {
    // The marker could not be read, so Documents/Vault may already be the
    // live vault: touch nothing, and stay sealed this launch.
    return false;
  }
  const vault = PHONE_SECTIONS.vault;
  try {
    if (await fs.stat(vault)) {
      // Before the marker exists, Documents/Vault is only ever the old
      // export: this build makes the live vault there only after the marker.
      await fs.mkdir(PHONE_SECTIONS.exports);
      let target: string | undefined;
      for (let n = 1; n <= 99 && !target; n++) {
        const at = `${PHONE_SECTIONS.exports}/${earlierExportName(n)}`;
        if (!(await fs.stat(at))) target = at;
      }
      if (!target) return false;
      await fs.rename(vault, target);
      if (await fs.stat(vault)) return false;
    }
    // Recorded only once the way is clear; a failed write leaves it to the
    // next launch, which finds nothing there and records it then.
    await storeSetJson(OLD_EXPORT_MARKER_KEY, { at: new Date().toISOString() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Make the Documents layout and write the README the first time (or over an
 * earlier one this app wrote), after moving the old export aside. True when
 * the Vault folder is the live vault's, ready to use; false when the old
 * export is still in its way (the vault stays sealed this launch). Never
 * throws.
 */
export async function ensurePhoneFolder(fs: PhoneFs = capacitorPhoneFs()): Promise<boolean> {
  if (!(await moveEarlierExportAside(fs))) return false;
  await moveModelsFolder(fs);
  try {
    for (const s of Object.keys(PHONE_SECTIONS) as PhoneSection[]) {
      await fs.mkdir(phoneSectionDir(s));
    }
    const there = await fs.readText(PHONE_README_PATH);
    const st = there === null ? await fs.stat(PHONE_README_PATH) : null;
    if ((there === null && !st) || (there !== null && PHONE_README_EARLIER.includes(there))) {
      await fs.writeText(PHONE_README_PATH, PHONE_README);
    }
  } catch {
    // A full disk: each part reports for itself when used. The old export is
    // out of the way, so the vault folder is still the live vault's.
  }
  return true;
}

/**
 * Rename the first layout's Models folder to Local Library, once, when the
 * new name is free. One rename on one volume, so no model file is copied or
 * downloaded again. With both there (a rename that failed before), the
 * plugin moves what is left on its own first look. Never throws.
 */
export async function moveModelsFolder(fs: PhoneFs): Promise<void> {
  try {
    const old = await fs.stat(EARLIER_MODELS_DIR);
    if (old?.type !== 'directory') return;
    if (await fs.stat(PHONE_SECTIONS.library)) return;
    await fs.rename(EARLIER_MODELS_DIR, PHONE_SECTIONS.library);
  } catch {
    // Left where it was; the plugin still finds the files there.
  }
}

let prepared: Promise<void> | undefined;

/**
 * At launch on the iPhone and the iPad, once the sealed store is unlocked:
 * the old export moved aside, the layout, then the one-time move of the
 * sealed vault into Vault. Runs once per launch; a no-op anywhere else. Never
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
