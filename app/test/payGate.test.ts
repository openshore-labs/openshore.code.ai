// The Personal paid gate (CTO, CFO, CX, 2026-09-30): only coding, building
// and agentic work is paid, on actions, not rooms. The classification, the
// build flag, the pure rules in state/payOps.ts, and the paywall's App Store
// branch, held here. The store with the gate ON is payGateStore.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROOM_ACCOUNT, type AccountFeature } from '../src/lib/accountGate.js';
import {
  PAY_GATE,
  PAY_GATES_ENABLED,
  PERSONAL_WEB_PRICE,
  featurePaid,
  payGatesFrom,
} from '../src/lib/payGate.js';
import {
  APPLE_SUBSCRIPTIONS_URL,
  PaywallLockedError,
  RESTORE_FOUND_NOTHING,
  appleUpdateAction,
  codingPaywalled,
  paidDoor,
  paywallReasonFor,
  personalLapsed,
  personalUnlockedFor,
  routinePatchFree,
  startWebCheckout,
} from '../src/state/payOps.js';
import { EGRESS, LINK_ONLY_HOSTS } from '../src/lib/egressManifest.js';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('what is paid', () => {
  it('classifies every account feature; only coding and Crew are Personal in v1', () => {
    const features = new Set(
      Object.values(ROOM_ACCOUNT).filter((f): f is AccountFeature => f !== null),
    );
    features.add('coding');
    expect(new Set(Object.keys(PAY_GATE))).toEqual(features);
    const paidV1 = (Object.keys(PAY_GATE) as AccountFeature[]).filter(
      (f) => featurePaid(f) && !['marketplace', 'launch'].includes(f),
    );
    expect(paidV1.sort()).toEqual(['coding', 'crew']);
    for (const free of ['projects', 'terminal', 'repos', 'vault', 'connections', 'pairing']) {
      expect(PAY_GATE[free as AccountFeature], free).toBe('free');
    }
  });

  it('the one web price is $49.99, the same as the App Store tier', () => {
    expect(PERSONAL_WEB_PRICE).toBe('$49.99');
  });
});

describe('the build flag', () => {
  it('is off unless the build sets VITE_PAY_GATES=1', async () => {
    expect(PAY_GATES_ENABLED).toBe(false);
    expect(payGatesFrom({ VITE_PAY_GATES: '1' })).toBe(true);
    expect(payGatesFrom({ VITE_PAY_GATES: 'true' })).toBe(false);
    expect(payGatesFrom(undefined)).toBe(false);
    vi.stubEnv('VITE_PAY_GATES', '1');
    vi.resetModules();
    const on = await import('../src/lib/payGate.js');
    expect(on.PAY_GATES_ENABLED).toBe(true);
  });

  it('is a literal read the bundler folds, and store.ts no longer holds a switch', () => {
    expect(read('src', 'lib', 'payGate.ts')).toContain(
      "export const PAY_GATES_ENABLED = import.meta.env.VITE_PAY_GATES === '1';",
    );
    const store = read('src', 'state', 'store.ts');
    expect(store).not.toMatch(/PAY_GATES_ENABLED = (true|false)/);
    expect(store).not.toMatch(/\$20 Personal/);
  });

  it('records no trial at launch as a hook', () => {
    expect(read('src', 'lib', 'payGate.ts')).toMatch(/No trial at launch/);
  });
});

describe('the paid door', () => {
  const active = { status: 'active' };
  const dead = { status: 'canceled' };

  it('is open with the flag off or no account backend, else by entitlement', () => {
    expect(personalUnlockedFor({ gates: false, configured: true })).toBe(true);
    expect(personalUnlockedFor({ gates: true, configured: false })).toBe(true);
    expect(personalUnlockedFor({ gates: true, configured: true })).toBe(false);
    expect(personalUnlockedFor({ gates: true, configured: true, userEntitlement: active })).toBe(
      true,
    );
    expect(personalUnlockedFor({ gates: true, configured: true, orgEntitlement: active })).toBe(
      true,
    );
    expect(personalUnlockedFor({ gates: true, configured: true, userEntitlement: dead })).toBe(
      false,
    );
  });

  it('asks for the sign-in first, then the paywall, and never paywalls a free feature', () => {
    expect(paidDoor('coding', { needsAccount: true, unlocked: false })).toBe('account');
    expect(paidDoor('coding', { needsAccount: false, unlocked: false })).toBe('paywall');
    expect(paidDoor('crew', { needsAccount: false, unlocked: true })).toBe('open');
    expect(paidDoor('vault', { needsAccount: false, unlocked: false })).toBe('open');
    expect(paywallReasonFor('crew')).toBe('crew');
    expect(paywallReasonFor('coding')).toBe('coding');
  });

  it('holds only a coding session shut, never a chat', () => {
    expect(codingPaywalled({ source: { kind: 'desktop' } }, false)).toBe(true);
    expect(codingPaywalled({ source: { kind: 'desktop' } }, true)).toBe(false);
    for (const kind of ['desktop-chat', 'device', 'stack', 'mock'] as const) {
      const source = kind === 'device' ? { kind, modelId: 'm' } : { kind };
      expect(codingPaywalled({ source } as never, false), kind).toBe(false);
    }
    expect(new PaywallLockedError().name).toBe('PaywallLockedError');
  });

  it('lets a pause through for free, and charges an edit or a resume', () => {
    expect(routinePatchFree({ enabled: false })).toBe(true);
    expect(routinePatchFree({ enabled: true })).toBe(false);
    expect(routinePatchFree({ enabled: false, task: 'x' })).toBe(false);
    expect(routinePatchFree({ task: 'x' })).toBe(false);
  });

  it('tells a lapsed subscriber from someone who never bought', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(personalLapsed(undefined)).toBe(false);
    expect(personalLapsed({ status: 'active' })).toBe(false);
    expect(personalLapsed({ status: 'incomplete' })).toBe(false);
    expect(personalLapsed({ status: 'canceled' })).toBe(true);
    expect(personalLapsed({ status: 'active', validUntil: past })).toBe(true);
  });
});

