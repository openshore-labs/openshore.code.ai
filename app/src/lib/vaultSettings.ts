// The vault's settings in the app (Vault M7, CTO L3 to L7, L18; CX Y2, Y3,
// Y5). One loader for every provider: four config reads through the seam
// (`oscode/vault`, then Obsidian's `app`, `daily-notes` and `templates`),
// resolved by the shared core (`resolveVaultSettings` from os-code/protocol),
// so the app, the engine and the daemon agree on every field and on what the
// in-vault file may never widen.
//
// The cache (L6): one entry per `providerId::resourceId`, trusted for 60
// seconds, dropped by this device's own write (seeded from the text it
// wrote), a repoint, move or pick, a sign-out, a pairing change, the room
// becoming visible, and a watcher hint naming `.oscode/` or the config
// folder. `clearVaultTodayCache` is an alias of `clearVaultSettingsCache`.
//
// The narrowing (L4): the in-vault file's lists are union only and apply on
// top of the machine's and the device's. A read that cannot answer
// (downloading, unsupported, a throw) or a file that is not JSON keeps the
// LAST GOOD narrowing for that vault, kept sealed on the device, so a file
// mid-sync never opens a note up. A file that is absent means none.
//
// The save (L7, CX Y5) is the person's alone: only the sheet calls
// `saveVaultSetting`, never an agent path (a grep test holds that). It
// writes the one changed field by compare-and-swap; when the file changed
// elsewhere, a DIFFERENT field is re-applied on theirs once, and the SAME
// field writes nothing and shows theirs with "Use {yours}". A file that is
// not a JSON object is never overwritten.
import {
  patchVaultSettingsFile,
  resolveVaultSettings,
  type ConfigRead,
  type ResolvedVaultSettings,
  type VaultPrivacyNarrowing,
  type VaultSettingsField,
  type VaultSettingsPatch,
  type VaultSettingsReads,
} from 'os-code/protocol';
import { readVaultConfig } from './gitos/config.js';
import type { StorageProvider, WriteGuard } from './gitos/providers.js';
import { storeGetJson, storeSetJson } from './platform.js';
import {
  VAULT_SETTINGS_FAILED,
  VAULT_SETTINGS_FIELD_LABELS,
  VAULT_SETTINGS_FROM_OBSIDIAN,
  VAULT_SETTINGS_FROM_OBSIDIAN_MORE,
  VAULT_SETTINGS_MERGED,
  VAULT_SETTINGS_OBSIDIAN_OWN,
  VAULT_SETTINGS_SAVED,
  VAULT_SETTINGS_UNREADABLE,
  vaultSettingsSameField,
  vaultSettingsSetAside,
} from './vaultCopy.js';

/** The shared core the loader and the save use. Tests pass their own. */
export interface VaultSettingsCore {
  resolve: (reads: VaultSettingsReads) => ResolvedVaultSettings;
  patch: (current: string | undefined, patch: VaultSettingsPatch) => string | undefined;
}

const CORE: VaultSettingsCore = {
  resolve: resolveVaultSettings,
  patch: patchVaultSettingsFile,
};

/** Where the last good in-vault narrowing of each vault is kept. */
export interface VaultNarrowingStore {
  load(key: string): Promise<VaultPrivacyNarrowing | undefined>;
  save(key: string, narrowing: VaultPrivacyNarrowing): Promise<void>;
}

const NARROWING_KEY = 'oscode.vaultNarrowing.v1';

/** The device's sealed store, one entry per vault key. */
export const sealedNarrowingStore: VaultNarrowingStore = {
  async load(key) {
    const kept = await storeGetJson<Record<string, unknown>>(NARROWING_KEY);
    const v = kept?.[key];
    return readNarrowing(v);
  },
  async save(key, narrowing) {
    const kept = (await storeGetJson<Record<string, unknown>>(NARROWING_KEY)) ?? {};
    await storeSetJson(NARROWING_KEY, { ...kept, [key]: narrowing });
  },
};

function strings(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
    ? [...(v as string[])]
    : undefined;
}

