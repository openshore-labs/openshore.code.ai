// Provenance on agent-written notes (Vault M7, CTO L9, L10): flat, one-line
// `oscode-*` frontmatter keys, merged into a note's text byte for byte, so the
// person's own keys, comments, order and line endings are untouched. The merge
// runs BEFORE the diff preview (engine `vaultWrite`, app `vaultPropose`), so
// the person approves the exact bytes; Crew notes and "Mark as reviewed" use
// the same function.
//
// The merge is a line-level text edit, never a YAML round trip (the vault
// core serializes no YAML, H2): each provenance key is one column-0 line (plus
// any indented continuation lines a hand edit left under it), replaced in
// place, removed, or appended before the closing `---`. The result is then
// re-parsed and proved: every other property deep-equal and in the same order,
// the `oscode:` marks unchanged, the provenance read back exactly, and every
// byte outside the provenance lines identical. Any miss is `skipped:
// 'verify'`, and the caller writes the approved text without provenance.
//
// Pure and import-free past the vault core (harnessPurity); values are
// written with `yamlString`.

import { readFrontmatter } from './frontmatter.js';
import { oscodeMarks } from './privacy.js';
import { yamlString } from './yamlScalar.js';
import type {
  FmValue,
  Frontmatter,
  NoteProvenance,
  ProvKey,
  ProvSize,
  ProvSource,
  ProvWhere,
  ProvenanceFields,
  ProvenanceMerge,
} from './types.js';

/** The provenance keys in the order a new block writes them. */
export const PROV_KEYS: readonly ProvKey[] = Object.freeze([
  'oscode-source',
  'oscode-model',
  'oscode-where',
  'oscode-size',
  'oscode-provider',
  'oscode-created',
  'oscode-reviewed',
] as const);

const PROV_SET: ReadonlySet<string> = new Set(PROV_KEYS);

/** One line of the frontmatter's raw text: `[start, next)` in raw, the
 *  break included; `content` is the line without its break. */
interface RawLine {
  start: number;
  next: number;
  content: string;
}

function linesOf(raw: string): RawLine[] {
  const out: RawLine[] = [];
  let i = 0;
  while (i < raw.length) {
    const nl = raw.indexOf('\n', i);
    const next = nl === -1 ? raw.length : nl + 1;
    let contentEnd = nl === -1 ? raw.length : nl;
    if (contentEnd > i && raw.charCodeAt(contentEnd - 1) === 13) contentEnd--;
    out.push({ start: i, next, content: raw.slice(i, contentEnd) });
    i = next;
  }
  return out;
}

/** The provenance key a column-0 line opens (`oscode-x:` or `oscode-x :`),
 *  or undefined. Exact spelling only: a quoted or re-cased key is the
 *  person's own property, and an append beside it fails the re-parse. */
function provKeyOf(content: string): ProvKey | undefined {
  const m = /^(oscode-[a-z]+)[ \t]*:(?:[ \t]|$)/.exec(content);
  return m && PROV_SET.has(m[1]!) ? (m[1] as ProvKey) : undefined;
}

/** A line that continues the value above it: indented, or a column-0
 *  sequence item (`key:` then `- a` is a valid block sequence). */
function continues(content: string): boolean {
  return /^[ \t]/.test(content) || /^-(?:[ \t]|$)/.test(content);
}

/** Each provenance key's span in raw: its line plus the continuation lines
 *  under it. Blank lines join a span only when a continuation line follows
 *  them. A second span for the same key is kept too (the re-parse would have
 *  refused the duplicate, so this never merges one). */
