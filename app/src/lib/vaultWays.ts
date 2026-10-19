// How you keep notes (founder, 2026-10-19; docs/design/vault-room-clarity-2026-10-19.md):
// the first thing in the Vault room, the same on every device. One row per
// way, the current one marked Here now; a computer offers two ways (OpenShore's
// own folder, or an Obsidian vault), a phone or an iPad three (with your
// computer, your Obsidian vault through your computer, only on this device).
//
// Obsidian is never a connection here, because there is none to make: an
// Obsidian vault is a folder of plain .md files, and Obsidian has no key to
// give another app. So "Your Obsidian vault" is the folder, chosen on the
// computer, and every docked device reaches it there. Copy says only that.
//
// Pure: the room passes in what it knows and acts on the row's action.
import type { Platform } from './platform.js';
import { sanitizeFolderSegment } from './projectMemory.js';

/** Where the person's vault is now, as the room knows it. */
export interface VaultWaysState {
  platform: Platform;
  /** The personal vault's storage id (files, local, hub, icloud, ...). */
  provider: string;
  /** On a computer: the vault folder is an Obsidian vault. */
  obsidianVault?: boolean;
  /** On a computer: the vault folder is OpenShore's own, OpenShore/Vault. */
  defaultFolder?: boolean;
  /** A computer or a server is docked (a phone, an iPad, the web). */
  docked: boolean;
  /** The docked machine is a server, so copy says "your server". */
  dockedServer?: boolean;
  /** Where your notes live, the Settings choice (undefined is 'all'). */
  sync?: 'all' | 'one' | 'device';
  /** The device in hand, e.g. "this phone" or "this iPad" (lib/deviceNoun). */
  deviceNoun: string;
}

export type VaultWayId = 'openshore' | 'obsidian' | 'computer' | 'device';

/** What a row does when tapped. */
export type VaultWayAction =
  /** Nothing to do: it is here now, or the row only explains. */
  | 'none'
  /** On a computer: the vault in OpenShore's own folder. */
  | 'use-openshore-folder'
  /** On a computer: the folder picker, for an Obsidian vault. */
  | 'choose-folder'
  /** Not docked: the Computer room. Its label is "Connect your computer". */
  | 'connect-computer'
  /** Docked: keep the vault with the computer (Sync on all devices). */
  | 'keep-with-computer'
  /** Keep the notes on this device alone. */
  | 'keep-on-device';

export interface VaultWay {
  id: VaultWayId;
  title: string;
  sub: string;
  /** The way the room recommends, or the one it does not. */
  mark?: 'recommended' | 'not-recommended';
  here: boolean;
  action: VaultWayAction;
  /** The row's button, when it acts. */
  actionLabel?: string;
}

/** The card's title. */
export const VAULT_WAYS_TITLE = 'How you keep notes';
/** The line under it. */
export const VAULT_WAYS_SUB =
  'Every note is a plain .md file you own. Choose where those files live.';
/** The folded card's button. */
export const VAULT_WAYS_CHANGE = 'Change';
/** The marks, in words (never colour alone). */
export const VAULT_WAY_MARKS = {
  recommended: 'Recommended',
  'not-recommended': 'Not recommended',
  here: 'Here now',
} as const;
/** The door to the Computer room, as every such door reads. */
export const VAULT_WAY_CONNECT = 'Connect your computer';