/** A kept narrowing as stored, or undefined when it is not one. */
function readNarrowing(v: unknown): VaultPrivacyNarrowing | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as { exclude?: unknown; localOnly?: { paths?: unknown; tags?: unknown } };
  const out: VaultPrivacyNarrowing = {};
  const exclude = strings(o.exclude);
  if (exclude) out.exclude = exclude;
  const paths = strings(o.localOnly?.paths);
  const tags = strings(o.localOnly?.tags);
  if (paths || tags) out.localOnly = { ...(paths ? { paths } : {}), ...(tags ? { tags } : {}) };
  return out;
}

/** The cache key of one vault: its storage and its resource. */
export function vaultSettingsKey(providerId: string, resourceId: string): string {
  return `${providerId}::${resourceId}`;
}

/** How long a vault's settings are trusted before they are read again. */
export const VAULT_SETTINGS_TTL_MS = 60_000;

interface Entry {
  at: number;
  reads: VaultSettingsReads;
  settings: ResolvedVaultSettings;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<ResolvedVaultSettings>>();
/** The last good narrowing seen this run, per vault, ahead of the store. */
const lastGood = new Map<string, VaultPrivacyNarrowing>();

/** Forget one vault's settings, or every vault's (a sign-out, a pairing
 *  change, a test). The last good narrowing is kept: it is a floor, not a
 *  cache. */
export function clearVaultSettingsCache(key?: string): void {
  if (key === undefined) {
    cache.clear();
    inFlight.clear();
    return;
  }
  cache.delete(key);
  inFlight.delete(key);
}

/** Tests only: forget the in-memory last good narrowings too. */
export function resetVaultSettingsForTests(): void {
  clearVaultSettingsCache();
  lastGood.clear();
}

/** A watcher hint (L6): drop the vault's settings when a changed path is the
 *  settings file's folder or the Obsidian config folder. True when it did. */
export function vaultSettingsHint(
  key: string,
  changed: readonly string[],
  configDir = '.obsidian',
): boolean {
  const dirs = ['.oscode', configDir].map((d) => d.toLowerCase());
  const hit = changed.some((p) => {
    const first = p.replace(/\\/g, '/').replace(/^\/+/, '').split('/')[0]!.toLowerCase();
    return dirs.includes(first);
  });
  if (hit) clearVaultSettingsCache(key);
  return hit;
}

/** What the loader may be handed besides the storage. */
export interface VaultSettingsLoadOpts {
  now?: () => number;
  core?: VaultSettingsCore;
  narrowings?: VaultNarrowingStore;
  /** Read again even when the cache is fresh (the room became visible). */
  force?: boolean;
}

async function readAll(
  provider: Pick<StorageProvider, 'readConfig'> | undefined,
  resourceId: string,
): Promise<VaultSettingsReads> {
  const [file, app, daily, templates] = await Promise.all([
    readVaultConfig(provider, resourceId, 'oscode/vault'),
    readVaultConfig(provider, resourceId, 'obsidian/app'),
    readVaultConfig(provider, resourceId, 'obsidian/daily-notes'),
    readVaultConfig(provider, resourceId, 'obsidian/templates'),
  ]);
  return { file, app, daily, templates };
}

/** The settings with the narrowing L4 says holds: the file's own when it
 *  read, the last good one when it could not be read, none when absent. */
async function withNarrowing(
  key: string,
  settings: ResolvedVaultSettings,
  store: VaultNarrowingStore,
): Promise<ResolvedVaultSettings> {
  if (settings.fileState === 'ok' || settings.fileState === 'absent') {
    const n = settings.fileState === 'ok' ? settings.narrowing : {};
    lastGood.set(key, n);
    try {
      await store.save(key, n);
    } catch {
      // A store that cannot be written costs only the offline floor.
    }
    return settings;
  }
  let kept = lastGood.get(key);
  if (!kept) {
    try {
      kept = await store.load(key);
    } catch {
      kept = undefined;
    }
    if (kept) lastGood.set(key, kept);
  }
  return { ...settings, narrowing: kept ?? {} };
}

async function resolveEntry(
  key: string,
  reads: VaultSettingsReads,
  at: number,
  core: VaultSettingsCore,
  store: VaultNarrowingStore,
): Promise<ResolvedVaultSettings> {
  const settings = await withNarrowing(key, core.resolve(reads), store);
  cache.set(key, { at, reads, settings });
  return settings;
}

/** One vault's resolved settings (L5): four config reads, cached for 60
 *  seconds per vault, one read in flight at a time. With no file anywhere it
 *  is exactly `VAULT_SETTINGS_DEFAULTS` (L18). */
export async function loadVaultSettings(
  provider: Pick<StorageProvider, 'readConfig'> | undefined,
  resourceId: string,
  key: string,
  opts: VaultSettingsLoadOpts = {},
): Promise<ResolvedVaultSettings> {
  const now = opts.now ?? (() => Date.now());
  const at = now();
  const hit = cache.get(key);
  if (!opts.force && hit && at - hit.at >= 0 && at - hit.at < VAULT_SETTINGS_TTL_MS) {
    return hit.settings;
  }
  const pending = inFlight.get(key);
  if (pending && !opts.force) return pending;
  const run = (async () => {
    const reads = await readAll(provider, resourceId);
    return resolveEntry(key, reads, at, opts.core ?? CORE, opts.narrowings ?? sealedNarrowingStore);
  })();
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    if (inFlight.get(key) === run) inFlight.delete(key);
  }
}

