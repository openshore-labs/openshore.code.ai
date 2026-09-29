// Your Claude Code commands work here (P3): find the command files a person
// already has, in the repository and in their own home folder, and read each
// one safely. The text they add to a task and the words every surface shows
// live in the pure half, commandText.ts.
//
// Where, in order (the first of a name wins, after OpenShore's own):
//   this repository: .oscode/commands, .claude/commands, .claude/skills/*/SKILL.md
//   your computer:   ~/.os-code/commands, ~/.claude/commands
//
// A command file is a proposal from wherever it sits: running it only adds its
// text to a task the person started. So reading one is held to three rules.
// Its real path must stay inside its own folder (a link out to ~/.ssh is
// refused), and a repository's folder must itself sit inside the workspace.
// Past 16 KB a file is not read. Past 200 files nothing more is looked at.
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { oscHome } from '../../config/home.js';
import {
  COMMAND_FILE_MAX_BYTES,
  COMMAND_FILES_MAX,
  commandNameOf,
  isBuiltInCommand,
  parseCommandFile,
  type CommandFile,
  type CommandFrom,
  type RepoCommand,
  type RepoCommandNotLoaded,
} from './commandText.js';

/** A command the engine can run: what a menu shows, plus its text. */
export interface CustomCommand extends RepoCommand {
  /** Where the person finds it (`.claude/commands/review.md`). */
  file: string;
  body: string;
  asksFor: CommandFile['asksFor'];
}

export interface CommandRoot {
  dir: string;
  from: CommandFrom;
  /** A skills folder: each `<name>/SKILL.md` is a command named `<name>`. */
  skills?: boolean;
  /** A repository's folder must resolve inside this one (the workspace). */
  within?: string;
}

export interface CommandDiscovery {
  commands: CustomCommand[];
  notLoaded: RepoCommandNotLoaded[];
}

/** Subfolders below a commands folder that are still read (Claude Code
 *  namespaces commands by subfolder; the name stays the file's own). */
const MAX_DEPTH = 3;

/** Claude Code's own folder: ~/.claude, or where CLAUDE_CONFIG_DIR puts it. */
export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
}

/** The folders, in the order a name is claimed. */
export function commandRoots(cwd: string): CommandRoot[] {
  return [
    { dir: join(cwd, '.oscode', 'commands'), from: 'project', within: cwd },
    { dir: join(cwd, '.claude', 'commands'), from: 'project', within: cwd },
    { dir: join(cwd, '.claude', 'skills'), from: 'project', within: cwd, skills: true },
    { dir: join(oscHome(), 'commands'), from: 'user' },
    { dir: join(claudeHome(), 'commands'), from: 'user' },
  ];
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function realOf(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/** How the person would name a path: relative to the workspace for the
 *  repository's, `~/...` for their own. Forward slashes everywhere. */
function shown(path: string, cwd: string, from: CommandFrom): string {
  const home = homedir();
  const rel =
    from === 'project'
      ? relative(cwd, path)
      : inside(home, path)
        ? `~/${relative(home, path)}`
        : path;
  return rel.split('\\').join('/');
}

interface Candidate {
  path: string;
  /** The file or folder name the command is named after. */
  raw: string;
}

/** Every command file under a commands folder, top level first, each level
 *  in name order, so the same tree always claims the same names. */
function commandFiles(
  root: string,
  rootReal: string,
  onOutside: (path: string) => void,
): Candidate[] {
  const out: Candidate[] = [];
  let level: string[] = [root];
  for (let depth = 0; depth <= MAX_DEPTH && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        if (/\.md$/i.test(entry.name) && (entry.isFile() || entry.isSymbolicLink())) {
          out.push({ path, raw: entry.name.replace(/\.md$/i, '') });
          continue;
        }
        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          try {
            isDir = statSync(path).isDirectory();
          } catch {
            isDir = false;
          }
        }
        if (!isDir) continue;
        // A folder that links out of the root is not followed.
        const real = realOf(path);
        if (!real || !inside(rootReal, real)) {
          if (real) onOutside(path);
          continue;
        }
        next.push(path);
      }
    }
    level = next;
  }
  return out;
}

