// The first open's swell (founder direction 2026-09-24: "a wave rolling across
// the screen to reveal the text", shaped by the Creative Studio as "Swell
// Line"). A scripted line is laid out whole from the start, so nothing
// reflows. Every word is a nowrap span, so a line only ever wraps between
// words, and every character inside it is its own inline-block span that
// rises from a hair below its baseline, crests, and settles, starting on the
// delay the ink plan gives it (lib/introWalk.ts inkPlan). Characters run in
// reading order, so the swell rolls left to right and on to the next line.
//
// The spans live only while the line is rolling in: a settled line renders
// plain, so kerning, selection, copy, and find are exactly as normal.

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface InkStamp {
  /** Each visible character's start, in reading order (inkPlan's delays). */
  delays: readonly number[];
  /** Characters from this index on arrive flat and fast: the skip's finish,
   *  re-stamped by the bubble. Undefined while the swell plays. */
  flatFrom?: number;
}

const SKIP = new Set(['pre', 'code']);

/** The rehype plugin: wrap every prose word in `<span class="iw">` and every
 *  character in `<span class="ic">` with its start as `--d`. Whitespace stays
 *  plain text between words, so wrapping is native. */
export function rehypeInk(stamp: InkStamp) {
  return () => (tree: HastNode) => {
    let n = 0;
    const last = stamp.delays.length ? stamp.delays[stamp.delays.length - 1]! : 0;
    const charSpan = (ch: string): HastNode => {
      const d = stamp.delays[n] ?? last;
      const flat = stamp.flatFrom !== undefined && n >= stamp.flatFrom;
      n += 1;
      return {
        type: 'element',
        tagName: 'span',
        properties: { className: flat ? ['ic', 'flat'] : ['ic'], style: `--d:${d}ms` },
        children: [{ type: 'text', value: ch }],
      };
    };
    const wrap = (node: HastNode) => {
      if (!node.children) return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value) {
          for (const part of child.value.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) next.push({ type: 'text', value: part });
            else
              next.push({
                type: 'element',
                tagName: 'span',
                properties: { className: ['iw'] },
                children: [...part].map(charSpan),
              });
          }
        } else {
          if (child.type === 'element' && !SKIP.has(child.tagName ?? '')) wrap(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    wrap(tree);
  };
}

/** The skip's finish: characters already under way keep their swell; the rest
 *  arrive flat, spread over `spreadMs` from `nowMs`. Returns the re-stamped
 *  delays and where the flat run begins. */
export function restampForSkip(
  delays: readonly number[],
  nowMs: number,
  spreadMs = 200,
): { delays: number[]; flatFrom: number } {
  const flatFrom = delays.findIndex((d) => d > nowMs);
  if (flatFrom < 0) return { delays: [...delays], flatFrom: delays.length };
  const rest = delays.length - flatFrom;
  return {
    delays: delays.map((d, i) =>
      i < flatFrom ? d : Math.round(nowMs + ((i - flatFrom) / Math.max(1, rest - 1)) * spreadMs),
    ),
    flatFrom,
  };
}