/** The cached settings of a vault, fresh or not, or undefined. */
export function cachedVaultSettings(key: string): ResolvedVaultSettings | undefined {
  return cache.get(key)?.settings;
}

/** The part of the privacy cache key the settings own (L6): a new file
 *  version compiles the rules again. */
export function vaultNarrowingStamp(settings: ResolvedVaultSettings | undefined): string {
  if (!settings) return 'none';
  return `${settings.fileState}:${settings.fileVersion ?? ''}`;
}

// ---------------------------------------------------------------------------
// Save

/** What one committed change did (CX Y5). */
export type VaultSettingSave =
  /** Written. `merged`: the file had changed elsewhere in another field, so
   *  this field was re-applied on theirs ("Saved. Some other settings
   *  changed somewhere else and show here now."). */
  | { kind: 'saved'; merged: boolean; settings: ResolvedVaultSettings }
  /** The same field changed elsewhere: nothing written. `theirs` is its value
   *  there now (undefined: the key is gone, the default holds). */
  | {
      kind: 'same-field';
      field: VaultSettingsField;
      theirs: unknown;
      yours: VaultSettingsPatch['value'];
      settings: ResolvedVaultSettings;
    }
  /** The file is not a JSON object: never overwritten, nothing written. */
  | { kind: 'unreadable' }
  /** This storage cannot save settings (no `writeConfig`). */
  | { kind: 'read-only' }
  /** The write failed or was refused twice: nothing changed. */
  | { kind: 'failed' };

export interface VaultSettingSaveDeps {
  provider: Pick<StorageProvider, 'readConfig' | 'writeConfig'>;
  resourceId: string;
  key: string;
  now?: () => number;
  core?: VaultSettingsCore;
  narrowings?: VaultNarrowingStore;
}

/** A dotted field's raw value in a file's JSON, or undefined. */
export function rawFieldValue(text: string | undefined, field: VaultSettingsField): unknown {
  if (text === undefined) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
  for (const part of field.split('.')) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(v, part)) return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The file as this device last read it. */
function fileOf(read: ConfigRead | undefined): { text: string; version: string } | undefined {
  return read?.ok ? { text: read.text, version: read.version } : undefined;
}

async function writeOnce(
  deps: VaultSettingSaveDeps,
  base: { text: string; version: string } | undefined,
  patch: VaultSettingsPatch,
  core: VaultSettingsCore,
): Promise<
  | { ok: true; text: string; version: string }
  | { ok: false; unreadable: true }
  | { ok: false; conflict: string; theirs?: { text: string; version: string } }
  | { ok: false; failed: true }
