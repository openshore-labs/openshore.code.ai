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
import { normalizeNotePath, scanInlineLinks, type LinkToken } from 'os-code/protocol';
import { resolveWikilink } from './vault.js';

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

/** The vault: href the reader's anchor override intercepts. */
export function vaultHref(dest: WikilinkDestination): string {
  return `vault:${encodeURIComponent(dest.path)}${dest.isNew ? '?new' : ''}`;
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
}

// The slice of mdast this plugin reads and writes. Local on purpose: the app
// does not depend on @types/mdast, and the plugin needs only these shapes.
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MdNode[];
}

/** Node types whose text is never read for links: code, raw HTML, and text
 *  already inside a link. */
const OPAQUE = new Set(['code', 'inlineCode', 'html', 'link', 'linkReference', 'definition']);

/** One text node split around its wikilinks, or null when it holds none. */
function splitText(value: string, opts: RemarkWikilinksOptions): MdNode[] | null {
  const links = scanInlineLinks(value).filter((l) => l.kind === 'wiki');
  if (links.length === 0) return null;
  const out: MdNode[] = [];
  let at = 0;
  let changed = false;
  for (const l of links) {
    let node: MdNode | undefined;
    if (l.embed) {
      // Embeds do not render inline yet, so they show as an explicit chip
      // rather than a broken image or a link to the embedded note.
      node = { type: 'inlineCode', value: `embed not supported yet: ${wikilinkLabel(l)}` };
    } else {
      const dest = wikilinkDestination(l.target, opts.paths, opts.sourcePath);
      if (dest) {
        node = {
          type: 'link',
          url: vaultHref(dest),
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

function walk(node: MdNode, opts: RemarkWikilinksOptions): void {
  const kids = node.children;
  if (!kids) return;
  let next: MdNode[] | null = null;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i]!;
    const split =
      child.type === 'text' && typeof child.value === 'string'
        ? splitText(child.value, opts)
        : null;
    if (split) {
      next ??= kids.slice(0, i);
      next.push(...split);
      continue;
    }
    if (!OPAQUE.has(child.type)) walk(child, opts);
    next?.push(child);
  }
  if (next) node.children = next;
}

/** The remark plugin: `remarkPlugins={[remarkGfm, [remarkWikilinks, opts]]}`. */
export function remarkWikilinks(opts: RemarkWikilinksOptions) {
  return (tree: object): void => {
    walk(tree as MdNode, opts);
  };
}
