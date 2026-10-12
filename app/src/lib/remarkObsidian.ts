// Obsidian's reading-view syntax for the Vault (Vault M6, tech review K10 and K11; UX review
// X12 and X13). One hand-written remark plugin, no new package, working on
// mdast nodes so code is never touched: fenced and indented code are `code`
// nodes and code spans are `inlineCode`, never `text`.
//
// - Callouts: a blockquote whose first line is `[!type]`, `[!type]-` or
//   `[!type]+`, read by the core's `parseCallout`. It becomes a
//   `vault-callout` element carrying only its family (neutral, positive,
//   caution, danger), never the raw type, so a note cannot pick a class.
// - `==highlight==` inside one text node becomes a `<mark>`. A span across
//   emphasis or a link stays as written (a documented divergence).
// - `^block-id` at the end of a block is taken off the text (it never reaches
//   the reader or the accessibility tree) and kept as `data-block` on the
//   block, for scroll-to. Only ids the core's scanner found count, so one in
//   code stays as written.
// - Headings carry `data-heading-index`. No `id` attribute is ever built from
//   note text (DOM clobbering); scroll-to walks these attributes instead.
// - A `#tag` in the text becomes a `vault-tag` element carrying the tag, so
//   the reader can make it a tap that searches `tag:x` (UX review X2). Not inside a
//   link, and a tag of digits alone (`#1`) is not a tag, as in Obsidian.
// - GFM task items become a `vault-task` line carrying the task's line in the
//   whole note (frontmatter lines counted), so a tick can find its marker.
//
// `%%comments%%` are not here: the reader masks them before the parse with
// the core's `maskComments`, which keeps every offset and line break.

import { parseCallout, type CalloutFamily } from 'os-code/protocol';
import type { MdNode } from './remarkWikilinks.js';

export interface RemarkObsidianOptions {
  /** Block ids the scanner found in the body, with their zero-based line. */
  blockIds?: ReadonlyArray<{ id: string; line: number }>;
  /** Lines before the body (the frontmatter), so a task's line is its line
   *  in the whole note. */
  lineOffset?: number;
}

/** Node types whose text is never read. */
const OPAQUE = new Set(['code', 'inlineCode', 'html', 'definition', 'vaultEmbed']);

const FAMILIES: readonly CalloutFamily[] = ['neutral', 'positive', 'caution', 'danger'];

/** The head of a callout's first line, `[!type]` plus its fold sign and the
 *  space after it. The core decides what the head means; this only finds
 *  where the title starts. */
const HEAD = /^\[![^\]\n]*\][+-]?[ \t]*/;

/** `==text==` inside one text node. */
const MARK = /==(?![\s=])([^\n]*?[^\s=])==/g;

/** `#tag` at the start of the text or after a space or an opening bracket:
 *  letters, digits, `_`, `-` and `/`, at least one of them not a digit. */
