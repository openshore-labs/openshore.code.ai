// Stopping, revoking, forgetting and exporting are always free (CTO,
// 2026-09-30). With the pay gates ON, a paid room still opens when it holds
// something to stop or let go of (roomPass): Crew with routines, Desktop +
// phone with a paired computer. Inside, the paid actions open the sheet and
// the free ones do not. Mounted in a real DOM (test/support/dom.ts) so the
// taps are the ones a person makes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

// Hoisted above the imports: a module a static import reaches (types.ts ->
// harborMini.ts) reads the flag when it loads.
vi.hoisted(() => vi.stubEnv('VITE_PAY_GATES', '1'));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => false,
  isPhone: () => true,
  dataUnlockState: async () => 'ok',
  openExternal: () => {},
  openInAppBrowser: () => {},
  storeGetJson: async () => undefined,
  storeSetJson: async () => {},
  storeGet: async () => null,
  storeSet: async () => {},
  storeDelete: async () => {},
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

vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/supabase.js')>();
  return { ...real, isConfigured: () => true };
});

const { useApp } = await import('../src/state/store.js');
const { roomPass } = await import('../src/state/payOps.js');
const { CREW_PLUS_LINE } = await import('../src/lib/payGate.js');

const session = {
  accessToken: 'tok',
  refreshToken: 'rt',
  expiresAt: Date.now() + 3_600_000,
  user: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', email: 'a@b.c' },
};

const hub = { baseUrl: 'http://100.64.0.2:4816', token: 'osc_member' };

const routine = {
  id: 'r1',
  name: 'Nightly review',
  agentId: 'a1',
  agentName: 'Reviewer',
  persona: 'p',
  task: 't',
  cwd: '/repo',
  schedule: { hour: 9, minute: 0, days: [1, 2, 3, 4, 5] },
  enabled: true,
  presence: 'idle',
};

let dom: TestDom | undefined;

beforeEach(() => {
  useApp.setState({
    authConfigured: true,
    authSession: session,
    userEntitlement: undefined,
    entitlement: undefined,
    paywall: undefined,
    accountGate: undefined,
    view: 'chat',
    viewTrail: [],
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
    routines: { routines: [], runs: [], loaded: true, available: false, live: false },
  });
});

afterEach(async () => {
  await dom?.render(null);
});

describe('the pass rule', () => {
  it('opens Crew only with routines, and Desktop + phone on the desktop or with a paired computer', () => {
    const none = { routines: 0, desktop: false, savedHubs: 0 };
    expect(roomPass('crew', none)).toBe(false);
    expect(roomPass('crew', { ...none, routines: 1 })).toBe(true);
    expect(roomPass('crewcommand', { ...none, routines: 1 })).toBe(true);
    expect(roomPass('pair', none)).toBe(false);
    expect(roomPass('pair', { ...none, desktop: true })).toBe(true);
    expect(roomPass('pair', { ...none, savedHubs: 1 })).toBe(true);
    // Rooms with nothing to stop never pass.
    for (const v of ['vault', 'terminalroom', 'repos', 'stackhealth'] as const)
      expect(roomPass(v, { routines: 3, desktop: true, savedHubs: 2 }), v).toBe(false);
  });
});