function machineNoun(s: VaultWaysState): string {
  return s.dockedServer ? 'your server' : 'your computer';
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The ways this device offers, in the order the card lists them. */
export function vaultWays(s: VaultWaysState): VaultWay[] {
  if (s.platform === 'electron') return desktopWays(s);
  return deviceWays(s);
}

function desktopWays(s: VaultWaysState): VaultWay[] {
  const onFolder = s.provider === 'files';
  const obsidianHere = onFolder && Boolean(s.obsidianVault);
  const openshoreHere = onFolder && Boolean(s.defaultFolder) && !obsidianHere;
  return [
    {
      id: 'openshore',
      title: 'In your OpenShore folder',
      sub: 'Plain .md files in OpenShore/Vault on this computer, with a folder for each project. Your agents and routines work here too.',
      mark: 'recommended',
      here: openshoreHere,
      action: openshoreHere ? 'none' : 'use-openshore-folder',
      ...(openshoreHere ? {} : { actionLabel: 'Use this' }),
    },
    {
      id: 'obsidian',
      title: 'Your Obsidian vault',
      sub: 'Already use Obsidian? Choose your vault folder, and OpenShore and Obsidian work on the same files. There is nothing to sign in to and no key: the folder is the connection.',
      here: obsidianHere,
      action: 'choose-folder',
      actionLabel: obsidianHere ? 'Choose another' : 'Choose folder',
    },
  ];
}

function deviceWays(s: VaultWaysState): VaultWay[] {
  const sync = s.sync ?? 'all';
  const machine = machineNoun(s);
  const withMachine =
    s.docked &&
    ((s.provider === 'hub' && sync !== 'device') || (s.provider === 'local' && sync === 'all'));
  const onDevice = s.provider === 'local' && (!s.docked || sync === 'device');
  const dock = s.docked
    ? undefined
    : ({ action: 'connect-computer', actionLabel: VAULT_WAY_CONNECT } as const);
  return [
    {
      id: 'computer',
      title: `With ${machine}`,
      sub: `Dock to ${machine} and your vault lives there, where your agents work. ${capital(s.deviceNoun)} keeps a copy and catches up whenever it is docked.`,
      mark: 'recommended',
      here: withMachine,
      ...(dock ??
        (withMachine
          ? { action: 'none' as const }
          : { action: 'keep-with-computer' as const, actionLabel: 'Use this' })),
    },
    {
      id: 'obsidian',
      title: 'Your Obsidian vault',
      sub: s.docked
        ? `Obsidian keeps its vault as a folder on ${machine}. Choose it there, in the Vault's ${VAULT_WAYS_TITLE}, and every docked device uses it. There is no key to enter here.`
        : `Obsidian keeps its vault as a folder on your computer. Dock to it, then choose that folder there, and every docked device uses it. There is no key to enter here.`,
      here: false,
      ...(dock ?? { action: 'none' as const }),
    },
    {
      id: 'device',
      title: `Only on ${s.deviceNoun}`,
      sub: `Your notes stay on ${s.deviceNoun}. Your agents on ${machine} cannot read them, and your other devices do not get them.`,
      mark: 'not-recommended',
      here: onDevice,
      action: onDevice ? 'none' : 'keep-on-device',
      ...(onDevice ? {} : { actionLabel: 'Use this' }),
    },
  ];
}

/** The folded card's one line: where the notes are kept now. */
export function vaultWaySummary(s: VaultWaysState, storageLabel?: string): string {
  const here = vaultWays(s).find((w) => w.here);
  if (here) {
    if (here.id === 'openshore') return 'Kept in your OpenShore folder.';
    if (here.id === 'obsidian') return 'Kept in your Obsidian vault.';
    if (here.id === 'computer') return `Kept with ${machineNoun(s)}.`;
    return `Kept only on ${s.deviceNoun}.`;
  }
  if (s.platform === 'electron' && s.provider === 'files') return 'Kept in a folder you chose.';
  return storageLabel ? `Kept in ${storageLabel}.` : 'Kept on this device.';
}

/** The toast after a phone's way changed. */
export function vaultWayToast(way: 'computer' | 'device', s: VaultWaysState): string {
  return way === 'computer'
    ? `Your vault is kept with ${machineNoun(s)}, and ${s.deviceNoun} keeps a copy.`
    : `Your notes stay on ${s.deviceNoun} now. Notes already on ${machineNoun(s)} stay there.`;
}

/** The folder in the vault that holds a project's notes, e.g.
 *  "Projects/My App" (the starter layout's Projects folder). */
export const VAULT_PROJECTS_FOLDER = 'Projects';
export function projectVaultFolder(projectName: string): string {
  return `${VAULT_PROJECTS_FOLDER}/${sanitizeFolderSegment(projectName) || 'Untitled project'}`;
}

/** The Projects card (once Coding projects): its title, its line, and what
 *  each row says it holds. The note names are the agent's preset notes. */
export const VAULT_PROJECTS_TITLE = 'Projects';
export const VAULT_PROJECTS_SUB =
  "Each project's notes. The agent keeps its own in the project's repository, so they travel with the code; read them here.";
export function vaultProjectRowSub(noteTitles: readonly string[], hasRepo: boolean): string {
  return hasRepo ? noteTitles.join(' · ') : 'Its notes start once it has a repository.';
}

/** In the vault's folder for a project: the way to the agent's notes. */
export function vaultProjectFolderLine(projectName: string): string {
  return `The agent's notes for ${projectName} (Current State, Progress, Decisions and more) are in its repository.`;
}
export const VAULT_PROJECT_FOLDER_OPEN = "Open the agent's notes";
/** The project notes view's row to the vault folder. */
export const VAULT_PROJECT_YOUR_NOTES = 'Your notes for this project';
export function vaultProjectYourNotesSub(projectName: string): string {
  return `A folder in your vault, ${projectVaultFolder(projectName)}, for anything you keep on it.`;
}
