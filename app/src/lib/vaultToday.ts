// Today's note (Vault M6, 6.4; tech review K7, UX review X11): which note is today's, and
// what a new one starts with. The folder, the date format and the template
// come from the vault's resolved settings (Vault M7, tech review L3, L5): Obsidian's
// `daily-notes.json` and `templates.json` where they set a field, else the
// vault's own `.oscode/vault.json`, else Obsidian's defaults: the vault root,
// `YYYY-MM-DD`, no template, `HH:mm`.
//
// This file resolves; it never writes. The write is the Organize stream's
// (`vaultOps.ts`): `write(path, text, { ifAbsent: true })`, and an `exists`
// opens the note as it is, byte for byte. An existing note is known from the
// list, so the template is not read for it.
//
// Budget (K16, revised by M7 L5): at most five provider calls, the settings
// loader's four config reads and the template, with the settings held for 60
// seconds per vault.
import {
  VAULT_DAILY_DEFAULTS,
  dailyNotePath,
  datePartsOf,
  fillTemplate,
  foldPath,
  formatVaultDate,
  noteTitle,
  resolveWikilink,
  type DailyNoteConfig,
  type DateParts,
  type NewNoteNameCheck,
  type TemplateFill,
  type VaultDateFormatResult,
  type ResolvedVaultSettings,
  type VaultPathIndex,
} from 'os-code/protocol';
import type { StorageProvider } from './gitos/providers.js';
import {
  VAULT_TODAY_STARTED,
  vaultTodayFormatRefused,
  vaultTodayNameRefused,
  vaultTodayStartedFrom,
  vaultTodayTemplateMissing,
} from './vaultCopy.js';
import {
  VAULT_SETTINGS_TTL_MS,
  clearVaultSettingsCache,
  loadVaultSettings,
  type VaultSettingsCore,
} from './vaultSettings.js';

/** The date core Today uses (harness/vault/dates.ts); tests pass their own. */
export interface VaultTodayDates {
  datePartsOf: (d: Date) => DateParts;
  formatVaultDate: (parts: DateParts, fmt: string) => VaultDateFormatResult;
  dailyNotePath: (parts: DateParts, cfg: DailyNoteConfig) => NewNoteNameCheck;
  fillTemplate: (text: string, fill: TemplateFill) => string;
}

const CORE_DATES: VaultTodayDates = { datePartsOf, formatVaultDate, dailyNotePath, fillTemplate };

export interface VaultTodayDeps {
  /** The vault's storage; only its config is read here. */
  provider: Pick<StorageProvider, 'readConfig'> | undefined;
  resourceId: string;
  /** Every note path in the vault (or a built index of them). */
  paths: readonly string[] | VaultPathIndex;
  /** A note's text through the store's body cache, or undefined. */
  readBody: (path: string) => Promise<string | undefined>;
  /** Keys the config cache; the vault target's key, so a repoint reads again. */
  cacheKey?: string;
  now?: () => Date;
  dates?: VaultTodayDates;
  /** The settings core (tests pass their own); default os-code/protocol's. */
  settingsCore?: VaultSettingsCore;
}

/** Everything the config says about today's note, defaults filled in. */
export interface VaultTodayConfig extends DailyNoteConfig {
  dateFormat: string;
  timeFormat: string;
}

export type VaultTodayPlan =
  | {
      ok: true;
      /** Today's note path. */
      path: string;
      title: string;
      parts: DateParts;
      /** Already in the list: open it unchanged, write nothing. */
      exists: boolean;
      /** A new note's text: the filled template, or empty. */
      text: string;
      /** Set when the config names a template: where it resolved, or the
       *  path as written with `found: false` (the note starts blank). */
      template?: { path: string; found: boolean };
    }
  | { ok: false; reason: 'format'; format: string; token: string }
  | { ok: false; reason: 'name'; error: string };

/** How long a vault's daily config is trusted before it is read again: the
 *  settings loader's (Vault M7, tech review L5, L6), which Today now reads. */
export const VAULT_TODAY_CONFIG_TTL_MS = VAULT_SETTINGS_TTL_MS;

/** Forget every cached config (a repoint, a sign-out, tests). An alias of
 *  `clearVaultSettingsCache` (L6), so every existing call site still drops
 *  the one cache Today reads. */
export const clearVaultTodayCache: (key?: string) => void = clearVaultSettingsCache;

/** Today's config from a vault's resolved settings (L3): Obsidian's
 *  daily-notes and templates files where they set a field, else the vault's
 *  own `.oscode/vault.json`, else Obsidian's defaults. */
