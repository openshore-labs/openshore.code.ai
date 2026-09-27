// A vault's config files, read through the seam (Vault M3, CTO H5). Only
// logical names cross (`obsidian/app`, `obsidian/daily-notes`,
// `obsidian/templates`, `oscode/vault`); each provider maps a name through its
// own allow-list, so a plugin's folder (which can hold tokens) and
// `workspace*.json` are never readable from here.
//
// readVaultConfig is the one entry point: it answers `unsupported` for a
// provider that has not gained readConfig, `refused` for any other name, and
// holds every answer to the 256 KB cap. The readers below turn a file into the
// few settings the Vault uses, and never throw: bad JSON, a wrong type, or a
// missing key each read as "not set", so a hand-edited file can only ever fall
// back to the defaults.
import {
  VAULT_CONFIG_MAX_BYTES,
  isVaultConfigName,
  utf8Length,
  type ConfigRead,
  type ConfigReadRefusal,
} from 'os-code/protocol';
import type { StorageProvider } from './providers.js';

const REFUSALS: ReadonlySet<string> = new Set<ConfigReadRefusal>([
  'absent',
  'too-large',
  'downloading',
  'unsupported',
  'refused',
]);

/** A provider's answer as the seam promises it, whatever came back: an ok
 *  carries text and a version and fits the cap, and a refusal names one of
 *  the known reasons. Anything else reads as `unsupported`. */
export function asConfigRead(r: unknown): ConfigRead {
  if (typeof r !== 'object' || r === null) return { ok: false, reason: 'unsupported' };
  const v = r as Record<string, unknown>;
  if (v.ok === true) {
    if (typeof v.text !== 'string' || typeof v.version !== 'string') {
      return { ok: false, reason: 'unsupported' };
    }
    if (utf8Length(v.text) > VAULT_CONFIG_MAX_BYTES) return { ok: false, reason: 'too-large' };
    return { ok: true, text: v.text, version: v.version };
  }
  if (v.ok === false && typeof v.reason === 'string' && REFUSALS.has(v.reason)) {
    return { ok: false, reason: v.reason as ConfigReadRefusal };
  }
  return { ok: false, reason: 'unsupported' };
}

/** Read one config file of a vault. A name outside the allow-list is
 *  `refused` before any provider sees it; a provider without readConfig, or
 *  one whose read failed outright, answers `unsupported`, which every caller
 *  treats as "use the defaults". */
export async function readVaultConfig(
  provider: Pick<StorageProvider, 'readConfig'> | undefined,
  resourceId: string,
  name: unknown,
): Promise<ConfigRead> {
  if (!isVaultConfigName(name)) return { ok: false, reason: 'refused' };
  if (typeof provider?.readConfig !== 'function') return { ok: false, reason: 'unsupported' };
  try {
    return asConfigRead(await provider.readConfig(resourceId, name));
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
}

// ---------------------------------------------------------------------------
// Tolerant JSON readers

/** A config file's top-level object, copied onto a null-prototype object, or
 *  undefined for a refusal, bad JSON, or anything that is not an object. */
export function configJson(read: ConfigRead): Record<string, unknown> | undefined {
  if (!read.ok) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text.replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(parsed)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = (parsed as Record<string, unknown>)[key];
  }
  return out;
}

/** The longest string setting kept. */
const MAX_SETTING = 1024;

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s && s.length <= MAX_SETTING ? s : undefined;
}

/** A folder setting as a vault-relative path: forward slashes, no leading or
 *  trailing slash, and never one that climbs out of the vault. Empty means
 *  the vault root, which reads as not set. */
function folder(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const segs = s
    .replace(/\\/g, '/')
    .split('/')
    .map((x) => x.trim())
    .filter((x) => x && x !== '.');
  if (segs.some((x) => x === '..')) return undefined;
  return segs.length ? segs.join('/') : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** The settings the Vault reads from Obsidian's `app.json`. */
export interface ObsidianAppConfig {
  newFileLocation?: 'root' | 'current' | 'folder';
  newFileFolderPath?: string;
  attachmentFolderPath?: string;
  newLinkFormat?: 'shortest' | 'relative' | 'absolute';
  useMarkdownLinks?: boolean;
  alwaysUpdateLinks?: boolean;
}

export function readObsidianAppConfig(read: ConfigRead): ObsidianAppConfig {
  const j = configJson(read);
  if (!j) return {};
  const out: ObsidianAppConfig = {};
  const loc = oneOf(j.newFileLocation, ['root', 'current', 'folder'] as const);
  if (loc) out.newFileLocation = loc;
  const nf = folder(j.newFileFolderPath);
  if (nf) out.newFileFolderPath = nf;
  // An attachment folder may be written "./" (beside the note) or "./sub";
  // kept as written, since only M6 reads it.
  const af = str(j.attachmentFolderPath);
  if (af) out.attachmentFolderPath = af;
  const fmt = oneOf(j.newLinkFormat, ['shortest', 'relative', 'absolute'] as const);
  if (fmt) out.newLinkFormat = fmt;
  const md = bool(j.useMarkdownLinks);
  if (md !== undefined) out.useMarkdownLinks = md;
  const upd = bool(j.alwaysUpdateLinks);
  if (upd !== undefined) out.alwaysUpdateLinks = upd;
  return out;
}

/** Obsidian's Daily notes settings (`daily-notes.json`). */
export interface DailyNotesConfig {
  folder?: string;
  /** A moment.js date format, as written ("YYYY-MM-DD" when not set). */
  format?: string;
  /** The template note's path, as written. */
  template?: string;
  autorun?: boolean;
}

export function readDailyNotesConfig(read: ConfigRead): DailyNotesConfig {
  const j = configJson(read);
  if (!j) return {};
  const out: DailyNotesConfig = {};
  const f = folder(j.folder);
  if (f) out.folder = f;
  const fmt = str(j.format);
  if (fmt) out.format = fmt;
  const t = folder(j.template);
  if (t) out.template = t;
  const auto = bool(j.autorun);
  if (auto !== undefined) out.autorun = auto;
  return out;
}

/** Obsidian's Templates settings (`templates.json`). */
export interface TemplatesConfig {
  folder?: string;
  dateFormat?: string;
  timeFormat?: string;
}

export function readTemplatesConfig(read: ConfigRead): TemplatesConfig {
  const j = configJson(read);
  if (!j) return {};
  const out: TemplatesConfig = {};
  const f = folder(j.folder);
  if (f) out.folder = f;
  const d = str(j.dateFormat);
  if (d) out.dateFormat = d;
  const t = str(j.timeFormat);
  if (t) out.timeFormat = t;
  return out;
}
