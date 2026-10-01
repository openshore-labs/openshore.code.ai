// The Delete account row and its sheets (CX ruling 3), mounted in a real
// (small) DOM: the row shows only while signed in, the confirm sheet asks
// once with CX's words, "Deleting..." holds both choices while the server
// works, a failure says so and leaves the choice open, a request for a
// recent sign-in (the live 2026-09-24 function) says what to do and that
// nothing was deleted, owns_org explains the one step first with a way to
// write to the one published address, the goodbye carries the Apple note
// when the person pays through Apple, as an if when the server did not say,
// a subscription that could not be stopped says so, an answer nobody could
// confirm says exactly that (never "was not deleted") and leaves the choice
// open, and a sign-in that died underneath says the device is signed out
// without claiming the account is gone or still there, whichever device
// deleted it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeleteAccountOutcome } from '../src/state/accountDeletion.js';
import { mountDom, type TestDom } from './support/dom.js';

const opened = vi.hoisted(() => [] as string[]);
vi.mock('../src/lib/platform.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/platform.js')>();
  return { ...real, openExternal: (url: string) => opened.push(url) };
});

let dom: TestDom;
let done: number;

beforeEach(async () => {
  dom = await mountDom();
  done = 0;
  opened.length = 0;
});
afterEach(async () => {
  await dom.unmount();
});

async function show(signedIn: boolean, onDelete: () => Promise<DeleteAccountOutcome>) {
  const { DeleteAccount } = await import('../src/components/DeleteAccount.js');
  await dom.render(<DeleteAccount signedIn={signedIn} onDelete={onDelete} onDone={() => done++} />);
}

async function copy() {
  return (await import('../src/components/DeleteAccount.js')).DELETE_ACCOUNT_COPY;
}

/** The row is a button whose text is its label and its sub. */
async function tapRow() {
  const c = await copy();
  await dom.click(`${c.row}${c.rowSub}`);
}

describe('the Delete account row', () => {
  it('is not there while signed out', async () => {
    await show(false, async () => ({ kind: 'failed' }));
    expect(dom.text()).not.toContain('Delete account');
  });

  it('is there while signed in, in the danger style, with what it does', async () => {
    const c = await copy();
    await show(true, async () => ({ kind: 'failed' }));
    expect(dom.text()).toContain(c.row);
    expect(dom.text()).toContain(c.rowSub);
    expect(dom.container.querySelector('.settings-row.danger')).not.toBeNull();
  });
});

