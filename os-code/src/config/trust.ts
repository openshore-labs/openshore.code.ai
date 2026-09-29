// Project trust, the machine half (v1 Phase 0; docs/zed-proposal.md "Fix now").
//
// Which folders the person trusts, and their "always allow in this project"
// grants, live in ~/.os-code/trust.json on this machine, never in the repo: a
// grant written into a tracked file would reach everyone who clones it, and a
// repo that could mark itself trusted would not need trust at all.
//
// A record is keyed by the folder's real path and carries the repository's
// origin, so a different repository cloned into the same path starts over.
// Trust also carries a digest of what it vouched for (the project file's
// trustable settings and the coding CLIs' own settings files), so a pull that
// changes the check command, an allow rule, or a Claude Code hook asks again.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { oscHome } from './home.js';
import { canonicalJson, trustableSubset, type PermissionRuleLike } from './projectPolicy.js';

export type TrustState =
  /** Nothing in this folder asks for trust (no loosening settings, no CLI hooks). */
  | 'none'
  /** The folder asks for settings the person has not trusted. */
  | 'untrusted'
  /** Trusted on this machine, and nothing it vouched for has changed. */
  | 'trusted'
  /** Trusted once, but its settings changed since (a pull, an edit). */
  | 'changed';

export interface FolderTrust {
  state: TrustState;
  /** The folder's real path, the store key. */
  folder: string;
  /** The repository's normalized origin, or null when it has none. */
  origin: string | null;
}

interface FolderRecord {
  origin: string | null;
  trust?: { digest: string; at: string };
  grants?: PermissionRuleLike[];
  /** Check commands the person let OpenShore run after changes here, each
   *  with a digest of what it runs (v1 Phase 1: verify on a paired phone, and
   *  a detected test script). A changed command or script asks again. */
  verifyGrants?: Array<{ command: string; digest: string; at: string }>;
}

interface TrustFile {
  version: 1;
  folders: Record<string, FolderRecord>;
}

export function trustStorePath(): string {
  return join(oscHome(), 'trust.json');
}

/** The store key for a folder: its real path, so a symlink cannot dodge it. */
export function folderKey(cwd: string): string {
  const abs = resolve(cwd);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

function readStore(): TrustFile {
  try {
    const parsed = JSON.parse(readFileSync(trustStorePath(), 'utf8')) as Partial<TrustFile>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.folders &&
      typeof parsed.folders === 'object'
    ) {
      return { version: 1, folders: parsed.folders as Record<string, FolderRecord> };
    }
  } catch {
    // Missing or unreadable: nothing is trusted and no grants apply. Failing
    // closed is the safe direction; writes below refuse to clobber a bad file.
  }
  return { version: 1, folders: {} };
}

function writeStore(store: TrustFile): void {
  const path = trustStorePath();
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    try {
      JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      // Never overwrite a store we cannot read: it holds the person's grants.
      try {
        copyFileSync(path, `${path}.corrupt`);
      } catch {
        // Refusing matters more than the copy.
      }
      throw new Error(
        `Refusing to save trust: ${path} could not be read (${(err as Error).message}). A copy was kept at ${path}.corrupt. Fix or delete it, then try again.`,
      );
    }
  }
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/** Normalize a git remote so the same repository reads the same every way it
 *  is spelled: no credentials, no scheme, no ".git", lowercase host. */
export function normalizeOrigin(url: string): string {
  let u = url.trim();
  const scp = /^([^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(u);
  if (scp && !/^[a-z]+:\/\//i.test(u)) {
    u = `${scp[2]!.toLowerCase()}/${scp[3]}`;
  } else {
    try {
      const parsed = new URL(u);
      u = `${parsed.host.toLowerCase()}${parsed.pathname}`;
    } catch {
      // Not a URL (a local path remote); keep it as written.
    }
  }
  return u.replace(/\/+$/, '').replace(/\.git$/, '');
}

function gitConfigPath(cwd: string): string | undefined {
  const dotGit = join(cwd, '.git');
  try {
    const st = statSync(dotGit);
    if (st.isDirectory()) return join(dotGit, 'config');
    // A worktree: ".git" is a file pointing at the real git dir, whose
    // "commondir" (when present) holds the shared config.
    const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
    if (!pointer) return undefined;
    const gitDir = isAbsolute(pointer[1]!.trim())
      ? pointer[1]!.trim()
      : resolve(cwd, pointer[1]!.trim());
    const commonFile = join(gitDir, 'commondir');
    if (existsSync(commonFile)) {
      const common = readFileSync(commonFile, 'utf8').trim();
      return join(isAbsolute(common) ? common : resolve(gitDir, common), 'config');
    }
    return join(gitDir, 'config');
  } catch {
    return undefined;
  }
}

/** The folder's origin remote, read straight from git's config file (no
 *  child process), normalized. Null when the folder is not a repository root
 *  or has no origin. */
export function readOrigin(cwd: string): string | null {
  const path = gitConfigPath(cwd);
  if (!path) return null;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let inOrigin = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      inOrigin = /^remote\s+"origin"$/.test(section[1]!.trim());
      continue;
    }
    if (!inOrigin) continue;
    const kv = /^url\s*=\s*(.+)$/.exec(line);
    if (kv) return normalizeOrigin(kv[1]!.trim());
  }
  return null;
}

