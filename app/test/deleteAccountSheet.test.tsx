// The Delete account row and its sheets (UX review ruling 3), mounted in a real
// (small) DOM: the row shows only while signed in, the confirm sheet asks
// once with UX review's words, "Deleting..." holds both choices while the server
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
    const card = sheet.indexOf('<SignInCard variant="sheet" />');
    const row = sheet.search(
      /<DeleteAccount\s+signedIn=\{signedIn\}\s+onDelete=\{deleteAccount\}\s+reauth=\{deleteReauth\}\s+onDone=\{close\}\s+\/>/,
    );
    expect(card).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(card);
    expect(row).toBeLessThan(sheet.indexOf('</Sheet>'));
  });

  it('gets the code step in the Profile sheet too', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const profile = readFileSync(
      join(process.cwd(), 'src', 'components', 'ProfileSheet.tsx'),
      'utf8',
    );
    expect(profile).toMatch(/<DeleteAccount[^>]*reauth=\{deleteReauth\}/);
  });
});

// ---- a recent sign-in (the security review's F2, 2026-10-21)

interface Reauth {
  email: string;
  sendCode: () => Promise<void>;
  confirmCode: (code: string) => Promise<void>;
  sent: number;
  confirmed: string[];
}

function reauthFake(over: Partial<Pick<Reauth, 'sendCode' | 'confirmCode'>> = {}): Reauth {
  const r: Reauth = {
    email: 'sam@example.com',
    sent: 0,
    confirmed: [],
    sendCode: async () => {
      r.sent++;
    },
    confirmCode: async (code: string) => {
      r.confirmed.push(code);
    },
  };
  if (over.sendCode) {
    const send = over.sendCode;
    r.sendCode = async () => {
      r.sent++;
      await send();
    };
  }
  if (over.confirmCode) {
    const confirm = over.confirmCode;
    r.confirmCode = async (code: string) => {
      r.confirmed.push(code);
      await confirm(code);
    };
  }
  return r;
}

async function showWithReauth(onDelete: () => Promise<DeleteAccountOutcome>, reauth: Reauth) {
  const { DeleteAccount } = await import('../src/components/DeleteAccount.js');
  await dom.render(
    <DeleteAccount signedIn onDelete={onDelete} reauth={reauth} onDone={() => done++} />,
  );
}

/** The sheet on screen now: one that is not playing its exit. */
const live = () => [...dom.container.querySelectorAll('.confirm-card:not(.closing)')];
const liveText = () =>
  live()
    .map((el) => el.textContent ?? '')
    .join(' ');

/** Tap a button in a sheet that is not leaving (the ask and the code sheet
 *  share labels while one leaves and the other arrives). */