describe('the store, with the gates on and no Plus', () => {
  it('opens Crew to someone with routines, and paywalls someone without', () => {
    useApp.getState().setView('crew', { root: true });
    expect(useApp.getState().paywall).toBe('crew');
    expect(useApp.getState().view).toBe('chat');
    useApp.setState({
      paywall: undefined,
      routines: {
        routines: [routine as never],
        runs: [],
        loaded: true,
        available: true,
        live: false,
      },
    });
    useApp.getState().setView('crew', { root: true });
    expect(useApp.getState().view).toBe('crew');
    expect(useApp.getState().paywall).toBeUndefined();
  });

  it('opens Desktop + phone to a phone with a paired computer', () => {
    useApp.getState().setView('pair', { root: true });
    expect(useApp.getState().paywall).toBe('pairing');
    useApp.setState({ paywall: undefined });
    useApp.setState({ settings: { ...useApp.getState().settings, daemon: hub, daemons: [hub] } });
    useApp.getState().setView('pair', { root: true });
    expect(useApp.getState().view).toBe('pair');
    expect(useApp.getState().paywall).toBeUndefined();
  });

  it('holds making and changing a crew member at the paid door, and lets deleting through', async () => {
    const input = { name: 'N', persona: 'P', activityLevel: 'request' as const, projectIds: [] };
    expect(await useApp.getState().createCrewAgent(input)).toBeUndefined();
    expect(useApp.getState().paywall).toBe('crew');
    useApp.setState({
      paywall: undefined,
      settings: {
        ...useApp.getState().settings,
        crew: [{ ...input, id: 'a1', createdAt: '2026-09-30T00:00:00.000Z' }],
      },
    });
    expect(await useApp.getState().updateCrewAgent('a1', { name: 'M' })).toBe(false);
    expect(useApp.getState().paywall).toBe('crew');
    useApp.setState({ paywall: undefined });
    await useApp.getState().deleteCrewAgent('a1');
    expect(useApp.getState().paywall).toBeUndefined();
    expect(useApp.getState().settings.crew).toEqual([]);
  });

  it('never paywalls stopping or deleting a routine', async () => {
    await useApp.getState().stopRoutine('r1');
    await useApp.getState().deleteRoutine('r1');
    await useApp.getState().updateRoutine('r1', { enabled: false });
    expect(useApp.getState().paywall).toBeUndefined();
  });
});

describe('the rooms, as a person taps them', () => {
  it('Pairing on a paired phone: Scan opens the sheet, Forget does not', async () => {
    useApp.setState({ settings: { ...useApp.getState().settings, daemon: hub, daemons: [hub] } });
    const { PairScreen } = await import('../src/screens/PairScreen.js');
    dom ??= await mountDom();
    await dom.render(<PairScreen />);
    expect(dom.text()).toContain('Part of OpenShore Plus');
    await dom.click('Scan to pair another computer');
    expect(useApp.getState().paywall).toBe('pairing');
    useApp.setState({ paywall: undefined });
    await dom.click('Forget this computer');
    await dom.click('Forget');
    await dom.settle();
    expect(useApp.getState().paywall).toBeUndefined();
    expect(useApp.getState().settings.daemon).toBeUndefined();
  });

  it('Crew with routines says they keep running and stopping them is free', async () => {
    useApp.setState({
      routines: {
        routines: [routine as never],
        runs: [],
        loaded: true,
        available: true,
        live: false,
      },
    });
    const { CrewScreen } = await import('../src/screens/CrewScreen.js');
    dom ??= await mountDom();
    await dom.render(<CrewScreen />);
    expect(dom.text()).toContain(CREW_PLUS_LINE);
    await dom.click('See Plus');
    expect(useApp.getState().paywall).toBe('crew');
  });

  it('a subscriber sees no Plus note', async () => {
    useApp.setState({
      userEntitlement: { tierId: 'personal', status: 'active' },
      settings: { ...useApp.getState().settings, daemon: hub, daemons: [hub] },
    });
    const { PairScreen } = await import('../src/screens/PairScreen.js');
    dom ??= await mountDom();
    await dom.render(<PairScreen />);
    expect(dom.text()).not.toContain('Part of OpenShore Plus');
  });
});

describe('Settings, the free ways out', () => {
  it('offers the iPhone vault export and a git host removal while those rooms are shut', async () => {
    const setState = useApp.setState;
    setState({ connectedRepoPlatforms: { github: true } as never });
    const { SettingsScreen } = await import('../src/screens/SettingsScreen.js');
    dom ??= await mountDom();
    await dom.render(<SettingsScreen />);
    expect(dom.text()).toContain('Export your notes');
    expect(dom.text()).toContain('Removing its sign-in from this device is always free.');
    // With Plus, both live in their own rooms again.
    setState({ userEntitlement: { tierId: 'personal', status: 'active' } });
    await dom.render(<SettingsScreen />);
    expect(dom.text()).not.toContain('Export your notes');
    expect(dom.text()).not.toContain('Removing its sign-in from this device is always free.');
  });
});