// Coding CLIs that CLI Pairing can run in this folder, and the settings files
// through which a repository can make them run commands (Claude Code hooks, a
// Codex config). `claude -p` skips Claude Code's own folder-trust prompt, so
// OpenShore's trust stands in for it.
const AGENT_CLI_DIRS = ['.claude', '.codex'];
const AGENT_CLI_FILES = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.codex/config.toml',
];

/** True when the folder carries a coding CLI's own settings folder. */
export function hasAgentCliSettings(cwd: string): boolean {
  return AGENT_CLI_DIRS.some((d) => {
    try {
      return statSync(join(cwd, d)).isDirectory();
    } catch {
      return false;
    }
  });
}

function fileDigest(path: string): string {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return '-';
  }
}

/** The digest of everything trust vouches for in this folder. */
export function trustDigest(cwd: string, project: unknown): string {
  const hash = createHash('sha256');
  hash.update(canonicalJson(trustableSubset(project)));
  for (const rel of AGENT_CLI_FILES) hash.update(`\n${rel}:${fileDigest(join(cwd, rel))}`);
  return `sha256:${hash.digest('hex')}`;
}

function recordFor(store: TrustFile, key: string, origin: string | null): FolderRecord | undefined {
  const record = store.folders[key];
  // A different repository in the same folder starts over: its grants and
  // trust belonged to the one that was here.
  return record && record.origin === origin ? record : undefined;
}

/**
 * This folder's trust state. `asksForTrust` is whether its project file has
 * settings that only trust would apply (the loader works that out from the
 * policy); a coding CLI's settings folder also asks, for CLI Pairing.
 */
export function folderTrust(cwd: string, project: unknown, asksForTrust: boolean): FolderTrust {
  const folder = folderKey(cwd);
  const origin = readOrigin(cwd);
  const needsTrust = asksForTrust || hasAgentCliSettings(cwd);
  if (!needsTrust) return { state: 'none', folder, origin };
  const record = recordFor(readStore(), folder, origin);
  if (!record?.trust) return { state: 'untrusted', folder, origin };
  const state = record.trust.digest === trustDigest(cwd, project) ? 'trusted' : 'changed';
  return { state, folder, origin };
}

/** Trust this folder as it stands now: its settings apply from the next
 *  session, until they change. `project` is its parsed os-code.config.json. */
export function trustFolder(cwd: string, project: unknown): FolderTrust {
  const store = readStore();
  const folder = folderKey(cwd);
  const origin = readOrigin(cwd);
  const existing = recordFor(store, folder, origin);
  store.folders[folder] = {
    ...(existing ?? {}),
    origin,
    trust: { digest: trustDigest(cwd, project), at: new Date().toISOString() },
  };
  writeStore(store);
  return { state: 'trusted', folder, origin };
}

/** Stop trusting this folder. Its grants stay: they are the person's own. */
export function forgetFolderTrust(cwd: string): void {
  const store = readStore();
  const folder = folderKey(cwd);
  const record = store.folders[folder];
  if (!record?.trust) return;
  delete record.trust;
  writeStore(store);
}

/** The person's "always allow in this project" rules for this folder. */
export function folderGrants(cwd: string): PermissionRuleLike[] {
  const record = recordFor(readStore(), folderKey(cwd), readOrigin(cwd));
  return Array.isArray(record?.grants) ? record.grants : [];
}

/** Record an "always allow in this project" rule for this folder, on this
 *  machine. Identical rules are kept once. Returns the store's path. */
export function addFolderGrant(cwd: string, rule: PermissionRuleLike): string {
  const store = readStore();
  const folder = folderKey(cwd);
  const origin = readOrigin(cwd);
  const record = recordFor(store, folder, origin) ?? { origin };
  const grants = Array.isArray(record.grants) ? [...record.grants] : [];
  const entry: PermissionRuleLike = { tool: rule.tool, decision: rule.decision };
  if (rule.pathGlob) entry.pathGlob = rule.pathGlob;
  if (rule.commandPrefix) entry.commandPrefix = rule.commandPrefix;
  const duplicate = grants.some(
    (g) =>
      g.tool === entry.tool &&
      g.decision === entry.decision &&
      (g.pathGlob ?? undefined) === (entry.pathGlob ?? undefined) &&
      (g.commandPrefix ?? undefined) === (entry.commandPrefix ?? undefined),
  );
  if (!duplicate) grants.push(entry);
  store.folders[folder] = { ...record, origin, grants };
  writeStore(store);
  return trustStorePath();
}

/** True when the person let this check command run after changes in this
 *  folder, and neither the command nor what it runs has changed since. */
export function hasVerifyGrant(cwd: string, command: string, digest: string): boolean {
  const record = recordFor(readStore(), folderKey(cwd), readOrigin(cwd));
  return (record?.verifyGrants ?? []).some((g) => g.command === command && g.digest === digest);
}

/** Record "always run this check here" for this folder, on this machine. A
 *  grant for the same command with an older digest is replaced. */
export function addVerifyGrant(cwd: string, command: string, digest: string): void {
  const store = readStore();
  const folder = folderKey(cwd);
  const origin = readOrigin(cwd);
  const record = recordFor(store, folder, origin) ?? { origin };
  const kept = (record.verifyGrants ?? []).filter((g) => g.command !== command);
  store.folders[folder] = {
    ...record,
    origin,
    verifyGrants: [...kept, { command, digest, at: new Date().toISOString() }],
  };
  writeStore(store);
}
