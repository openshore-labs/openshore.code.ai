// Config loading: global (~/.os-code/config.json), then the project's
// os-code.config.json applied under the project-trust policy
// (projectPolicy.ts): a repo's file can tighten OpenShore from any folder, but
// only loosens it once the person trusts that folder on this machine
// (trust.ts), and never sets machine config at all. A missing file is fine, a
// malformed file gets a precise, human error naming the file and the field.
import {
  closeSync,
  copyFileSync,
  fchmodSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { ConfigSchema, DaemonSchema, type OscConfig } from './schema.js';
import type { z } from 'zod';
import { oscHome } from './home.js';
import { applyProjectConfig } from './projectPolicy.js';
import {
  addFolderGrant,
  folderGrants,
  folderTrust,
  forgetFolderTrust,
  trustFolder,
  trustStorePath,
  type FolderTrust,
  type TrustState,
} from './trust.js';

export { oscHome };

export type DaemonConfig = z.infer<typeof DaemonSchema>;

export interface LoadedConfig {
  config: OscConfig;
  /** Which files actually contributed. */
  sources: string[];
  /** Non-fatal problems worth surfacing in doctor. */
  warnings: string[];
  /** Where this folder stands on project trust, and what its own file asks
   *  for that stays off until the person trusts it (plain words). */
  projectTrust: ProjectTrust;
}

export interface ProjectTrust {
  state: TrustState;
  /** The folder's real path. */
  folder: string;
  /** What the folder's os-code.config.json asks for that is not applied
   *  until the person trusts the folder, one plain phrase each. Empty when
   *  trusted or when it asks for nothing. */
  waiting: string[];
}

export function globalConfigPath(): string {
  return join(oscHome(), 'config.json');
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, 'os-code.config.json');
}

