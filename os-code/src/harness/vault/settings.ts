// The vault's settings (Vault M7, CTO L1 to L4, L13): one schema and one pure
// core, read by the engine, the daemon, the desktop's main process and the app
// alike. The in-vault file `.oscode/vault.json` holds conventions and
// narrowing only: anyone who can write the folder (a sync client, an Obsidian
// plugin, a teammate) can write it, so it can never widen reach. Obsidian's
// own config (`app.json`, `daily-notes.json`, `templates.json`) seeds the
// conventions and wins where it sets one (L3); OpenShore reads it and never
// writes it.
//
// The tolerant readers of Obsidian's files live here too (moved from
// app/src/lib/gitos/config.ts, which re-exports them), so the engine seeds
// from `.obsidian` exactly as the app does. Every reader and the parser never
// throw: bad JSON, a wrong type or a missing key reads as "not set", so a
// hand-edited file can only ever fall back to the defaults.
//
// Pure and import-free past the vault core (harnessPurity).

import { VAULT_DAILY_DEFAULTS } from './dates.js';
import { foldPath } from './paths.js';
import type {
  ConfigRead,
  ResolvedVaultSettings,
  VaultDeleteMode,
  VaultEditorFont,
  VaultEditorSize,
  VaultIgnoreFilters,
  VaultLinkFormat,
  VaultLinkStyle,
  VaultLinkUpdateRule,
  VaultNewNoteLocation,
  VaultOpenMode,
  VaultPackSize,
  VaultPrivacyNarrowing,
  VaultSettingsField,
  VaultSettingsFile,
  VaultSettingsParse,
  VaultSettingsPatch,
  VaultSettingsReads,
  VaultSettingsSetAside,
  VaultSettingsSource,
  VaultTreeSort,
} from './types.js';
import type { VaultContextSetting } from '../vaultContext.js';

/** Every field of the in-vault file, in CX Y1's sheet order (L2, L18). */
export const VAULT_SETTINGS_FIELDS: readonly VaultSettingsField[] = Object.freeze([
  'newNotes.location',
  'newNotes.folder',
  'editor.openMode',
  'tree.sort',
  'delete',
  'exclude',
  'localOnly.paths',
  'localOnly.tags',
  'agent.folder',
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
  'editor.font',
  'editor.size',
] as const);

/** Top-level keys the in-vault file may never hold, each set aside as
 *  `widens` with its plain fragment (L4). One test per key. */
export const WIDENING_KEYS: readonly string[] = Object.freeze([
  'context',
  'pack',
  'packSize',
  'packMaxTokens',
  'budget',
  'handoff',
  'pins',
  'dir',
  'location',
  'provider',
  'provenance',
  'include',
  'unexclude',
  'allow',
  'permissions',
  'trust',
  'cloud',
  'share',
  'memory',
] as const);

/** Entries kept per list, and characters per string, in the in-vault file. */
export const VAULT_SETTINGS_LIST_MAX = 200;
export const VAULT_SETTINGS_STRING_MAX = 512;

// ---------------------------------------------------------------------------
// Plain fragments (CTO-owned, CX Y3). Each one completes "This vault's
// settings file also asks to {plain}." so it reads as a verb phrase.

const ROOM = 'give notes more room in each chat';

/** The plain fragment for each widening key. */
export const WIDENING_PLAIN: Readonly<Record<string, string>> = Object.freeze({
  context: 'change which notes go into each chat',
  pack: ROOM,
  packSize: ROOM,
  packMaxTokens: ROOM,
  budget: ROOM,
  handoff: 'turn the handoff back on',
  pins: "pin notes to this project's chats",
  dir: 'move where this vault lives',
  location: 'move where this vault lives',
  provider: 'choose where this vault is kept or which model reads it',
  provenance: 'stop marking which notes a model wrote',
  include: 'let models see notes this computer hides',
  unexclude: 'let models see notes this computer hides',
  allow: 'let models do more with this vault',
  permissions: 'let models do more with this vault',
  trust: 'trust this vault on this computer',
  cloud: 'send notes to cloud models',
  share: 'share notes beyond this computer',
  memory: 'turn memory back on',
});

