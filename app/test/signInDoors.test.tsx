// The sign-in sheet with no passwords (founder and CX, 2026-10-12): one email
// field and one button, a Terms line under it, then a check step with the
// 6-digit code, a resend that waits out the server's own limit, and a way
// back to change the address. No Sign in / Create account toggle, and no copy
// that tells anyone whether an address has an account.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const auth = vi.hoisted(() => ({
  sent: [] as string[],
  verified: [] as Array<[string, string]>,
  verifyError: undefined as Error | undefined,
  sendError: undefined as Error | undefined,
  toasts: [] as string[],
  settings: {} as Record<string, unknown>,
}));

vi.mock('../src/hooks/useAuth.js', () => ({
  useAuth: () => ({
    configured: true,
    signedIn: false,
    email: undefined,
    role: undefined,
    sendSignInEmail: async (addr: string) => {
      if (auth.sendError) throw auth.sendError;
      auth.sent.push(addr);
    },
    verifySignInCode: async (addr: string, code: string) => {
      if (auth.verifyError) throw auth.verifyError;
      auth.verified.push([addr, code]);
    },
    signOut: async () => {},
    signOutEverywhere: async () => {},
  }),
}));

vi.mock('../src/state/store.js', () => ({
  useApp: () => ({
    showToast: (text: string) => auth.toasts.push(text),
    unsentTeamTextCount: async () => 0,
    settings: auth.settings,
  }),
}));

const ops = await import('../src/state/emailSignInOps.js');

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
  auth.sent = [];
  auth.verified = [];
  auth.verifyError = undefined;
  auth.sendError = undefined;
  auth.toasts = [];
  auth.settings = {};
});
afterEach(async () => {
  await dom.unmount();
});

async function card() {
  const { SignInCard } = await import('../src/components/SignInCard.js');
  await dom.render(<SignInCard variant="sheet" />);
}

async function sendTo(addr: string) {
  await dom.type('you@example.com', addr);
  await dom.click(ops.SEND_CODE);
  await dom.settle();
}

describe('the email step', () => {
  it('is one field, one button and the Terms line: no password, no mode toggle', async () => {
    await card();
    expect(dom.container.querySelector('input[type="password"]')).toBeNull();
    expect(dom.buttons()).toEqual([ops.SEND_CODE, 'Terms of Use', 'Privacy Policy']);
    expect(dom.text()).toContain(ops.EMAIL_STEP_SUB);
    expect(dom.text()).toContain(`${ops.CONSENT_LEAD} Terms of Use and Privacy Policy.`);
    for (const gone of ['Create an account', 'Forgot your password?', 'Password']) {
      expect(dom.text()).not.toContain(gone);
    }
  });

  it('tells someone who signed in here before, once, that passwords are gone', async () => {
    auth.settings = { prefsOwner: 'u1' };
    await card();
    expect(dom.text()).toContain(ops.PASSWORDS_GONE);
    expect(dom.text()).not.toContain(ops.EMAIL_STEP_SUB);
    await dom.unmount();
    dom = await mountDom();
    auth.settings = { prefsOwner: 'u1', passwordsGoneSeen: true };
    await card();
    expect(dom.text()).not.toContain(ops.PASSWORDS_GONE);
  });

  it('asks for an address before sending, inline', async () => {
    await card();
    await dom.click(ops.SEND_CODE);
    await dom.settle();
    expect(auth.sent).toEqual([]);
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toBe('Enter your email.');
  });

  it('says a rate limit plainly, and stays on the email step', async () => {
    auth.sendError = new Error(
      'For security purposes, you can only request this after 41 seconds.',
    );
    await card();
    await sendTo('sam@example.com');
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toBe(ops.RATE_LIMITED);
    expect(dom.buttons()).toContain(ops.SEND_CODE);
  });
});

describe('the check step', () => {
  it('names the address and both ways in, and waits out the resend limit', async () => {
    await card();
    await sendTo('sam@example.com');
    expect(auth.sent).toEqual(['sam@example.com']);
    expect(dom.text()).toContain(ops.CHECK_TITLE);
    expect(dom.text()).toContain('We sent a 6-digit code and a link to sam@example.com.');
    expect(dom.text()).toContain('The code works for 10 minutes.');
    expect(dom.text()).toContain(ops.resendIn(ops.RESEND_WAIT_S));
    expect(dom.buttons()).not.toContain(ops.SEND_NEW_CODE);
    expect(dom.buttons()).toContain(ops.DIFFERENT_EMAIL);
  });

  it('signs in on the sixth digit, with nothing else to tap', async () => {
    await card();
    await sendTo('sam@example.com');
    await dom.type('000000', '12345');
    expect(auth.verified).toEqual([]);
    await dom.type('000000', '123456');
    await dom.settle();
    expect(auth.verified).toEqual([['sam@example.com', '123456']]);
    expect(auth.toasts).toEqual([ops.SIGNED_IN]);
  });

  it('a refused code clears the field and says so inline', async () => {
    auth.verifyError = new Error(ops.CODE_REFUSED);
    await card();
    await sendTo('sam@example.com');
    await dom.type('000000', '654321');
    await dom.settle();
    expect(dom.value('000000')).toBe('');
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toBe(ops.CODE_REFUSED);
  });

  it('goes back to change the address, keeping it in the field', async () => {
    await card();
    await sendTo('sam@example.com');
    await dom.click(ops.DIFFERENT_EMAIL);
    expect(dom.value('you@example.com')).toBe('sam@example.com');
    expect(dom.buttons()).toContain(ops.SEND_CODE);
  });
});

describe('the words', () => {
  it('the resend count reads as a person says it', () => {
    expect(ops.resendIn(1)).toBe('Send a new code in 1 second');
    expect(ops.resendIn(45)).toBe('Send a new code in 45 seconds');
  });

  it('the pending request lives exactly as long as the code', () => {
    expect(ops.PENDING_AUTH_TTL_MS).toBe(10 * 60_000);
  });
});
