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
// History, kept because it explains capacitor.config.ts: this once tracked
// visualViewport as a proxy and fought WKWebView's own native scroll, which
// dragged the whole page (header and the fixed greeting) when the composer
// focused. Keyboard.resize: 'none' stops WKWebView touching the page at all,
// so the greeting's fixed layout holds by construction and the only thing
// left for JS is the keyboard's exact height, which the plugin hands over.
import { useEffect } from 'react';
import { Keyboard } from '@capacitor/keyboard';

export function useKeyboardInset(): void {
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const rootEl = document.documentElement;
    const showHandle = Keyboard.addListener('keyboardWillShow', (info) => {
      rootEl.style.setProperty('--kb-inset', `${info.keyboardHeight}px`);
      rootEl.classList.add('kb-open');
    });
    const hideHandle = Keyboard.addListener('keyboardWillHide', () => {
      rootEl.classList.remove('kb-open');
    });
    return () => {
      void showHandle.then((h) => h.remove());
      void hideHandle.then((h) => h.remove());
      rootEl.classList.remove('kb-open');
    };
  }, []);
}
