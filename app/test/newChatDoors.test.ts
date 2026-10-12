// The quick doors to a new chat (Creative Studio, 2026-10-12): the drawer's
// floating button, the desktop sidebar's compose icon, the shortcut, /new,
// and the tray and Dock menus. Plain everywhere but a project's room.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNewChatKey, newChatShortcutLabel, newChatTarget } from '../src/lib/newChat.js';
import { trayMenuTemplate } from '../electron/lifecycle.js';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const key = (
  k: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {},
) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('where a new chat opens', () => {
  it('is plain everywhere but a project room, where it joins the project', () => {
    expect(newChatTarget({ view: 'chat' })).toEqual({ kind: 'plain' });
    expect(newChatTarget({ view: 'chats', viewProjectId: 'p1' })).toEqual({ kind: 'plain' });
    expect(newChatTarget({ view: 'project', viewProjectId: 'p1' })).toEqual({
      kind: 'project',
      projectId: 'p1',
    });
  });
});

describe('the shortcut', () => {
  it('is Cmd+N on a Mac desktop and Ctrl+N elsewhere', () => {
    expect(isNewChatKey(key('n', { metaKey: true }), 'electron', true)).toBe(true);
    expect(isNewChatKey(key('n', { ctrlKey: true }), 'electron', false)).toBe(true);
    expect(isNewChatKey(key('n', { ctrlKey: true }), 'electron', true)).toBe(false);
    expect(isNewChatKey(key('n', { metaKey: true, shiftKey: true }), 'electron', true)).toBe(false);
  });

  it('leaves Cmd+N to the browser on the web', () => {
    expect(isNewChatKey(key('n', { metaKey: true }), 'web', true)).toBe(false);
    expect(isNewChatKey(key('O', { metaKey: true, shiftKey: true }), 'web', true)).toBe(true);
    expect(newChatShortcutLabel('web', false)).toBe('Ctrl+Shift+O');
  });

  it('has none on the phone', () => {
    expect(isNewChatKey(key('n', { metaKey: true }), 'ios', true)).toBe(false);
    expect(newChatShortcutLabel('ios', true)).toBeUndefined();
  });
});

describe('the doors', () => {
  const sidebar = read('src/components/Sidebar.tsx');
  const css = read('src/theme.css');

  it('floats the drawer button over the foot, plain, with the compose glyph', () => {
    expect(sidebar).toMatch(
      /\{drawer \? \(\s*<button[\s\S]{0,80}className="sidebar-fab press-fb"[\s\S]{0,120}onClick=\{\(\) => startNewChat\(\)\}[\s\S]{0,60}aria-label="New chat"[\s\S]{0,40}<ComposeGlyph/,
    );
    // An action, never a nav row.
    expect(sidebar).not.toMatch(/view: 'newchat'|label: 'New chat'/);
  });

  it('arrives and leaves with the door on its tokens', () => {
    expect(css).toMatch(/\.sidebar\.drawer \.sidebar-fab \{\s*animation: drawer-row-in/);
    expect(css).toMatch(/\.sidebar\.drawer\.via-gesture \.sidebar-fab,/);
    expect(css).toMatch(/\.sidebar\.drawer\.entered \.sidebar-fab \{\s*animation: none/);
    const fab = css.match(/\.sidebar-fab \{[^}]*\}/)![0];
    expect(fab).toMatch(/box-shadow: var\(--elev-2\)/);
    expect(fab).not.toMatch(/cubic-bezier|transition/);
  });

  it('gives the persistent sidebar a compose icon instead', () => {
    expect(sidebar).toMatch(/\{!drawer \? \(\s*<button[\s\S]{0,80}sidebar-compose press-fb/);
  });

  it('offers New chat in the tray, after Open', () => {
    expect(trayMenuTemplate({ hubRunning: true }).map((i) => i.id)).toEqual([
      'open',
      'new',
      'hub',
      'quit',
    ]);
    const main = read('electron/main.ts');
    expect(main).toMatch(/webContents\.send\('osc:new-chat'\)/);
    expect(main).toMatch(/app\.dock\?\.setMenu\(/);
    expect(read('electron/preload.cjs')).toMatch(/onNewChat: listen\('osc:new-chat'\)/);
  });

  it('adds /new beside /clear', () => {
    expect(read('src/components/Composer.tsx')).toMatch(
      /\{ name: 'new', hint: 'Start a new chat' \}/,
    );
    expect(read('src/screens/ChatScreen.tsx')).toMatch(
      /case 'new':\s*case 'clear':\s*startNewChat\(\)/,
    );
  });
});