function readJson(path: string): { value?: unknown; error?: string } {
  try {
    const raw = readFileSync(path, 'utf8');
    return { value: JSON.parse(raw) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return { error: `${path}: ${(err as Error).message}` };
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge where `over` wins; arrays replace rather than concatenate. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) {
      out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out;
  }
  return over === undefined ? base : over;
}

export function loadConfig(cwd: string = process.cwd()): LoadedConfig {
  const sources: string[] = [];
  const warnings: string[] = [];

  const projectPath = projectConfigPath(cwd);
  let globalValue: unknown = {};
  let projectValue: unknown;
  for (const path of [globalConfigPath(), projectPath]) {
    const { value, error } = readJson(path);
    if (error) {
      warnings.push(`Could not read ${error}. Using defaults for it.`);
      continue;
    }
    if (value === undefined) continue;
    sources.push(path);
    if (path === projectPath) projectValue = value;
    else globalValue = value;
  }

  // Validate the two files together first, so a malformed value in either one
  // gets the same precise error it always did.
  const combined = ConfigSchema.safeParse(deepMerge(globalValue, projectValue ?? {}));
  if (!combined.success) {
    const issue = combined.error.issues[0];
    const where = issue ? issue.path.join('.') : 'config';
    const detail = issue ? issue.message : 'invalid config';
    throw new Error(
      `Your config has a problem at "${where}": ${detail}. Files read: ${sources.join(', ') || '(none)'}. Fix the field or delete it to fall back to the default.`,
    );
  }

  // The person's own settings, then the project's file on top of them under
  // the trust policy. The untrusted pass also says whether the folder asks for
  // anything only trust would apply.
  const base = ConfigSchema.parse(globalValue);
  const grants = folderGrants(cwd);
  const untrusted = applyProjectConfig(base, projectValue, false, grants);
  const waiting = untrusted.setAside.filter((s) => s.trustable);
  const trust = folderTrust(cwd, projectValue, waiting.length > 0);
  const applied =
    trust.state === 'trusted' ? applyProjectConfig(base, projectValue, true, grants) : untrusted;

  // Machine config in a project file is dropped every time, trusted or not.
  const machine = [...new Set(applied.setAside.filter((s) => !s.trustable).map((s) => s.path))];
  for (const key of machine) {
    warnings.push(
      `${key} settings are machine config; ignored from os-code.config.json (${projectPath}). Set them in ${globalConfigPath()}.`,
    );
  }
  const waitingPlain = trust.state === 'trusted' ? [] : [...new Set(waiting.map((s) => s.plain))];
  if (waitingPlain.length) {
    const changed = trust.state === 'changed' ? ' It changed since you trusted it.' : '';
    warnings.push(
      `This folder's os-code.config.json ${waitingPlain.join('; ')}. That stays off until you trust this folder.${changed} Trust it with "osc trust" here, or from the card in the app.`,
    );
  }

  const parsed = ConfigSchema.parse(applied.config);

  // A vault folder that cannot be used (a relative path) falls back to the
  // default; say so here, so doctor and the session warnings carry it.
  const vault = resolveVaultDir(parsed.vault?.dir);
  if (vault.warning) warnings.push(vault.warning);

  return {
    config: parsed,
    sources,
    warnings,
    projectTrust: { state: trust.state, folder: trust.folder, waiting: waitingPlain },
  };
}

/** Trust this folder on this machine: its own os-code.config.json applies in
 *  full from the next session (machine config aside), until it changes. */
export function trustProjectFolder(cwd: string): FolderTrust {
  const { value, error } = readJson(projectConfigPath(cwd));
  if (error) throw new Error(`Cannot trust this folder yet: could not read ${error}`);
  return trustFolder(cwd, value);
}

/** This folder's trust as the coding CLIs see it: only their own settings
 *  folders (.claude, .codex) ask, since CLI Pairing runs them headless. */
export function cliFolderTrust(cwd: string): FolderTrust {
  const { value } = readJson(projectConfigPath(cwd));
  return folderTrust(cwd, value, false);
}

/** Stop trusting this folder on this machine. */
export function forgetProjectFolder(cwd: string): void {
  forgetFolderTrust(cwd);
}

/**
 * The daemon's own settings (bind, port, outbox roots, Stack Health
 * visibility), parsed from the GLOBAL file alone. The daemon reads every
 * daemon.* value through this so no project file, in its cwd or anywhere else,
 * can steer machine config (DAE-9). An unreadable or invalid global file falls
 * back to the schema defaults: the daemon must keep serving on a bad edit.
 */
export function loadDaemonConfig(): DaemonConfig {
  const { value } = readJson(globalConfigPath());
  const raw = isPlainObject(value) && isPlainObject(value.daemon) ? value.daemon : {};
  const parsed = DaemonSchema.safeParse(raw);
  return parsed.success ? parsed.data : DaemonSchema.parse({});
}

/** The vault folder when none is configured: beside the OSCode clones. */
export function defaultVaultDir(): string {
  return join(homedir(), 'OSCode', 'Vault');
}

export interface VaultDir {
  /** The absolute vault folder every process uses. */
  dir: string;
  /** Set when the configured value could not be used and the default stands. */
  warning?: string;
}

/**
 * Resolve a configured vault folder. A leading "~" expands to the home folder
 * and the result must be absolute, so a session, the routine scheduler, and the
 * desktop app land on the same folder whatever their working directory. A
 * relative path is never resolved against a process cwd: it falls back to the
 * default with a warning. Unset means ~/OSCode/Vault.
 */
export function resolveVaultDir(configured: string | undefined): VaultDir {
  const raw = configured?.trim();
  if (!raw) return { dir: defaultVaultDir() };
  const expanded =
    raw === '~'
      ? homedir()
      : raw.startsWith('~/') || raw.startsWith('~\\')
        ? join(homedir(), raw.slice(2))
        : raw;
  if (!isAbsolute(expanded)) {
    return {
      dir: defaultVaultDir(),
      warning: `vault.dir "${raw}" is not an absolute path, so the vault stays at ${defaultVaultDir()}. Use a full path, or one starting with ~/.`,
    };
  }
  return { dir: resolve(expanded) };
}

/**
 * The vault folder, parsed from the GLOBAL file alone: vault.* is machine
 * config (see PROJECT_POLICY in projectPolicy.ts), so no project file can move where the agent
 * reads without a prompt. The one helper the engine's vault tools, the routine
 * scheduler, and the desktop app all resolve the folder through. Never throws:
 * an unreadable global file falls back to the default.
 */
export function loadVaultDir(): VaultDir {
  const { value } = readJson(globalConfigPath());
  const vault = isPlainObject(value) && isPlainObject(value.vault) ? value.vault : {};
  return resolveVaultDir(typeof vault.dir === 'string' ? vault.dir : undefined);
}

/** The one line every process says when the vault folder is missing. */
export const VAULT_FOLDER_MISSING = 'The vault folder is not there right now.';

/**
 * The vault folder, ready to use: the default (~/OSCode/Vault) is made on
 * first use; any other folder must already be there. A configured folder that
 * has gone missing (renamed, moved, or on a drive that is not connected) is
 * never recreated, since a fresh empty folder would scatter notes between two
 * places. Throws VAULT_FOLDER_MISSING instead. The engine's vault tools, the
 * routine scheduler, and the desktop app's main process all go through this.
 */
export function ensureVaultRoot(dir: string): string {
  let there = false;
  try {
    there = statSync(dir).isDirectory();
  } catch {
    there = false;
  }
  if (there) return dir;
  if (resolve(dir) === defaultVaultDir()) {
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  throw new Error(VAULT_FOLDER_MISSING);
}

/** Write the global config, creating ~/.os-code on first run. The read-modify-
 *  write is guarded on both ends: an unparsable existing file is preserved and
 *  refused (never silently treated as `{}`, which would discard providers,
 *  stack, and permissions), and the write goes through a temp file + rename so
 *  a crash mid-write can never leave a torn config on disk. */
export function saveGlobalConfig(partial: unknown): string {
  const path = globalConfigPath();
  const next = deepMerge(readGlobalForWrite(path), partial);
  // Validate before writing so a bad save can never brick the CLI.
  ConfigSchema.parse(next);
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  return path;
}

/** The global file as it stands, for a write: {} when there is none yet. An
 *  unparsable file is preserved and refused, never read as {}. */
function readGlobalForWrite(path: string): Record<string, unknown> {
  mkdirSync(oscHome(), { recursive: true });
  if (!existsSync(path)) return {};
  const { value, error } = readJson(path);
  if (error) {
    // Overwriting a corrupt config with a partial would discard everything
    // it held. Preserve it for recovery and refuse the write; the caller can
    // fix or delete it and retry.
    const backup = `${path}.corrupt`;
    try {
      copyFileSync(path, backup);
    } catch {
      // Best-effort: refusing the write matters more than the copy landing.
    }
    throw new Error(
      `Refusing to save: ${error}. The existing config could not be parsed; a copy was preserved at ${backup}. Fix or delete ${path}, then retry.`,
    );
  }
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new Error(`Refusing to save: ${path} does not hold a JSON object. Fix or delete it.`);
  }
  return value;
}

/** Edit the global file in place, for a change a deep merge cannot make (a
 *  removal). The edit gets the file's own JSON, every key it holds kept; the
 *  result is validated before the atomic write, and an edit that throws
 *  writes nothing (keys on your server, 2026-10-09). */
export function editGlobalConfig(edit: (raw: Record<string, unknown>) => void): string {
  const path = globalConfigPath();
  const raw = readGlobalForWrite(path);
  edit(raw);
  ConfigSchema.parse(raw);
  writeFileAtomic(path, `${JSON.stringify(raw, null, 2)}\n`);
  return path;
}

/** The global file alone, parsed, with no project file over it: what this
 *  machine's own config says. An unreadable or invalid file throws. */
export function loadGlobalConfig(): OscConfig {
  const { value, error } = readJson(globalConfigPath());
  if (error) throw new Error(`Could not read ${error}`);
  return ConfigSchema.parse(value ?? {});
}

/** Write via a temp file on the same directory, then rename over the target.
 *  The rename is atomic on a POSIX filesystem, so a reader never sees a partial
 *  file and a crash mid-write leaves the previous config intact. The temp file
 *  carries the existing file's mode (0o600 for a new file), so a person's chmod
 *  survives a save, and it is synced before the rename, so the rename never
 *  publishes bytes still in a cache (Vault M1, tech review F7.3). */
export function writeFileAtomic(path: string, data: string): void {
  let mode = 0o600;
  try {
    mode = statSync(path).mode & 0o7777;
  } catch {
    // No file yet: owner-only, since the config names key variables.
  }
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, 'wx', mode);
  try {
    // open() applies the umask; set the mode exactly, where the OS has one.
    if (process.platform !== 'win32') fchmodSync(fd, mode);
    writeSync(fd, data);
    fsyncSync(fd);
  } catch (err) {
    closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      // Best effort: the temp name is unique to this write.
    }
    throw err;
  }
  closeSync(fd);
  renameSync(tmp, path);
}

/**
 * Record an "always allow in this project" rule for this folder, on this
 * machine (~/.os-code/trust.json), never in the repo: a rule written into a
 * tracked os-code.config.json would ship to everyone who clones it. Identical
 * rules are kept once. Returns the path written.
 */
export function addProjectPermissionRule(
  cwd: string,
  rule: {
    tool: string;
    pathGlob?: string;
    commandPrefix?: string;
    decision?: 'allow' | 'ask' | 'deny';
  },
): string {
  // A shell rule is scoped to the command's first word (ENG-4); without the
  // prefix it would land as a blanket allow, so the field always travels.
  return addFolderGrant(cwd, {
    tool: rule.tool,
    decision: rule.decision ?? 'allow',
    ...(rule.pathGlob ? { pathGlob: rule.pathGlob } : {}),
    ...(rule.commandPrefix ? { commandPrefix: rule.commandPrefix } : {}),
  });
}

export { trustStorePath };

/** Parse defaults only, used where config must never throw (doctor itself). */
export function defaultConfig(): OscConfig {
  return ConfigSchema.parse({});
}
