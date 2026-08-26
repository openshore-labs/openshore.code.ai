// Repo homes: cloning a repo into a storage location the USER picked, safely.
// Until now both clone paths hardcoded ~/OSCode/<name>. Letting the user choose
// an absolute path (their own folder, a NAS, a Tailscale mount) opens four holes
// the CTO flagged as must-fix, and this module is where all four are closed:
//
//   1. The picked parent is realpath-confined and sensitive roots are refused
//      (assertSafeRepoParent), so a clone can never land in ~, /, ~/.ssh, the
//      OS Code config home, or inside another repo's .git.
//   2. An existing target is never silently reused or clobbered: it must be a
//      git repo whose origin matches the requested URL, else we refuse
//      (inspectTarget), and we never delete or clone over a directory.
//   3. Private-repo auth goes through a one-shot GIT_ASKPASS that reads the
//      token from the environment (cloneWithAuth), never baked into the URL or
//      persisted to .git/config where `git remote -v` would leak it.
//   4. The caller registers the chosen root into daemon.outboxAllowedRoots (done
//      at the call sites), rather than widening the member-isolation gates.
//
// The daemon and the Electron host both call these, so the safety lives in one
// place the tests pin, not duplicated across two surfaces.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { simpleGit } from 'simple-git';
import { loadConfig, oscHome, saveGlobalConfig } from '../config/load.js';
import { getGithubToken } from '../auth/github.js';
import { currentBranch, mirrorRepo } from './index.js';

const run = promisify(execFile);

/** Realpath of the deepest ancestor of `abs` that exists, re-joined with the
 *  non-existent tail. Mirrors the Jail discipline so a symlink partway up the
 *  chosen path cannot redirect the clone outside the intended tree. */
function deepestRealpath(abs: string): string {
  let existing = abs;
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const parent = resolve(existing, '..');
    if (parent === existing) break;
    tail.unshift(existing.slice(parent.length + 1));
    existing = parent;
  }
  let real = existing;
  try {
    real = realpathSync(existing);
  } catch {
    // Keep the resolved (non-realpathed) form if the ancestor vanished.
  }
  return tail.length ? join(real, ...tail) : real;
}

/** True when `child` is `root` or sits underneath it. Both must be absolute. */
function contains(root: string, child: string): boolean {
  return child === root || child.startsWith(root + sep);
}

export class RepoHomeError extends Error {}

/**
 * Validate a user-picked parent directory a repo will be cloned INTO, and
 * return its realpath-resolved absolute form. Throws RepoHomeError with a
 * human reason on anything unsafe. Pure enough to unit-test with a tmp tree.
 */
export function assertSafeRepoParent(parent: string): string {
  if (typeof parent !== 'string' || !parent.trim()) {
    throw new RepoHomeError('Pick a folder for the repo to live in.');
  }
  if (!isAbsolute(parent)) {
    throw new RepoHomeError(`The storage folder must be an absolute path. Got: ${parent}`);
  }
  const real = deepestRealpath(resolve(parent));
  const home = deepestRealpath(homedir());
  const oscConfig = deepestRealpath(oscHome());

  // A short list of roots a repo must never land in or under.
  const forbidden: Array<{ path: string; why: string }> = [
    { path: real === '/' ? '/' : deepestRealpath('/'), why: 'the filesystem root' },
    { path: home, why: 'your home directory itself' },
    { path: deepestRealpath(join(home, '.ssh')), why: 'your SSH keys folder' },
    { path: oscConfig, why: 'the OS Code config folder' },
  ];
  for (const f of forbidden) {
    if (real === f.path) {
      throw new RepoHomeError(
        `That folder is ${f.why}. Choose a dedicated folder for repositories.`,
      );
    }
  }
  // Under ~/.ssh or the config home (not just equal to them) is also refused.
  for (const f of [deepestRealpath(join(home, '.ssh')), oscConfig]) {
    if (contains(f, real)) {
      throw new RepoHomeError('That folder is inside a protected system folder. Pick another.');
    }
  }
  // Never nest a working copy inside an existing repo's .git object store.
  if (real.split(sep).includes('.git')) {
    throw new RepoHomeError('That folder is inside a .git directory. Pick a normal folder.');
  }
  return real;
}

