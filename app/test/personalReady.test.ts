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
import { RENEWAL_LINE, WEB_RENEWAL_LINE, paywallMoney } from '../src/components/Paywall.js';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('the paywall', () => {
  const paywall = read('src', 'components', 'Paywall.tsx');

  it('shows only the App Store price on iOS, and the one web price elsewhere (E0, 2026-09-30)', () => {
    expect(PERSONAL_UNLOCK_PRICE_YEAR).toBe(50);
    expect(paywall).not.toMatch(/\$20|\$50|PERSONAL_UNLOCK_PRICE_YEAR/);
    expect(paywall).toContain('products([PERSONAL_YEARLY_PRODUCT_ID])');
    const withPrice = paywallMoney(true, true, '$49.99');
    expect(withPrice.priceLine).toBe('$49.99 per year. Renews yearly.');
    expect(withPrice.buy).toBe('Get Plus');
    const noPrice = paywallMoney(true, true, undefined);
    expect(noPrice.priceLine).toBe('Renews yearly. See the price in the App Store.');
    expect(noPrice.buy).toBe('Get Plus');
    // The desktop and the web buy through Stripe at the one web price.
    const web = paywallMoney(true, false, undefined);
    expect(web.priceLine).toBe('$49.99 a year. Renews yearly.');
    expect(web.buy).toBe('Get Plus');
    expect(web.renewal).toBe(WEB_RENEWAL_LINE);
    // A lapsed subscriber renews.
    expect(paywallMoney(true, false, undefined, true).buy).toBe('Renew Plus');
    expect(paywallMoney(true, true, '$49.99', true).buy).toBe('Renew Plus');
  });

  it('says it renews and where to cancel, under the price', () => {
    expect(RENEWAL_LINE).toBe(
      'Cancel any time on your iPhone in Settings, then your name, then Subscriptions.',
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
    // The two links live in one place, shared with Settings (5.1.1(i)).
    const links = read('src', 'lib', 'legalLinks.ts');
    expect(links).toContain("TERMS_URL = 'https://openshore.ai/terms/'");
    expect(links).toContain("PRIVACY_URL = 'https://openshore.ai/privacy/'");
    expect(paywall).toContain("from '../lib/legalLinks.js'");
    expect(paywall).toContain('Terms of Use');
    expect(paywall).toContain('Privacy Policy');
  });

  it('says buying needs an account when signed out', () => {
    expect(paywall).toContain('Buying Plus does');
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

  it('shows OpenShore Plus and offers Restore', () => {
    expect(settings).toContain('<SettingsRow label="OpenShore Plus"');
    expect(settings).toContain('label="Restore purchases"');
    // Hidden while the pay gates are off (the App Store build, 2026-10-01).
    expect(settings).toContain(
      '{PAY_GATES_ENABLED ? (\n            <SettingsRow label="OpenShore Plus"',
    );
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
    for (const name of [
      'async createRoutine(input) {',
      'async runRoutineNow(id) {',
      'async updateRoutine(id, patch) {',
    ]) {
      const body = store.slice(store.indexOf(`    ${name}`));
      expect(body.slice(0, 400), name).toContain("requirePersonal('crew')");
    }
    // Deleting and stopping stay free.
    for (const name of ['async deleteRoutine(id) {', 'async stopRoutine(id) {']) {
      const body = store.slice(store.indexOf(`    ${name}`));
      expect(body.slice(0, 400), name).not.toContain('requirePersonal');
    }
  });

  it('small copy: Tailscale on every platform, the activity log, Crew notifications', () => {
    // The status line moved into lib/hubStatus.ts (the cleanup package).
    expect(read('src', 'lib', 'hubStatus.ts')).toContain('Open the Tailscale app and sign in');
    expect(read('src', 'screens', 'SettingsScreen.tsx')).not.toContain('Paste it back to the team');
    expect(read('src', 'screens', 'CrewCommandScreen.tsx')).not.toContain('and pings you.');
  });
});

describe('the privacy policy is reachable in every build (Apple 5.1.1(i))', () => {
  it('Settings links the privacy policy and the terms, outside the paywall', () => {
    const settings = read('src', 'screens', 'SettingsScreen.tsx');
    expect(settings).toContain('label="Privacy Policy"');
    expect(settings).toContain('openExternal(PRIVACY_URL)');
    expect(settings).toContain('label="Terms of Use"');
    expect(settings).toContain('openExternal(TERMS_URL)');
  });
});
