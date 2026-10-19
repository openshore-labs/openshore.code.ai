// One OpenShore folder on this computer (founder, 2026-10-16): everything the
// person saves through OpenShore sits under ~/OpenShore, a subfolder per part
// of the app, so it can be found, opened and backed up like any other folder.
// Machine state (keys, tokens, trust, indexes, session journals) stays hidden
// in ~/.os-code and never lands here.
//
// Each folder is named for the room that shows it (founder, 2026-10-19):
// Chats, Repositories (the clones the Repositories room lists), Vault, Local
// Library (files the Local Library got) and Exports. The first layout called
// Repositories "Projects" and Local Library "Models"; `moveRenamedSections`
// carries those over once and leaves a link at Projects, so a repository path
// a project, a chat or a routine recorded keeps resolving.
//
// It replaces ~/OSCode, which held the clones, the Vault, the sample and the
// scratch folder side by side. `moveLegacyFolder` carries an existing ~/OSCode
// over once: the Vault to Vault, every other folder to Repositories (scratch
// as Repositories/Scratch). Nothing is copied or deleted, each folder is
// renamed (one disk, so nothing is half moved), and a name already taken in the
// new place stays where it was. Once ~/OSCode is empty it becomes a link to
// Repositories, so a path a session or a routine recorded keeps resolving.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
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
  chats: 'Chats',
  repositories: 'Repositories',
  vault: 'Vault',
  library: 'Local Library',
  exports: 'Exports',
} as const;
export type Section = keyof typeof SECTIONS;

/** The folders a vault keeps for two rooms: notes for each project, and the
 *  notes routines leave (Agents). The starter layout makes them; a routine's
 *  run note makes Agents/<routine> on its first run. */
export const VAULT_FOLDERS = {
  projects: 'Projects',
  agents: 'Agents',
} as const;

/** The names the first layout used, carried over once by `moveRenamedSections`. */
export const RENAMED_SECTIONS: ReadonlyArray<{ from: string; to: Section; link: boolean }> = [
  // A repository path recorded under Projects must keep resolving: link it.
  { from: 'Projects', to: 'repositories', link: true },
  // Nothing records a path into Models, so no link is left behind.
  { from: 'Models', to: 'library', link: false },
];

const README_LINES: Record<Section, string> = {
  chats: 'Your chats, one markdown file each, filed by month. Turn this off in Settings, Chats.',
  repositories:
    'The repositories you cloned, one folder each, as the Repositories room lists them. Scratch holds what a chat with no project made.',
  vault: `Your notes, plain markdown. Obsidian can open this folder as a vault. Notes for a project go in Vault/${VAULT_FOLDERS.projects}/<project>, and routines leave their run notes in Vault/${VAULT_FOLDERS.agents}.`,
  library:
    'Files OpenShore got from the Local Library. Ollama keeps its own models in its own folder.',
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

/** READMEs earlier builds wrote, word for word. One of these is replaced with
 *  today's; any other text is the person's and is kept. */
export const EARLIER_READMES: readonly string[] = [
  // The first layout (2026-10-16), before and after Crew became Agents.
  '# OpenShore\n\nEverything you save through OpenShore on this computer, one folder for each part of the app.\n\n- **Vault**: Your notes, plain markdown. Obsidian can open this folder as a vault. Crew routines leave their run notes in Vault/Crew.\n- **Chats**: Your chats, one markdown file each, filed by month. Turn this off in Settings, Chats.\n- **Projects**: Repositories you cloned and project work, one folder each. Scratch holds what a chat with no project made.\n- **Models**: Model files OpenShore downloaded. Ollama keeps its own models in its own folder.\n- **Exports**: Anything you export or save out of OpenShore.\n\nSettings, keys and other machine state are kept apart from your files, in a hidden folder, and never here.\n',
  '# OpenShore\n\nEverything you save through OpenShore on this computer, one folder for each part of the app.\n\n- **Vault**: Your notes, plain markdown. Obsidian can open this folder as a vault. Routines leave their run notes in Vault/Agents.\n- **Chats**: Your chats, one markdown file each, filed by month. Turn this off in Settings, Chats.\n- **Projects**: Repositories you cloned and project work, one folder each. Scratch holds what a chat with no project made.\n- **Models**: Model files OpenShore downloaded. Ollama keeps its own models in its own folder.\n- **Exports**: Anything you export or save out of OpenShore.\n\nSettings, keys and other machine state are kept apart from your files, in a hidden folder, and never here.\n',
];

/** ~/OpenShore. */
export function openshoreRoot(home: string = homedir()): string {
  return join(home, OPENSHORE_FOLDER);
}

/** One part of the app's folder, e.g. ~/OpenShore/Repositories. */
export function sectionDir(section: Section, home: string = homedir()): string {
  return join(openshoreRoot(home), SECTIONS[section]);
}

/** Where a desktop chat with no project works: ~/OpenShore/Repositories/Scratch. */
export function scratchDir(home: string = homedir()): string {
  return join(sectionDir('repositories', home), 'Scratch');
}

export interface FolderMove {
  /** Folders renamed into the new place, as `from -> to`. */
  moved: string[];
  /** Folders left in the old place because their name was taken in the new one. */
  kept: string[];
  /** Set once the old folder was emptied and turned into a link to its new place. */
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
  return join(sectionDir('repositories', home), name);
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
  mkdirSync(sectionDir('repositories', home), { recursive: true });
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
      linkDir(sectionDir('repositories', home), legacy);
      result.linked = true;
    } catch {
      // The old folder stays (empty or not): nothing recorded is lost, and the
      // next start tries again.
    }
  }
  return result;
}