/** Confine a repo name to a single path segment (no traversal, no separators),
 *  derived from a clone URL. Keeps the join to the chosen parent safe. */
export function repoNameFromUrl(url: string): string {
  const cleaned = url
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const last =
    cleaned
      .split(/[\\/:]/)
      .filter(Boolean)
      .pop() ?? 'repo';
  const safe = last.replace(/[^A-Za-z0-9._-]/g, '');
  // Reject a name that resolves to a traversal or an empty/dotfile-only string.
  return safe && safe !== '.' && safe !== '..' ? safe : 'repo';
}

/** Normalize a git remote for comparison: strip .git, trailing slash, and a
 *  userinfo prefix, and fold scp-style git@host:owner/repo to host/owner/repo. */
export function normalizeRemote(url: string): string {
  let u = url
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  u = u.replace(/^[a-z]+:\/\//i, '').replace(/^[^@/]+@/, '');
  u = u.replace(':', '/');
  return u.toLowerCase();
}

export interface TargetInspection {
  /** Absolute, realpath-resolved target the repo would occupy. */
  target: string;
  /** 'clone' = does not exist, safe to clone. 'reuse' = an existing checkout of
   *  the SAME remote, safe to open. */
  action: 'clone' | 'reuse';
}

/**
 * Decide what cloning `url` into `parent/name` should do, refusing anything
 * unsafe. If the target exists it must be a git repo whose origin matches the
 * URL (then we reuse it); a non-repo directory or a mismatched remote is
 * refused rather than clobbered.
 */
export async function inspectTarget(
  parent: string,
  name: string,
  url: string,
): Promise<TargetInspection> {
  const safeParent = assertSafeRepoParent(parent);
  const target = join(safeParent, name);
  if (!existsSync(target)) return { target, action: 'clone' };

  if (!statSync(target).isDirectory()) {
    throw new RepoHomeError(`A file already exists at ${target}. Pick another folder or name.`);
  }
  const g = simpleGit(target);
  if (!(await g.checkIsRepo())) {
    throw new RepoHomeError(
      `${target} already exists and is not a git repo. Refusing to clone over it.`,
    );
  }
  let origin = '';
  try {
    origin = (await g.remote(['get-url', 'origin']))?.trim() ?? '';
  } catch {
    origin = '';
  }
  if (!origin || normalizeRemote(origin) !== normalizeRemote(url)) {
    throw new RepoHomeError(
      `${target} is already a different repository (${origin || 'no origin'}). Refusing to reuse it.`,
    );
  }
  return { target, action: 'reuse' };
}

/**
 * Clone `url` into `dir`, supplying `token` (if given) through a one-shot
 * GIT_ASKPASS script that reads it from the environment. The token is never
 * written into the URL or .git/config, so it does not persist at rest in the
 * clone and never appears in `git remote -v`. The askpass file is created 0700
 * in a private temp dir and removed in a finally.
 */
export async function cloneWithAuth(url: string, dir: string, token?: string): Promise<void> {
  if (!token) {
    await simpleGit().clone(url, dir);
    return;
  }
  const askDir = mkdtempSync(join(tmpdir(), 'osc-ask-'));
  const askPath = join(askDir, 'askpass.sh');
  try {
    // Git calls this for the username prompt and the password prompt; echoing
    // the token satisfies both (GitHub/GitLab/Bitbucket authenticate on the
    // token regardless of the username field).
    writeFileSync(askPath, '#!/bin/sh\nprintf "%s" "$OSC_GIT_TOKEN"\n');
    chmodSync(askPath, 0o700);
    await run('git', ['clone', url, dir], {
      env: {
        ...process.env,
        GIT_ASKPASS: askPath,
        GIT_TERMINAL_PROMPT: '0',
        OSC_GIT_TOKEN: token,
      },
      maxBuffer: 64 * 1024 * 1024,
    });
  } finally {
    rmSync(askDir, { recursive: true, force: true });
  }
}

const URL_ANCHOR = /^(https:\/\/|git@)/;

/** The default parent every repo lands in when the user does not choose one:
 *  ~/OSCode, which the member-isolation gate already trusts. */
export function defaultRepoParent(): string {
  return join(homedir(), 'OSCode');
}

export interface CloneHomeRequest {
  url: string;
  /** Absolute parent the working copy lives in. Empty/undefined = ~/OSCode. */
  parent?: string;
  /** Explicit auth token. Omitted, a github.com URL uses the box's own token. */
  token?: string;
}

export interface CloneHomeResult {
  cwd: string;
  name: string;
  defaultBranch: string;
  /** The realpath parent the repo landed in, so callers can show it. */
  parent: string;
  /** True when the parent sits outside ~/OSCode and was allowlisted for outbox. */
  registeredRoot: boolean;
}

/**
 * Clone a repo into a user-chosen storage location, safely. Resolves the target
 * under the (validated) parent, refuses an unsafe or mismatched existing dir,
 * authenticates a private github clone with the box token via askpass, records
 * the default branch, and, when the repo lands outside ~/OSCode, allowlists its
 * path for the outbox (extending daemon.outboxAllowedRoots, never widening the
 * gates). Callers on both the daemon and the desktop host go through here.
 */
export async function cloneRepoHome(req: CloneHomeRequest): Promise<CloneHomeResult> {
  const url = req.url.trim();
  if (!URL_ANCHOR.test(url)) {
    throw new RepoHomeError('Send an https:// or git@ repository URL.');
  }
  const name = repoNameFromUrl(url);
  const parent = req.parent?.trim() ? req.parent.trim() : defaultRepoParent();
  const inspection = await inspectTarget(parent, name, url);
  const { target } = inspection;

  if (inspection.action === 'clone') {
    const token = req.token ?? (/github\.com/i.test(url) ? getGithubToken() : undefined);
    await cloneWithAuth(url, target, token);
  }

  const defaultBranch = await currentBranch(target);
  const registeredRoot = allowlistOutboxRoot(target);
  const realParent = resolve(target, '..');
  return { cwd: target, name, defaultBranch, parent: realParent, registeredRoot };
}

/** Add a repo path to daemon.outboxAllowedRoots when it lives outside ~/OSCode,
 *  so buffered commits can land there without relaxing the isolation gate.
 *  Returns whether a new root was written. Idempotent. */
export function allowlistOutboxRoot(target: string): boolean {
  const managed = resolve(defaultRepoParent());
  const resolved = resolve(target);
  if (resolved === managed || resolved.startsWith(managed + sep)) return false;

  const roots = loadConfig().config.daemon.outboxAllowedRoots ?? [];
  if (roots.some((r) => resolved === resolve(r) || resolved.startsWith(resolve(r) + sep))) {
    return false;
  }
  // Arrays replace on merge, so write the full extended list.
  saveGlobalConfig({ daemon: { outboxAllowedRoots: [...roots, resolved] } });
  return true;
}

export interface BackupResult {
  /** Absolute path of the mirror that now holds the backup. */
  destPath: string;
  backedUpAt: string;
}

/**
 * Snapshot the repo at `cwd` into a binary-safe mirror under `destParent` (a
 * second local or NAS folder the user picked). The mirror is `<destParent>/
 * <name>.git`, incremental after the first run. `destParent` is validated like a
 * repo home, and must not sit inside the source repo (which would recurse). v1
 * backups target a real filesystem only; a cloud-drive bundle is a fast-follow.
 */
export async function backupRepoHome(cwd: string, destParent: string): Promise<BackupResult> {
  if (!existsSync(cwd) || !(await simpleGit(cwd).checkIsRepo())) {
    throw new RepoHomeError('The repo to back up is not on disk here.');
  }
  const safeDest = assertSafeRepoParent(destParent);
  const src = deepestRealpath(resolve(cwd));
  if (safeDest === src || safeDest.startsWith(src + sep)) {
    throw new RepoHomeError('Pick a backup folder outside the repo itself.');
  }
  const destPath = join(safeDest, `${basename(src)}.git`);
  await mirrorRepo(src, destPath);
  return { destPath, backedUpAt: new Date().toISOString() };
}
