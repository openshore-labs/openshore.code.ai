// The pairing review (UX-led design review, 2026-10-01; docs/design/pairing-review.md),
// with the room renamed Computer and pairing called docking by a maintainer
// (2026-10-07; the dock form moved to components/DockForm.tsx): the QR is a link the iPhone Camera opens and is
// only ever for the person's own network, a spent code is never thrown away,
// and the screens say plainly what happened.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => false,
  isPhone: () => true,
  openExternal: () => {},
  dataUnlockState: async () => 'ok',
  storeGetJson: async (k: string) => {
    const v = mem.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    mem.set(k, JSON.stringify(v));
  },
  storeGet: async (k: string) => mem.get(k) ?? null,
  storeSet: async (k: string, v: string) => {
    mem.set(k, v);
  },
  storeDelete: async (k: string) => {
    mem.delete(k);
  },
  sealExistingKeys: async () => {},
  secretGet: async () => null,
  secretSet: async () => {},
  secretDelete: async () => {},
}));

vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

const { useApp } = await import('../src/state/store.js');
const { pairingLink } = await import('../src/lib/qrDecode.js');
const { ROOM_LABELS } = await import('../src/lib/navRooms.js');
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('the name', () => {
  it('is Computer, one plain word, and "hub" stays out of it', () => {
    expect(ROOM_LABELS.pair).toBe('Computer');
  });
});

describe('a pairing link opened from the iPhone Camera', () => {
  beforeEach(() => {
    mem.clear();
    useApp.setState({ pairOffer: undefined, view: 'chat', toast: undefined });
  });

  it('opens Computer and asks first; it never docks on the link alone', () => {
    useApp.getState().offerPairing(pairingLink('http://100.64.1.2:4816', 'pc_abc'));
    expect(useApp.getState().pairOffer).toEqual({
      address: 'http://100.64.1.2:4816',
      claim: 'pc_abc',
    });
    expect(useApp.getState().view).toBe('pair');
    expect(useApp.getState().settings.daemon).toBeUndefined();
    const form = read('src', 'components', 'DockForm.tsx');
    expect(form).toContain('Dock to this machine?');
    // Computer's own forms answer the link, on both paths.
    const screen = read('src', 'screens', 'PairScreen.tsx');
    expect(screen).toContain('<DockForm expect="desktop" offers />');
    // Both server paths, at home and rented (2026-10-12), answer it too.
    expect(screen).toContain(
      '<DockForm key={`dock-${path}`} expect="server" place={path} offers />',
    );
  });

  it("refuses a link for an address off the person's own network", () => {
    useApp.getState().offerPairing(pairingLink('http://203.0.113.9:4816', 'pc_abc'));
    expect(useApp.getState().pairOffer).toBeUndefined();
    expect(useApp.getState().view).toBe('chat');
  });

  it('is routed by the deep link handler', () => {
    const hook = read('src', 'hooks', 'useAuthDeepLink.ts');
    expect(hook).toMatch(/if \(host === 'pair'\) return 'pair';/);
    expect(hook).toMatch(/if \(kind === 'pair'\) \{\s*offerPairing\(url\);/);
  });
});

describe('the screens, as UX review asked', () => {
  const screen = read('src', 'screens', 'PairScreen.tsx');
  const form = read('src', 'components', 'DockForm.tsx');

  it('saves the new credential before checking it, and retries the check once', () => {
    // Where a server lives (at home or rented) is saved with the credential.
    const save = form.indexOf(
      'await saveHub({ baseUrl, token, ...placed }, { role: claimed.role });',
    );
    const check = form.indexOf('let health = await daemonHealth({ baseUrl, token });');
    expect(save).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(save);
    expect(form).toContain('HEALTH_RETRY_MS');
  });

  it('puts the QR as a link, the scan first, and typing behind a disclosure', () => {
    expect(screen).toContain('pairingLink(`http://${next.host}:${next.port}`, next.claim)');
    expect(form).toContain("Can't scan? Type it in");
    expect(form).not.toContain('Tip: pasting the whole QR text');
    expect(form.indexOf('setScanning(true)')).toBeLessThan(form.indexOf("Can't scan? Type it in"));
    expect(form).toContain('Docking to ${noun}...');
  });

  it('confirms a revoke, names the device and time, and offers launch at login', () => {
    expect(screen).toMatch(/<h3>Revoke \{revoking\?\.label/);
    expect(screen).toContain("toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })");
    expect(screen).toContain("'Open OpenShore when this computer starts'");
  });

  it('keeps the expert tools folded away from a first pairing', () => {
    const more = screen.indexOf('{more ? (');
    expect(more).toBeGreaterThan(0);
    expect(screen.indexOf('<RemoteHubPanel />')).toBeGreaterThan(more);
  });

  it('lists no Android download on the iPhone; the web still links it', () => {
    expect(screen).toContain(
      "TAILSCALE_LINKS.filter((l) => !(platform() === 'ios' && l.glyph === 'android'))",
    );
    expect(screen).toMatch(/label: 'Android',\s*glyph: 'android'/);
  });

  it('tells an iPad from an iPhone on the computer', async () => {
    const { phoneDeviceName } = await import('../src/screens/PairScreen.js');
    const nav = globalThis.navigator;
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' });
    expect(phoneDeviceName()).toBe('iPad');
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' });
    expect(phoneDeviceName()).toBe('iPhone');
    vi.stubGlobal('navigator', nav);
  });
});

describe('a revoked phone is told so', () => {
  it('asks the credential-free route once per outage and stops on a refusal', () => {
    const driver = read('src', 'drivers', 'remoteDriver.ts');
    expect(driver).toMatch(/if \(!this\.rejectionChecked\) \{\s*this\.rejectionChecked = true;/);
    expect(driver).toMatch(
      /if \(health\.detail === PAIRING_REJECTED\) \{\s*this\.emitTerminal\(PAIRING_REJECTED\);/,
    );
  });

  it('a forgotten computer forgets this phone too', () => {
    // A server's provider keys go first, while the credential still works
    // (keys on your server, 2026-10-09); then the revoke, best effort as
    // before. app/test/serverKeys.test.tsx holds the order.
    const store = read('src', 'state', 'store.ts');
    expect(store).toMatch(/leaving\?\.token \? await leaveHub\(leaving, role\)/);
    const ops = read('src', 'state', 'serverKeysOps.ts');
    expect(ops).toMatch(
      /const cleared = await clearServerKeys\(target, role\);\s*if \(target\.token\) void daemonForgetSelf\(target\);/,
    );
  });
});
