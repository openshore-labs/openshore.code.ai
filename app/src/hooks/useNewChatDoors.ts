// The new-chat doors that live outside any one screen: the keyboard shortcut
// and the desktop's tray and Dock menus (lib/newChat.ts). Mounted once, in App.
import { useEffect } from 'react';
import { bridge } from '../lib/electronBridge.js';
import { isMacLike, isNewChatKey, newChatTarget } from '../lib/newChat.js';
import { platform } from '../lib/platform.js';
import { useApp } from '../state/store.js';

/** Open a new chat from where the person is: a project chat inside a
 *  project's room, a plain chat everywhere else. */
export function openNewChatHere(): void {
  const s = useApp.getState();
  const target = newChatTarget(s);
  if (target.kind === 'project') s.startProjectChat(target.projectId);
  else s.startNewChat();
}

export function useNewChatDoors(): void {
  useEffect(() => {
    const plat = platform();
    const mac = isMacLike();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || !isNewChatKey(e, plat, mac)) return;
      // A sheet holds the keyboard while it is open; the shortcut waits.
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      openNewChatHere();
    };
    window.addEventListener('keydown', onKey);
    // The tray and the Dock menu ask for a plain chat: they are outside the
    // app, so there is no room to read a project from.
    const off = bridge()?.onNewChat?.(() => useApp.getState().startNewChat());
    return () => {
      window.removeEventListener('keydown', onKey);
      off?.();
    };
  }, []);
}
