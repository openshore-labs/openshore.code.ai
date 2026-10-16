// Settings, Chats, Save chats as files (founder, 2026-10-16), mounted for
// real: on by default, and turning it off asks first in a confirm sheet
// whether the files already written go too. Nothing is removed without that
// answer, and closing the sheet keeps the switch on.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountDom, type TestDom } from './support/dom.js';

let dom: TestDom;
let calls: Array<{ on: boolean; removeFiles?: boolean }>;
let toasts: string[];

beforeEach(async () => {
  dom = await mountDom();
  calls = [];
  toasts = [];
});
afterEach(async () => {
  await dom.unmount();
});

async function show(on: boolean) {
  const { ChatFilesRow } = await import('../src/components/ChatFilesRow.js');
  await dom.render(
    <ChatFilesRow
      where="In OpenShore/Chats on this computer, one markdown file per chat."
      on={on}
      onSet={(next, opts) => {
        calls.push({ on: next, ...(opts?.removeFiles ? { removeFiles: true } : {}) });
      }}
      toast={(t) => toasts.push(t)}
    />,
  );
}

async function flip() {
  const { act } = await import('react');
  const sw = dom.container.querySelector('[role="switch"]') as HTMLElement;
  await act(async () => {
    sw.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

describe('Save chats as files', () => {
  it('shows the label, where the files go, and the switch on', async () => {
    const { CHAT_FILES_COPY } = await import('../src/components/ChatFilesRow.js');
    await show(true);
    expect(dom.text()).toContain(CHAT_FILES_COPY.label);
    expect(dom.text()).toContain('In OpenShore/Chats on this computer');
    const sw = dom.container.querySelector('[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-label')).toBe('Save chats as files');
  });

  it('turning it off asks first, and changes nothing until answered', async () => {
    const { CHAT_FILES_COPY: c } = await import('../src/components/ChatFilesRow.js');
    await show(true);
    await flip();
    expect(dom.text()).toContain(c.offTitle);
    expect(dom.text()).toContain(c.offBody);
    expect(dom.buttons()).toEqual(expect.arrayContaining([c.keep, c.remove]));
    expect(calls).toEqual([]);
  });

  it('Keep the files turns it off and removes nothing', async () => {
    const { CHAT_FILES_COPY: c } = await import('../src/components/ChatFilesRow.js');
    await show(true);
    await flip();
    await dom.click(c.keep);
    expect(calls).toEqual([{ on: false }]);
    expect(toasts).toEqual([c.keptToast]);
  });

  it('Remove the files turns it off and removes them, only on that answer', async () => {
    const { CHAT_FILES_COPY: c } = await import('../src/components/ChatFilesRow.js');
    await show(true);
    await flip();
    await dom.click(c.remove);
    expect(calls).toEqual([{ on: false, removeFiles: true }]);
    expect(toasts).toEqual([c.removedToast]);
  });

  it('turning it on asks nothing', async () => {
    const { CHAT_FILES_COPY: c } = await import('../src/components/ChatFilesRow.js');
    await show(false);
    await flip();
    expect(calls).toEqual([{ on: true }]);
    expect(dom.text()).not.toContain(c.offTitle);
  });

  it('sits in Settings, Chats, beside Clear chats, through the store’s one action', () => {
    const screen = readFileSync(
      new URL('../src/screens/SettingsScreen.tsx', import.meta.url),
      'utf8',
    );
    const group = screen.slice(screen.indexOf('<SettingsGroup title="Chats"'));
    expect(group.indexOf('<ChatFilesRow')).toBeGreaterThan(-1);
    expect(group.indexOf('<ChatFilesRow')).toBeLessThan(group.indexOf('label="Clear chats"'));
    expect(group).toMatch(/onSet=\{setChatFiles\}/);
    expect(screen).toMatch(/where=\{chatFilesSub\}/);
    expect(screen).toMatch(/const chatFilesSub = chatFilesWhere\(platform\(\)\);/);
  });
});
