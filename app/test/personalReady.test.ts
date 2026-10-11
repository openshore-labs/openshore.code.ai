// Personal (v1) readiness: the defects an audit of the Personal flows found,
// each pinned so it stays fixed. Honest words about accounts, no switch that
// does nothing, a Claude key that needs no workspace, a terminal that says
// when it lost the computer, Install by name in Stack, and, since OpenShore
// went open source (founder, 2026-10-11), no paywall anywhere: Crew's work
// meets only the free sign-in.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WAYFINDING_READY } from '../src/lib/currents.js';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('nothing is sold (open source, founder 2026-10-11)', () => {
  it('the paywall, the pay gate and the in-app purchase are gone', () => {
    for (const gone of [
      ['src', 'components', 'Paywall.tsx'],
      ['src', 'components', 'PlusNote.tsx'],
      ['src', 'lib', 'payGate.ts'],
      ['src', 'state', 'payOps.ts'],
      ['src', 'lib', 'iap.ts'],
      ['plugins', 'oscode-iap'],
    ]) {
      expect(existsSync(join(process.cwd(), ...gone)), gone.join('/')).toBe(false);
    }
    const store = read('src', 'state', 'store.ts');
    for (const word of ['openPaywall', 'buyPersonal', 'restorePurchases', 'VITE_PAY_GATES']) {
      expect(store, word).not.toContain(word);
    }
    expect(read('src', 'vite-env.d.ts')).not.toContain('VITE_PAY_GATES');
  });

  it('no copy offers OpenShore Plus', () => {
    for (const file of [
      ['src', 'components', 'Sidebar.tsx'],
      ['src', 'components', 'ProfileSheet.tsx'],
      ['src', 'components', 'AccountGateSheet.tsx'],
      ['src', 'components', 'DeleteAccount.tsx'],
      ['src', 'screens', 'SettingsScreen.tsx'],
      ['src', 'lib', 'accountGate.ts'],
      ['src', 'lib', 'guideCards.ts'],
      ['src', 'lib', 'harborMini.ts'],
      ['src', 'lib', 'plans.ts'],
    ]) {
      expect(read(...file), file.join('/')).not.toMatch(/OpenShore Plus|Get Plus|Upgrade to/);
    }
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

  it('shows only the Wayfinding switches that do something', () => {
    expect(WAYFINDING_READY).toEqual(['memory']);
    expect(settings).toContain('WAYFINDING_READY.map(');
    expect(settings).not.toContain('WAYFINDING_IDS.map(');
  });
});

describe('the rest of the Personal paths', () => {
  it('a Claude key saves without a workspace id unless Claude asks for one', () => {
    const connections = read('src', 'screens', 'ConnectionsScreen.tsx');
    expect(connections).not.toContain(
      'Add the workspace id from the Anthropic Console, then save.',
    );
    expect(connections).toContain('This Claude key needs its workspace ID.');
    // Save waits while the key is checked, for a key to check (D14), and
    // while the network is down, since the check needs it (Desktop Offline).
    // The workspace sheet of a connected Claude waits for its ID instead.
    expect(connections).toContain(
      'disabled={checking || networkDown || !(workspaceOnly ? workspace : value).trim()}',
    );
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

  it("Crew's work meets the free sign-in, and pausing or deleting never does", () => {
    const store = read('src', 'state', 'store.ts');
    for (const name of [
      'async createRoutine(input) {',
      'async runRoutineNow(id) {',
      'async updateRoutine(id, patch) {',
    ]) {
      const body = store.slice(store.indexOf(`    ${name}`));
      expect(body.slice(0, 400), name).toContain("requireAccount('crew')");
    }
    for (const name of ['async deleteRoutine(id) {', 'async stopRoutine(id) {']) {
      const body = store.slice(store.indexOf(`    ${name}`));
      expect(body.slice(0, 400), name).not.toContain('requireAccount');
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
  it('Settings links the privacy policy and the terms', () => {
    const settings = read('src', 'screens', 'SettingsScreen.tsx');
    expect(settings).toContain('label="Privacy Policy"');
    expect(settings).toContain('openExternal(PRIVACY_URL)');
    expect(settings).toContain('label="Terms of Use"');
    expect(settings).toContain('openExternal(TERMS_URL)');
  });
});