/** A link from `at` to the folder `target`. A junction on Windows needs no
 *  developer mode; elsewhere a plain link. */
function linkDir(target: string, at: string): void {
  symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
}

/**
 * Carry the first layout's names over once (founder, 2026-10-19): Projects to
 * Repositories, Models to Local Library. The whole folder is renamed when the
 * new name is free; otherwise each entry is, and a name already taken stays
 * where it was. Projects becomes a link to Repositories once it is empty. Safe
 * on every start, and never throws.
 */
export function moveRenamedSections(home: string = homedir()): FolderMove {
  const result: FolderMove = { moved: [], kept: [], linked: false };
  for (const r of RENAMED_SECTIONS) {
    const from = join(openshoreRoot(home), r.from);
    const to = sectionDir(r.to, home);
    if (!isRealDir(from)) continue;
    try {
      if (!existsSync(to)) {
        renameSync(from, to);
        result.moved.push(`${from} -> ${to}`);
      } else {
        const left: string[] = [];
        for (const name of readdirSync(from)) {
          const src = join(from, name);
          const dest = join(to, name);
          if (existsSync(dest)) {
            left.push(src);
            continue;
          }
          try {
            renameSync(src, dest);
            result.moved.push(`${src} -> ${dest}`);
          } catch {
            left.push(src);
          }
        }
        result.kept.push(...left);
        if (left.length) continue;
        rmdirSync(from);
      }
      if (r.link) {
        linkDir(to, from);
        result.linked = true;
      }
    } catch {
      // The old folder stays (empty or not): nothing is lost, and the next
      // start tries again.
    }
  }
  return result;
}

/**
 * Make ~/OpenShore and its parts, write its README the first time, and move
 * the first layout's names and an old ~/OSCode over. Called when the CLI, the daemon or the desktop app
 * starts, never by `osc --help`. Never throws: a folder that cannot be made
 * shows up later where it is used, with that place's own message.
 */
export function ensureOpenshoreFolder(home: string = homedir()): FolderMove {
  let move: FolderMove = { moved: [], kept: [], linked: false };
  try {
    // The first layout's names first, so ~/OSCode lands in the new ones.
    const renamed = moveRenamedSections(home);
    const legacy = moveLegacyFolder(home);
    move = {
      moved: [...renamed.moved, ...legacy.moved],
      kept: [...renamed.kept, ...legacy.kept],
      linked: legacy.linked,
    };
    for (const s of Object.keys(SECTIONS) as Section[]) {
      mkdirSync(sectionDir(s, home), { recursive: true });
    }
    const readme = join(openshoreRoot(home), 'README.md');
    if (!existsSync(readme) || EARLIER_READMES.includes(readFileSync(readme, 'utf8'))) {
      writeFileSync(readme, OPENSHORE_README);
    }
  } catch {
    // Read-only home, a full disk: each part reports for itself when used.
  }
  return move;
}