export function todayConfigOf(settings: ResolvedVaultSettings): VaultTodayConfig {
  const d = settings.daily;
  return {
    folder: d.folder ?? VAULT_DAILY_DEFAULTS.folder,
    format: d.format || VAULT_DAILY_DEFAULTS.format,
    ...(d.template ? { template: d.template } : {}),
    dateFormat: settings.templates.dateFormat || VAULT_DAILY_DEFAULTS.format,
    timeFormat: settings.templates.timeFormat || VAULT_DAILY_DEFAULTS.timeFormat,
  };
}

/** The daily config of a vault, through the settings loader (four config
 *  reads, cached for 60 seconds per vault). */
export async function vaultTodayConfig(
  deps: Pick<VaultTodayDeps, 'provider' | 'resourceId' | 'cacheKey' | 'now' | 'settingsCore'>,
): Promise<VaultTodayConfig> {
  const key = deps.cacheKey ?? deps.resourceId;
  // The resolver never throws, and a config read that fails reads as
  // unavailable (the defaults, Obsidian's files winning where they answer).
  const settings = await loadVaultSettings(deps.provider, deps.resourceId, key, {
    ...(deps.now ? { now: () => deps.now!().getTime() } : {}),
    ...(deps.settingsCore ? { core: deps.settingsCore } : {}),
  });
  return todayConfigOf(settings);
}

function pathList(paths: readonly string[] | VaultPathIndex): readonly string[] {
  return Array.isArray(paths) ? (paths as readonly string[]) : (paths as VaultPathIndex).paths;
}

/** The template note a config names: exactly as written (with or without
 *  `.md`), then as a wikilink would resolve it. */
export function resolveTodayTemplate(
  written: string,
  paths: readonly string[] | VaultPathIndex,
): string | undefined {
  const list = pathList(paths);
  const want = [written, /\.md$/i.test(written) ? undefined : `${written}.md`].filter(
    (x): x is string => Boolean(x),
  );
  for (const w of want) if (list.includes(w)) return w;
  const folded = new Set(want.map(foldPath));
  const byFold = list.find((p) => folded.has(foldPath(p)));
  if (byFold) return byFold;
  return resolveWikilink(written, paths);
}

/** Today's note for this vault: its path, whether it is there already, and
 *  what a new one starts with. Refuses by name a format it cannot read, so it
 *  never forks the day's note under a guessed name. */
export async function resolveVaultToday(deps: VaultTodayDeps): Promise<VaultTodayPlan> {
  const dates = deps.dates ?? CORE_DATES;
  const parts = dates.datePartsOf((deps.now ?? (() => new Date()))());
  const cfg = await vaultTodayConfig(deps);
  const formatted = dates.formatVaultDate(parts, cfg.format);
  if (!formatted.ok) {
    return { ok: false, reason: 'format', format: cfg.format, token: formatted.token };
  }
  const named = dates.dailyNotePath(parts, { folder: cfg.folder, format: cfg.format });
  if (!named.ok) return { ok: false, reason: 'name', error: named.error };
  const path = named.path;
  const title = noteTitle(path);
  const list = pathList(deps.paths);
  const folded = foldPath(path);
  const existing = list.find((p) => p === path) ?? list.find((p) => foldPath(p) === folded);
  if (existing !== undefined) {
    return { ok: true, path: existing, title: noteTitle(existing), parts, exists: true, text: '' };
  }
  if (!cfg.template) return { ok: true, path, title, parts, exists: false, text: '' };
  const templatePath = resolveTodayTemplate(cfg.template, deps.paths);
  let body: string | undefined;
  if (templatePath !== undefined) {
    try {
      body = await deps.readBody(templatePath);
    } catch {
      body = undefined;
    }
  }
  if (body === undefined) {
    return {
      ok: true,
      path,
      title,
      parts,
      exists: false,
      text: '',
      template: { path: cfg.template, found: false },
    };
  }
  const text = dates.fillTemplate(body, {
    parts,
    title,
    dateFormat: cfg.dateFormat,
    timeFormat: cfg.timeFormat,
  });
  return {
    ok: true,
    path,
    title,
    parts,
    exists: false,
    text,
    template: { path: templatePath!, found: true },
  };
}

/** The line to show once today's note is started (UX review X11), or undefined when
 *  there is nothing to say: an existing note opens with no toast. Call it only
 *  after the write lands; a write that finds the note already there (another
 *  device made it a moment ago) also says nothing. */
export function vaultTodayLine(plan: VaultTodayPlan): string | undefined {
  if (!plan.ok) {
    return plan.reason === 'format'
      ? vaultTodayFormatRefused(plan.format, plan.token)
      : vaultTodayNameRefused(plan.error);
  }
  if (plan.exists) return undefined;
  if (!plan.template) return VAULT_TODAY_STARTED;
  return plan.template.found
    ? vaultTodayStartedFrom(plan.template.path)
    : vaultTodayTemplateMissing(plan.template.path);
}
