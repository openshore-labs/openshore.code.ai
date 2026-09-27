// The desktop vault folder's own controls (Vault M1 1.4): where it is, the
// system picker, the choices after a pick, and opening it in the file manager
// or Obsidian. Every call is a no-argument IPC to main, or names a choice main
// offered; the renderer never sends a folder path (CTO F7). Each is a quiet
// no-op off the desktop.
import {
  bridge,
  type VaultBringResult,
  type VaultDirInfo,
  type VaultPickResult,
  type VaultRefineChoice,
} from './electronBridge.js';
import { platform } from './platform.js';

function folderBridge() {
  const b = bridge();
  return platform() === 'electron' && b && typeof b.vaultDirInfo === 'function' ? b : undefined;
}

/** Whether this device can pick a vault folder (the desktop app). */
export function canPickVaultFolder(): boolean {
  return Boolean(folderBridge());
}

/** Where the folder is, or undefined off the desktop or when main did not
 *  answer. */
export async function vaultFolderInfo(): Promise<VaultDirInfo | undefined> {
  try {
    return await folderBridge()?.vaultDirInfo();
  } catch {
    return undefined;
  }
}

/** Run the system folder picker in main. Undefined off the desktop. */
export async function chooseVaultFolder(): Promise<VaultPickResult | undefined> {
  return folderBridge()?.vaultChooseDir();
}

/** One of the choices a pick's result offered. */
export async function refineVaultFolder(
  choice: VaultRefineChoice,
): Promise<VaultPickResult | undefined> {
  return folderBridge()?.vaultRefineDir(choice);
}

/** Bring the previous folder's notes into this one (main copies, creating
 *  only). Undefined off the desktop. */
export async function bringPreviousVaultFolder(): Promise<VaultBringResult | undefined> {
  return folderBridge()?.vaultBringPrevious();
}

/** Open the folder in Finder, File Explorer, or the file manager. */
export async function revealVaultFolder(): Promise<boolean> {
  try {
    return (await folderBridge()?.vaultReveal())?.ok === true;
  } catch {
    return false;
  }
}

/** Open the folder in Obsidian. */
export async function openVaultInObsidian(): Promise<void> {
  await folderBridge()
    ?.vaultOpenObsidian()
    .catch(() => {});
}

/** macOS: open Privacy & Security, Files and Folders. */
export async function openPrivacySettings(): Promise<void> {
  await folderBridge()
    ?.openPrivacySettings()
    .catch(() => {});
}