/** A field's name inside a plain fragment. */
const FIELD_LABEL: Readonly<Record<VaultSettingsField, string>> = {
  'newNotes.location': 'where new notes go',
  'newNotes.folder': 'the folder new notes go in',
  'editor.openMode': 'how notes open',
  'tree.sort': 'how notes sort',
  delete: 'what Delete does',
  exclude: 'the notes models never see',
  'localOnly.paths': 'the folders that stay on this computer',
  'localOnly.tags': 'the tags that stay on this computer',
  'agent.folder': 'where your agent writes',
  'daily.folder': "today's note folder",
  'daily.format': "today's note date format",
  'daily.template': "today's note template",
  'templates.folder': 'the templates folder',
  'templates.dateFormat': 'the template date format',
  'templates.timeFormat': 'the template time format',
  'links.style': 'the kind of link new links use',
  'links.format': 'link paths',
  'links.updateOnRename': 'what a rename does to links',
  'attachments.folder': 'the attachments folder',
  'editor.font': 'the editor font',
  'editor.size': 'the text size',
};

function shown(value: string): string {
  const s = value.trim();
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

function invalidPlain(label: string): string {
  return `set ${label} to something OpenShore cannot read`;
}

function unknownPlain(key: string): string {
  return `use a setting OpenShore does not know ("${shown(key)}")`;
}

// ---------------------------------------------------------------------------
// Tolerant JSON readers (Vault M3, CTO H5; moved here in M7, L1)

/** A config file's top-level object, copied onto a null-prototype object, or
 *  undefined for a refusal, bad JSON, or anything that is not an object. */
export function configJson(read: ConfigRead): Record<string, unknown> | undefined {
  if (!read.ok) return undefined;
  const parsed = parseObject(read.text);
  if (!parsed) return undefined;
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(parsed)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = parsed[key];
  }
  return out;
}

