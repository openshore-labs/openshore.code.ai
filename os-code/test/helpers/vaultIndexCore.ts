// The core the index tests and the bench feed the Vault index (Vault M3 H3).
//
// The index takes its grammar and resolution as an injected VaultIndexCore, so
// it never imports stream A's files. `loadVaultIndexCore()` hands back the real
// shared core (scan.ts, frontmatter.ts, resolve.ts, paths.ts) when those files
// exist on this tree, and this small stand-in when they do not yet, so the
// index branch and the core branch merge in either order. `coreKind` says
// which one ran. The stand-in covers only what the index tests lean on: plain
// wikilinks and markdown links, fences and %% comments skipped, `#tags`, ATX
// headings, block ids, and a key: value frontmatter with tags and aliases.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { VaultIndexCore } from '../../src/harness/vault/index.js';
import type {
  Frontmatter,
  FrontmatterRange,
  LinkToken,
  NoteScan,
  SkippedRange,
  VaultPathIndex,
} from '../../src/harness/vault/types.js';

const VAULT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/harness/vault');

// ---------------------------------------------------------------------------
// The stand-in

function frontmatterRange(text: string): FrontmatterRange | null {
  const off = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const open = /^---[ \t]*\r?\n/.exec(text.slice(off));
  if (!open) return null;
  const from = off + open[0].length;
  const close = /^---[ \t]*(\r?\n|$)/m;
  const rest = text.slice(from);
  const m = close.exec(rest);
  if (!m) return null;
  return { start: 0, end: from + m.index + m[0].length, raw: rest.slice(0, m.index) };
}

