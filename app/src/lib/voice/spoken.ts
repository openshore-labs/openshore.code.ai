// Turning a streamed markdown reply into something worth hearing. Two pure
// helpers, both pinned by tests:
//   toSpeakable(text)  strips the markup a voice should not read out (fences,
//                      emphasis stars, link plumbing) and names a code block
//                      rather than reading its every bracket aloud.
//   nextSentenceEnd    finds the end of the next complete sentence so the
//                      synthesizer can start on sentence one while the model is
//                      still writing sentence two, and never splits inside an
//                      unclosed code fence.
// No em dashes anywhere (repo rule); the transforms never introduce one either.

/** Replace a fenced code block with a short spoken note. Reading code aloud,
 *  bracket by bracket, is noise; naming it is what a person would say. */
function nameCodeBlocks(text: string): string {
  return text.replace(/```[^\n]*\n?[\s\S]*?```/g, ' Here is a code block on screen. ');
}

/** Make a line of markdown read like speech: drop the syntax, keep the words. */
export function toSpeakable(text: string): string {
  let out = nameCodeBlocks(text);
  // Inline code: keep the word, drop the backticks.
  out = out.replace(/`([^`]+)`/g, '$1');
  // Images and links: speak the visible text, not the URL.
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Headings, blockquotes, list bullets at the start of a line.
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  out = out.replace(/^\s{0,3}>\s?/gm, '');
  out = out.replace(/^\s*[-*+]\s+/gm, '');
  out = out.replace(/^\s*\d+\.\s+/gm, '');
  // Emphasis and strikethrough markers, table pipes.
  out = out.replace(/(\*\*|__|\*|_|~~)/g, '');
  out = out.replace(/\|/g, ' ');
  // Collapse whitespace so the synthesizer does not pause on layout.
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/** How many unclosed ``` fences stand in text[0, at). Odd means we are inside a
 *  code fence, where a sentence terminator is not a real sentence end. */
function openFences(text: string, at: number): number {
  let count = 0;
  for (let i = 0; i + 2 < at; i++) {
    if (text[i] === '`' && text[i + 1] === '`' && text[i + 2] === '`') {
      count++;
      i += 2;
    }
  }
  return count;
}

const TERMINATORS = new Set(['.', '!', '?']);

/** The end index (exclusive) of the next complete sentence at or after `from`,
 *  or -1 if none has finished yet. A terminator counts as a sentence end only
 *  when it is followed by whitespace or the string end, is not a decimal point
 *  between digits, and is not inside an open code fence. A hard newline also
 *  ends a chunk, so a heading or a list item is spoken on its own. */
export function nextSentenceEnd(text: string, from: number): number {
  // Start knowing whether `from` is already inside a fence, then flip parity as
  // the scan crosses each ``` so the check stays O(n) rather than rescanning.
  let inFence = openFences(text, from) % 2 === 1;
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '`' && text[i + 1] === '`' && text[i + 2] === '`') {
      inFence = !inFence;
      i += 2;
      continue;
    }
    // Nothing inside an unclosed code fence ends a chunk, a newline included, so
    // the fence is spoken whole (as "a code block on screen") once it closes.
    if (inFence) continue;
    if (ch === '\n') {
      // A blank line (paragraph break) or a single newline both end a chunk.
      return i + 1;
    }
    if (!TERMINATORS.has(ch)) continue;
    const next = text[i + 1];
    // A decimal like 3.14 or a version 8.5 is not a sentence end.
    if (ch === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(next ?? '')) continue;
    // The terminator must be at the end or followed by whitespace.
    if (next !== undefined && !/\s/.test(next)) continue;
    return i + 1;
  }
  return -1;
}
