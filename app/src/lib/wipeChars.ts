// The first open's wipe (founder direction 2026-09-24, shaped by the Creative
// Studio): a scripted line is laid out whole from the start, so nothing
// reflows, and every character is its own span that arrives on a delay set by
// its place in the text. Characters are in reading order, so the reveal sweeps
// left to right along each line, then down to the next, like light moving
// across the water. Paragraph breaks and a step heading add their pauses.
//
// Pure: the rehype plugin that splits prose into character spans, and the
// timeline math the walk's sequencing shares (lib/introWalk.ts), so a beat
// starts exactly when the sweep before it has finished.

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface WipeTiming {
  /** The beat between one character and the next. */
  staggerMs: number;
  /** Extra stillness at each paragraph break. */
  paragraphPauseMs: number;
  /** Extra breath before a step heading ("Step 1 of 4: ..."). */
  headingPauseMs: number;
  /** How long one character takes to arrive (mirrors its CSS token). */
  charMs: number;
}

const BREAK = /\n\s*\n/;

/** A paragraph's visible text: markdown's bold markers removed. */
function visible(paragraph: string): string {
  return paragraph.replace(/\*\*/g, '');
}

/** The markdown paragraphs of a scripted line, as the reader sees them. */
export function wipeParagraphs(text: string): string[] {
  return text
    .split(BREAK)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** When the paragraph at `index` starts, given the ones before it. */
function paragraphStart(paragraphs: string[], index: number, t: WipeTiming): number {
  let at = 0;
  let chars = 0;
  for (let i = 0; i < index; i += 1) chars += visible(paragraphs[i]!).length;
  at = chars * t.staggerMs + index * t.paragraphPauseMs;
  for (let i = 1; i <= index; i += 1) {
    if (paragraphs[i]!.startsWith('**Step')) at += t.headingPauseMs;
  }
  return at;
}

/** How long a scripted line takes to sweep in, from its first character to
 *  its last one fully arrived. */
export function wipeDurationMs(text: string, t: WipeTiming): number {
  const paragraphs = wipeParagraphs(text);
  if (!paragraphs.length) return 0;
  const last = paragraphs.length - 1;
  const lastLen = visible(paragraphs[last]!).length;
  return paragraphStart(paragraphs, last, t) + Math.max(0, lastLen - 1) * t.staggerMs + t.charMs;
}

const SKIP = new Set(['pre', 'code']);

/** The rehype plugin: every prose character becomes `<span class="c">` with its
 *  arrival delay as `--d` (ms). Whitespace advances the sweep but stays plain
 *  text, so wrapping and spacing are exactly as settled text lays out. */
export function rehypeWipeChars(t: WipeTiming) {
  return () => (tree: HastNode) => {
    const blocks = (tree.children ?? []).filter((n) => n.type === 'element');
    let chars = 0;
    let headings = 0;
    blocks.forEach((block, index) => {
      const firstText = textOf(block).trimStart();
      if (index > 0 && isStepHeading(block, firstText)) headings += 1;
      const start = chars * t.staggerMs + index * t.paragraphPauseMs + headings * t.headingPauseMs;
      let local = 0;
      const wrap = (node: HastNode) => {
        if (!node.children) return;
        const next: HastNode[] = [];
        for (const child of node.children) {
          if (child.type === 'text' && child.value) {
            for (const ch of child.value) {
              const d = Math.round(start + local * t.staggerMs);
              local += 1;
              if (/\s/.test(ch)) next.push({ type: 'text', value: ch });
              else
                next.push({
                  type: 'element',
                  tagName: 'span',
                  properties: { className: ['c'], style: `--d:${d}ms` },
                  children: [{ type: 'text', value: ch }],
                });
            }
          } else {
            if (child.type === 'element' && !SKIP.has(child.tagName ?? '')) wrap(child);
            next.push(child);
          }
        }
        node.children = next;
      };
      wrap(block);
      chars += local;
    });
  };
}

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

function isStepHeading(block: HastNode, firstText: string): boolean {
  const first = (block.children ?? []).find((c) => c.type !== 'text' || (c.value ?? '').trim());
  return first?.tagName === 'strong' && firstText.startsWith('Step');
}
