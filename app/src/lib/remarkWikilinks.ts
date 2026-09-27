// Obsidian wikilinks for the Vault's reader (Vault M3, CTO H2 and H6). A remark
// plugin that splits mdast `text` nodes with the core's scanInlineLinks, so a
// [[link]] becomes a real link node carrying a vault: href and the renderer
// never touches code: fenced and indented code are `code` nodes and code spans
// are `inlineCode` nodes, never `text`, so nothing inside them is read. Text
// already inside a link is left alone, so no anchor ever nests in another.
//
// It replaces the old string pass (wikilinksToMarkdown), which rewrote the raw
// markdown before parsing and so turned [[links]] inside code fences into
// anchors.
import {
  attachmentMime,
  normalizeNotePath,
  resolveAttachment,
  scanInlineLinks,
  type LinkToken,
} from 'os-code/protocol';
import { noteTitle, resolveWikilink } from './vault.js';

/** Where a wikilink goes in the reader: the note it opens, and whether that
 *  note does not exist yet (dashed, created on tap). */
export interface WikilinkDestination {
  path: string;
  isNew: boolean;
}

/** Resolve one wikilink for the reader. A link to the note itself
 *  (`[[#Heading]]`) opens `sourcePath`; with no source it goes nowhere. An
 *  unresolved link names the note a tap would create, by the one new-name
 *  rule, so a dashed link always reaches the note it makes. */
export function wikilinkDestination(
  target: string,
  paths: readonly string[],
  sourcePath?: string,
): WikilinkDestination | undefined {
  const t = target.trim();
  if (!t) return sourcePath ? { path: sourcePath, isNew: false } : undefined;
  const resolved = resolveWikilink(t, paths, sourcePath);
  if (resolved) return { path: resolved, isNew: false };
  return { path: normalizeNotePath(t) ?? t, isNew: true };
}

/** The vault: href the reader's anchor override intercepts. A heading or
 *  block subpath (`[[Note#Goals]]`, `[[Note#^id]]`) rides after `#`, so the
 *  reader can scroll to it once the note is open (CX X12). */
export function vaultHref(dest: WikilinkDestination, subpath?: string): string {
  const sub = subpath?.trim();
  return `vault:${encodeURIComponent(dest.path)}${dest.isNew ? '?new' : ''}${
    sub ? `#${encodeURIComponent(sub)}` : ''
  }`;
}

/** What a wikilink shows: its alias, else the target, with a heading or
 *  block shown after it the way Obsidian does ("Plan > Goals"). */
export function wikilinkLabel(link: Pick<LinkToken, 'target' | 'subpath' | 'alias'>): string {
  const alias = link.alias?.trim();
  if (alias) return alias;
  const target = link.target.trim();
  const sub = link.subpath?.trim();
  if (!sub) return target;
  return target ? `${target} > ${sub}` : sub;
}

export interface RemarkWikilinksOptions {
  paths: readonly string[];
  /** The note being read, so a relative link and `[[#Heading]]` resolve
   *  from it. */
  sourcePath?: string;
  /** The vault's attachment paths, so `![[img.png]]` and `![](img.png)` find
   *  their file (CTO K11). Left out, the reader has no way to load one, and
   *  an attachment embed shows as a chip that says so. */
  attachments?: readonly string[];
  /** Obsidian's `attachmentFolderPath`, when the vault sets one. */
  attachmentFolder?: string;
  /** How deep this reader sits inside note embeds: 0 for the note itself.
   *  At 1 or more a note embed is a link chip, never another card (K11). */
  depth?: number;
}

/** The most note embeds one note renders as cards (K11); the rest are link
 *  chips. */
export const VAULT_EMBEDS_PER_NOTE = 10;

/** What an embed turned into, read by the reader's `vault-embed` element:
 *  - `note`: a card with the note's body, one level deep;
 *  - `nested`: a link chip (a second level, or past the per-note cap);
 *  - `missing`: no note by that name;
 *  - `image`, `pdf`: an attachment (`path` absent when none resolved);
 *  - `file`: another file type, which does not open in the Vault;
 *  - `remote`: an http(s) image, never fetched (a note must not beacon). */
export type VaultEmbedKind = 'note' | 'nested' | 'missing' | 'image' | 'pdf' | 'file' | 'remote';

// The slice of mdast this plugin reads and writes. Local on purpose: the app
// does not depend on @types/mdast, and the plugin needs only these shapes.
export interface MdNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  title?: string | null;
  checked?: boolean | null;
  depth?: number;
  children?: MdNode[];
  position?: { start: { line: number; offset?: number }; end: { line: number; offset?: number } };
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Node types whose text is never read for links: code, raw HTML, and text
 *  already inside a link. */
const OPAQUE = new Set(['code', 'inlineCode', 'html', 'link', 'linkReference', 'definition']);

/** A file name with an extension that is not `.md`: an attachment candidate. */
const FILE_EXT = /\.([A-Za-z0-9]{1,8})$/;

/** `300` or `300x200` in an embed's alias: Obsidian's size, width first. */
const SIZE = /^(\d{1,4})(?:x\d{1,4})?$/;

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/** The alt text an image shows: its alias, else the file name without its
 *  extension (CX X14). */
function altFor(target: string, alias?: string): string {
  const a = alias?.trim();
  if (a) return a;
  return baseName(target).replace(FILE_EXT, '');
}

/** Split an alias into its alt text and an Obsidian size (`|300`,
 *  `caption|300`). */
function sizeOf(alias?: string): { alias?: string; width?: number } {
  const a = alias?.trim();
  if (!a) return {};
  const bar = a.lastIndexOf('|');
  const tail = bar >= 0 ? a.slice(bar + 1).trim() : a;
  const m = SIZE.exec(tail);
  if (!m) return { alias: a };
  const rest = bar >= 0 ? a.slice(0, bar).trim() : '';
  return { alias: rest || undefined, width: Number(m[1]) };
}

interface EmbedCounter {
  notes: number;
}

function embedNode(kind: VaultEmbedKind, props: Record<string, unknown>): MdNode {
  const hProperties: Record<string, unknown> = { dataKind: kind };
  for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== '') hProperties[k] = v;
  return { type: 'vaultEmbed', data: { hName: 'vault-embed', hProperties } };
}

