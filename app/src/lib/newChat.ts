// The quick doors to a new chat (Creative Studio, 2026-10-12, built on the
// founder's yes): the drawer's floating button, the desktop sidebar's compose
// icon, the keyboard shortcut, `/new`, and the tray and Dock menus. Each one
// starts a plain chat, the claude.ai side, except a door used from inside a
// project's room, which starts a chat in that project. Where you are decides
// it; no door hides a mode.

import type { Platform } from './platform.js';

export type NewChatTarget = { kind: 'plain' } | { kind: 'project'; projectId: string };

/** What a context-aware door (the shortcut, `/new`) opens from here. The
 *  drawer's button is always plain: the drawer is global. */
export function newChatTarget(s: { view: string; viewProjectId?: string }): NewChatTarget {
  return s.view === 'project' && s.viewProjectId
    ? { kind: 'project', projectId: s.viewProjectId }
    : { kind: 'plain' };
}

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The new-chat shortcut: Cmd+N (Ctrl+N off a Mac) in the desktop app, and
 *  Cmd+Shift+O (Ctrl+Shift+O) in a browser, which keeps Cmd+N for a window.
 *  The phone has no shortcut. */
export function isNewChatKey(e: KeyLike, platform: Platform, mac: boolean): boolean {
  if (platform === 'ios' || e.altKey) return false;
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return false;
  const key = e.key.toLowerCase();
  if (platform === 'electron') return key === 'n' && !e.shiftKey;
  return key === 'o' && e.shiftKey;
}

/** The hint a tooltip shows beside "New chat", or nothing on the phone. */
export function newChatShortcutLabel(platform: Platform, mac: boolean): string | undefined {
  if (platform === 'ios') return undefined;
  const mod = mac ? 'Cmd' : 'Ctrl';
  return platform === 'electron' ? `${mod}+N` : `${mod}+Shift+O`;
}

export function isMacLike(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
}
