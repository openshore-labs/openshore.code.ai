// Config loading: global (~/.os-code/config.json) then project
// (os-code.config.json), project wins per key. A missing file is fine, a
// malformed file gets a precise, human error naming the file and the field.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema, DaemonSchema, type OscConfig } from './schema.js';
import type { z } from 'zod';

export type DaemonConfig = z.infer<typeof DaemonSchema>;

export interface LoadedConfig {
  config: OscConfig;
  /** Which files actually contributed. */
  sources: string[];
  /** Non-fatal problems worth surfacing in doctor. */
  warnings: string[];
}

/** ~/.os-code (or OSC_HOME, which tests and multi-profile setups use). */
export function oscHome(): string {
  return process.env.OSC_HOME ?? join(homedir(), '.os-code');
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
  let merged: unknown = {};

  const projectPath = projectConfigPath(cwd);
  for (const path of [globalConfigPath(), projectPath]) {
    const { value, error } = readJson(path);
    if (error) {
      warnings.push(`Could not read ${error}. Using defaults for it.`);
      continue;
    }
    if (value !== undefined) {
      // The daemon block is machine config and never comes from a project file
      // (DAE-9): a repo the daemon runs from can be written by a member through
      // the outbox, so honoring daemon.* there would let a commit widen the
      // outbox roots or move the bind. Dropped with one warning, never merged.
      let contribution = value;
      if (path === projectPath && isPlainObject(value) && 'daemon' in value) {
        const { daemon: _ignored, ...rest } = value;
        contribution = rest;
        warnings.push(
          `daemon settings are machine config; ignored from os-code.config.json (${path}). Set them in ${globalConfigPath()}.`,
        );
      }
      merged = deepMerge(merged, contribution);
      sources.push(path);
    }
  }

  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue ? issue.path.join('.') : 'config';
    const detail = issue ? issue.message : 'invalid config';
    throw new Error(
      `Your config has a problem at "${where}": ${detail}. Files read: ${sources.join(', ') || '(none)'}. Fix the field or delete it to fall back to the default.`,
    );
  }

  return { config: parsed.data, sources, warnings };
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

/** Write the global config, creating ~/.os-code on first run. The read-modify-
 *  write is guarded on both ends: an unparsable existing file is preserved and
 *  refused (never silently treated as `{}`, which would discard providers,
 *  stack, and permissions), and the write goes through a temp file + rename so
 *  a crash mid-write can never leave a torn config on disk. */
export function saveGlobalConfig(partial: unknown): string {
  const path = globalConfigPath();
  mkdirSync(oscHome(), { recursive: true });
  let current: unknown = {};
  if (existsSync(path)) {
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
    current = value ?? {};
  }
  const next = deepMerge(current, partial);
  // Validate before writing so a bad save can never brick the CLI.
  ConfigSchema.parse(next);
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  return path;
}

/** Write via a temp file on the same directory, then rename over the target.
 *  The rename is atomic on a POSIX filesystem, so a reader never sees a partial
 *  file and a crash mid-write leaves the previous config intact. */
function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/**
 * Append an allow rule to the workspace's os-code.config.json ("don't ask
 * again for this in this project"). Rules are evaluated first match wins, so
 * the new rule goes on the end. Same guards as the global save: a corrupt
 * file is preserved and refused, the write is atomic, and the merged result
 * must validate. Returns the path written.
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
  const path = projectConfigPath(cwd);
  let current: Record<string, unknown> = {};
  if (existsSync(path)) {
    const { value, error } = readJson(path);
    if (error) throw new Error(`Refusing to save: ${error}`);
    if (isPlainObject(value)) current = value;
  }
  const permissions = isPlainObject(current.permissions) ? { ...current.permissions } : {};
  const rules = Array.isArray(permissions.rules) ? [...permissions.rules] : [];
  const entry: Record<string, unknown> = { tool: rule.tool, decision: rule.decision ?? 'allow' };
  if (rule.pathGlob) entry.pathGlob = rule.pathGlob;
  // A shell rule is scoped to the command's first word (ENG-4); without the
  // prefix it would land as a blanket allow, so the field always travels.
  if (rule.commandPrefix) entry.commandPrefix = rule.commandPrefix;
  const duplicate = rules.some(
    (r) =>
      isPlainObject(r) &&
      r.tool === entry.tool &&
      r.decision === entry.decision &&
      (r.pathGlob ?? undefined) === (entry.pathGlob ?? undefined) &&
      (r.commandPrefix ?? undefined) === (entry.commandPrefix ?? undefined),
  );
  if (!duplicate) rules.push(entry);
  const next = { ...current, permissions: { ...permissions, rules } };
  ConfigSchema.parse(deepMerge(defaultConfig(), next));
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  return path;
}

/** Parse defaults only, used where config must never throw (doctor itself). */
export function defaultConfig(): OscConfig {
  return ConfigSchema.parse({});
}