/** An attachment by name (`img.png`, `docs/spec.pdf`), or undefined when the
 *  name is not an image or a PDF this reader can show. */
function attachmentEmbed(
  target: string,
  alias: string | undefined,
  opts: RemarkWikilinksOptions,
): MdNode | undefined {
  const mime = attachmentMime(target);
  if (!mime) return undefined;
  const { alias: alt, width } = sizeOf(alias);
  const path = opts.attachments
    ? resolveAttachment(target, opts.sourcePath ?? '', opts.attachments, opts.attachmentFolder)
    : undefined;
  if (mime === 'application/pdf') {
    return embedNode('pdf', { dataPath: path, dataName: baseName(path ?? target) });
  }
  return embedNode('image', {
    dataPath: path,
    dataName: baseName(path ?? target),
    dataAlt: altFor(target, alt),
    dataWidth: width,
  });
}

/** One `![[...]]` as the node the reader renders (CX X14). */
function wikiEmbed(l: LinkToken, opts: RemarkWikilinksOptions, count: EmbedCounter): MdNode {
  const target = l.target.trim();
  const label = l.alias?.trim() || target || l.subpath?.trim() || '';
  // An attachment by extension first; a note named like a file
  // ("report.pdf.md") still embeds as the note when no attachment matches.
  if (FILE_EXT.test(target) && !/\.md$/i.test(target)) {
    const att = attachmentEmbed(target, l.alias, opts);
    const note = resolveWikilink(target, opts.paths, opts.sourcePath);
    if (att && (att.data?.hProperties?.dataPath || !note)) return att;
    if (!note) return embedNode('file', { dataName: baseName(target) });
  }
  const dest = wikilinkDestination(target, opts.paths, opts.sourcePath);
  if (!dest || dest.isNew) return embedNode('missing', { dataTitle: target || label });
  const props = {
    dataPath: dest.path,
    dataSub: l.subpath?.trim(),
    dataTitle: noteTitle(dest.path),
  };
  if ((opts.depth ?? 0) >= 1 || count.notes >= VAULT_EMBEDS_PER_NOTE) {
    return embedNode('nested', props);
  }
  count.notes += 1;
  return embedNode('note', props);
}

/** A markdown image (`![alt](img.png)`): an attachment from the vault, or a
 *  remote chip. Its `src` is never taken from the note (K10): the reader
 *  loads a blob URL it made for the resolved path. */