const TAG = /(^|[\s([{])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

/** A callout title from its type when the line gives none: `Note`,
 *  `Warning`, `Faq` (UX review X12). */
export function calloutTitleOf(type: string): string {
  const t = type.replace(/-/g, ' ').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1).toLowerCase() : 'Note';
}

function el(
  type: string,
  hName: string,
  props: Record<string, unknown>,
  children: MdNode[],
): MdNode {
  return { type, data: { hName, hProperties: props }, children };
}

function lastText(node: MdNode): MdNode | undefined {
  const kids = node.children;
  if (!kids) return undefined;
  for (let i = kids.length - 1; i >= 0; i--) {
    const k = kids[i]!;
    if (k.type === 'text') return k;
    if (k.type === 'break') continue;
    if (OPAQUE.has(k.type)) return undefined;
    return lastText(k);
  }
  return undefined;
}

// ---------------------------------------------------------------- callouts

/** A blockquote as a callout, or null when its first line is not a head. */
function callout(quote: MdNode): MdNode | null {
  const first = quote.children?.[0];
  if (first?.type !== 'paragraph' || !first.children?.length) return null;
  const lead = first.children[0]!;
  if (lead.type !== 'text' || !lead.value?.startsWith('[!')) return null;
  const nl = lead.value.indexOf('\n');
  const line = nl >= 0 ? lead.value.slice(0, nl) : lead.value;
  const head = parseCallout(line) ?? parseCallout(`> ${line}`);
  if (!head) return null;
  const family = FAMILIES.includes(head.family) ? head.family : 'neutral';
  const skip = HEAD.exec(line)?.[0].length ?? line.length;

  // The title is the rest of the first line, inline markup kept; the body is
  // everything after it.
  const title: MdNode[] = [];
  const rest: MdNode[] = [];
  let inTitle = true;
  first.children.forEach((node, i) => {
    if (!inTitle) {
      rest.push(node);
      return;
    }
    if (node.type === 'text' && typeof node.value === 'string') {
      const value = i === 0 ? node.value.slice(skip) : node.value;
      const cut = i === 0 ? (nl >= 0 ? nl - skip : -1) : value.indexOf('\n');
      if (cut >= 0) {
        if (value.slice(0, cut)) title.push({ type: 'text', value: value.slice(0, cut) });
        const after = value.slice(cut + 1);
        if (after) rest.push({ type: 'text', value: after });
        inTitle = false;
        return;
      }
      if (value) title.push({ type: 'text', value });
      return;
    }
    if (node.type === 'break') {
      inTitle = false;
      return;
    }
    title.push(node);
  });
  const hasTitle = title.some((n) => n.type !== 'text' || n.value?.trim());
  const titleKids = hasTitle
    ? title
    : [{ type: 'text', value: head.title?.trim() || calloutTitleOf(head.type) }];
  const body: MdNode[] = [];
  if (rest.some((n) => n.type !== 'text' || n.value?.trim())) {
    body.push({ ...first, children: rest });
  }
  body.push(...(quote.children ?? []).slice(1));
  return el('vaultCallout', 'vault-callout', { dataFamily: family, dataFold: head.fold ?? '' }, [
    el('vaultCalloutTitle', 'vault-callout-title', {}, titleKids),
    el('vaultCalloutBody', 'vault-callout-body', {}, body),
  ]);
}

// -------------------------------------------------------------- highlights

function splitMarks(value: string): MdNode[] | null {
  MARK.lastIndex = 0;
  const out: MdNode[] = [];
  let at = 0;
  for (let m = MARK.exec(value); m; m = MARK.exec(value)) {
    if (m.index > at) out.push({ type: 'text', value: value.slice(at, m.index) });
    out.push(
      el('vaultMark', 'mark', { className: ['vault-mark'] }, [{ type: 'text', value: m[1]! }]),
    );
    at = m.index + m[0].length;
  }
  if (!out.length) return null;
  if (at < value.length) out.push({ type: 'text', value: value.slice(at) });
  return out;
}

/** Split `#tag`s out of a text node, or null when it holds none. */
function splitTags(value: string): MdNode[] | null {
  TAG.lastIndex = 0;
  const out: MdNode[] = [];
  let at = 0;
  for (let m = TAG.exec(value); m; m = TAG.exec(value)) {
    const start = m.index + m[1]!.length;
    const tag = m[2]!.replace(/\/+$/, '');
    if (!tag) continue;
    if (start > at) out.push({ type: 'text', value: value.slice(at, start) });
    out.push(el('vaultTag', 'vault-tag', { dataTag: tag }, [{ type: 'text', value: `#${tag}` }]));
    at = start + 1 + tag.length;
    TAG.lastIndex = at;
  }
  if (!out.length) return null;
  if (at < value.length) out.push({ type: 'text', value: value.slice(at) });
  return out;
}

/** Highlights first, then tags in what is still plain text. */
function splitText(value: string, tags: boolean): MdNode[] | null {
  const marked = splitMarks(value);
  if (!tags) return marked;
  const pieces = marked ?? [{ type: 'text', value }];
  let changed = Boolean(marked);
  const out: MdNode[] = [];
  for (const p of pieces) {
    const split = p.type === 'text' && typeof p.value === 'string' ? splitTags(p.value) : null;
    if (split) {
      changed = true;
      out.push(...split);
    } else out.push(p);
  }
  return changed ? out : null;
}

// ----------------------------------------------------------- block anchors

/** Take a trailing `^id` off a block; true when the block had it. */
function stripAnchor(block: MdNode, id: string): boolean {
  const text = lastText(block);
  if (!text?.value) return false;
  const re = new RegExp(`(^|\\s)\\^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  if (!re.test(text.value)) return false;
  text.value = text.value.replace(re, '').replace(/\s+$/, '');
  return true;
}

const isBlank = (n: MdNode): boolean =>
  !n.children?.length ||
  n.children.every((c) => (c.type === 'text' && !c.value?.trim()) || c.type === 'break');

function setProp(node: MdNode, key: string, value: unknown): void {
  node.data ??= {};
  node.data.hProperties ??= {};
  node.data.hProperties[key] = value;
}

// -------------------------------------------------------------------- walk

interface State {
  opts: RemarkObsidianOptions;
  anchors: Map<number, string>;
  headings: number;
  /** Inside a link: a `#` there is part of its text, never a tag. */
  inLink?: boolean;
}

function walk(node: MdNode, st: State): void {
  const kids = node.children;
  if (!kids) return;
  const next: MdNode[] = [];
  for (let child of kids) {
    if (OPAQUE.has(child.type)) {
      next.push(child);
      continue;
    }
    if (child.type === 'text' && typeof child.value === 'string') {
      const split = splitText(child.value, !st.inLink);
      if (split) next.push(...split);
      else next.push(child);
      continue;
    }
    if (child.type === 'link' || child.type === 'linkReference') {
      walk(child, { ...st, inLink: true });
      next.push(child);
      continue;
    }
    if (child.type === 'blockquote') child = callout(child) ?? child;

    if ((child.type === 'paragraph' || child.type === 'heading') && child.position) {
      const line = child.position.end.line - 1;
      const id = st.anchors.get(line);
      if (id && stripAnchor(child, id)) {
        st.anchors.delete(line);
        const owner = node.type === 'listItem' ? node : child;
        if (child.type === 'paragraph' && isBlank(child) && owner === child) {
          // `^id` on its own line names the block before it.
          const prev = next[next.length - 1];
          if (prev) setProp(prev, 'dataBlock', id);
          continue;
        }
        setProp(owner, 'dataBlock', id);
      }
    }
    if (child.type === 'heading') setProp(child, 'dataHeadingIndex', st.headings++);

    if (child.type === 'listItem' && typeof child.checked === 'boolean') {
      const line = (child.position?.start.line ?? 1) - 1 + (st.opts.lineOffset ?? 0);
      const checked = child.checked;
      child.checked = null;
      setProp(child, 'className', ['vault-task-item']);
      walk(child, st);
      const items = child.children ?? [];
      const lead = items[0];
      const label = lead?.type === 'paragraph' ? (lead.children ?? []) : [];
      const rest = lead?.type === 'paragraph' ? items.slice(1) : items;
      const task = el(
        'vaultTask',
        'vault-task',
        { dataLine: line, dataChecked: checked ? 'true' : 'false' },
        label,
      );
      child.children = [task, ...rest];
      next.push(child);
      continue;
    }
    walk(child, st);
    next.push(child);
  }
  node.children = next;
}

/** The remark plugin: `[remarkObsidian, { blockIds, lineOffset }]`, after
 *  remark-gfm and the wikilinks plugin. */
export function remarkObsidian(opts: RemarkObsidianOptions = {}) {
  return (tree: object): void => {
    const anchors = new Map<number, string>();
    for (const b of opts.blockIds ?? []) anchors.set(b.line, b.id);
    walk(tree as MdNode, { opts, anchors, headings: 0 });
  };
}
