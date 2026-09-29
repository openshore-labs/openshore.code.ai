// Code highlighting, loaded on first need. highlight.js (with rehype-highlight
// over it) is about 320 KB, and a launch used to carry all of it for a chat
// that may never show a code block. It now arrives the first time a message
// holds a fenced block; until then the block renders as plain, readable code
// in the same box, and the tint lands in place when the chunk does (the
// highlight classes only colour spans, so nothing moves). Every Markdown
// surface shares the one load.
import { useEffect, useSyncExternalStore } from 'react';

type RehypeHighlight = typeof import('rehype-highlight').default;

let loaded: RehypeHighlight | undefined;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

/** Start the one load. A failed load (offline in a dev server, a chunk gone
 *  after an update) leaves the blocks plain and lets a later block try again. */
export function loadHighlighter(): Promise<void> {
  loading ??= import('rehype-highlight').then(
    (m) => {
      loaded = m.default;
      for (const notify of listeners) notify();
    },
    () => {
      loading = undefined;
    },
  );
  return loading;
}

/** Whether markdown text holds a fenced code block, the only thing the
 *  highlighter tints (an indented block has no language to highlight). */
export function hasCodeFence(text: string): boolean {
  return /^ {0,3}(?:```|~~~)/m.test(text);
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

const current = () => loaded;

/** The highlighter plugin once it has arrived; asks for it the first time a
 *  caller `wants` it. Undefined until then, and whenever it is not wanted. */
export function useHighlighter(wants: boolean): RehypeHighlight | undefined {
  const plugin = useSyncExternalStore(subscribe, current, current);
  useEffect(() => {
    if (wants && !loaded) void loadHighlighter();
  }, [wants]);
  return wants ? plugin : undefined;
}