function skippedRanges(text: string, from: number): SkippedRange[] {
  const out: SkippedRange[] = [];
  const fence = /^[ \t>]*(`{3,}|~{3,})[^\n]*$/gm;
  fence.lastIndex = from;
  for (let m = fence.exec(text); m; m = fence.exec(text)) {
    const marker = m[1]!;
    const closeRe = new RegExp(
      `^[ \\t>]*${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`,
      'gm',
    );
    closeRe.lastIndex = m.index + m[0].length + 1;
    const c = closeRe.exec(text);
    const end = c ? c.index + c[0].length : text.length;
    out.push({ kind: 'fence', start: m.index, end });
    fence.lastIndex = end;
  }
  const inside = (i: number) => out.some((r) => i >= r.start && i < r.end);
  const more: SkippedRange[] = [];
  for (const m of text.slice(from).matchAll(/%%[\s\S]*?%%/g)) {
    const start = from + m.index!;
    if (!inside(start)) more.push({ kind: 'comment', start, end: start + m[0].length });
  }
  for (const m of text.slice(from).matchAll(/`[^`\n]+`/g)) {
    const start = from + m.index!;
    if (!inside(start)) more.push({ kind: 'code-span', start, end: start + m[0].length });
  }
  return [...out, ...more].sort((a, b) => a.start - b.start);
}

const WIKI = /(!?)\[\[([^[\]|#^\n]*)(?:#([^[\]|\n]*))?(?:\|([^[\]\n]*))?\]\]/g;
const MDLINK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g;

function wikilinks(text: string, from: number, to: number, where: LinkToken['where']) {
  const out: LinkToken[] = [];
  WIKI.lastIndex = from;
  for (let m = WIKI.exec(text); m && m.index < to; m = WIKI.exec(text)) {
    const targetStart = m.index + m[1]!.length + 2;
    const target = m[2]!;
    const link: LinkToken = {
      kind: 'wiki',
      start: m.index,
      end: m.index + m[0].length,
      target,
      targetStart,
      targetEnd: targetStart + target.length,
      embed: m[1] === '!',
      where,
    };
    if (m[3] !== undefined) link.subpath = m[3];
    if (m[4] !== undefined) link.alias = m[4];
    out.push(link);
  }
  return out;
}

export function stubScanNote(text: string): NoteScan {
  const frontmatter = frontmatterRange(text);
  const bodyFrom = frontmatter?.end ?? 0;
  const skipped = skippedRanges(text, bodyFrom);
  const free = (i: number) => !skipped.some((r) => i >= r.start && i < r.end);
  const links: LinkToken[] = [];
  if (frontmatter) links.push(...wikilinks(text, 0, frontmatter.end, 'frontmatter'));
  links.push(...wikilinks(text, bodyFrom, text.length, 'body').filter((l) => free(l.start)));
  MDLINK.lastIndex = bodyFrom;
  for (let m = MDLINK.exec(text); m; m = MDLINK.exec(text)) {
    if (!free(m.index)) continue;
    const dest = m[3]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith('//') || dest.startsWith('#'))
      continue;
    const [pathPart, sub] = dest.split('#');
    let target = pathPart!;
    try {
      target = decodeURIComponent(target);
    } catch {}
    const ext = /\.([A-Za-z0-9]+)$/.exec(target)?.[1];
    const targetStart = m.index + m[1]!.length + m[2]!.length + 3;
    const link: LinkToken = {
      kind: 'md',
      start: m.index,
      end: m.index + m[0].length,
      target,
      targetStart,
      targetEnd: targetStart + pathPart!.length,
      embed: m[1] === '!',
      where: 'body',
      alias: m[2]!,
    };
    if (sub !== undefined) link.subpath = sub;
    if (ext && ext.toLowerCase() !== 'md') link.attachment = true;
    links.push(link);
  }
  links.sort((a, b) => a.start - b.start);
  const tags = [];
  for (const m of text.slice(bodyFrom).matchAll(/(^|[\s(,])#([\p{L}\p{N}_\-/]+)/gu)) {
    const start = bodyFrom + m.index! + m[1]!.length;
    if (!free(start) || /^\d+$/.test(m[2]!)) continue;
    tags.push({ start, end: start + 1 + m[2]!.length, tag: m[2]! });
  }
  const headings = [];
  const blockIds = [];
  const lines = text.split('\n');
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (at >= bodyFrom && free(at)) {
      const h = /^(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
      if (h) {
        const level = h[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
        headings.push({ start: at, end: at + line.length, level, text: h[2] ?? '', line: i });
      }
      const b = /\s\^([A-Za-z0-9-]+)\s*$/.exec(line);
      if (b) blockIds.push({ start: at + b.index, end: at + line.length, id: b[1]!, line: i });
    }
    at += line.length + 1;
  }
  return {
    frontmatter,
    links,
    tags,
    headings,
    blockIds,
    skipped,
    capped: { links: false, tags: false, headings: false },
  };
}

function listOrComma(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  const items = Array.isArray(v) ? v : v.split(',');
  return items.map((s) => s.trim().replace(/^#/, '')).filter(Boolean);
}

export function stubReadFrontmatter(text: string): Frontmatter {
  const r = frontmatterRange(text);
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
  if (!r) return empty;
  const values = new Map<string, string | string[]>();
  let last: string | undefined;
  for (const line of r.raw.split(/\r?\n/)) {
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && last) {
      const prev = values.get(last);
      values.set(last, [...(Array.isArray(prev) ? prev : []), item[1]!.trim()]);
      continue;
    }
    const kv = /^([^:\s][^:]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.trim();
    if (values.has(key))
      return { ...empty, state: 'invalid', start: r.start, end: r.end, raw: r.raw };
    last = key;
    values.set(key, kv[2]!.trim().replace(/^\[(.*)\]$/, '$1'));
  }
  const keys = [...values.keys()];
  return {
    state: 'ok',
    start: r.start,
    end: r.end,
    raw: r.raw,
    props: keys.map((key) => ({ key, value: values.get(key)! })),
    tags: listOrComma(values.get('tags') ?? values.get('tag')),
    aliases: listOrComma(values.get('aliases') ?? values.get('alias')),
    links: wikilinks(text, 0, r.end, 'frontmatter'),
    keys,
  };
}

interface StubPathIndex extends VaultPathIndex {
  byFold: Map<string, string[]>;
  byBase: Map<string, string[]>;
}

const foldPath = (p: string) => p.normalize('NFC').toLowerCase();
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function stubBuildPathIndex(paths: readonly string[]): VaultPathIndex {
  const byFold = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  for (const p of paths) {
    const f = foldPath(p);
    byFold.set(f, [...(byFold.get(f) ?? []), p]);
    const b = baseOf(f);
    byBase.set(b, [...(byBase.get(b) ?? []), p]);
  }
  const idx: StubPathIndex = { kind: 'vault-path-index', paths: [...paths], byFold, byBase };
  return idx;
}

function joinRelative(folder: string, rel: string): string | undefined {
  const parts = folder ? folder.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function pickExact(hits: string[] | undefined, want: string): string | undefined {
  if (!hits || hits.length === 0) return undefined;
  return hits.find((h) => h === want) ?? [...hits].sort()[0];
}

export function stubResolveWikilink(
  target: string,
  index: VaultPathIndex,
  sourcePath?: string,
): string | undefined {
  const idx = index as StubPathIndex;
  const t = target.trim();
  if (!t) return undefined;
  const cands = /\.md$/i.test(t) ? [`${t}.md`, t] : [`${t}.md`];
  const folder = sourcePath ? sourcePath.slice(0, Math.max(0, sourcePath.lastIndexOf('/'))) : '';
  for (const c of cands) {
    const exact = pickExact(idx.byFold.get(foldPath(c)), c);
    if (exact) return exact;
    const rel = joinRelative(folder, c);
    if (rel !== undefined && (c.startsWith('.') || folder)) {
      const hit = pickExact(idx.byFold.get(foldPath(rel)), rel);
      if (hit) return hit;
    }
    const f = foldPath(c);
    const suffix = (idx.byBase.get(baseOf(f)) ?? []).filter(
      (p) => foldPath(p) === f || foldPath(p).endsWith(`/${f}`),
    );
    if (suffix.length > 0) {
      return suffix.sort((a, b) => {
        const af = a.startsWith(`${folder}/`) ? 0 : 1;
        const bf = b.startsWith(`${folder}/`) ? 0 : 1;
        return (
          af - bf ||
          a.split('/').length - b.split('/').length ||
          a.length - b.length ||
          (a < b ? -1 : a > b ? 1 : 0)
        );
      })[0];
    }
  }
  return undefined;
}

export function stubResolveMarkdownLink(
  href: string,
  sourcePath: string,
  index: VaultPathIndex,
): string | undefined {
  const idx = index as StubPathIndex;
  const withExt = /\.md$/i.test(href) ? href : `${href}.md`;
  const folder = sourcePath.slice(0, Math.max(0, sourcePath.lastIndexOf('/')));
  const rel = href.startsWith('/') ? withExt.slice(1) : joinRelative(folder, withExt);
  if (rel === undefined) return undefined;
  return (
    pickExact(idx.byFold.get(foldPath(rel)), rel) ??
    pickExact(idx.byFold.get(foldPath(withExt)), withExt)
  );
}

export const stubVaultIndexCore: VaultIndexCore = {
  scanNote: stubScanNote,
  readFrontmatter: stubReadFrontmatter,
  buildPathIndex: stubBuildPathIndex,
  resolveWikilink: stubResolveWikilink,
  resolveMarkdownLink: stubResolveMarkdownLink,
};

// ---------------------------------------------------------------------------
// The loader

export type CoreKind = 'shared-core' | 'stand-in';

/** The real shared core when stream A's files are on this tree, else the
 *  stand-in. A computed specifier, so this compiles before those files
 *  exist. */
export async function loadVaultIndexCore(): Promise<{ core: VaultIndexCore; coreKind: CoreKind }> {
  const files = ['scan', 'frontmatter', 'resolve', 'paths'].map((n) => join(VAULT_SRC, `${n}.ts`));
  if (files.every((f) => existsSync(f))) {
    try {
      const [scan, fm, res, paths] = await Promise.all(
        files.map((f) => import(pathToFileURL(f).href) as Promise<Record<string, unknown>>),
      );
      const core = {
        scanNote: scan!.scanNote,
        readFrontmatter: fm!.readFrontmatter,
        buildPathIndex: res!.buildPathIndex,
        resolveWikilink: res!.resolveWikilink,
        resolveMarkdownLink: res!.resolveMarkdownLink,
        normalizeNotePath: paths!.normalizeNotePath,
      };
      if (Object.values(core).every((f) => typeof f === 'function')) {
        return { core: core as unknown as VaultIndexCore, coreKind: 'shared-core' };
      }
    } catch {}
  }
  return { core: stubVaultIndexCore, coreKind: 'stand-in' };
}