/** JSON text as a plain object (a BOM allowed), or undefined. */
function parseObject(text: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
  return isObject(parsed) ? parsed : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function own(o: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

/** The longest string setting kept from Obsidian's files. */
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
  /** `preview` opens notes for reading, `source` for editing. */
  defaultViewMode?: 'source' | 'preview';
  /** `none` deletes for good; `system` and `local` keep a trash. */
  trashOption?: 'system' | 'local' | 'none';
  /** Obsidian's Excluded files, as written (plain paths and `/regex/`). */
  userIgnoreFilters?: string[];
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
  const view = oneOf(j.defaultViewMode, ['source', 'preview'] as const);
  if (view) out.defaultViewMode = view;
  const trash = oneOf(j.trashOption, ['system', 'local', 'none'] as const);
  if (trash) out.trashOption = trash;
  if (Array.isArray(j.userIgnoreFilters)) {
    const filters = j.userIgnoreFilters
      .map(str)
      .filter((x): x is string => x !== undefined)
      .slice(0, VAULT_SETTINGS_LIST_MAX);
    if (filters.length) out.userIgnoreFilters = filters;
  }
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

/** Obsidian's Excluded files, split (L2): plain paths leave notes out of
 *  search and suggestions; a `/regex/` entry is skipped and counted. Not
 *  privacy. */
export function obsidianIgnoreFilters(app: ObsidianAppConfig): VaultIgnoreFilters {
  const paths: string[] = [];
  let regexSkipped = 0;
  for (const raw of app.userIgnoreFilters ?? []) {
    if (raw.length > 2 && raw.startsWith('/') && raw.endsWith('/')) regexSkipped++;
    else if (raw.length <= VAULT_SETTINGS_STRING_MAX) paths.push(raw.replace(/\\/g, '/'));
  }
  return { paths, regexSkipped };
}

/** Whether a note is left out of retrieval (L2): anything under the
 *  templates folder (a template is scaffolding, not a note on the task),
 *  and anything Obsidian's plain ignore filters name, matched as a path
 *  prefix the way Obsidian matches them. Not privacy: a pinned note the
 *  person placed still rides, and no copy says models do not see these.
 *  Folded (NFC, lowercase) for the compare only. */
export function retrievalSkipped(
  path: string,
  settings: Pick<ResolvedVaultSettings, 'templates' | 'ignore'> | undefined,
): boolean {
  if (!settings) return false;
  const p = foldPath(path.replace(/\\/g, '/'));
  const under = (folder: string | undefined): boolean => {
    const f = foldPath((folder ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
    return f !== '' && (p === f || p.startsWith(`${f}/`));
  };
  if (under(settings.templates.folder)) return true;
  for (const raw of settings.ignore.paths) {
    const f = foldPath(raw.replace(/^\/+/, ''));
    if (f && p.startsWith(f)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The defaults: exactly today's behavior with no config anywhere (L18)

/** Every field from nowhere. */
function allSources(source: VaultSettingsSource): Record<VaultSettingsField, VaultSettingsSource> {
  const out = {} as Record<VaultSettingsField, VaultSettingsSource>;
  for (const f of VAULT_SETTINGS_FIELDS) out[f] = source;
  return out;
}

function freezeDeep<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const k of Object.keys(v)) freezeDeep((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

/** The vault's settings with no file anywhere: today's behavior, pinned by
 *  the no-config parity tests (L18). A new note goes in the folder in view;
 *  notes open for reading (a fresh note still edits); the tree sorts by name;
 *  Delete moves to Trash; links are shortest-path wikilinks and a rename
 *  asks; today's note is `YYYY-MM-DD` at the root with no template; the
 *  editor keeps the platform's face and size; the agent may write anywhere;
 *  the file narrows nothing. */
export const VAULT_SETTINGS_DEFAULTS: Readonly<ResolvedVaultSettings> = freezeDeep({
  newNotes: { location: 'current' },
  daily: { folder: VAULT_DAILY_DEFAULTS.folder, format: VAULT_DAILY_DEFAULTS.format },
  templates: {
    dateFormat: VAULT_DAILY_DEFAULTS.format,
    timeFormat: VAULT_DAILY_DEFAULTS.timeFormat,
  },
  attachments: {},
  links: { style: 'wiki', format: 'shortest', updateOnRename: 'ask' },
  editor: { openMode: 'read', font: 'default', size: 'default' },
  tree: { sort: 'name' },
  delete: 'trash',
  agent: {},
  narrowing: { exclude: [], localOnly: { paths: [], tags: [] } },
  ignore: { paths: [], regexSkipped: 0 },
  source: allSources('default'),
  setAside: [],
  fileState: 'absent',
  obsidian: false,
} satisfies ResolvedVaultSettings);

// ---------------------------------------------------------------------------
// Parse `.oscode/vault.json` (L2, L4)

type Folder = { ok: string } | { bad: 'invalid' | 'climbs' | 'dot' };

/** A folder in the in-vault file: vault-relative, `/` separated, no leading
 *  slash, no `..`, no dot segment, trailing slashes dropped. */
function vaultFolder(v: string): Folder {
  const s = v.trim().replace(/\\/g, '/');
  if (!s || s.length > VAULT_SETTINGS_STRING_MAX) return { bad: 'invalid' };
  if (s.startsWith('/')) return { bad: 'climbs' };
  const segs = s.replace(/\/+$/, '').split('/');
  if (segs.some((x) => x.trim() === '..')) return { bad: 'climbs' };
  if (segs.some((x) => x.trim() === '')) return { bad: 'invalid' };
  if (segs.some((x) => x.trim().startsWith('.'))) return { bad: 'dot' };
  return { ok: segs.map((x) => x.trim()).join('/') };
}

/** Obsidian's attachment form: `/` (the root), `./` (beside the note),
 *  `./sub`, or a vault folder. */
function attachmentFolder(v: string): string | undefined {
  const s = v.trim().replace(/\\/g, '/');
  if (s === '/' || s === './') return s;
  if (s.startsWith('./')) {
    const rest = vaultFolder(s.slice(2));
    return 'ok' in rest ? `./${rest.ok}` : undefined;
  }
  const f = vaultFolder(s);
  return 'ok' in f ? f.ok : undefined;
}

function scalar(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s && s.length <= VAULT_SETTINGS_STRING_MAX ? s : undefined;
}

const ENUMS = {
  'newNotes.location': ['root', 'current', 'folder'],
  'editor.openMode': ['read', 'edit'],
  'editor.font': ['default', 'serif', 'mono'],
  'editor.size': ['smaller', 'default', 'larger'],
  'tree.sort': ['name', 'modified', 'created'],
  delete: ['trash', 'permanent'],
  'links.style': ['wiki', 'markdown'],
  'links.format': ['shortest', 'relative', 'absolute'],
  'links.updateOnRename': ['ask', 'always'],
} as const satisfies Partial<Record<VaultSettingsField, readonly string[]>>;

/** How each scalar field reads a value. */
type Kind = 'enum' | 'folder' | 'text' | 'attachment' | 'agent';
const SCALAR_KIND: Readonly<Partial<Record<VaultSettingsField, Kind>>> = {
  'newNotes.location': 'enum',
  'newNotes.folder': 'folder',
  'editor.openMode': 'enum',
  'editor.font': 'enum',
  'editor.size': 'enum',
  'tree.sort': 'enum',
  delete: 'enum',
  'agent.folder': 'agent',
  'daily.folder': 'folder',
  'daily.format': 'text',
  'daily.template': 'folder',
  'templates.folder': 'folder',
  'templates.dateFormat': 'text',
  'templates.timeFormat': 'text',
  'links.style': 'enum',
  'links.format': 'enum',
  'links.updateOnRename': 'enum',
  'attachments.folder': 'attachment',
};

const LIST_FIELDS: ReadonlySet<VaultSettingsField> = new Set([
  'exclude',
  'localOnly.paths',
  'localOnly.tags',
]);

/** The known sections and the fields under each (a top-level field maps to
 *  itself). */
const SECTIONS: ReadonlyMap<string, readonly string[] | null> = (() => {
  const m = new Map<string, string[] | null>();
  for (const f of VAULT_SETTINGS_FIELDS) {
    const [top, sub] = f.split('.') as [string, string | undefined];
    if (sub === undefined) m.set(top, null);
    else m.set(top, [...(m.get(top) ?? []), sub]);
  }
  return m;
})();

/** The value a field holds in a parsed file, or undefined. */
function getField(file: VaultSettingsFile, field: VaultSettingsField): unknown {
  const [top, sub] = field.split('.') as [string, string | undefined];
  const v = (file as Record<string, unknown>)[top];
  if (sub === undefined) return v;
  return isObject(v) ? v[sub] : undefined;
}

function setField(file: VaultSettingsFile, field: VaultSettingsField, value: unknown): void {
  const [top, sub] = field.split('.') as [string, string | undefined];
  const f = file as Record<string, unknown>;
  if (sub === undefined) {
    f[top] = value;
    return;
  }
  const sec = isObject(f[top]) ? (f[top] as Record<string, unknown>) : {};
  sec[sub] = value;
  f[top] = sec;
}

/** Parse `.oscode/vault.json` as an allow-list (L4). Never throws;
 *  `unreadable` for bad JSON or a non-object top level. A widening key, a
 *  `!` entry, or an agent folder that climbs or names a dot folder is set
 *  aside as `widens`; any other key `unknown`; a known key of the wrong type
 *  `invalid`, and the rest still applies. */
export function parseVaultSettingsFile(text: string): VaultSettingsParse {
  if (typeof text !== 'string') return { unreadable: true };
  const obj = parseObject(text);
  if (!obj) return { unreadable: true };
  const file: VaultSettingsFile = {};
  const setAside: VaultSettingsSetAside[] = [];
  const aside = (key: string, reason: VaultSettingsSetAside['reason'], plain: string): void => {
    setAside.push({ key, reason, plain });
  };

  for (const top of Object.keys(obj)) {
    const v = obj[top];
    if (top === 'version') {
      if (v === 1) file.version = 1;
      else aside('version', 'invalid', 'use a settings format OpenShore does not know');
      continue;
    }
    if (WIDENING_KEYS.includes(top)) {
      aside(top, 'widens', WIDENING_PLAIN[top] ?? unknownPlain(top));
      continue;
    }
    if (!SECTIONS.has(top)) {
      aside(top, 'unknown', unknownPlain(top));
      continue;
    }
    const subs = SECTIONS.get(top);
    if (subs === null || subs === undefined) {
      readField(top as VaultSettingsField, v, file, aside);
      continue;
    }
    if (!isObject(v)) {
      aside(top, 'invalid', invalidPlain(FIELD_LABEL[`${top}.${subs[0]}` as VaultSettingsField]));
      continue;
    }
    for (const sub of Object.keys(v)) {
      const key = `${top}.${sub}`;
      if (!subs.includes(sub)) {
        if (WIDENING_KEYS.includes(sub))
          aside(key, 'widens', WIDENING_PLAIN[sub] ?? unknownPlain(key));
        else aside(key, 'unknown', unknownPlain(key));
        continue;
      }
      readField(key as VaultSettingsField, v[sub], file, aside);
    }
  }
  return { file, setAside };
}

function readField(
  field: VaultSettingsField,
  v: unknown,
  file: VaultSettingsFile,
  aside: (key: string, reason: VaultSettingsSetAside['reason'], plain: string) => void,
): void {
  const label = FIELD_LABEL[field];
  if (LIST_FIELDS.has(field)) {
    readList(field, v, file, aside);
    return;
  }
  const kind = SCALAR_KIND[field];
  const s = scalar(v);
  if (s === undefined) {
    aside(field, 'invalid', invalidPlain(label));
    return;
  }
  switch (kind) {
    case 'enum': {
      const allowed = ENUMS[field as keyof typeof ENUMS] as readonly string[];
      if (allowed.includes(s)) setField(file, field, s);
      else aside(field, 'invalid', invalidPlain(label));
      return;
    }
    case 'folder': {
      const f = vaultFolder(s);
      if ('ok' in f) setField(file, field, f.ok);
      else aside(field, 'invalid', invalidPlain(label));
      return;
    }
    case 'attachment': {
      const a = attachmentFolder(s);
      if (a !== undefined) setField(file, field, a);
      else aside(field, 'invalid', invalidPlain(label));
      return;
    }
    case 'agent': {
      const f = vaultFolder(s);
      if ('ok' in f) setField(file, field, f.ok);
      else if (f.bad === 'climbs')
        aside(field, 'widens', 'let your agent write outside this vault');
      else if (f.bad === 'dot') aside(field, 'widens', `let your agent write in "${shown(s)}"`);
      else aside(field, 'invalid', invalidPlain(label));
      return;
    }
    default:
      setField(file, field, s);
  }
}

/** The plain fragment for a `!` entry in a list (it would lift a rule). */
function negatedPlain(field: VaultSettingsField, rest: string): string {
  const what = shown(rest);
  if (field === 'exclude') return `let models see "${what}"`;
  if (field === 'localOnly.tags')
    return `send notes tagged #${what.replace(/^#/, '')} to cloud models`;
  return `send "${what}" to cloud models`;
}

function readList(
  field: VaultSettingsField,
  v: unknown,
  file: VaultSettingsFile,
  aside: (key: string, reason: VaultSettingsSetAside['reason'], plain: string) => void,
): void {
  const label = FIELD_LABEL[field];
  if (!Array.isArray(v)) {
    aside(field, 'invalid', invalidPlain(label));
    return;
  }
  const out: string[] = [];
  v.forEach((entry, i) => {
    const key = `${field}[${i}]`;
    const s = scalar(entry);
    if (s === undefined) {
      aside(key, 'invalid', invalidPlain(label));
      return;
    }
    if (s.startsWith('!')) {
      aside(key, 'widens', negatedPlain(field, s.slice(1)));
      return;
    }
    out.push(s);
  });
  if (out.length > VAULT_SETTINGS_LIST_MAX) {
    aside(
      `${field}[${VAULT_SETTINGS_LIST_MAX}]`,
      'invalid',
      `keep more than ${VAULT_SETTINGS_LIST_MAX} entries in ${label}`,
    );
    out.length = VAULT_SETTINGS_LIST_MAX;
  }
  setField(file, field, out);
}

// ---------------------------------------------------------------------------
// Resolve (L3): Obsidian's convention wins, then the vault file, then default

/** A field's resolved value and where it came from. */
function pick<T>(
  obsidian: T | undefined,
  vault: T | undefined,
  fallback: T,
): { value: T; source: VaultSettingsSource } {
  if (obsidian !== undefined) return { value: obsidian, source: 'obsidian' };
  if (vault !== undefined) return { value: vault, source: 'vault' };
  return { value: fallback, source: 'default' };
}

/** Resolve every field by L3's precedence from the four reads. No file
 *  anywhere gives exactly `VAULT_SETTINGS_DEFAULTS`. Never throws. */
export function resolveVaultSettings(reads: VaultSettingsReads): ResolvedVaultSettings {
  const D = VAULT_SETTINGS_DEFAULTS;
  const app = readObsidianAppConfig(reads.app);
  const od = readDailyNotesConfig(reads.daily);
  const ot = readTemplatesConfig(reads.templates);

  let file: VaultSettingsFile = {};
  let setAside: VaultSettingsSetAside[] = [];
  let fileState: ResolvedVaultSettings['fileState'];
  const fr = reads.file;
  if (fr.ok) {
    const parsed = parseVaultSettingsFile(fr.text);
    if ('unreadable' in parsed) fileState = 'unreadable';
    else {
      fileState = 'ok';
      file = parsed.file;
      setAside = parsed.setAside;
    }
  } else fileState = fr.reason === 'absent' ? 'absent' : 'unavailable';

  const source = allSources('default');
  const at = <T>(field: VaultSettingsField, obs: T | undefined, fallback: T): T => {
    const r = pick(obs, getField(file, field) as T | undefined, fallback);
    source[field] = r.source;
    return r.value;
  };
  const opt = <T>(field: VaultSettingsField, obs: T | undefined): T | undefined =>
    at<T | undefined>(field, obs, undefined);

  const location = at<VaultNewNoteLocation>(
    'newNotes.location',
    app.newFileLocation,
    D.newNotes.location,
  );
  const newFolder = opt<string>('newNotes.folder', app.newFileFolderPath);
  const openMode = at<VaultOpenMode>(
    'editor.openMode',
    app.defaultViewMode === undefined
      ? undefined
      : app.defaultViewMode === 'preview'
        ? 'read'
        : 'edit',
    D.editor.openMode,
  );
  const sort = at<VaultTreeSort>('tree.sort', undefined, D.tree.sort);
  const del = at<VaultDeleteMode>(
    'delete',
    app.trashOption === undefined ? undefined : app.trashOption === 'none' ? 'permanent' : 'trash',
    D.delete,
  );
  const exclude = at<readonly string[]>('exclude', undefined, []);
  const localPaths = at<readonly string[]>('localOnly.paths', undefined, []);
  const localTags = at<readonly string[]>('localOnly.tags', undefined, []);
  const agentFolder = opt<string>('agent.folder', undefined);
  const dailyFolder = at<string>('daily.folder', od.folder, D.daily.folder);
  const dailyFormat = at<string>('daily.format', od.format, D.daily.format);
  const dailyTemplate = opt<string>('daily.template', od.template);
  const tplFolder = opt<string>('templates.folder', ot.folder);
  const tplDate = at<string>('templates.dateFormat', ot.dateFormat, D.templates.dateFormat);
  const tplTime = at<string>('templates.timeFormat', ot.timeFormat, D.templates.timeFormat);
  const style = at<VaultLinkStyle>(
    'links.style',
    app.useMarkdownLinks === undefined ? undefined : app.useMarkdownLinks ? 'markdown' : 'wiki',
    D.links.style,
  );
  const format = at<VaultLinkFormat>('links.format', app.newLinkFormat, D.links.format);
  const update = at<VaultLinkUpdateRule>(
    'links.updateOnRename',
    app.alwaysUpdateLinks === undefined ? undefined : app.alwaysUpdateLinks ? 'always' : 'ask',
    D.links.updateOnRename,
  );
  const attach = opt<string>('attachments.folder', app.attachmentFolderPath);
  const font = at<VaultEditorFont>('editor.font', undefined, D.editor.font);
  const size = at<VaultEditorSize>('editor.size', undefined, D.editor.size);

  return {
    newNotes: { location, ...(newFolder !== undefined ? { folder: newFolder } : {}) },
    daily: {
      folder: dailyFolder,
      format: dailyFormat,
      ...(dailyTemplate !== undefined ? { template: dailyTemplate } : {}),
    },
    templates: {
      ...(tplFolder !== undefined ? { folder: tplFolder } : {}),
      dateFormat: tplDate,
      timeFormat: tplTime,
    },
    attachments: attach !== undefined ? { folder: attach } : {},
    links: { style, format, updateOnRename: update },
    editor: { openMode, font, size },
    tree: { sort },
    delete: del,
    agent: agentFolder !== undefined ? { folder: agentFolder } : {},
    narrowing: {
      exclude: [...exclude],
      localOnly: { paths: [...localPaths], tags: [...localTags] },
    },
    ignore: obsidianIgnoreFilters(app),
    source,
    setAside,
    fileState,
    ...(fr.ok ? { fileVersion: fr.version } : {}),
    obsidian: reads.app.ok || reads.daily.ok || reads.templates.ok,
  };
}

// ---------------------------------------------------------------------------
// Union (L4)

/** The union of several narrowings (L4): lists join in order with exact
 *  duplicates dropped, nothing is removed, so an empty list can never drop
 *  an entry another part holds. */
export function unionNarrowing(
  ...parts: Array<VaultPrivacyNarrowing | undefined>
): VaultPrivacyNarrowing {
  const exclude: string[] = [];
  const paths: string[] = [];
  const tags: string[] = [];
  const add = (into: string[], list: readonly unknown[] | undefined): void => {
    if (!Array.isArray(list)) return;
    for (const x of list) if (typeof x === 'string' && !into.includes(x)) into.push(x);
  };
  for (const p of parts) {
    if (!p) continue;
    add(exclude, p.exclude);
    add(paths, p.localOnly?.paths);
    add(tags, p.localOnly?.tags);
  }
  return { exclude, localOnly: { paths, tags } };
}

// ---------------------------------------------------------------------------
// Patch (L7): the settings writer's next text

/** The file's next text with one field changed (L7), or undefined when
 *  `current` is present and not a JSON object (never overwrite it). Unknown
 *  and set-aside keys are kept as found; `JSON.stringify(obj, null, 2) +
 *  "\n"`. `current` undefined starts a new `{ "version": 1 }` file. A `null`
 *  value ("Default") removes the key, and a section it leaves empty. Throws
 *  a TypeError for a list value on a scalar field or the reverse (a caller's
 *  bug, never a file's). */
export function patchVaultSettingsFile(
  current: string | undefined,
  patch: VaultSettingsPatch,
): string | undefined {
  const { field, value } = patch;
  if (!VAULT_SETTINGS_FIELDS.includes(field)) throw new TypeError(`unknown vault setting ${field}`);
  if (value !== null) {
    const isList = Array.isArray(value);
    if (isList !== LIST_FIELDS.has(field)) {
      throw new TypeError(
        `vault setting ${field} takes ${LIST_FIELDS.has(field) ? 'a list' : 'a string'}`,
      );
    }
    if (isList && (value as readonly unknown[]).some((x) => typeof x !== 'string')) {
      throw new TypeError(`vault setting ${field} takes a list of strings`);
    }
  }
  let obj: Record<string, unknown>;
  if (current === undefined) obj = { version: 1 };
  else {
    const parsed = parseObject(current);
    if (!parsed) return undefined;
    obj = parsed;
  }
  const [top, sub] = field.split('.') as [string, string | undefined];
  const next = value === null ? undefined : Array.isArray(value) ? [...value] : value;
  if (sub === undefined) {
    if (next === undefined) delete obj[top];
    else obj[top] = next;
  } else {
    const had = own(obj, top) && isObject(obj[top]);
    const sec: Record<string, unknown> = had ? (obj[top] as Record<string, unknown>) : {};
    if (next === undefined) {
      delete sec[sub];
      if (had && Object.keys(sec).length === 0) delete obj[top];
    } else {
      sec[sub] = next;
      obj[top] = sec;
    }
  }
  return `${JSON.stringify(obj, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Reach switches (L13): the humanizerEnabled shape, off wins

/** Whether the vault context pack is on (L13): machine or project `off`
 *  wins, and the app's override only ever turns it off. `machine` and
 *  `project` are `vault.context` as each holds it (on the engine the loaded
 *  config already carries both, so `project` may be undefined). */
export function vaultContextOn(
  machine: VaultContextSetting | undefined,
  project: VaultContextSetting | undefined,
  app: 'off' | undefined,
): boolean {
  return machine !== 'off' && project !== 'off' && app !== 'off';
}

/** Whether the handoff is written and read (L13, CTO reconciliation 4):
 *  true only when machine `vault.handoff`, the project and the app all allow
 *  it. */
export function vaultHandoffOn(
  machine: 'auto' | 'off' | undefined,
  project: 'auto' | 'off' | undefined,
  app: 'off' | undefined,
): boolean {
  return machine !== 'off' && project !== 'off' && app !== 'off';
}

const PACK_SIZE_ORDER: readonly VaultPackSize[] = ['small', 'normal', 'large'];

function packSizeOr(v: unknown, fallback: VaultPackSize): VaultPackSize {
  return PACK_SIZE_ORDER.includes(v as VaultPackSize) ? (v as VaultPackSize) : fallback;
}

/** The pack size in force (L13): the app may only lower the machine's. An
 *  unknown value reads as not set. */
export function vaultPackSize(
  machine: VaultPackSize | undefined,
  app: VaultPackSize | undefined,
): VaultPackSize {
  const m = packSizeOr(machine, 'normal');
  const a = packSizeOr(app, m);
  return PACK_SIZE_ORDER.indexOf(a) < PACK_SIZE_ORDER.indexOf(m) ? a : m;
}