function markdownImage(node: MdNode, opts: RemarkWikilinksOptions): MdNode {
  const raw = (node.url ?? '').trim();
  const { alias: alt, width } = sizeOf(node.alt ?? undefined);
  if (/^https?:\/\//i.test(raw)) {
    return embedNode('remote', { dataUrl: raw, dataAlt: alt || raw });
  }
  let target = raw;
  try {
    target = decodeURI(raw);
  } catch {
    // A broken escape: the raw text still names something.
  }
  // Any other scheme (data:, blob:, file:) names nothing in the vault.
  const scheme = /^[a-z][a-z0-9+.-]*:/i.test(target);
  if (!scheme && FILE_EXT.test(target)) {
    const att = attachmentEmbed(target, alt, opts);
    if (att) {
      if (width !== undefined) att.data!.hProperties!.dataWidth = width;
      return att;
    }
  }
  return embedNode('image', {
    dataName: baseName(target) || alt || raw,
    dataAlt: alt || baseName(target),
  });
}

/** One text node split around its wikilinks, or null when it holds none. */
function splitText(
  value: string,
  opts: RemarkWikilinksOptions,
  count: EmbedCounter,
): MdNode[] | null {
  const links = scanInlineLinks(value).filter((l) => l.kind === 'wiki');
  if (links.length === 0) return null;
  const out: MdNode[] = [];
  let at = 0;
  let changed = false;
  for (const l of links) {
    let node: MdNode | undefined;
    if (l.embed) {
      node = wikiEmbed(l, opts, count);
    } else {
      const dest = wikilinkDestination(l.target, opts.paths, opts.sourcePath);
      if (dest) {
        node = {
          type: 'link',
          url: vaultHref(dest, l.subpath),
          title: null,
          children: [{ type: 'text', value: wikilinkLabel(l) }],
        };
      }
    }
    if (!node) continue;
    if (l.start > at) out.push({ type: 'text', value: value.slice(at, l.start) });
    out.push(node);
    at = l.end;
    changed = true;
  }
  if (!changed) return null;
  if (at < value.length) out.push({ type: 'text', value: value.slice(at) });
  return out;
}

function walk(node: MdNode, opts: RemarkWikilinksOptions, count: EmbedCounter): void {
  const kids = node.children;
  if (!kids) return;
  let next: MdNode[] | null = null;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i]!;
    let split: MdNode[] | null = null;
    if (child.type === 'text' && typeof child.value === 'string') {
      split = splitText(child.value, opts, count);
    } else if (child.type === 'image') {
      split = [markdownImage(child, opts)];
    }
    if (split) {
      next ??= kids.slice(0, i);
      next.push(...split);
      continue;
    }
    if (!OPAQUE.has(child.type)) walk(child, opts, count);
    next?.push(child);
  }
  if (next) node.children = next;
}

const isCard = (n: MdNode): boolean =>
  n.type === 'vaultEmbed' && n.data?.hProperties?.dataKind === 'note';

const isBlank = (nodes: MdNode[]): boolean =>
  nodes.every((n) => (n.type === 'text' && !n.value?.trim()) || n.type === 'break');

/** A note embed is a card with block content, which cannot sit inside a
 *  `<p>`: the paragraph splits around it, and blank halves go. */
function liftCards(node: MdNode): void {
  const kids = node.children;
  if (!kids) return;
  let next: MdNode[] | null = null;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i]!;
    if (child.type === 'paragraph' && child.children?.some(isCard)) {
      next ??= kids.slice(0, i);
      let run: MdNode[] = [];
      const flush = () => {
        if (!isBlank(run)) next!.push({ type: 'paragraph', children: run });
        run = [];
      };
      for (const inner of child.children) {
        if (isCard(inner)) {
          flush();
          next.push(inner);
        } else run.push(inner);
      }
      flush();
      continue;
    }
    if (!OPAQUE.has(child.type)) liftCards(child);
    next?.push(child);
  }
  if (next) node.children = next;
}

/** The remark plugin: `remarkPlugins={[remarkGfm, [remarkWikilinks, opts]]}`. */
export function remarkWikilinks(opts: RemarkWikilinksOptions) {
  return (tree: object): void => {
    walk(tree as MdNode, opts, { notes: 0 });
    liftCards(tree as MdNode);
  };
}
