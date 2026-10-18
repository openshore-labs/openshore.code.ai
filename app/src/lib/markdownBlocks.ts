// A live reply, cut into the blocks already finished and the one still being
// written. Re-parsing the whole reply's markdown on every frame of a reveal
// costs more each word on a long answer, and on a phone that is also running
// the model it was enough to stall painting. Finished blocks never change, so
// components/Markdown.tsx renders each one once (memoized) and only the last
// block is parsed again as words land: the cost per frame stays the size of
// one paragraph however long the reply grows. A settled reply renders whole.
//
// A block ends at a blank line outside a fence, unless what follows still
// belongs to it: an indented line (a list item's own paragraph or code) or
// the next item of a list. So a list, a table, a fence and a paragraph each
// stay one block, and the cut never changes how the markdown reads.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])\s/;

export function splitBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | undefined;
  let inList = false;
  let blank = false;
  for (const line of lines) {
    const open = FENCE.exec(line);
    if (fence) {
      current.push(line);
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (!line.trim()) {
      current.push(line);
      blank = true;
      continue;
    }
    const continues = /^(\s{2,}|\t)/.test(line) || (inList && LIST_ITEM.test(line));
    if (blank && !continues && current.some((l) => l.trim())) {
      blocks.push(current.join('\n'));
      current = [];
      inList = false;
    }
    blank = false;
    if (open) fence = open[1];
    if (LIST_ITEM.test(line)) inList = true;
    current.push(line);
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}

/**
 * Close the emphasis and code a live block has opened but not yet closed, so
 * `**Step 1: Under` reads bold now instead of showing its asterisks until the
 * closing pair arrives (and then re-rendering every word into a new element,
 * which would replay their fades). A marker with nothing after it yet is
 * dropped rather than closed. A block holding a fence is left alone (an
 * open one is closeOpenFence's). Only ever applied to the live tail: the settled reply
 * renders exactly what the model wrote.
 */
export function closeOpenMarks(block: string): string {
  if (/^ {0,3}(`{3,}|~{3,})/m.test(block)) return block;
  // A marker that is the very last thing so far (a bold or a bullet about to
  // begin) waits for its first word.
  block = block.replace(/(^|\s)(\*{1,3}|`)\s*$/, '$1');
  const open: { mark: string; at: number }[] = [];
  let code = -1;
  for (let i = 0; i < block.length; i += 1) {
    const c = block[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '`') {
      code = code === -1 ? i : -1;
      continue;
    }
    if (code !== -1 || c !== '*') continue;
    let run = 1;
    while (block[i + run] === '*') run += 1;
    const lineStart = /(^|\n)[ \t]*$/.test(block.slice(0, i));
    const before = block[i - 1] ?? ' ';
    const after = block[i + run] ?? ' ';
    // A bullet ("* item") and a lone star between spaces are not emphasis.
    if (!(lineStart && run === 1 && after === ' ') && !(/\s/.test(before) && /\s/.test(after))) {
      let left = run;
      while (left > 0) {
        const mark = left >= 2 ? '**' : '*';
        left -= mark.length;
        const top = open[open.length - 1];
        if (top?.mark === mark && !/\s/.test(before)) open.pop();
        else if (!/\s/.test(after)) open.push({ mark, at: i + (run - left - mark.length) });
      }
    }
    i += run - 1;
  }
  let out = block;
  const tail: string[] = [];
  const marks = [...open];
  if (code !== -1) marks.push({ mark: '`', at: code });
  for (const { mark, at } of marks.sort((a, b) => b.at - a.at)) {
    if (!out.slice(at + mark.length).trim()) out = out.slice(0, at) + out.slice(at + mark.length);
    else tail.unshift(mark);
  }
  if (!tail.length) return out;
  const end = out.replace(/\s+$/, '');
  return end + tail.reverse().join('') + out.slice(end.length);
}
