// The workspaces the app lists and clones into, shared by the daemon (the
// phone's view of this computer) and the desktop app's engine host, so both
// list the same folders and clone the same way.
//
// Two gaps this closes: a repository cloned from the phone never showed up in
// the picker until a chat had run in it (the list was built from sessions
// alone), and nothing said which repository a folder holds, so the app could
// not tell that a GitHub repository was already on this computer. Each row now
// carries its origin address (credentials stripped), and every clone under
// ~/OSCode is listed after the recent ones.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { isAdminProvisionedWorkspace } from '../core/security/workspaces.js';
import { clone } from './index.js';

export interface WorkspaceRow {
  cwd: string;
  name: string;
  lastUsed?: string;
  /** The clone's origin address, with any embedded credentials removed. */
  remote?: string;
}

/** The folder the app clones into. */
export function managedParent(): string {
  return join(homedir(), 'OSCode');
}

/** An address with any user:password@ removed, so a token someone embedded in
 *  a remote never leaves this computer. */
export function stripCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, '$1');
}

/** The origin address of a clone, read straight from its .git/config (no git
 *  process per row). Undefined for a folder that is not a plain clone. */
export function originUrl(cwd: string): string | undefined {
  let text: string;
  try {
    const gitDir = join(cwd, '.git');
    if (!statSync(gitDir).isDirectory()) return undefined;
    text = readFileSync(join(gitDir, 'config'), 'utf8');
  } catch {
    return undefined;
  }
  let inOrigin = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inOrigin = /^\[remote\s+"origin"\]$/.test(line);
      continue;
    }
    if (!inOrigin) continue;
    const m = /^url\s*=\s*(.+)$/.exec(line);
    if (m) return stripCredentials(m[1]!.trim());
  }
  return undefined;
}

/** host/path of a git address, lowercased with any .git dropped, so an https
 *  and an ssh address for one repository compare equal. */
export function normalizeRemote(url: string): string | undefined {
  const raw = stripCredentials(url.trim());
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)(.+)$/.exec(raw);
  let host: string;
  let path: string;
  if (scp) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    try {
      const u = new URL(raw);
      host = u.hostname;
      path = u.pathname;
    } catch {
      return undefined;
    }
  }
  const clean = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
  return host && clean ? `${host.toLowerCase()}/${clean}` : undefined;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The workspaces to list: the folders recent sessions ran in (newest first, up
 * to 12, only ones still on disk), then every git clone under ~/OSCode that is
 * really inside it (a symlink pointing out does not count). Only clones: the
 * Vault and the desktop's scratch folder live there too and are not
 * repositories. Each row carries its origin address when it has one.
 */
export function listWorkspaces(
  sessions: Iterable<{ cwd: string; updatedAt?: string }>,
): WorkspaceRow[] {
  const seen = new Set<string>();
  const out: WorkspaceRow[] = [];
  for (const session of sessions) {
    if (out.length >= 12) break;
    if (seen.has(session.cwd) || !existsSync(session.cwd)) continue;
    seen.add(session.cwd);
    out.push({ cwd: session.cwd, name: basename(session.cwd), lastUsed: session.updatedAt });
  }
  const parent = managedParent();
  let names: string[] = [];
  try {
    names = readdirSync(parent).sort((a, b) => a.localeCompare(b));
  } catch {
    names = [];
  }
  for (const name of names) {
    const cwd = join(parent, name);
    if (seen.has(cwd) || name.startsWith('.')) continue;
    if (!isDirectory(cwd) || !existsSync(join(cwd, '.git'))) continue;
    if (!isAdminProvisionedWorkspace(cwd)) continue;
    seen.add(cwd);
    out.push({ cwd, name });
  }
  return out.map((row) => {
    const remote = originUrl(row.cwd);
    return remote ? { ...row, remote } : row;
  });
}

/** The folder name a clone address lands in, or undefined when the address's
 *  last segment is not usable as one (`.`, `..`, or odd characters, DAE-16). */
export function cloneFolderName(url: string): string | undefined {
  // The address's last segment, then without .git: "owner/.git" names nothing.
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
  const name = last.replace(/\.git$/, '');
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') return undefined;
  return name;
}

// One clone per folder at a time: a second tap (or a phone retrying after its
// request timed out) joins the clone already running instead of reading a
// half-written folder as ready.
const inFlight = new Map<string, Promise<void>>();

/**
 * Clone `url` into ~/OSCode/<name> and return the folder, or return the folder
 * already there when it holds the same repository. A folder of that name that
 * holds a DIFFERENT repository is refused rather than silently reused.
 */
export async function cloneIntoManaged(
  url: string,
  name: string,
  opts: { token?: string } = {},
): Promise<string> {
  const parent = managedParent();
  mkdirSync(parent, { recursive: true });
  const target = join(parent, name);
  const running = inFlight.get(target);
  if (running) {
    await running;
    return target;
  }
  if (existsSync(target)) {
    const origin = originUrl(target);
    if (origin && normalizeRemote(origin) !== normalizeRemote(url)) {
      throw new Error(
        `A different repository already uses the folder OSCode/${name} on this computer. Rename or move that folder, then try again.`,
      );
    }
    return target;
  }
  const run = clone(url.trim(), target, opts);
  inFlight.set(target, run);
  try {
    await run;
  } finally {
    inFlight.delete(target);
  }
  return target;
}
