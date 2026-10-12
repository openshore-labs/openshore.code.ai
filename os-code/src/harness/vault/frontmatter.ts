// The Vault's frontmatter reader (Vault M3, tech review H2). Parses with js-yaml's
// CORE_SCHEMA, the parser Obsidian's own parseYaml is backed by, so invalid
// YAML is judged the same way; dates stay the strings the person typed, and
// there are no binary or omap types. Read-only: nothing here or anywhere in
// the vault core serializes YAML (a test greps for it), so the bytes on disk
// are only ever the bytes the person wrote.
//
// Hostile blocks are bounded: a block over 64 KB is never parsed, and the
// parsed value is walked into null-prototype objects at most 8 deep and 1,000
// values in all, so an alias bomb or a `__proto__` key cannot hurt the caller.

import { CORE_SCHEMA, load } from 'js-yaml';
import { findFrontmatter, scanNote } from './scan.js';
import { utf8Length } from './paths.js';
import type { FmProp, FmValue, Frontmatter, LinkToken } from './types.js';

export const FRONTMATTER_LIMITS = { bytes: 64 * 1024, depth: 8, values: 1000 } as const;

type Budget = { left: number };

/** A safe copy of one parsed value: null-prototype objects, depth and count
 *  capped. Past the depth cap a value becomes null; past the count cap the
 *  rest of a list or map is dropped. */
function safeCopy(v: unknown, depth: number, budget: Budget): FmValue {
  if (budget.left <= 0) return null;
  budget.left--;
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return v;
  if (typeof v !== 'object') return String(v);
  if (depth >= FRONTMATTER_LIMITS.depth) return null;
  if (Array.isArray(v)) {
    const out: FmValue[] = [];
    for (const item of v) {
      if (budget.left <= 0) break;
      out.push(safeCopy(item, depth + 1, budget));
    }
    return out;
  }
  const out = Object.create(null) as { [key: string]: FmValue };
  for (const key of Object.keys(v)) {
    if (budget.left <= 0) break;
    out[key] = safeCopy((v as Record<string, unknown>)[key], depth + 1, budget);
  }
  return out;
}

/** The strings of a list or a comma string. */
function listOf(value: FmValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === 'string') out.push(...item.split(','));
    else if (typeof item === 'number' || typeof item === 'boolean') out.push(String(item));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

function propOf(props: FmProp[], ...names: string[]): FmValue[] {
  return props.filter((p) => names.includes(p.key.toLowerCase())).map((p) => p.value);
}

/** Read a note's frontmatter. Never throws. */
export function readFrontmatter(text: string): Frontmatter {
  const range = findFrontmatter(text);
  const empty: Frontmatter = {
    state: 'none',
    start: 0,
    end: 0,
    raw: '',
    props: [],
    tags: [],
    aliases: [],
    links: [],
    keys: [],
  };
  if (!range) return empty;
  const base = { ...empty, start: range.start, end: range.end, raw: range.raw };
  if (utf8Length(range.raw) > FRONTMATTER_LIMITS.bytes) return { ...base, state: 'too-large' };
  const links: LinkToken[] = scanNote(text.slice(0, range.end)).links.filter(
    (l) => l.where === 'frontmatter',
  );
  let parsed: unknown;
  try {
    // js-yaml refuses a duplicate key, as Obsidian does.
    parsed = load(range.raw, { schema: CORE_SCHEMA });
  } catch {
    return { ...base, state: 'invalid', links };
  }
  if (parsed === null || parsed === undefined) return { ...base, state: 'ok', links };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...base, state: 'invalid', links };
  }
  const budget: Budget = { left: FRONTMATTER_LIMITS.values };
  const props: FmProp[] = [];
  for (const key of Object.keys(parsed)) {
    if (budget.left <= 0) break;
    props.push({ key, value: safeCopy((parsed as Record<string, unknown>)[key], 1, budget) });
  }
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of propOf(props, 'tags', 'tag')) {
    for (const raw of listOf(value)) {
      const tag = raw.replace(/^#+/, '').trim();
      if (!tag || !/\D/.test(tag) || seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }
  const aliases = [...new Set(propOf(props, 'aliases', 'alias').flatMap(listOf))];
  return {
    ...base,
    state: 'ok',
    props,
    tags,
    aliases,
    links,
    keys: props.map((p) => p.key),
  };
}
