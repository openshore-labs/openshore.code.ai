// How much of the screen the on-screen keyboard covers, as a live CSS var
// (--kb-inset) plus a root class (kb-open) the composer reads to hug the
// keyboard with no gap (see .composer-wrap in theme.css).
//
// Registered ONCE, at the shell, never per screen. It used to live in
// ChatScreen, and that was a real bug: opening a new chat from the Chats
// room remounts ChatScreen, the composer's autofocus effect runs before the
// parent's (child effects first) and raises the keyboard while the fresh
// keyboardWillShow listener is still being registered (the Capacitor
// addListener is async), so the event was missed and the composer sat under
// the keyboard. At the shell the listener exists from boot.
//
// Belt and braces (founder, 2026-09-03, a recording of the keyboard rising
// clean over the text box after Chats, then a chat, then a tap, on the same
// build where the plain path had just worked): the lift no longer hangs on
// one event arriving with one good number.
// - Both keyboardWillShow and keyboardDidShow feed the inset, and the plain
//   window events the plugin also fires are read too.
// - A real height is remembered on the device (lib/keyboardHeight.ts); a
//   stray zero lifts by the remembered height instead of collapsing to 4px.
// - A text field that takes focus and hears no show event within a beat is
//   lifted on the remembered height anyway, and that fallback lets go on
//   blur; a real event arriving later simply overrides it.
//
// History, kept because it explains capacitor.config.ts: this once tracked
// visualViewport as a proxy and fought WKWebView's own native scroll, which
// dragged the whole page (header and the fixed greeting) when the composer
// focused. Keyboard.resize: 'none' stops WKWebView touching the page at all,
// so the greeting's fixed layout holds by construction and the only thing
// left for JS is the keyboard's exact height, which the plugin hands over.
import { useEffect } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import {
  insetForShow,
  knownKeyboardHeight,
  rememberKeyboardHeight,
} from '../lib/keyboardHeight.js';

/** How long a focused field waits for the plugin before lifting on its own.
 *  The keyboard's own slide is about 250ms; the event lands well inside that. */
export const FALLBACK_AFTER_MS = 420;

const FIELD = 'input:not([type="file"]), textarea, [contenteditable="true"]';

export function useKeyboardInset(): void {
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const rootEl = document.documentElement;
    let heard = false;
    let fallbackTimer: number | undefined;

    const lift = (height: number) => {
      rootEl.style.setProperty('--kb-inset', `${height}px`);
      rootEl.classList.add('kb-open');
    };
    const onShow = (reported: number) => {
      heard = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
      rememberKeyboardHeight(reported);
      lift(insetForShow(reported));
    };
    const onHide = () => {
      heard = false;
      rootEl.classList.remove('kb-open');
    };

    const handles = [
      Keyboard.addListener('keyboardWillShow', (info) => onShow(info.keyboardHeight)),
      Keyboard.addListener('keyboardDidShow', (info) => onShow(info.keyboardHeight)),
      Keyboard.addListener('keyboardWillHide', onHide),
      Keyboard.addListener('keyboardDidHide', onHide),
    ];
    // The plugin also fires plain window events with the same payload; a
    // second road to the same number, in case the listener road is missed.
    const onWindowShow = (e: Event) => {
      const detail = (
        e as Event & { keyboardHeight?: number; detail?: { keyboardHeight?: number } }
      ).keyboardHeight;
      const nested = (e as CustomEvent<{ keyboardHeight?: number }>).detail?.keyboardHeight;
      onShow(Number(detail ?? nested ?? 0));
    };
    window.addEventListener('keyboardWillShow', onWindowShow);
    window.addEventListener('keyboardDidShow', onWindowShow);

    // The fallback: a text field took focus, the keyboard is rising, and
    // nothing has been heard. Lift on the remembered height rather than let
    // the field sit under the keyboard.
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches(FIELD)) return;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = undefined;
        if (heard || document.activeElement !== el) return;
        lift(knownKeyboardHeight());
      }, FALLBACK_AFTER_MS);
    };
    // The fallback lets go on blur; a lift the plugin confirmed waits for the
    // plugin's own hide, which follows the keyboard rather than the focus.
    const onFocusOut = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches(FIELD)) return;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
      if (!heard) rootEl.classList.remove('kb-open');
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      for (const h of handles) void h.then((handle) => handle.remove());
      window.removeEventListener('keyboardWillShow', onWindowShow);
      window.removeEventListener('keyboardDidShow', onWindowShow);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      rootEl.classList.remove('kb-open');
    };
  }, []);
}
