// The vault's settings on the engine and the daemon (Vault M7, CTO L5, L6):
// the four config reads (`.oscode/vault.json` and Obsidian's three) resolved
// through the pure core (`resolveVaultSettings`), kept per real root and
// revalidated at most every 2 seconds, or at once when a caller forces it (a
// task start). A read that has not changed (compared by version) keeps the
// resolved value it had. Node-side, so it stays out of src/harness/.
//
// This file also holds the one check the workspace file tools share (L8):
// writeFile and editFile never write under a vault's `.oscode/`, the owner's
// or any member's, whatever the grant. The settings writer lives in
// configFile.ts and is never imported here.
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { resolveVaultSettings } from '../../harness/vault/settings.js';
import { foldPath } from '../../harness/vault/paths.js';
import type {
  ConfigRead,
  ResolvedVaultSettings,
  VaultConfigName,
  VaultSettingsReads,
} from '../../harness/vault/types.js';
import { loadVaultDir } from '../../config/load.js';
import { readVaultConfigFile } from './configFile.js';
import { deepestRealpath } from './folderFs.js';
import { memberVaultsDir } from './memberRoots.js';

/** A cached value is looked at again after this long (L6). */
export const VAULT_SETTINGS_REVALIDATE_MS = 2_000;

/** The tool card's reason when a model tries to write under `.oscode/` (CX
 *  Y3). */
export const VAULT_SETTINGS_DENY =
  'Vault settings are yours to change, so a model cannot write under .oscode.';

/** Tests only: stand in for the pure resolver, the reader or the clock. */
export const vaultSettingsHooksForTests: {
  resolve?: (reads: VaultSettingsReads) => ResolvedVaultSettings;
  read?: (root: string, name: VaultConfigName) => Promise<ConfigRead>;
  now?: () => number;
} = {};

interface Entry {
  checkedAt: number;
  key: string;
  settings: ResolvedVaultSettings;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<ResolvedVaultSettings>>();

const NAMES: ReadonlyArray<[keyof VaultSettingsReads, VaultConfigName]> = [
  ['file', 'oscode/vault'],
  ['app', 'obsidian/app'],
  ['daily', 'obsidian/daily-notes'],
  ['templates', 'obsidian/templates'],
];

function realRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
}

/** One read; a throw reads as `unsupported`, so the resolver marks the file
 *  unavailable and the host keeps its last good narrowing (L4). */
async function readOne(root: string, name: VaultConfigName): Promise<ConfigRead> {
  const read = vaultSettingsHooksForTests.read ?? readVaultConfigFile;
  try {
    return await read(root, name);
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
}

function keyOf(reads: VaultSettingsReads): string {
  return NAMES.map(([role]) => {
    const r = reads[role];
    return r.ok ? `v:${r.version}` : `r:${r.reason}`;
  }).join('|');
}

async function load(key: string, now: number): Promise<ResolvedVaultSettings> {
  const pairs = await Promise.all(
    NAMES.map(async ([role, name]) => [role, await readOne(key, name)] as const),
  );
  const reads = Object.fromEntries(pairs) as unknown as VaultSettingsReads;
  const versions = keyOf(reads);
  const was = cache.get(key);
  if (was && was.key === versions) {
    was.checkedAt = now;
    return was.settings;
  }
  const settings = (vaultSettingsHooksForTests.resolve ?? resolveVaultSettings)(reads);
  cache.set(key, { checkedAt: now, key: versions, settings });
  return settings;
}

/**
 * The vault's resolved settings at `root` (L5). Kept per real root and read
 * again at most every 2 seconds; `force` reads again now (a task start, a
 * pack prepare). The four files are compared by version, so an unchanged
 * vault resolves once. Throws only when the resolver does.
 */
export async function vaultSettingsFor(
  root: string,
  options: { force?: boolean } = {},
): Promise<ResolvedVaultSettings> {
  const key = realRoot(root);
  const now = (vaultSettingsHooksForTests.now ?? Date.now)();
  const was = cache.get(key);
  if (was && !options.force && now - was.checkedAt < VAULT_SETTINGS_REVALIDATE_MS) {
    return was.settings;
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const next = load(key, now).finally(() => inflight.delete(key));
  inflight.set(key, next);
  return next;
}

/** Drop the kept settings for one root, or for every root. */
export function clearVaultSettingsCache(root?: string): void {
  if (root === undefined) cache.clear();
  else cache.delete(realRoot(root));
}

// ---------------------------------------------------------------------------
// The workspace file tools' `.oscode/` deny (L8)

function within(target: string, root: string): boolean {
  return target === root || target.startsWith(root + sep);
}

function segmentsUnder(target: string, root: string): string[] | undefined {
  if (!within(target, root)) return undefined;
  const rel = relative(root, target);
  if (rel === '') return [];
  if (isAbsolute(rel)) return undefined;
  return rel.split(sep);
}

function isSettingsDir(segment: string | undefined): boolean {
  return segment !== undefined && foldPath(segment).trim() === '.oscode';
}

/** Whether a path, as written or as resolved, sits under `<root>/.oscode/`
 *  for one vault root, or under any member root's `.oscode/`. */
function underSettingsDir(target: string, roots: readonly string[], members: string): boolean {
  for (const root of roots) {
    if (isSettingsDir(segmentsUnder(target, root)?.[0])) return true;
  }
  return isSettingsDir(segmentsUnder(target, members)?.[1]);
}

/** Same file (a hard link to a settings file): device and inode match. */
function sameFile(a: string, b: string): boolean {
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}

/**
 * Whether a workspace write (writeFile, editFile) to `abs` would land under a
 * vault's `.oscode/` (L8): the session's own vault, the machine owner's, or
 * any member's root. Judged on the path as written AND as resolved through
 * links, so a symlink into `.oscode/` is refused too, and a hard link to the
 * settings file is caught by its inode. Holds whatever the grant: the tools
 * call it in execute, which an "always allow" reaches without a preview.
 * `runShell` is not covered; it stays under its own ask rule.
 */
export function workspaceWriteHitsVaultSettings(abs: string, sessionVault?: string): boolean {
  const roots = new Set<string>();
  for (const dir of [sessionVault, safeMachineVault()]) {
    if (!dir) continue;
    roots.add(resolve(dir));
    roots.add(realRoot(dir));
  }
  const members = memberVaultsDir();
  const memberSet = [resolve(members), realRoot(members)];
  const typed = resolve(abs);
  const real = deepestRealpath(abs);
  for (const m of memberSet) {
    if (underSettingsDir(typed, [...roots], m) || underSettingsDir(real, [...roots], m)) {
      return true;
    }
  }
  // A hard link planted in the workspace shares the settings file's inode.
  let links = 1;
  try {
    links = lstatSync(abs).nlink;
  } catch {
    return false;
  }
  if (links < 2) return false;
  return [...roots].some((root) => sameFile(abs, join(root, '.oscode', 'vault.json')));
}

function safeMachineVault(): string | undefined {
  try {
    return loadVaultDir().dir;
  } catch {
    return undefined;
  }
}
