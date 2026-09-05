// Keyboard focus stays inside an open dialog. Every sheet in the app renders a
// `.sheet` inside a `.sheet-scrim` (the model sheet, approvals, the paywall,
// the vault storage picker, and so on), the confirm variant a `.confirm-card`,
// and the compact drawer a `.sidebar.drawer`, so one app-level trap covers all
// of them without threading a ref through each: while a dialog is open and not
// already playing its exit, Tab and Shift+Tab wrap within it, focus moves into
// it when it appears so a keyboard user is not left on the page behind, and
// when it goes the opener gets focus back (UI-9). A dialog should behave like
// a dialog.
import { useEffect } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Every surface that should trap focus while open. */
export const DIALOG =
  '.sheet:not(.closing), .confirm-card:not(.closing), .sidebar.drawer:not(.closing)';

/** The topmost open dialog, or null when none is open. */
export function openSheet(root: Document | HTMLElement = document): HTMLElement | null {
  const sheets = root.querySelectorAll<HTMLElement>(DIALOG);
  return sheets.length ? sheets[sheets.length - 1]! : null;
}

/** Where Tab should land next inside `sheet`, wrapping at either end. Pure, so
 *  the wrap logic is testable without a DOM event. */
export function nextFocus(
  focusables: HTMLElement[],
  active: Element | null,
  backwards: boolean,
): HTMLElement | undefined {
  if (!focusables.length) return undefined;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const idx = active ? focusables.indexOf(active as HTMLElement) : -1;
  if (idx === -1) return backwards ? last : first;
  if (backwards) return idx === 0 ? last : focusables[idx - 1];
  return idx === focusables.length - 1 ? first : focusables[idx + 1];
}

/** The shape of a mutation record this trap cares about: only the node lists,
 *  so the filter is testable without a DOM. */
export interface MutationLike {
  addedNodes: ArrayLike<Node>;
  removedNodes: ArrayLike<Node>;
}

/** Did any of these mutations add or remove a dialog root (or a subtree that
 *  holds one)? Streamed text arrives as text nodes inside a message bubble,
 *  which this says no to cheaply, so the observer never walks the whole
 *  document per token. `.closing` is a class flip, not a mutation this sees;
 *  the dialog is caught on its real removal a beat later. */
export function mutationTouchesDialog(records: ArrayLike<MutationLike>): boolean {
  const selector = '.sheet, .confirm-card, .sidebar.drawer';
  const holdsDialog = (node: Node): boolean => {
    if (node.nodeType !== 1) return false;
    const el = node as Element;
    return el.matches(selector) || el.querySelector(selector) !== null;
  };
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    for (let j = 0; j < r.addedNodes.length; j++) if (holdsDialog(r.addedNodes[j]!)) return true;
    for (let j = 0; j < r.removedNodes.length; j++)
      if (holdsDialog(r.removedNodes[j]!)) return true;
  }
  return false;
}

export function useSheetFocusTrap(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const sheet = openSheet();
      if (!sheet) return;
      const focusables = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      const target = nextFocus(focusables, document.activeElement, e.shiftKey);
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    document.addEventListener('keydown', onKey);

    // The dialog that currently holds focus, and where focus came from, so
    // it can be handed back when the dialog goes.
    let current: HTMLElement | null = null;
    let opener: HTMLElement | null = null;
    const sync = () => {
      const sheet = openSheet();
      if (sheet === current) return;
      if (sheet) {
        const active = document.activeElement as HTMLElement | null;
        if (!current && active && active !== document.body && !sheet.contains(active)) {
          opener = active;
        }
        current = sheet;
        // Move focus into it (its first control) unless the dialog already
        // holds focus, e.g. an autofocused field.
        if (!sheet.contains(document.activeElement)) {
          sheet.querySelector<HTMLElement>(FOCUSABLE)?.focus();
        }
        return;
      }
      // The last dialog closed: give focus back to whatever opened it, if it
      // is still on the page and focus has not moved somewhere deliberate.
      current = null;
      const active = document.activeElement;
      if (opener && opener.isConnected && (!active || active === document.body)) {
        opener.focus();
      }
      opener = null;
    };
    const obs = new MutationObserver((records) => {
      if (mutationTouchesDialog(records)) sync();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('keydown', onKey);
      obs.disconnect();
    };
  }, []);
}