function provSpans(raw: string): Array<{ key: ProvKey; start: number; end: number }> {
  const lines = linesOf(raw);
  const spans: Array<{ key: ProvKey; start: number; end: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const key = provKeyOf(lines[i]!.content);
    if (!key) continue;
    let end = lines[i]!.next;
    let j = i + 1;
    while (j < lines.length) {
      const c = lines[j]!.content;
      if (continues(c)) {
        end = lines[j]!.next;
        j++;
        continue;
      }
      if (c.trim() === '') {
        let k = j;
        while (k < lines.length && lines[k]!.content.trim() === '') k++;
        if (k < lines.length && continues(lines[k]!.content)) {
          end = lines[k]!.next;
          j = k + 1;
          continue;
        }
      }
      break;
    }
    spans.push({ key, start: lines[i]!.start, end });
    i = j - 1;
  }
  return spans;
}

/** Raw with every provenance span cut out: what must match byte for byte. */
function withoutProv(raw: string): string {
  let out = '';
  let at = 0;
  for (const s of provSpans(raw)) {
    out += raw.slice(at, s.start);
    at = s.end;
  }
  return out + raw.slice(at);
}

/** Deep equality over parsed frontmatter values, key order included. */
function sameValue(a: FmValue, b: FmValue): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]!));
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
  const ao = a as Record<string, FmValue>;
  const bo = b as Record<string, FmValue>;
  return ak.every((k) => sameValue(ao[k]!, bo[k]!));
}

function lineFor(key: ProvKey, value: string, eol: string): string {
  return `${key}: ${yamlString(value)}${eol}`;
}

/** Set (a string) or remove (`null`) each named provenance line in `text`
 *  (L10), keeping the BOM, the note's EOL and every other byte. */
export function mergeProvenance(text: string, fields: ProvenanceFields): ProvenanceMerge {
  const wanted = PROV_KEYS.filter((k) => fields[k] !== undefined);
  if (wanted.length === 0) return { text };
  const before = readFrontmatter(text);
  if (before.state === 'invalid') return { skipped: 'invalid' };
  if (before.state === 'too-large') return { skipped: 'too-large' };

  let next: string;
  if (before.state === 'none') {
    // No block: prepend one after any BOM, in LF (a new block's EOL follows
    // the note's own when every break in it is CRLF).
    const sets = wanted.filter((k) => typeof fields[k] === 'string');
    if (sets.length === 0) return { text };
    const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    const body = text.slice(bom);
    const eol = /\r\n/.test(body) && !/(^|[^\r])\n/.test(body) ? '\r\n' : '\n';
    const block = `---${eol}${sets.map((k) => lineFor(k, fields[k]!, eol)).join('')}---${eol}`;
    next = text.slice(0, bom) + block + body;
  } else {
    // The opening line's break sets the block's EOL.
    const openNl = text.indexOf('\n', before.start);
    const eol = openNl > 0 && text.charCodeAt(openNl - 1) === 13 ? '\r\n' : '\n';
    const rawStart = openNl + 1;
    const raw = before.raw;
    if (text.slice(rawStart, rawStart + raw.length) !== raw) return { skipped: 'verify' };
    const spans = provSpans(raw);
    let out = '';
    let at = 0;
    for (const s of spans) {
      out += raw.slice(at, s.start);
      at = s.end;
      if (!wanted.includes(s.key)) out += raw.slice(s.start, s.end);
      else {
        const v = fields[s.key];
        if (typeof v === 'string') out += lineFor(s.key, v, eol);
      }
    }
    out += raw.slice(at);
    const present = new Set(spans.map((s) => s.key));
    const appended = wanted
      .filter((k) => !present.has(k) && typeof fields[k] === 'string')
      .map((k) => lineFor(k, fields[k]!, eol))
      .join('');
    if (appended) {
      if (out.length > 0 && !out.endsWith('\n')) out += eol;
      out += appended;
    }
    next = text.slice(0, rawStart) + out + text.slice(rawStart + raw.length);
  }
  return verify(text, before, next, fields) ? { text: next } : { skipped: 'verify' };
}

