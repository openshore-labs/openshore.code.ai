// Keyboard focus stays inside an open sheet. Every sheet in the app renders a
// `.sheet` inside a `.sheet-scrim` (the model sheet, approvals, the paywall,
// the vault storage picker, and so on), so one app-level trap covers all of
// them without threading a ref through each: while a sheet is open and not
// already playing its exit, Tab and Shift+Tab wrap within it, and focus moves
// into it when it appears so a keyboard user is not left on the page behind.
// A dialog should behave like a dialog; this is the last a11y gap the polish
// pass had left open.
import { useEffect } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The topmost open sheet, or null when none is open. */
export function openSheet(root: Document | HTMLElement = document): HTMLElement | null {
  const sheets = root.querySelectorAll<HTMLElement>('.sheet:not(.closing)');
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

    // When a sheet appears, move focus into it (its first control) unless the
    // sheet already holds focus, e.g. an autofocused field.
    const obs = new MutationObserver(() => {
      const sheet = openSheet();
      if (!sheet || sheet.contains(document.activeElement)) return;
      const first = sheet.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('keydown', onKey);
      obs.disconnect();
    };
  }, []);
}