describe('buying on the desktop and the web', () => {
  it('asks stripe-checkout for Personal and opens the answer in the browser', async () => {
    const calls: Array<{ fn: string; token: string; body: unknown }> = [];
    const opened: string[] = [];
    const outcome = await startWebCheckout({
      token: 'tok',
      invoke: async <T>(fn: string, token: string, body: Record<string, unknown>) => {
        calls.push({ fn, token, body });
        return { url: 'https://checkout.stripe.com/c/pay/cs_1' } as T;
      },
      open: (u) => opened.push(u),
    });
    expect(calls).toEqual([{ fn: 'stripe-checkout', token: 'tok', body: { tierId: 'personal' } }]);
    expect(opened).toEqual(['https://checkout.stripe.com/c/pay/cs_1']);
    expect(outcome.kind).toBe('opened');
  });

  it('opens the portal for a live subscription, and says the refusal otherwise', async () => {
    const manage = await startWebCheckout({
      token: 't',
      invoke: async <T>() =>
        ({ url: 'https://billing.stripe.com/p/1', alreadySubscribed: true }) as T,
      open: () => {},
    });
    expect(manage.kind).toBe('manage');
    const refused = await startWebCheckout({
      token: 't',
      invoke: async () => {
        throw new Error('You already have Personal.');
      },
      open: () => {
        throw new Error('never opened');
      },
    });
    expect(refused).toEqual({ kind: 'error', message: 'You already have Personal.' });
  });

  it('lists Stripe under what leaves this device', () => {
    const hosts = new Set(EGRESS.flatMap((e) => e.hosts));
    expect(hosts.has('checkout.stripe.com')).toBe(true);
    expect(hosts.has('billing.stripe.com')).toBe(true);
    expect(APPLE_SUBSCRIPTIONS_URL).toBe('https://apps.apple.com/account/subscriptions');
    expect('apps.apple.com' in LINK_ONLY_HOSTS).toBe(true);
  });
});

describe('Apple', () => {
  const P = 'ai.openshore.oscode.personal.yearly';

  it('links a purchase Apple completed later, or keeps it for the sign-in', () => {
    const upd = { jws: 'J', productId: P, revoked: false };
    expect(appleUpdateAction(upd, { signedIn: true, productId: P })).toBe('link');
    expect(appleUpdateAction(upd, { signedIn: false, productId: P })).toBe('keep');
    expect(appleUpdateAction({ ...upd, revoked: true }, { signedIn: true, productId: P })).toBe(
      'refresh',
    );
    expect(
      appleUpdateAction({ ...upd, productId: 'other' }, { signedIn: true, productId: P }),
    ).toBe('ignore');
  });

  it('passes the account id as appAccountToken, and the plugin keeps early updates', () => {
    const swift = read(
      'plugins',
      'oscode-iap',
      'ios',
      'Sources',
      'OscodeIapPlugin',
      'OscodeIapPlugin.swift',
    );
    expect(swift).toContain('.appAccountToken(uuid)');
    expect(swift).toContain('retainUntilConsumed: true');
    expect(read('src', 'state', 'store.ts')).toContain(
      'iapPurchase(PERSONAL_YEARLY_PRODUCT_ID, get().authSession?.user.id)',
    );
    const notifications = read('..', 'supabase', 'functions', 'apple-notifications', 'index.ts');
    expect(notifications).toContain('userIdFromAppAccountToken(txn.appAccountToken');
  });

  it('says what a restore that found nothing means', () => {
    expect(RESTORE_FOUND_NOTHING).toBe(
      'No Personal purchase on this Apple Account. Bought on the web? Sign in with that email.',
    );
  });
});

// App Store 3.1.1: the iPhone and iPad branch of the sheet names no other way
// to pay, no web price, and no address.
describe("the paywall's App Store branch", () => {
  const paywall = read('src', 'components', 'Paywall.tsx');
  const start = paywall.indexOf('function AppStoreActions');
  // The function's own body: up to its closing brace at the left margin.
  const end = paywall.indexOf('\n}\n', start);

  it('never mentions Stripe, web checkout, or a URL', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const ios = paywall.slice(start, end);
    expect(ios).not.toMatch(/stripe|checkout|https?:|www\.|\.com|web|computer|\$\d/i);
    expect(ios).toContain('Restore purchases');
    expect(ios).toContain('buyPersonal');
  });

  it('carries no "buy on your computer" line anywhere, and CX\'s words', () => {
    expect(paywall).not.toMatch(/on your computer, then|Bought on your iPhone|buy it there/i);
    expect(paywall).toContain("'Let OpenShore build it.'");
    expect(paywall).toContain("'Your Personal year has ended.'");
    expect(paywall).toContain('Not now. Keep chatting.');
    expect(paywall).toContain('I already paid');
    expect(paywall).toContain(
      '{ios ? <AppStoreActions buy={buy} /> : <CheckoutActions buy={buy} />}',
    );
  });
});
