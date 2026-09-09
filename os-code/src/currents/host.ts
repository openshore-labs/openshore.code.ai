// The machine side of Agentic Currents: what this computer can host, and a
// read-only view of a Hermes home folder for the Vault. Node only; the
// browser-safe shapes live in model.ts.
//
// Reading Hermes memory is jailed to the Hermes home the same way the desktop's
// repo-read bridge is jailed to a repo: a path that leaves the home (a symlink
// included) is refused, only markdown is served, and every note is size-capped.
// Nothing here writes. Editing a memory or a skill stays with Hermes itself and
// with the vault's always-ask write path if the person ever wants it.
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join, relative, sep } from 'node:path';
import { Jail, JailViolation } from '../core/security/jail.js';
import {
  CURRENTS_LIMITS,
  type CliAgentCommand,
  type CurrentsHostProbe,
  type HermesNote,
  type HermesNoteMeta,
} from './model.js';

/** The Hermes home on this machine: HERMES_HOME wins, else ~/.hermes, which is
 *  what the Hermes installer uses. */
export function hermesHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.HERMES_HOME?.trim();
  return fromEnv ? fromEnv : join(homedir(), '.hermes');
}

/** Whether a command is on PATH and executable, without spawning anything. */
export function commandOnPath(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const path = env.PATH ?? '';
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return true;
    } catch {
      // not here; keep looking
    }
  }
  return false;
}

/** What this machine can host, reported honestly: a folder that exists, a CLI
 *  that is actually on PATH. The phone renders Arriving for anything false. */
export function probeCurrentsHost(env: NodeJS.ProcessEnv = process.env): CurrentsHostProbe {
  const home = hermesHome(env);
  return {
    hermes: { home, present: existsSync(home) && safeIsDir(home) },
    cli: { claude: commandOnPath('claude', env), codex: commandOnPath('codex', env) },
  };
}

export function cliCommandAvailable(
  command: CliAgentCommand,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return commandOnPath(command, env);
}

// The notes the Vault shows: the memory and identity files at the top of the
// home, plus every skill's SKILL.md. Session databases, config, credentials,
// and plugins are never listed; they are not knowledge and some hold secrets.
const TOP_LEVEL_NOTES = ['MEMORY.md', 'SOUL.md', 'USER.md', 'AGENTS.md'];
const SKILLS_DIR = 'skills';
const MAX_SKILL_DEPTH = 3;

/** List the markdown notes in a Hermes home, newest first, capped. An absent
 *  home lists as empty rather than throwing: the Vault shows "nothing here
 *  yet", which is the truth. */
export function listHermesNotes(home: string): HermesNoteMeta[] {
  if (!existsSync(home) || !safeIsDir(home)) return [];
  const jail = new Jail(home);
  const out: HermesNoteMeta[] = [];
  for (const name of TOP_LEVEL_NOTES) {
    const meta = metaFor(jail, home, name);
    if (meta) out.push(meta);
  }
  const skills = join(home, SKILLS_DIR);
  if (existsSync(skills) && safeIsDir(skills)) {
    walkSkills(jail, home, skills, 0, out);
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out.slice(0, CURRENTS_LIMITS.notes);
}

/** Read one note by its home-relative path. Returns undefined for anything
 *  that is not a served markdown note inside the home. */
export function readHermesNote(home: string, relPath: string): HermesNote | undefined {
  if (!existsSync(home) || !safeIsDir(home)) return undefined;
  const clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || !clean.toLowerCase().endsWith('.md')) return undefined;
  // Only the shapes the listing serves: a top-level note, or a SKILL.md under
  // skills/. A dotfile or anything else under the home is not a note.
  const isTop = TOP_LEVEL_NOTES.includes(clean);
  const isSkill = clean.startsWith(`${SKILLS_DIR}/`) && basename(clean) === 'SKILL.md';
  if (!isTop && !isSkill) return undefined;
  if (clean.split('/').some((seg) => seg === '..' || seg.startsWith('.'))) return undefined;
  const jail = new Jail(home);
  let abs: string;
  try {
    abs = jail.resolve(clean);
  } catch (err) {
    if (err instanceof JailViolation) return undefined;
    throw err;
  }
  let st;
  try {
    st = statSync(abs);
  } catch {
    return undefined;
  }
  if (!st.isFile()) return undefined;
  if (st.size > CURRENTS_LIMITS.noteBytes) {
    return {
      path: clean,
      title: titleFor(clean),
      updatedAt: st.mtime.toISOString(),
      size: st.size,
      text: `This note is ${Math.round(st.size / 1024)} KB, larger than the ${Math.round(CURRENTS_LIMITS.noteBytes / 1024)} KB the app shows. Open it on the computer.`,
    };
  }
  return {
    path: clean,
    title: titleFor(clean),
    updatedAt: st.mtime.toISOString(),
    size: st.size,
    text: readFileSync(abs, 'utf8'),
  };
}

function walkSkills(jail: Jail, home: string, dir: string, depth: number, out: HermesNoteMeta[]) {
  if (depth > MAX_SKILL_DEPTH || out.length >= CURRENTS_LIMITS.notes) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSkills(jail, home, abs, depth + 1, out);
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      const rel = relative(home, abs).split(sep).join('/');
      const meta = metaFor(jail, home, rel);
      if (meta) out.push(meta);
    }
  }
}

function metaFor(jail: Jail, home: string, rel: string): HermesNoteMeta | undefined {
  let abs: string;
  try {
    abs = jail.resolve(rel);
  } catch {
    return undefined;
  }
  try {
    const st = statSync(abs);
    if (!st.isFile()) return undefined;
    return { path: rel, title: titleFor(rel), updatedAt: st.mtime.toISOString(), size: st.size };
  } catch {
    return undefined;
  }
}

/** A human title: MEMORY.md reads "Memory", skills/foo-bar/SKILL.md reads
 *  "foo-bar" (the skill folder is its name). */
export function titleFor(rel: string): string {
  const parts = rel.split('/');
  const file = parts[parts.length - 1] ?? rel;
  if (file === 'SKILL.md' && parts.length >= 2) return parts[parts.length - 2]!;
  const stem = file.replace(/\.md$/i, '');
  if (stem === stem.toUpperCase()) return stem.charAt(0) + stem.slice(1).toLowerCase();
  return stem;
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