> {
  const next = core.patch(base?.text, patch);
  if (next === undefined) return { ok: false, unreadable: true };
  const guard: WriteGuard = base ? { ifMatch: base.version } : { ifAbsent: true };
  let r;
  try {
    r = await deps.provider.writeConfig!(deps.resourceId, 'oscode/vault', next, guard);
  } catch {
    return { ok: false, failed: true };
  }
  if (r.ok) return { ok: true, text: next, version: r.file.version ?? r.file.updatedAt };
  const theirs = r.theirs
    ? { text: r.theirs.text, version: r.theirs.version ?? r.theirs.updatedAt }
    : undefined;
  return { ok: false, conflict: r.conflict, ...(theirs ? { theirs } : {}) };
}

/** Save one changed field (L7, CX Y5): only that key is written, every other
 *  key (unknown and set-aside ones too) kept as found; `null` removes it. */
export async function saveVaultSetting(
  deps: VaultSettingSaveDeps,
  patch: VaultSettingsPatch,
): Promise<VaultSettingSave> {
  if (typeof deps.provider.writeConfig !== 'function') return { kind: 'read-only' };
  const core = deps.core ?? CORE;
  const store = deps.narrowings ?? sealedNarrowingStore;
  const at = (deps.now ?? (() => Date.now()))();
  let entry = cache.get(deps.key);
  if (!entry) {
    await loadVaultSettings(deps.provider, deps.resourceId, deps.key, {
      ...(deps.now ? { now: deps.now } : {}),
      core,
      narrowings: store,
    });
    entry = cache.get(deps.key);
  }
  if (!entry) return { kind: 'failed' };
  // A bad file shows every row read-only and is never overwritten.
  if (entry.settings.fileState === 'unreadable') return { kind: 'unreadable' };
  if (entry.settings.fileState === 'unavailable') return { kind: 'failed' };
  const base = fileOf(entry.reads.file);
  const first = await writeOnce(deps, base, patch, core);
  if ('unreadable' in first) return { kind: 'unreadable' };
  if ('failed' in first) return { kind: 'failed' };
  const landed = async (
    text: string,
    version: string,
    merged: boolean,
  ): Promise<VaultSettingSave> => {
    const reads: VaultSettingsReads = { ...entry!.reads, file: { ok: true, text, version } };
    const settings = await resolveEntry(deps.key, reads, at, core, store);
    return { kind: 'saved', merged, settings };
  };
  if (first.ok) return landed(first.text, first.version, false);
  if (first.conflict === 'downloading') return { kind: 'failed' };

  // Refused by compare-and-swap: read theirs (the conflict's copy, else the
  // file now), then judge the one field.
  let theirs = first.theirs;
  let theirsRead: ConfigRead | undefined;
  if (!theirs) {
    theirsRead = await readVaultConfig(deps.provider, deps.resourceId, 'oscode/vault');
    theirs = fileOf(theirsRead);
    if (!theirs && theirsRead.ok === false && theirsRead.reason !== 'absent') {
      return { kind: 'failed' };
    }
  }
  const theirsReads: VaultSettingsReads = {
    ...entry.reads,
    file: theirs ? { ok: true, ...theirs } : { ok: false, reason: 'absent' },
  };
  const theirsValue = rawFieldValue(theirs?.text, patch.field);
  if (!same(theirsValue, rawFieldValue(base?.text, patch.field))) {
    const settings = await resolveEntry(deps.key, theirsReads, at, core, store);
    return {
      kind: 'same-field',
      field: patch.field,
      theirs: theirsValue,
      yours: patch.value,
      settings,
    };
  }
  const again = await writeOnce(deps, theirs, patch, core);
  if ('unreadable' in again) {
    await resolveEntry(deps.key, theirsReads, at, core, store);
    return { kind: 'unreadable' };
  }
  if (again.ok) return landed(again.text, again.version, true);
  // Refused twice: nothing changed here; the next read shows what is there.
  clearVaultSettingsCache(deps.key);
  return { kind: 'failed' };
}

