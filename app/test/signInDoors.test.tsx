// The sign-in sheet's doors under its button (follow-up to the 2026-10-07
// review): two lines in either mode, never three. Resend confirmation stands
// only where it applies, once a sign-up sent a link or a sign-in was refused
// until the address is confirmed, and then it takes the magic link's line.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const auth = vi.hoisted(() => ({
  needsConfirmation: true,
  signInError: undefined as Error | undefined,
  resent: [] as string[],
}));

vi.mock('../src/hooks/useAuth.js', () => ({
  useAuth: () => ({
    configured: true,
    signedIn: false,
    email: undefined,
    role: undefined,
    passwordRecovery: false,
    signIn: async () => {
      if (auth.signInError) throw auth.signInError;
    },
    signUp: async () => ({ needsConfirmation: auth.needsConfirmation }),
    sendMagicLink: async () => {},
    sendPasswordReset: async () => {},
    resendConfirmation: async (addr: string) => {
      auth.resent.push(addr);
    },
    updateMyPassword: async () => {},
    signOut: async () => {},
    signOutEverywhere: async () => {},
  }),
}));

vi.mock('../src/state/store.js', () => ({
  useApp: () => ({ showToast: () => {}, unsentTeamTextCount: async () => 0 }),
}));

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
  auth.needsConfirmation = true;
  auth.signInError = undefined;
  auth.resent = [];
});
afterEach(async () => {
  await dom.unmount();
});

/** The lines under the primary button, as a person reads them. */
function doors(): string[] {
  const primary = dom.container.querySelector('.btn.primary');
  const lines: string[] = [];
  for (let el = primary?.nextElementSibling; el; el = el.nextElementSibling) {
    lines.push((el.textContent ?? '').replace(/\s+/g, ' ').trim());
  }
  return lines;
}

async function card() {
  const { SignInCard } = await import('../src/components/SignInCard.js');
  await dom.render(<SignInCard variant="sheet" />);
}

describe('the sign-in sheet offers two doors under its button', () => {
  it('in sign-in mode: Create an account, and the magic link', async () => {
    await card();
    expect(doors()).toEqual(['New to OpenShore? Create an account', 'Email me a link instead']);
  });

  it('in sign-up mode, before anything was sent: Sign in, and the magic link', async () => {
    await card();
    await dom.click('Create an account');
    expect(doors()).toEqual(['Already have an account? Sign in', 'Email me a link instead']);
    expect(dom.buttons()).not.toContain('Resend confirmation email');
  });

  it('after a sign-up sent its link, Resend takes the magic link line', async () => {
    await card();
    await dom.click('Create an account');
    await dom.type('you@example.com', 'sam@example.com');
    await dom.type('At least 8 characters', 'long enough');
    await dom.click('Create account');
    await dom.settle();
    expect(doors()).toEqual(['Already have an account? Sign in', 'Resend confirmation email']);

    await dom.click('Resend confirmation email');
    await dom.settle();
    expect(auth.resent).toEqual(['sam@example.com']);

    // Still true in sign-in mode: the address still waits on its link.
    await dom.click('Sign in');
    expect(doors()).toEqual(['New to OpenShore? Create an account', 'Resend confirmation email']);
  });

  it('a sign-up that signs in at once offers no Resend', async () => {
    auth.needsConfirmation = false;
    await card();
    await dom.click('Create an account');
    await dom.type('you@example.com', 'sam@example.com');
    await dom.type('At least 8 characters', 'long enough');
    await dom.click('Create account');
    await dom.settle();
    expect(doors()).toEqual(['Already have an account? Sign in', 'Email me a link instead']);
  });

  it('a sign-in refused until the address is confirmed offers Resend', async () => {
    auth.signInError = new Error('Email not confirmed');
    await card();
    await dom.type('you@example.com', 'sam@example.com');
    await dom.type('', 'secret');
    await dom.click('Sign in');
    await dom.settle();
    expect(doors()).toEqual(['New to OpenShore? Create an account', 'Resend confirmation email']);
  });

  it('another address brings the magic link back', async () => {
    await card();
    await dom.click('Create an account');
    await dom.type('you@example.com', 'sam@example.com');
    await dom.type('At least 8 characters', 'long enough');
    await dom.click('Create account');
    await dom.settle();
    await dom.type('you@example.com', 'alex@example.com');
    expect(doors()).toEqual(['Already have an account? Sign in', 'Email me a link instead']);
    // The same address in another case is the same address.
    await dom.type('you@example.com', ' Sam@Example.com ');
    expect(doors()).toEqual(['Already have an account? Sign in', 'Resend confirmation email']);
  });

  it('reads a refusal for an unconfirmed address, and nothing else, as one', async () => {
    const { awaitsConfirmation } = await import('../src/components/SignInCard.js');
    expect(awaitsConfirmation(new Error('Email not confirmed'))).toBe(true);
    expect(awaitsConfirmation(new Error('Invalid login credentials'))).toBe(false);
    expect(awaitsConfirmation(undefined)).toBe(false);
  });
});
