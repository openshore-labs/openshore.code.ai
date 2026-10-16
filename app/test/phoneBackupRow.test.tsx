// Settings, Chats, iCloud Backup (founder, 2026-10-16), mounted for real: off by
// default, so the Vault and Chats folders stay in the closed loop; turning it
// on warns first that the files would leave it, and nothing changes until the
// person says Include them. Off needs no question.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountDom, type TestDom } from './support/dom.js';

let dom: TestDom;
let calls: boolean[];
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
  const { PhoneBackupRow } = await import('../src/components/PhoneBackupRow.js');
  await dom.render(
    <PhoneBackupRow
      device="this iPhone"
      on={on}
      onSet={(next) => {
        calls.push(next);
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

const copy = async () =>
  (await import('../src/components/PhoneBackupRow.js')).phoneBackupCopy('this iPhone');

describe('iCloud Backup for notes and chats', () => {
  it('reads off, and says they stay in the closed loop', async () => {
    const c = await copy();
    await show(false);
    expect(dom.container.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(dom.text()).toContain(c.offSub);
  });

  it('turning it on warns first that it leaves the closed loop, and changes nothing yet', async () => {
    const c = await copy();
    await show(false);
    await flip();
    expect(dom.text()).toContain(c.askTitle);
    expect(c.askBody).toMatch(/closed loop/);
    expect(c.askBody).toMatch(/private ones included/);
    expect(calls).toEqual([]);
    await dom.click(c.keepOut);
    expect(calls).toEqual([]);
  });

  it('Include them turns it on, only on that answer', async () => {
    const c = await copy();
    await show(false);
    await flip();
    await dom.click(c.include);
    expect(calls).toEqual([true]);
    expect(toasts).toEqual([c.onToast]);
  });

  it('turning it off asks nothing', async () => {
    const c = await copy();
    await show(true);
    await flip();
    expect(calls).toEqual([false]);
    expect(dom.text()).not.toContain(c.askTitle);
  });

  it('sits in Settings, Chats, on the iPhone and iPad only, off unless turned on', () => {
    const screen = readFileSync(
      new URL('../src/screens/SettingsScreen.tsx', import.meta.url),
      'utf8',
    );
    const group = screen.slice(screen.indexOf('<SettingsGroup title="Chats"'));
    expect(group).toMatch(/platform\(\) === 'ios' \? \(\s*<PhoneBackupRow/);
    expect(group).toMatch(/on=\{settings\.phoneBackup === true\}/);
    const store = readFileSync(new URL('../src/state/store.ts', import.meta.url), 'utf8');
    expect(store).toMatch(/applyPhoneBackup\(settings\.phoneBackup === true\)/);
    expect(store).toMatch(/excluded: !on/);
  });
});