// ---------------------------------------------------------------------------
// Sheet logic (CX Y2, Y3, Y5): what a row may do and what it says, so the
// sheet (stream G) renders and never decides.

/** One row's state. `readOnly` rows are `aria-disabled` with `reason` as
 *  their description; `sub` is the neutral line under the value. */
export interface VaultSettingRowState {
  readOnly: boolean;
  /** Why the row cannot change here, when it cannot. */
  reason?: string;
  /** "From Obsidian", or "Obsidian keeps its own setting for this." */
  sub?: string;
  /** The one line a tap on a From Obsidian row fades in. */
  more?: string;
}

/** A row's state (CX Y2, Y5): a field Obsidian sets is read-only "From
 *  Obsidian"; a bad file makes every row read-only with its line; a storage
 *  that cannot save makes every row read-only with the storage's own line
 *  (`storageLine`, e.g. `vaultCapLine` or the away line). */
export function vaultSettingRow(
  settings: ResolvedVaultSettings,
  field: VaultSettingsField,
  opts: { settingsWrite: boolean; storageLine?: string },
): VaultSettingRowState {
  if (settings.source[field] === 'obsidian') {
    return {
      readOnly: true,
      reason: VAULT_SETTINGS_FROM_OBSIDIAN_MORE,
      sub: VAULT_SETTINGS_FROM_OBSIDIAN,
      more: VAULT_SETTINGS_FROM_OBSIDIAN_MORE,
    };
  }
  const own =
    settings.obsidian && OBSIDIAN_SEEDED.has(field) ? VAULT_SETTINGS_OBSIDIAN_OWN : undefined;
  if (settings.fileState === 'unreadable') {
    return { readOnly: true, reason: VAULT_SETTINGS_UNREADABLE, ...(own ? { sub: own } : {}) };
  }
  if (!opts.settingsWrite || settings.fileState === 'unavailable') {
    return {
      readOnly: true,
      ...(opts.storageLine ? { reason: opts.storageLine } : {}),
      ...(own ? { sub: own } : {}),
    };
  }
  return { readOnly: false, ...(own ? { sub: own } : {}) };
}

/** The fields Obsidian has a setting for (CTO L2's seed column), so only
 *  these say "Obsidian keeps its own setting for this." in a vault that has
 *  `.obsidian/`. */
const OBSIDIAN_SEEDED: ReadonlySet<VaultSettingsField> = new Set<VaultSettingsField>([
  'newNotes.location',
  'newNotes.folder',
  'editor.openMode',
  'delete',
  'daily.folder',
  'daily.format',
  'daily.template',
  'templates.folder',
  'templates.dateFormat',
  'templates.timeFormat',
  'links.style',
  'links.format',
  'links.updateOnRename',
  'attachments.folder',
]);

/** The quiet lines at the top of section 2 (CX Y3): one per ask the file may
 *  not make, from the schema's `plain` fragment. Keys the file got wrong or
 *  that no version knows are not asks, so they say nothing here. */
export function vaultSettingsSetAsideLines(settings: ResolvedVaultSettings): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of settings.setAside) {
    if (s.reason !== 'widens' || !s.plain || seen.has(s.plain)) continue;
    seen.add(s.plain);
    out.push(vaultSettingsSetAside(s.plain));
  }
  return out;
}

/** The status line after a save (CX Y5), or undefined for none. The
 *  same-field line names the field and theirs; the sheet adds "Use
 *  {yours}" with `vaultSettingsUseYours`. */
export function vaultSettingSaveLine(
  r: VaultSettingSave,
  label: (field: VaultSettingsField, value: unknown) => string,
): string | undefined {
  switch (r.kind) {
    case 'saved':
      return r.merged ? VAULT_SETTINGS_MERGED : VAULT_SETTINGS_SAVED;
    case 'same-field':
      return vaultSettingsSameField(VAULT_SETTINGS_FIELD_LABELS[r.field], label(r.field, r.theirs));
    case 'unreadable':
      return VAULT_SETTINGS_UNREADABLE;
    case 'failed':
      return VAULT_SETTINGS_FAILED;
    case 'read-only':
      return undefined;
  }
}