/** Every `<name>/SKILL.md` under a skills folder, in name order. */
function skillFiles(root: string): Candidate[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || e.isSymbolicLink()))
    .map((e) => e.name)
    .sort()
    .map((name) => ({ path: join(root, name, 'SKILL.md'), raw: name }));
}

type Read = { text: string } | { tooLarge: true } | undefined;

/** Read a regular file of at most the cap, by its real path. Anything else
 *  (a folder, a pipe that would block, a file that vanished) reads nothing. */
function readCapped(real: string): Read {
  let fd: number | undefined;
  try {
    fd = openSync(real, 'r');
    const st = fstatSync(fd);
    if (!st.isFile()) return undefined;
    if (st.size > COMMAND_FILE_MAX_BYTES) return { tooLarge: true };
    const buf = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) {
      const n = readSync(fd, buf, got, st.size - got, got);
      if (n <= 0) break;
      got += n;
    }
    return { text: buf.subarray(0, got).toString('utf8') };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Closing a file we only read cannot lose anything.
      }
    }
  }
}

/**
 * Find the commands for a workspace. OpenShore's own names always win, then
 * the repository's folders in order, then the person's own; a file that loses
 * on its name, or breaks a rule, is reported in `notLoaded` and never read
 * into a command. Never throws: a folder that cannot be read has no commands.
 */
export function discoverCommands(cwd: string, roots = commandRoots(cwd)): CommandDiscovery {
  const commands: CustomCommand[] = [];
  const notLoaded: RepoCommandNotLoaded[] = [];
  const byName = new Map<string, CustomCommand>();
  // A session in the home folder reaches ~/.claude/commands as the
  // repository's and as the person's own: it is read once, as the first.
  const readRoots = new Set<string>();
  let looked = 0;
  for (const root of roots) {
    const rootReal = realOf(root.dir);
    if (!rootReal || readRoots.has(rootReal)) continue;
    readRoots.add(rootReal);
    const label = (path: string) => shown(path, cwd, root.from);
    if (root.within) {
      const withinReal = realOf(root.within);
      if (!withinReal || !inside(withinReal, rootReal)) {
        notLoaded.push({ file: label(root.dir), from: root.from, reason: 'outside-folder' });
        continue;
      }
    }
    const onOutside = (path: string) =>
      notLoaded.push({ file: label(path), from: root.from, reason: 'outside-folder' });
    const found = root.skills ? skillFiles(root.dir) : commandFiles(root.dir, rootReal, onOutside);
    for (const candidate of found) {
      const real = realOf(candidate.path);
      // A skill folder with no SKILL.md, or a link to nothing, is not a command.
      if (!real) continue;
      looked += 1;
      if (looked > COMMAND_FILES_MAX) {
        notLoaded.push({ file: label(root.dir), from: root.from, reason: 'too-many' });
        return { commands, notLoaded };
      }
      const file = label(candidate.path);
      const name = commandNameOf(candidate.raw);
      const base = { file, ...(name ? { name } : {}), from: root.from };
      if (!inside(rootReal, real)) {
        notLoaded.push({ ...base, reason: 'outside-folder' });
        continue;
      }
      if (!name) {
        notLoaded.push({ ...base, reason: 'bad-name' });
        continue;
      }
      if (isBuiltInCommand(name)) {
        notLoaded.push({ ...base, reason: 'built-in' });
        continue;
      }
      const winner = byName.get(name);
      if (winner) {
        notLoaded.push({ ...base, reason: 'shadowed', by: winner.from });
        continue;
      }
      const read = readCapped(real);
      if (!read) continue;
      if ('tooLarge' in read) {
        notLoaded.push({ ...base, reason: 'too-large' });
        continue;
      }
      const parsed = parseCommandFile(read.text);
      const command: CustomCommand = {
        name,
        from: root.from,
        file,
        body: parsed.body,
        asksFor: parsed.asksFor,
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.argumentHint ? { argumentHint: parsed.argumentHint } : {}),
      };
      byName.set(name, command);
      commands.push(command);
    }
  }
  return { commands, notLoaded };
}

/** The list a menu shows: names and words, never a command's text. */
export function menuOf(commands: readonly CustomCommand[]): RepoCommand[] {
  return commands.map(({ name, description, argumentHint, from }) => ({
    name,
    from,
    ...(description ? { description } : {}),
    ...(argumentHint ? { argumentHint } : {}),
  }));
}