/** The re-parse proof (L10): the merge changed only provenance lines. */
function verify(
  text: string,
  before: Frontmatter,
  next: string,
  fields: ProvenanceFields,
): boolean {
  const after = readFrontmatter(next);
  if (after.state !== 'ok') return false;
  // Every byte outside the block, and every byte of it past the provenance
  // lines, is the note's own.
  if (before.state === 'none') {
    const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    if (next.slice(0, after.start) !== text.slice(0, bom)) return false;
    if (next.slice(after.end) !== text.slice(bom)) return false;
  } else {
    if (text.slice(before.end) !== next.slice(after.end)) return false;
    if (text.slice(0, before.start) !== next.slice(0, after.start)) return false;
  }
  if (before.state === 'ok') {
    const openOld = text.slice(before.start, text.indexOf('\n', before.start) + 1);
    const openNew = next.slice(after.start, next.indexOf('\n', after.start) + 1);
    if (openOld !== openNew) return false;
    const closeOld = text.slice(before.end - closingLength(text, before), before.end);
    const closeNew = next.slice(after.end - closingLength(next, after), after.end);
    if (closeOld !== closeNew) return false;
    if (withoutProv(before.raw) !== withoutProv(after.raw)) return false;
  } else if (withoutProv(after.raw) !== '') return false;
  // Every other property deep-equal and in order.
  const others = (fm: Frontmatter) => fm.props.filter((p) => !PROV_SET.has(p.key));
  const a = others(before);
  const b = others(after);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.key !== b[i]!.key || !sameValue(a[i]!.value, b[i]!.value)) return false;
  }
  // The `oscode:` marks are untouched.
  const ma = oscodeMarks(before);
  const mb = oscodeMarks(after);
  if (ma.length !== mb.length || ma.some((m, i) => m !== mb[i])) return false;
  // The provenance reads back exactly; a key not named keeps its old value.
  for (const key of PROV_KEYS) {
    const got = after.props.filter((p) => p.key === key);
    const want = fields[key];
    if (want === undefined) {
      const had = before.props.filter((p) => p.key === key);
      if (had.length !== got.length) return false;
      if (had.length && !sameValue(had[0]!.value, got[0]!.value)) return false;
    } else if (want === null) {
      if (got.length !== 0) return false;
    } else if (got.length !== 1 || got[0]!.value !== want) return false;
  }
  return true;
}

/** The closing `---` line's length, its break included. */
function closingLength(text: string, fm: Frontmatter): number {
  const openNl = text.indexOf('\n', fm.start);
  return fm.end - (openNl + 1) - fm.raw.length;
}

const SOURCES: ReadonlySet<string> = new Set<ProvSource>([
  'agent',
  'agent-edit',
  'crew',
  'handoff',
]);
const WHERES: ReadonlySet<string> = new Set<ProvWhere>(['local', 'cloud']);
const SIZES: ReadonlySet<string> = new Set<ProvSize>(['tiny', 'small', 'mid', 'large']);

/** An ISO 8601 date or date-time a person or the merge wrote. */
function isIsoish(s: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s) &&
    !Number.isNaN(Date.parse(s))
  );
}

/** A note's provenance from its parsed frontmatter. Reads only `oscode-*`
 *  keys, never `oscode:` (the M4 marks). */
export function readProvenance(fm: Frontmatter): NoteProvenance {
  const str = (key: ProvKey): string | undefined => {
    const v = fm.props.find((p) => p.key === key)?.value;
    return typeof v === 'string' && v.trim() ? v : undefined;
  };
  const out: NoteProvenance = {};
  const source = str('oscode-source');
  if (source && SOURCES.has(source)) out.source = source as ProvSource;
  const model = str('oscode-model');
  if (model) out.model = model;
  const where = str('oscode-where');
  if (where && WHERES.has(where)) out.where = where as ProvWhere;
  const size = str('oscode-size');
  if (size && SIZES.has(size)) out.size = size as ProvSize;
  const provider = str('oscode-provider');
  if (provider) out.provider = provider;
  const created = str('oscode-created');
  if (created && isIsoish(created)) out.created = created;
  const reviewed = str('oscode-reviewed');
  if (reviewed && isIsoish(reviewed)) out.reviewed = reviewed;
  return out;
}
