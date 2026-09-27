// The frontmatter on a Crew run note (Vault M4, 4.9, CTO I13). Hand-written,
// never serialized by a YAML library (the vault core serializes no YAML, H2):
// every value is a JSON string, which YAML reads as a double-quoted scalar,
// so a routine named `Q3: "auth"` or a model named `qwen2.5:7b` can never be
// misread as a map, a number, or a date. The block is what lets a later run
// (or the person, in Obsidian) find this run by type, routine, and tag, and
// follow `previous` back through the routine's history.
//
// Vault M6 (6.4, CTO K7): a run note links TO the day's note (`day`), read
// from the vault's own daily-notes settings, and never creates or appends to
// it; the day's Linked mentions then show the run. The link is written only
// when the date format is one the vault core supports, so a guessed name can
// never fork the day's note.
//
// Vault M7 (CTO L9, L10): the block carries the note's provenance, the flat
// `oscode-*` keys, written by the same `mergeProvenance` every agent write
// goes through: `oscode-source: "crew"`, the model, when it started, and,
// when the scheduler judged them, where the seat ran (by address), its class,
// and a cloud seat's provider. Machine `vault.provenance: off` passes 'off'.
import { VAULT_DAILY_DEFAULTS, dailyNotePath, datePartsOf } from '../harness/vault/dates.js';
import { mergeProvenance } from '../harness/vault/provenance.js';
import type {
  ConfigRead,
  DailyNoteConfig,
  ProvSize,
  ProvWhere,
  ProvenanceFields,
} from '../harness/vault/types.js';
import { yamlString } from '../harness/vault/yamlScalar.js';

// Moved to harness/vault/yamlScalar.ts (Vault M7, CTO L10); re-exported for
// the callers that name it here.
export { yamlString };

/** The routine's own tag, `crew/<slug>`: letters, digits, `_` and `-` only,
 *  the characters an Obsidian tag keeps. Undefined when nothing is left, or
 *  when only digits are (Obsidian does not treat an all-digit tag as a tag). */
export function crewTag(folder: string): string | undefined {
  const slug = folder
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug || !/\D/.test(slug)) return undefined;
  return `crew/${slug}`;
}

/** The wikilink to an earlier run note, by its full vault path (so two
 *  routines' notes from the same minute never collide), or undefined when
 *  the path cannot be written inside `[[...]]` (a record from before the
 *  folder rule, holding a bracket, a bar, a hash, or a caret). */
export function runNoteLink(notePath: string): string | undefined {
  const target = notePath.replace(/\.md$/i, '');
  if (!target || /[[\]|#^\r\n]/.test(target)) return undefined;
  return `[[${target}]]`;
}

export interface RunNoteFields {
  routine: string;
  project: string;
  model: string;
  session: string;
  started: string;
  state: string;
  /** The routine's folder under Crew/, for its tag. */
  folder: string;
  /** The previous run note's vault path, when there is one. */
  previousPath?: string;
  /** The day's note's vault path (`runNoteDayPath`), when there is one. */
  dayPath?: string;
  /** What the scheduler knows of the seat, for the provenance lines; 'off'
   *  (machine `vault.provenance: off`) writes none. Absent still writes the
   *  source, the model, and the start. */
  provenance?: RunNoteProvenance | 'off';
}

/** The seat a run used, as the scheduler judged it at open. */
export interface RunNoteProvenance {
  /** Judged by address (`leavesThisNetwork`), never by a provider label. */
  where?: ProvWhere;
  size?: ProvSize;
  /** Cloud only; dropped for a local seat. */
  provider?: string;
}

/** The provenance fields a Crew run note carries. */
export function runNoteProvenance(f: RunNoteFields): ProvenanceFields {
  if (f.provenance === 'off') return {};
  const p = f.provenance ?? {};
  return {
    'oscode-source': 'crew',
    'oscode-model': f.model,
    ...(p.where ? { 'oscode-where': p.where } : {}),
    ...(p.size ? { 'oscode-size': p.size } : {}),
    ...(p.where === 'cloud' && p.provider ? { 'oscode-provider': p.provider } : {}),
    'oscode-created': f.started,
  };
}

/** The daily-notes settings from `obsidian/daily-notes` (Obsidian's
 *  `daily-notes.json`: `folder`, `format`, `template`, an empty one meaning
 *  the default). Absent is Obsidian's defaults; a file that cannot be read or
 *  parsed is undefined, so no link is guessed. */
export function dailyNoteConfigOf(read: ConfigRead): DailyNoteConfig | undefined {
  if (!read.ok) {
    return read.reason === 'absent'
      ? { folder: VAULT_DAILY_DEFAULTS.folder, format: VAULT_DAILY_DEFAULTS.format }
      : undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const o = parsed as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const folder = text(o.folder).replace(/^\/+|\/+$/g, '');
  const format = text(o.format) || VAULT_DAILY_DEFAULTS.format;
  const template = text(o.template);
  return { folder, format, ...(template ? { template } : {}) };
}

/** The day's note path for a run that started at `started` (the host's local
 *  clock), or undefined when the settings cannot be read or the format holds
 *  a token the vault core does not support. */
export function runNoteDayPath(started: Date, read: ConfigRead): string | undefined {
  const cfg = dailyNoteConfigOf(read);
  if (!cfg) return undefined;
  try {
    const path = dailyNotePath(datePartsOf(started), cfg);
    return path.ok ? path.path : undefined;
  } catch {
    return undefined;
  }
}

/** The note's frontmatter block, closing newline included. */
export function runNoteFrontmatter(f: RunNoteFields): string {
  const tag = crewTag(f.folder);
  const tags = ['crew', ...(tag ? [tag] : [])].map(yamlString).join(', ');
  const previous = f.previousPath ? runNoteLink(f.previousPath) : undefined;
  const day = f.dayPath ? runNoteLink(f.dayPath) : undefined;
  const lines = [
    '---',
    `type: ${yamlString('crew-run')}`,
    `routine: ${yamlString(f.routine)}`,
    `project: ${yamlString(f.project)}`,
    `model: ${yamlString(f.model)}`,
    `session: ${yamlString(f.session)}`,
    `started: ${yamlString(f.started)}`,
    `state: ${yamlString(f.state)}`,
    `tags: [${tags}]`,
    ...(previous ? [`previous: ${yamlString(previous)}`] : []),
    ...(day ? [`day: ${yamlString(day)}`] : []),
    '---',
  ];
  const block = `${lines.join('\n')}\n`;
  // The same merge every agent write goes through. It cannot skip on a block
  // built here, but if it ever did, the run note still lands, without it.
  const merged = mergeProvenance(block, runNoteProvenance(f));
  return 'text' in merged ? merged.text : block;
}