describe('the confirm sheet', () => {
  it('asks once, in plain words, with Keep my account beside Delete account', async () => {
    const c = await copy();
    let calls = 0;
    await show(true, async () => {
      calls++;
      return { kind: 'failed' };
    });
    await tapRow();
    expect(dom.text()).toContain(c.title);
    expect(dom.text()).toContain(c.body);
    expect(dom.buttons()).toEqual(expect.arrayContaining([c.keep, c.confirm]));
    expect(calls).toBe(0);
  });

  it('holds both choices at Deleting... while the server works', async () => {
    const c = await copy();
    let finish: (o: DeleteAccountOutcome) => void = () => {};
    await show(true, () => new Promise((resolve) => (finish = resolve)));
    await tapRow();
    await dom.click(c.confirm);
    expect(dom.buttons()).toContain(c.working);
    const held = [...dom.container.querySelectorAll('button')].filter(
      (b) => b.textContent === c.working || b.textContent === c.keep,
    );
    expect(held.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    finish({ kind: 'failed' });
    await dom.settle();
  });

  it('says it was not deleted, and leaves the choice open, when it fails', async () => {
    const c = await copy();
    await show(true, async () => ({ kind: 'failed' }));
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    expect(dom.text()).toContain(c.failed);
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toBe(c.failed);
    expect(dom.buttons()).toContain(c.confirm);
  });

  it('asks for a recent sign-in, says nothing was deleted, and leaves the choice open', async () => {
    const c = await copy();
    await show(true, async () => ({ kind: 'reauth_required' }));
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toBe(c.reauth);
    expect(c.reauth).toMatch(/^Your account was not deleted\./);
    expect(c.reauth).toMatch(
      /sign out, sign back in, then delete your account within ten minutes\.$/,
    );
    expect(dom.text()).not.toContain(c.failed);
    expect(dom.buttons()).toEqual(expect.arrayContaining([c.keep, c.confirm]));
  });

  it('says a subscription could not be stopped, and leaves the choice open', async () => {
    const c = await copy();
    await show(true, async () => ({ kind: 'billing' }));
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toBe(c.billing);
    expect(c.billing).toMatch(
      /^Your account was not deleted: a subscription could not be stopped\./,
    );
    expect(c.billing).toContain('support@openshore.ai');
    expect(c.billing).not.toMatch(/connection/);
    expect(dom.buttons()).toEqual(expect.arrayContaining([c.keep, c.confirm]));
  });

  it('says it could not confirm the deletion, never that it was not deleted, and leaves the choice open', async () => {
    const c = await copy();
    await show(true, async () => ({ kind: 'unconfirmed' }));
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toBe(c.unconfirmed);
    expect(c.unconfirmed).toBe(
      'We could not confirm whether your account was deleted. Check your connection and try again.',
    );
    expect(c.unconfirmed).not.toMatch(/was not deleted|is deleted/);
    expect(dom.text()).not.toContain(c.failed);
    expect(dom.text()).not.toContain(c.doneTitle);
    expect(dom.text()).not.toContain(c.signedOutTitle);
    expect(dom.buttons()).toEqual(expect.arrayContaining([c.keep, c.confirm]));
    expect(done).toBe(0);
  });

  it('says the device is signed out, claiming nothing about the account, when the sign-in died', async () => {
    const c = await copy();
    const { DeleteAccount } = await import('../src/components/DeleteAccount.js');
    const onDelete = async (): Promise<DeleteAccountOutcome> => ({ kind: 'signed_out' });
    await show(true, onDelete);
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    expect(dom.text()).toContain(c.signedOutTitle);
    expect(dom.text()).toContain(c.signedOutBody);
    expect(dom.text()).not.toContain(c.failed);
    expect(dom.text()).not.toContain(c.doneTitle);
    expect(c.signedOutBody).not.toMatch(/was not deleted|is deleted/);
    // It fits a deletion on this device (a retry after a lost answer) as
    // well as on another one.
    expect(c.signedOutBody).toContain(
      'If your account was already deleted, here or on another device, it is gone. If not, sign in again and try once more.',
    );
    expect(c.signedOutBody).not.toMatch(/you already deleted your account on another device/);
    // The store signed the device out: the row goes, the note stays until Close.
    await dom.render(<DeleteAccount signedIn={false} onDelete={onDelete} onDone={() => done++} />);
    expect(dom.text()).not.toContain(c.rowSub);
    expect(dom.text()).toContain(c.signedOutTitle);
    expect(dom.buttons()).not.toContain(c.confirm);
    await dom.click(c.close);
    await dom.settle();
    expect(done).toBe(0);
  });

  it('explains the one step first when the person owns a team with others in it', async () => {
    const c = await copy();
    await show(true, async () => ({ kind: 'owns_org' }));
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    expect(dom.text()).toContain(c.ownsOrgTitle);
    expect(dom.text()).toContain(c.ownsOrgBody);
    await dom.click(c.emailSupport);
    expect(opened).toEqual(['mailto:support@openshore.ai']);
    expect(dom.buttons()).toContain(c.close);
  });

  it('says goodbye with the Apple note when the person pays through Apple', async () => {
    const c = await copy();
    await show(true, async () => ({ kind: 'deleted', appleNote: true }));
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    expect(dom.text()).toContain(c.doneTitle);
    expect(dom.text()).toContain(c.doneBody);
    expect(dom.text()).toContain(c.appleNote);
    await dom.click(c.done);
    expect(done).toBe(1);
  });

  // With the pay gates off (the first submission, 2026-10-01) nothing can be
  // bought, so the "if you pay" line is left out until Plus returns.
  it('leaves the Apple "if" line out while the pay gates are off', async () => {
    const c = await copy();
    await show(true, async () => ({ kind: 'deleted' }));
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    expect(dom.text()).toContain(c.doneTitle);
    expect(dom.text()).not.toContain(c.appleNoteIf);
    expect(dom.text()).not.toContain(c.appleNote);
  });

  it('leaves the Apple note out when there is no Apple subscription', async () => {
    const c = await copy();
    await show(true, async () => ({ kind: 'deleted', appleNote: false }));
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    expect(dom.text()).toContain(c.doneTitle);
    expect(dom.text()).not.toContain(c.appleNote);
    expect(dom.text()).not.toContain(c.appleNoteIf);
  });

  it('keeps the goodbye on screen after the signed-in row is gone', async () => {
    const c = await copy();
    const { DeleteAccount } = await import('../src/components/DeleteAccount.js');
    const onDelete = async (): Promise<DeleteAccountOutcome> => ({
      kind: 'deleted',
      appleNote: false,
    });
    await show(true, onDelete);
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    // The store has signed the device out: the row goes, the goodbye stays.
    await dom.render(<DeleteAccount signedIn={false} onDelete={onDelete} />);
    expect(dom.text()).not.toContain(c.rowSub);
    expect(dom.text()).toContain(c.doneTitle);
  });
});

describe('where the row lives', () => {
  it('is in the Your account sheet, after the signed-in card, wired to the store', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const settings = readFileSync(
      join(process.cwd(), 'src', 'screens', 'SettingsScreen.tsx'),
      'utf8',
    );
    const sheet = settings.slice(settings.indexOf("<Sheet open={sheet === 'account'}"));
    const card = sheet.indexOf('<SignInCard />');
    const row = sheet.indexOf(
      '<DeleteAccount signedIn={signedIn} onDelete={deleteAccount} onDone={close} />',
    );
    expect(card).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(card);
    expect(row).toBeLessThan(sheet.indexOf('</Sheet>'));
  });
});
