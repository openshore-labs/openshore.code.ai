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

/** A field rests with its primary action where its container asks for it
 *  (UX review, 2026-10-02): a block marked `data-reveal-with` names its commit
 *  button with `data-reveal-primary`, and the two rise together so Save is
 *  never under the keyboard. Unmarked fields rise alone, as before. */
export function revealActionOf(field: Element): Element | undefined {
  const group = field.closest('[data-reveal-with]');
  return group?.querySelector('[data-reveal-primary]') ?? undefined;
}

/** How far to scroll so the field, and its action when it has one, sit the
 *  gap above the keyboard, capped so the field's top never rises past
 *  `viewTop` (the bottom of the room's bar). When both cannot fit, the
 *  field wins. */
export function revealPlan(opts: {
  fieldTop: number;
  fieldBottom: number;
  actionBottom?: number;
  viewTop: number;
  viewportHeight: number;
  inset: number;
  gap?: number;
}): number {
  const gap = opts.gap ?? REVEAL_GAP;
  const forField = revealDelta(opts.fieldBottom, opts.viewportHeight, opts.inset, gap);
  if (opts.actionBottom === undefined) return forField;
  const forAction = revealDelta(opts.actionBottom, opts.viewportHeight, opts.inset, gap);
  const cap = opts.fieldTop - (opts.viewTop + gap);
  return Math.max(forField, Math.min(forAction, cap));
}

/** The top of a scroller's visible area: under its own sticky bar when it
 *  has one, else its own top edge. */
export function viewTopOf(scroller: Element): number {
  const bar = scroller.querySelector(':scope > .topbar');
  return (bar ?? scroller).getBoundingClientRect()[bar ? 'bottom' : 'top'];
}
