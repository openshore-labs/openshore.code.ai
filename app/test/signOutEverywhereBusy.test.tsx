// "Sign out everywhere" while the server works (UX review cleanup 7), mounted in a
// real (small) DOM: after the confirm, both controls hold, a status line
// takes the link's place, and a second tap cannot fire. When the call fails,
// the card comes back as it was.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const auth = vi.hoisted(() => ({
  everywhere: 0,
  finish: (() => {}) as () => void,
}));

vi.mock('../src/hooks/useAuth.js', () => ({
  useAuth: () => ({
    configured: true,
    signedIn: true,
    email: 'me@example.com',
    role: undefined,
    passwordRecovery: false,
    signIn: async () => {},
    signUp: async () => {},
    sendMagicLink: async () => {},
    sendPasswordReset: async () => {},
    resendConfirmation: async () => {},
    updateMyPassword: async () => {},
    signOut: async () => {},
    signOutEverywhere: () => {
      auth.everywhere++;
      return new Promise<void>((resolve) => (auth.finish = resolve));
    },
  }),
}));

vi.mock('../src/state/store.js', () => ({
  useApp: () => ({ showToast: () => {}, unsentTeamTextCount: async () => 0 }),
}));

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
  auth.everywhere = 0;
});
afterEach(async () => {
  await dom.unmount();
});

describe('Sign out everywhere, while waiting', () => {
  it('holds both controls and says it is signing out everywhere', async () => {
    const { SignInCard } = await import('../src/components/SignInCard.js');
    await dom.render(<SignInCard />);
    const signOut = () =>
      [...dom.container.querySelectorAll('button')].find((b) => b.textContent === 'Sign out')!;
    expect(signOut().disabled).toBe(false);

    await dom.click('Sign out everywhere');
    // The confirm sheet: its danger button carries the same words.
    const confirm = dom.container.querySelector('.confirm-card .btn.danger') as HTMLButtonElement;
    expect(confirm.textContent).toBe('Sign out everywhere');
    confirm.click();
    await dom.settle();

    expect(auth.everywhere).toBe(1);
    const status = dom.container.querySelector('[role="status"]');
    expect(status?.textContent).toBe('Signing out everywhere...');
    // The link is gone, so a second tap cannot fire; Sign out stays, disabled.
    expect([...dom.container.querySelectorAll('.card button')].map((b) => b.textContent)).toEqual([
      'Sign out',
    ]);
    expect(signOut().disabled).toBe(true);

    // The server answers no (the store shows the failure toast): the card is
    // as it was.
    auth.finish();
    await dom.settle();
    expect(dom.container.querySelector('.card [role="status"]')).toBeNull();
    expect(signOut().disabled).toBe(false);
    expect(dom.buttons()).toContain('Sign out everywhere');
  });
});
