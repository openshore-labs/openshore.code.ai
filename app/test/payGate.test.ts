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
  roomPaid,
} from '../src/lib/payGate.js';
import {
  APPLE_SUBSCRIPTIONS_URL,
  PaywallLockedError,
  RESTORE_FOUND_NOTHING,
  appleUpdateAction,
  chatPaidFeature,
  chatPaywall,
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
  it('classifies every account feature; only Projects and Cloud Connections stay free in v1', () => {
    const features = new Set(
      Object.values(ROOM_ACCOUNT).filter((f): f is AccountFeature => f !== null),
    );
    features.add('coding');
    // The purchase itself, tapped signed out (no room carries it).
    features.add('plus');
    expect(new Set(Object.keys(PAY_GATE))).toEqual(features);
    const paidV1 = (Object.keys(PAY_GATE) as AccountFeature[]).filter(
      (f) => featurePaid(f) && !['marketplace', 'launch', 'health', 'plus'].includes(f),
    );
    // The founder's widening (2026-09-30), over the advisors' actions-only.
    expect(paidV1.sort()).toEqual(['coding', 'crew', 'pairing', 'repos', 'terminal', 'vault']);
    for (const free of ['projects', 'connections', 'admin']) {
      expect(PAY_GATE[free as AccountFeature], free).toBe('free');
    }
    expect(PAY_GATE.health).toBe('personal');
  });

  it('opens Chats, Projects, the Stack, Cloud Connections and Settings, and no other nav room', () => {
    const nav = [
      'chats',
      'projects',
      'terminalroom',
      'repos',
      'stack',
      'vault',
      'crew',
      'marketplace',
      'stackhealth',
      'launch',
      'connections',
      'pair',
      'settings',
    ] as const;
    expect(nav.filter((v) => !roomPaid(v))).toEqual([
      'chats',
      'projects',
      'stack',
      'connections',
      'settings',
    ]);
    // The rooms those reach stay free with them.
    for (const v of ['chat', 'project', 'projectmemory', 'onboarding'] as const)
      expect(roomPaid(v), v).toBe(false);
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
    expect(paidDoor('projects', { needsAccount: false, unlocked: false })).toBe('open');
    expect(paidDoor('vault', { needsAccount: false, unlocked: false })).toBe('paywall');
    expect(paidDoor('pairing', { needsAccount: false, unlocked: false })).toBe('paywall');
    expect(paywallReasonFor('crew')).toBe('crew');
    expect(paywallReasonFor('coding')).toBe('coding');
    expect(paywallReasonFor('pairing')).toBe('pairing');
    expect(paywallReasonFor('launch')).toBe('coding');
    for (const room of ['terminal', 'repos', 'vault', 'health'] as const)
      expect(paywallReasonFor(room), room).toBe('plus');
  });

  it('holds a coding session shut anywhere, and a chat with the computer from another device', () => {
    const desktop = { source: { kind: 'desktop' } } as never;
    const computerChat = { source: { kind: 'desktop-chat' } } as never;
    expect(chatPaywall(desktop, false, false)).toBe('coding');
    expect(chatPaywall(desktop, false, true)).toBe('coding');
    expect(chatPaywall(desktop, true, true)).toBeNull();
    // The computer's own chat on the desktop is free (CTO ruling 8); from the
    // phone, or a desktop running on another computer, it is Desktop + phone.
    expect(chatPaywall(computerChat, false, false)).toBeNull();
    expect(chatPaywall(computerChat, false, true)).toBe('pairing');
    expect(chatPaywall(computerChat, true, true)).toBeNull();
    expect(chatPaidFeature(computerChat, true)).toBe('pairing');
    for (const kind of ['device', 'stack', 'mock', 'cloud'] as const) {
      const source = kind === 'device' ? { kind, modelId: 'm' } : { kind };
      expect(chatPaywall({ source } as never, false, true), kind).toBeNull();
    }
    expect(chatPaywall(undefined, false, true)).toBeNull();
  });

  it('names the door a refused chat met', () => {
    const coding = new PaywallLockedError();
    expect(coding.name).toBe('PaywallLockedError');
    expect(coding.feature).toBe('coding');
    expect(coding.message).toBe('The coding agent is part of OpenShore Plus.');
    const pairing = new PaywallLockedError('pairing');
    expect(pairing.feature).toBe('pairing');
    expect(pairing.message).toMatch(/computer from another device is part of OpenShore Plus/);
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
    // No other way to pay is named (App Store 3.1.1; CTO, 2026-09-30).
    expect(RESTORE_FOUND_NOTHING).toBe('No OpenShore Plus purchase on this Apple Account.');
  });
});

