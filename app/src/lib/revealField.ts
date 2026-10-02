// Bring a focused field to rest just above the on-screen keyboard. The webview
// never resizes for the keyboard (capacitor.config.ts sets Keyboard.resize:
// 'none'), so the keyboard simply covers the bottom of the page; a room gains
// room to scroll under it from the kb-open padding in theme.css, and this
// moves the field's own scroller so the field sits a small gap above the
// keyboard, where the person can see what they type.

/** The gap left between a revealed field and the top of the keyboard. */
export const REVEAL_GAP = 16;

/** How far to scroll (positive is down) so a field whose bottom edge is at
 *  `fieldBottom` sits `gap` above a keyboard of `inset` on a viewport
 *  `viewportHeight` tall. Zero when the field is already clear. */
export function revealDelta(
  fieldBottom: number,
  viewportHeight: number,
  inset: number,
  gap = REVEAL_GAP,
): number {
  const visibleBottom = viewportHeight - inset - gap;
  return fieldBottom > visibleBottom ? fieldBottom - visibleBottom : 0;
}

/** The nearest ancestor that scrolls vertically, else the document's. */
export function scrollParentOf(el: Element): Element {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement ?? document.documentElement;
}