async function tapLive(label: string) {
  const { act } = await import('react');
  const button = live()
    .flatMap((el) => [...el.querySelectorAll('button')])
    .find((b) => b.textContent === label);
  if (!button) throw new Error(`No live "${label}" button in: ${liveText()}`);
  await act(async () => {
    button.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

const liveButton = (label: string) =>
  live()
    .flatMap((el) => [...el.querySelectorAll('button')])
    .find((b) => b.textContent === label) as HTMLButtonElement | undefined;

describe('a recent sign-in, by email code', () => {
  it('goes straight to the goodbye when the session is recent (the server never asks)', async () => {
    const c = await copy();
    const r = reauthFake();
    let calls = 0;
    await showWithReauth(async () => {
      calls++;
      return { kind: 'deleted', appleNote: false };
    }, r);
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    expect(calls).toBe(1);
    expect(r.sent).toBe(0);
    expect(liveText()).not.toContain(c.codeTitle);
    expect(liveText()).toContain(c.doneTitle);
  });

  it('asks for a code when the session is stale, emails it at once, and deletes with it', async () => {
    const c = await copy();
    const r = reauthFake();
    const answers: DeleteAccountOutcome[] = [
      { kind: 'reauth_required' },
      { kind: 'deleted', appleNote: false },
    ];
    let calls = 0;
    await showWithReauth(async () => answers[calls++]!, r);
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    // The ask gives way to the code sheet; the old sign-out line never shows.
    expect(liveText()).toContain(c.codeTitle);
    expect(liveText()).toContain('We sent a 6-digit code to sam@example.com.');
    expect(liveText()).not.toContain(c.reauth);
    expect(r.sent).toBe(1);
    expect(calls).toBe(1);
    // Nothing deletes on a short code; the button waits for six digits.
    expect(liveButton(c.codeConfirm)?.disabled).toBe(true);
    await dom.type('000000', '12 34 5');
    expect(liveButton(c.codeConfirm)?.disabled).toBe(true);
    await dom.type('000000', '123 456');
    expect(liveButton(c.codeConfirm)?.disabled).toBe(false);
    // Typing the sixth digit is not the delete: the person taps it.
    expect(r.confirmed).toEqual([]);
    await tapLive(c.codeConfirm);
    await dom.settle();
    expect(r.confirmed).toEqual(['123456']);
    expect(calls).toBe(2);
    expect(liveText()).toContain(c.doneTitle);
  });

  it('says a wrong code did not work, clears the field, and deletes nothing', async () => {
    const c = await copy();
    const { CODE_REFUSED } = await import('../src/state/emailSignInOps.js');
    const r = reauthFake({
      confirmCode: async () => {
        throw new Error(CODE_REFUSED);
      },
    });
    let calls = 0;
    await showWithReauth(async () => {
      calls++;
      return { kind: 'reauth_required' };
    }, r);
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    await dom.type('000000', '999999');
    await tapLive(c.codeConfirm);
    await dom.settle();
    expect(live()[0]?.querySelector('[role="alert"]')?.textContent).toBe(CODE_REFUSED);
    expect(dom.value('000000')).toBe('');
    expect(calls).toBe(1);
    expect(liveText()).toContain(c.codeTitle);
    expect(liveText()).not.toContain(c.doneTitle);
  });

  it('sends a new code only after the wait, and says it went', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const c = await copy();
      const { NEW_CODE_SENT, SEND_NEW_CODE, resendIn } =
        await import('../src/state/emailSignInOps.js');
      const r = reauthFake();
      await showWithReauth(async () => ({ kind: 'reauth_required' }), r);
      await tapRow();
      await dom.click(c.confirm);
      await dom.settle();
      expect(r.sent).toBe(1);
      expect(liveText()).toContain(resendIn(60));
      expect(liveButton(SEND_NEW_CODE)).toBeUndefined();
      const { act } = await import('react');
      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });
      await tapLive(SEND_NEW_CODE);
      await dom.settle();
      expect(r.sent).toBe(2);
      expect(liveText()).toContain(NEW_CODE_SENT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says a code could not be sent, and offers a new one at once', async () => {
    const c = await copy();
    const { SEND_NEW_CODE, RATE_LIMITED } = await import('../src/state/emailSignInOps.js');
    let fail: Error | undefined = new Error('Failed to fetch');
    const r = reauthFake({
      sendCode: async () => {
        if (fail) throw fail;
      },
    });
    await showWithReauth(async () => ({ kind: 'reauth_required' }), r);
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    expect(live()[0]?.querySelector('[role="alert"]')?.textContent).toBe(c.codeSendFailed);
    fail = new Error('email rate limit exceeded');
    await tapLive(SEND_NEW_CODE);
    await dom.settle();
    expect(live()[0]?.querySelector('[role="alert"]')?.textContent).toBe(RATE_LIMITED);
    fail = undefined;
    await tapLive(SEND_NEW_CODE);
    await dom.settle();
    expect(r.sent).toBe(3);
    expect(live()[0]?.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the account on Keep my account, and the sheet plays its exit', async () => {
    const c = await copy();
    const r = reauthFake();
    let calls = 0;
    await showWithReauth(async () => {
      calls++;
      return { kind: 'reauth_required' };
    }, r);
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    await tapLive(c.keep);
    // Still mounted, leaving: the exit plays before it goes.
    const leaving = [...dom.container.querySelectorAll('.confirm-card.closing')].map(
      (el) => el.textContent ?? '',
    );
    expect(leaving.some((t) => t.includes(c.codeTitle))).toBe(true);
    expect(liveText()).not.toContain(c.codeTitle);
    expect(calls).toBe(1);
    expect(r.confirmed).toEqual([]);
    expect(done).toBe(0);
  });

  it('retries the delete without a second code after a failure past the code', async () => {
    const c = await copy();
    const r = reauthFake();
    const answers: DeleteAccountOutcome[] = [
      { kind: 'reauth_required' },
      { kind: 'failed' },
      { kind: 'deleted', appleNote: false },
    ];
    let calls = 0;
    await showWithReauth(async () => answers[calls++]!, r);
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    await dom.type('000000', '123456');
    await tapLive(c.codeConfirm);
    await dom.settle();
    expect(live()[0]?.querySelector('[role="alert"]')?.textContent).toBe(c.failed);
    expect(live()[0]?.querySelector('[placeholder="000000"]')).toBeNull();
    await tapLive(c.codeConfirm);
    await dom.settle();
    expect(r.confirmed).toEqual(['123456']);
    expect(calls).toBe(3);
    expect(liveText()).toContain(c.doneTitle);
  });

  it('asks for a new code when the server still wants a recent sign-in', async () => {
    const c = await copy();
    const r = reauthFake();
    await showWithReauth(async () => ({ kind: 'reauth_required' }), r);
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    await dom.type('000000', '123456');
    await tapLive(c.codeConfirm);
    await dom.settle();
    expect(live()[0]?.querySelector('[role="alert"]')?.textContent).toBe(c.codeAgain);
    expect(dom.value('000000')).toBe('');
  });

  it('owns_org and the goodbye still follow from the code sheet', async () => {
    const c = await copy();
    const r = reauthFake();
    const answers: DeleteAccountOutcome[] = [{ kind: 'reauth_required' }, { kind: 'owns_org' }];
    let calls = 0;
    await showWithReauth(async () => answers[calls++]!, r);
    await tapRow();
    await dom.click(c.confirm);
    await dom.settle();
    await dom.type('000000', '123456');
    await tapLive(c.codeConfirm);
    await dom.settle();
    expect(liveText()).toContain(c.ownsOrgTitle);
  });
});

describe('useAuth().deleteReauth', () => {
  it('emails the code to the signed-in address and confirms it for this account', async () => {
    const { useApp } = await import('../src/state/store.js');
    const { useAuth } = await import('../src/hooks/useAuth.js');
    const sentTo: string[] = [];
    const confirmed: string[] = [];
    useApp.setState({
      authSession: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
        user: { id: 'u1', email: 'sam@example.com' },
      },
      sendSignInEmail: async (to: string) => {
        sentTo.push(to);
      },
      confirmByCode: async (code: string) => {
        confirmed.push(code);
      },
    });
    let seen: ReturnType<typeof useAuth>['deleteReauth'];
    function Probe() {
      seen = useAuth().deleteReauth;
      return null;
    }
    await dom.render(<Probe />);
    expect(seen!.email).toBe('sam@example.com');
    await seen!.sendCode();
    await seen!.confirmCode('123456');
    expect(sentTo).toEqual(['sam@example.com']);
    expect(confirmed).toEqual(['123456']);
    useApp.setState({ authSession: undefined });
    await dom.render(<Probe />);
    expect(seen).toBeUndefined();
  });
});
