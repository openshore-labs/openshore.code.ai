// Config loading: global (~/.os-code/config.json) then project
// (os-code.config.json), project wins per key. A missing file is fine, a
// malformed file gets a precise, human error naming the file and the field.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema, type OscConfig } from './schema.js';

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

  for (const path of [globalConfigPath(), projectConfigPath(cwd)]) {
    const { value, error } = readJson(path);
    if (error) {
      warnings.push(`Could not read ${error}. Using defaults for it.`);
      continue;
    }
    if (value !== undefined) {
      merged = deepMerge(merged, value);
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

/** Write the global config, creating ~/.os-code on first run. */
export function saveGlobalConfig(partial: unknown): string {
  const path = globalConfigPath();
  mkdirSync(oscHome(), { recursive: true });
  const current = existsSync(path) ? (readJson(path).value ?? {}) : {};
  const next = deepMerge(current, partial);
  // Validate before writing so a bad save can never brick the CLI.
  ConfigSchema.parse(next);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return path;
}

/** Parse defaults only, used where config must never throw (doctor itself). */
export function defaultConfig(): OscConfig {
  return ConfigSchema.parse({});
}
