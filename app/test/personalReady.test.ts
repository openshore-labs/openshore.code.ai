// Personal (v1) readiness: the defects an audit of the Personal flows found,
// each pinned so it stays fixed. The price and the legal links on the
// paywall, honest words about accounts, a Personal status and Restore in
// Settings, purchases that say what happened, an entitlement that holds on an
// offline launch, no switch that does nothing, a Claude key that needs no
// workspace, a terminal that says when it lost the computer, Install by name
// in Stack, and Crew behind Personal once the gates return.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAL_UNLOCK_PRICE_YEAR } from '../src/lib/plans.js';
import { WAYFINDING_READY } from '../src/lib/currents.js';
import { restoreOfflineEntitlement } from '../src/state/store.js';
import { RENEWAL_LINE, paywallMoney } from '../src/components/Paywall.js';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('the paywall', () => {
  const paywall = read('src', 'components', 'Paywall.tsx');

  it('shows only the App Store price, and says where to see it otherwise (E0)', () => {
    expect(PERSONAL_UNLOCK_PRICE_YEAR).toBe(50);
    expect(paywall).not.toMatch(/\$20|\$50|PERSONAL_UNLOCK_PRICE_YEAR/);
    expect(paywall).toContain('products([PERSONAL_YEARLY_PRODUCT_ID])');
    const withPrice = paywallMoney(true, true, '$49.99');
    expect(withPrice.priceLine).toBe('$49.99 per year. One person, the whole app.');
    expect(withPrice.buy).toBe('Unlock Personal · $49.99/year');
    const noPrice = paywallMoney(true, true, undefined);
    expect(noPrice.priceLine).toBe('One person, the whole app. See the price in the App Store.');
    expect(noPrice.buy).toBe('Unlock Personal');
    expect(paywallMoney(true, false, undefined).priceLine).toBe(
      'One person, the whole app. Bought on your iPhone. See the price in the App Store.',
    );
    expect(paywallMoney(true, false, undefined).buy).toBeNull();
  });

  it('says it renews and where to cancel, under the price', () => {
    expect(RENEWAL_LINE).toBe(
      'Renews yearly. Cancel any time on your iPhone in Settings, then your name, then Subscriptions.',
    );
    expect(paywallMoney(true, true, '$49.99').renewal).toBe(RENEWAL_LINE);
    expect(paywall.indexOf('{renewal ?')).toBeGreaterThan(paywall.indexOf('{priceLine ?'));
  });

  it('shows no price, no renewal line, and no buy button while the pay gates are off', () => {
    expect(paywallMoney(false, true, '$49.99')).toEqual({
      priceLine: null,
      renewal: null,
      buy: null,
    });
  });

  it('carries the terms and the privacy policy (Apple 3.1.2)', () => {
    expect(paywall).toContain("TERMS_URL = 'https://openshore.ai/terms/'");
    expect(paywall).toContain("PRIVACY_URL = 'https://openshore.ai/privacy/'");
    expect(paywall).toContain('Terms of Use');
    expect(paywall).toContain('Privacy Policy');
  });

  it('says buying needs an account when signed out', () => {
    expect(paywall).toContain('Buying Personal does');
  });
});

describe('accounts, said plainly', () => {
  it('nothing claims Personal needs no account, or that chats sync', () => {
    for (const file of [
      ['src', 'components', 'SignInCard.tsx'],
      ['src', 'lib', 'harborMini.ts'],
      ['src', 'lib', 'egressManifest.ts'],
      ['src', 'screens', 'SettingsScreen.tsx'],
      ['src', 'components', 'Sidebar.tsx'],
    ]) {
      const text = read(...file);
      expect(text, file.join('/')).not.toMatch(/Personal use needs no account|Sync chats across/);
    }
  });
});

describe('Settings', () => {
  const settings = read('src', 'screens', 'SettingsScreen.tsx');

  it('shows Personal and offers Restore', () => {
    expect(settings).toContain('<SettingsRow label="Personal"');
    expect(settings).toContain('label="Restore purchases"');
    expect(settings).toContain("'Free in the beta'");
  });

  it('shows only the Wayfinding switches that do something', () => {
    expect(WAYFINDING_READY).toEqual(['memory']);
    expect(settings).toContain('WAYFINDING_READY.map(');
    expect(settings).not.toContain('WAYFINDING_IDS.map(');
  });
});

describe('purchases say what happened', () => {
  const store = read('src', 'state', 'store.ts');

  it('a pending purchase, a failed one, and an offline restore each get words', () => {
    expect(store).toContain("if (result.state === 'pending') {");
    expect(store).toContain('The purchase did not complete. Nothing was charged.');
    expect(store).toContain('You are offline. Restore once you are back online.');
    expect(store).toContain("refreshed === 'offline'");
  });

  it('an offline launch keeps a verified entitlement, then asks StoreKit', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const got: unknown[] = [];
    await restoreOfflineEntitlement((e) => got.push(e), {
      read: async () => ({ tierId: 'personal', status: 'active', validUntil: future }),
      storeKit: async () => {
        throw new Error('not asked');
      },
    });
    expect(got).toHaveLength(1);
    got.length = 0;
    await restoreOfflineEntitlement((e) => got.push(e), {
      read: async () => ({ tierId: 'personal', status: 'active', validUntil: past }),
      storeKit: async () => ({ active: true, expiresAt: future }),
    });
    expect(got).toEqual([{ tierId: 'personal', status: 'active', validUntil: future }]);
    got.length = 0;
    await restoreOfflineEntitlement((e) => got.push(e), {
      read: async () => null,
      storeKit: async () => ({ active: false }),
    });
    expect(got).toEqual([]);
  });
});

describe('the rest of the Personal paths', () => {
  it('a Claude key saves without a workspace id unless Claude asks for one', () => {
    const connections = read('src', 'screens', 'ConnectionsScreen.tsx');
    expect(connections).not.toContain(
      'Add the workspace id from the Anthropic Console, then save.',
    );
    expect(connections).toContain('This Claude key needs its workspace id.');
    expect(connections).toContain('disabled={checking}');
  });

  it('the terminal says when it lost the computer, or was refused', () => {
    const terminal = read('src', 'components', 'DesktopTerminal.tsx');
    expect(terminal).toContain(
      "Can't reach your computer. Check that it is on and on Tailscale. Still trying.",
    );
    expect(terminal).toContain('Your computer no longer accepts this device.');
  });

  it('Install by name lives in Stack, not only the Marketplace', () => {
    expect(read('src', 'screens', 'StackScreen.tsx')).toContain('<InstallByName />');
    expect(read('src', 'components', 'InstallByName.tsx')).toContain('b.installOllamaRef(ref)');
  });

  it('Crew sits behind Personal once the pay gates return', () => {
    const store = read('src', 'state', 'store.ts');
    for (const name of ['async createRoutine(input) {', 'async runRoutineNow(id) {']) {
      const body = store.slice(store.indexOf(`    ${name}`));
      expect(body.slice(0, 400), name).toContain("get().openPaywall('crew')");
    }
  });

  it('small copy: Tailscale on every platform, the activity log, Crew notifications', () => {
    expect(read('src', 'screens', 'PairScreen.tsx')).toContain(
      'Open the Tailscale app and sign in',
    );
    expect(read('src', 'screens', 'SettingsScreen.tsx')).not.toContain('Paste it back to the team');
    expect(read('src', 'screens', 'CrewCommandScreen.tsx')).not.toContain('and pings you.');
  });
});