// App Store 3.1.1: the iPhone and iPad branch of the sheet names no other way
// to pay, no web price, and no address.
// App Store 3.1.1 beyond the sheet's own buttons (CTO, 2026-09-30): every
// purchase string an iPhone or iPad can reach names no other way to pay, no
// web price, and no address.
describe('every purchase string iOS can reach', () => {
  const OTHER_WAY = /stripe|checkout|on the web|the web\b|web price|https?:|www\.|\$\d/i;

  it('says nothing about another way to pay', async () => {
    const p = await import('../src/components/Paywall.js');
    const { ACCOUNT_GATE_PLUS_BODY, accountCopy } = await import('../src/lib/accountGate.js');
    const on = accountCopy(true);
    const strings = [
      RESTORE_FOUND_NOTHING,
      p.RENEWAL_LINE,
      p.PAYWALL_HEADLINE,
      p.PAYWALL_PAIRING_HEADLINE,
      p.PAYWALL_PLUS_HEADLINE,
      p.PAYWALL_LAPSED_HEADLINE,
      p.PAYWALL_BODY,
      ...p.BULLETS,
      ACCOUNT_GATE_PLUS_BODY,
      on.body,
      on.pitch,
      on.notice,
      on.signInSub,
      // The App Store branch's money lines, before StoreKit answers.
      p.paywallMoney(true, true, undefined).priceLine!,
      p.paywallMoney(true, true, undefined).renewal!,
    ];
    for (const s of strings) expect(s, s).not.toMatch(OTHER_WAY);
  });

  it("leaves the Stripe rail off the iPhone's What leaves this device", async () => {
    const { egressByRecipient } = await import('../src/lib/egressManifest.js');
    const ios = egressByRecipient(4, 'ios', true);
    const ids = ios.flatMap((g) => g.entries.map((e) => e.id));
    expect(ids).toContain('purchase');
    expect(ids).not.toContain('purchase-web');
    expect(ids).not.toContain('stripe');
    expect(ios.map((g) => g.recipient)).not.toContain('Payments');
    const desktop = egressByRecipient(4, 'electron', true).flatMap((g) =>
      g.entries.map((e) => e.id),
    );
    expect(desktop).toContain('stripe');
    expect(desktop).not.toContain('purchase');
    // A build with the pay gates off lists no purchase at all (first
    // submission, 2026-10-01).
    for (const platform of ['ios', 'electron'] as const) {
      const off = egressByRecipient(4, platform, false).flatMap((g) => g.entries.map((e) => e.id));
      for (const id of ['purchase', 'purchase-web', 'stripe']) expect(off).not.toContain(id);
    }
  });
});

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
    expect(paywall).toContain("'Your Plus year has ended.'");
    expect(paywall).toContain('Not now. Keep chatting.');
    expect(paywall).toContain('I already paid');
    expect(paywall).toContain(
      '{ios ? <AppStoreActions buy={buy} /> : <CheckoutActions buy={buy} />}',
    );
  });
});

// Desktop + phone is part of Plus (founder, 2026-09-30): each screen's paid
// moment passes the one door, and the free ones (Revoke, Forget, Turn off,
// the desktop's own shell) never do.
describe('Pairing, at its screens', () => {
  const pair = read('src', 'screens', 'PairScreen.tsx');
  const terminal = read('src', 'screens', 'TerminalRoomScreen.tsx');
  const paywall = read('src', 'components', 'Paywall.tsx');

  it('asks the door before Scan, before a claim is spent, and before another computer', () => {
    expect(pair).toContain("if (requirePersonal('pairing')) setScanning(true);");
    const phone = pair.slice(pair.indexOf('function PhonePair'));
    const door = phone.indexOf("if (!requirePersonal('pairing')) return;");
    expect(door).toBeGreaterThan(-1);
    expect(door).toBeLessThan(phone.indexOf('redeemPairClaim('));
    const remote = pair.slice(
      pair.indexOf('function RemoteHubPanel'),
      pair.indexOf('function PhonePair'),
    );
    expect(remote.indexOf("requirePersonal('pairing')")).toBeLessThan(
      remote.indexOf('daemonHealth('),
    );
  });

  it('shows the pairing code only while Plus is open, and keeps Revoke free', () => {
    expect(pair).toContain('{pairOpen && info?.running && qr ? (');
    const start = pair.indexOf('revokeDeviceCredential');
    const revoke = pair.slice(start, pair.indexOf('Revoke\n', start));
    expect(revoke).toContain('revoked. It can no longer connect');
    expect(revoke).not.toMatch(/requirePersonal|pairOpen/);
    // The note lives in its own component now, shared with Crew.
    expect(pair).toContain("import { PlusNote } from '../components/PlusNote.js';");
    expect(read('src', 'components', 'PlusNote.tsx')).toContain(
      "if (door !== 'paywall') return null;",
    );
  });

  // The Terminal room itself became Plus with the room gate (2026-09-30), so
  // the desktop's own shell is paid at the room's door; this in-room check is
  // what holds a phone that reached the room some other way.
  it("asks the door for the computer's shell from another device, inside the Plus room", () => {
    expect(terminal).toContain("if (!desktopLocal && !requirePersonal('pairing')) return;");
  });

  it('gives the sheet its own headline and an honest bullet', () => {
    expect(paywall).toContain("'Reach your computer from your phone.'");
    expect(paywall).toContain("'All of OpenShore, with Plus.'");
    expect(paywall).toContain("'Terminal, Repositories, and Vault'");
    expect(paywall).toContain("'Your computer from your phone, while it is on'");
    expect(paywall).not.toMatch(/always on/i);
  });
});
