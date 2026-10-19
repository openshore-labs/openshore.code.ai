// One OpenShore folder on this computer (founder, 2026-10-16): everything the
// person saves through OpenShore sits under ~/OpenShore, a subfolder per part
// of the app, so it can be found, opened and backed up like any other folder.
// Machine state (keys, tokens, trust, indexes, session journals) stays hidden
// in ~/.os-code and never lands here.
//
// It replaces ~/OSCode, which held the clones, the Vault, the sample and the
// scratch folder side by side. `moveLegacyFolder` carries an existing ~/OSCode
// over once: the Vault to Vault, every other folder to Projects (scratch as
// Projects/Scratch). Nothing is copied or deleted, each folder is renamed (one disk,
// so nothing is half moved), and a name already taken in the new place stays
// where it was. Once ~/OSCode is empty it becomes a link to Projects, so a
// repository path a session or a routine recorded keeps resolving.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const OPENSHORE_FOLDER = 'OpenShore';
/** The folder this one replaced. */
export const LEGACY_FOLDER = 'OSCode';

/** Each part of the app's own subfolder, in the order the README lists them. */
export const SECTIONS = {
  vault: 'Vault',
  chats: 'Chats',
  projects: 'Projects',
  models: 'Models',
  exports: 'Exports',
} as const;
export type Section = keyof typeof SECTIONS;

const README_LINES: Record<Section, string> = {
  vault:
    'Your notes, plain markdown. Obsidian can open this folder as a vault. Routines leave their run notes in Vault/Agents.',
  chats: 'Your chats, one markdown file each, filed by month. Turn this off in Settings, Chats.',
  projects:
    'Repositories you cloned and project work, one folder each. Scratch holds what a chat with no project made.',
  models: 'Model files OpenShore downloaded. Ollama keeps its own models in its own folder.',
  exports: 'Anything you export or save out of OpenShore.',
};

export const OPENSHORE_README = [
  '# OpenShore',
  '',
  'Everything you save through OpenShore on this computer, one folder for each part of the app.',
  '',
  ...(Object.keys(SECTIONS) as Section[]).map((s) => `- **${SECTIONS[s]}**: ${README_LINES[s]}`),
  '',
  'Settings, keys and other machine state are kept apart from your files, in a hidden folder, and never here.',
  '',
].join('\n');

/** ~/OpenShore. */
export function openshoreRoot(home: string = homedir()): string {
  return join(home, OPENSHORE_FOLDER);
}

/** One part of the app's folder, e.g. ~/OpenShore/Projects. */
export function sectionDir(section: Section, home: string = homedir()): string {
  return join(openshoreRoot(home), SECTIONS[section]);
}

/** Where a desktop chat with no project works: ~/OpenShore/Projects/Scratch. */
export function scratchDir(home: string = homedir()): string {
  return join(sectionDir('projects', home), 'Scratch');
}

export interface FolderMove {
  /** Folders renamed into the new place, as `from -> to`. */
  moved: string[];
  /** Folders left in ~/OSCode because their name was taken in the new place. */
  kept: string[];
  /** Set once ~/OSCode was emptied and turned into a link to Projects. */
  linked: boolean;
}

function isRealDir(p: string): boolean {
  try {
    const st = lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Where one entry of ~/OSCode belongs now. */
function destinationOf(name: string, home: string): string {
  if (name === 'Vault') return sectionDir('vault', home);
  if (name === 'scratch') return scratchDir(home);
  return join(sectionDir('projects', home), name);
}

/**
 * Carry an existing ~/OSCode into ~/OpenShore once. Safe to call on every
 * start: with no real ~/OSCode folder (none, or already the link) it does
 * nothing. Never throws: a folder that cannot be renamed stays where it was
 * and is reported as kept.
 */
export function moveLegacyFolder(home: string = homedir()): FolderMove {
  const result: FolderMove = { moved: [], kept: [], linked: false };
  const legacy = join(home, LEGACY_FOLDER);
  if (!isRealDir(legacy)) return result;
  mkdirSync(sectionDir('projects', home), { recursive: true });
  for (const name of readdirSync(legacy)) {
    const from = join(legacy, name);
    const to = destinationOf(name, home);
    if (existsSync(to)) {
      result.kept.push(from);
      continue;
    }
    try {
      mkdirSync(join(to, '..'), { recursive: true });
      renameSync(from, to);
      result.moved.push(`${from} -> ${to}`);
    } catch {
      result.kept.push(from);
    }
  }
  if (result.kept.length === 0) {
    try {
      rmdirSync(legacy);
      // A junction on Windows needs no developer mode; elsewhere a plain link.
      symlinkSync(
        sectionDir('projects', home),
        legacy,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      result.linked = true;
    } catch {
      // The old folder stays (empty or not): nothing recorded is lost, and the
      // next start tries again.
    }
  }
  return result;
}

/**
 * Make ~/OpenShore and its parts, write its README the first time, and move
 * an old ~/OSCode over. Called when the CLI, the daemon or the desktop app
 * starts, never by `osc --help`. Never throws: a folder that cannot be made
 * shows up later where it is used, with that place's own message.
 */
export function ensureOpenshoreFolder(home: string = homedir()): FolderMove {
  let move: FolderMove = { moved: [], kept: [], linked: false };
  try {
    move = moveLegacyFolder(home);
    for (const s of Object.keys(SECTIONS) as Section[]) {
      mkdirSync(sectionDir(s, home), { recursive: true });
    }
    const readme = join(openshoreRoot(home), 'README.md');
    if (!existsSync(readme)) writeFileSync(readme, OPENSHORE_README);
  } catch {
    // Read-only home, a full disk: each part reports for itself when used.
  }
  return move;
}
