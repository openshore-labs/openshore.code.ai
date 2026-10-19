// A chat's right-click menu (founder, 2026-10-19): right-click a recent chat
// in the sidebar, or any chat in the Chats room, for Open, Rename and Delete.
// Delete asks first. The menu stays inside the window and leaves the way it
// came (components/ChatMenu.tsx).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mountDom } from './support/dom.js';

const dom = await mountDom();

vi.mock('../src/state/store.js', () => ({ useApp: () => ({}) }));

const { ChatContextMenu, clampMenu } = await import('../src/components/ChatMenu.js');
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('where the menu opens', () => {
  const view = { width: 800, height: 600 };
  const size = { width: 170, height: 120 };

  it('opens at the pointer when it fits', () => {
    expect(clampMenu({ x: 100, y: 100 }, size, view)).toEqual({ left: 100, top: 100 });
  });

  it('stays inside the right edge, and opens upward near the bottom', () => {
    expect(clampMenu({ x: 790, y: 580 }, size, view)).toEqual({ left: 622, top: 460 });
  });
});

describe('the menu', () => {
  it('lists its actions, and a pick closes it and runs the action', async () => {
    const picked: string[] = [];
    let closed = 0;
    await dom.render(
      <ChatContextMenu
        at={{ x: 10, y: 10 }}
        label="Chat actions"
        onClose={() => closed++}
        items={[
          { label: 'Open', onSelect: () => picked.push('open') },
          { label: 'Rename', onSelect: () => picked.push('rename') },
          { label: 'Delete', danger: true, onSelect: () => picked.push('delete') },
        ]}
      />,
    );
    // A portal: the menu sits on the body, above every transformed panel.
    const rows = () =>
      Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(rows().map((b) => b.textContent)).toEqual(['Open', 'Rename', 'Delete']);
    expect(document.body.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe(
      'Chat actions',
    );
    rows()[2]!.click();
    await dom.settle();
    expect(picked).toEqual(['delete']);
    expect(closed).toBe(1);
    await dom.unmount();
  });
});

describe('every chat list offers it', () => {
  it('the sidebar recents open it on a right-click', () => {
    const sidebar = read('src', 'components', 'Sidebar.tsx');
    const recents = sidebar.slice(sidebar.indexOf('function RecentChats('));
    expect(recents).toContain('onContextMenu={(e) => actions.openMenu(e, c.id)}');
    expect(recents).toContain('{actions.node}');
  });

  it('the Chats room opens it on a right-click, where it once only renamed', () => {
    const chats = read('src', 'screens', 'ChatsScreen.tsx');
    expect(chats).toContain('onContextMenu={(e) => actions.openMenu(e, row.id)}');
    expect(chats).toContain('Right-click for more.');
  });

  it('offers Open, Rename and Delete, and Delete asks before anything goes', () => {
    const menu = read('src', 'components', 'ChatMenu.tsx');
    expect(menu).toMatch(/label: 'Open'[\s\S]*label: 'Rename'[\s\S]*label: 'Delete', danger: true/);
    expect(menu).toContain('onSelect: () => confirmDelete(menuId)');
    expect(menu).toContain('<h3>Delete this chat?</h3>');
  });
});
