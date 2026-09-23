// The Claude-style arrival for a streaming reply: every word is its own span,
// so each new group of words mounts in light and fades up to full ink (the
// `.md-live .w` animation in theme.css), while the words already on screen
// keep their DOM nodes and never replay. A rehype plugin, run after syntax
// highlighting, only while a reply is live; a settled reply renders as plain
// text with no spans at all.
//
// Code is left alone: a fenced block is a unit you read whole, and splitting
// highlighted tokens would cost more than the fade is worth.

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const SKIP = new Set(['pre', 'code']);

/** Split a text run into words (as spans) and the whitespace between them
 *  (kept as plain text, so wrapping and spacing are exactly as before). */
export function splitWords(value: string): HastNode[] {
  const out: HastNode[] = [];
  for (const part of value.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) out.push({ type: 'text', value: part });
    else
      out.push({
        type: 'element',
        tagName: 'span',
        properties: { className: ['w'] },
        children: [{ type: 'text', value: part }],
      });
  }
  return out;
}

function wrap(node: HastNode): void {
  if (!node.children) return;
  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value) {
      next.push(...splitWords(child.value));
    } else {
      if (child.type === 'element' && !SKIP.has(child.tagName ?? '')) wrap(child);
      next.push(child);
    }
  }
  node.children = next;
}

/** The rehype plugin: wrap every prose word in `<span class="w">`. */
export function rehypeFadeWords() {
  return (tree: HastNode) => {
    wrap(tree);
  };
}
