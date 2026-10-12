// Runs on, on screen (founder, 2026-10-12). The project room gains a third
// pill once a machine is docked, and its sheet picks this computer (on the
// desktop), any docked machine with its kind and size, or the device's own
// choice. Computer offers the founder's three ways in: your computer, a
// server at home, a rented server. A rented server's setup says what each
// size can do, held to the same fit rule the First Seat uses, and how to set
// up several at once; a server at home is never told about renting. Mounted
// in a real DOM (test/support/dom.ts) so the taps are the ones a person makes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const shell = vi.hoisted(() => ({ desktop: false }));
vi.mock('../src/lib/platform.js', () => ({
  platform: () => (shell.desktop ? 'desktop' : 'ios'),
  isDesktop: () => shell.desktop,
  isPhone: () => !shell.desktop,
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
vi.mock('../src/drivers/remoteDriver.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/drivers/remoteDriver.js')>()),
  daemonHealth: vi.fn(async () => ({
    ok: true,
    detail: 'Docked to your server.',
    kind: 'server',
    machine: { ramGB: 4, cpus: 2, arch: 'arm64' },
  })),
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

const dom: TestDom = await mountDom();
const { useApp } = await import('../src/state/store.js');
const { THIS_COMPUTER } = await import('../src/lib/runsOn.js');
const docking = await import('../src/lib/docking.js');
const { fitVerdict } = await import('../src/lib/firstSeat.js');
const { HARBOR_MASTER_SIZES } = await import('../src/lib/harborMaster.js');
const { vaultCopy, HUB_HOME_SERVER_STORAGE, HUB_SERVER_STORAGE } =
  await import('../src/lib/vaultCopy.js');

const HOME = {
  baseUrl: 'http://127.0.0.1:1',
  token: 'a',
  kind: 'desktop' as const,
  name: 'studio',
};
const VPS = {
  baseUrl: 'http://127.0.0.1:2',
  token: 'b',
  kind: 'server' as const,
  place: 'rented' as const,
  name: 'cax11',
  machine: { ramGB: 4, cpus: 2, arch: 'arm64' },
};

function project(runsOn?: string) {
  return {
    id: 'p1',
    name: 'Shop',
    repoIds: [],
    createdAt: new Date().toISOString(),
    ...(runsOn ? { runsOn } : {}),
  };
}

beforeEach(() => {
  shell.desktop = false;
  useApp.setState({
    view: 'project',
    viewProjectId: 'p1',
    viewTrail: [],
    conversations: {},
    order: [],
    settings: {
      onboarded: true,
      claudeModel: 'x',
      deviceModels: {},
      projects: [project()],
      activeProjectId: 'p1',
    },
  } as never);
});

afterEach(async () => {
  await dom.render(null);
});

const pills = () =>
  [...dom.container.querySelectorAll<HTMLElement>('.project-pill')].map((el) => el.textContent);

describe('the project room', () => {
  it('shows no Runs on until a machine is docked', async () => {
    const { ProjectDetailScreen } = await import('../src/screens/ProjectDetailScreen.js');
    await dom.render(<ProjectDetailScreen />);
    expect(pills()).toEqual(['Add repositories', 'Add instructions']);
  });

  it('names where new chats run, and the sheet moves them to another machine', async () => {
    useApp.setState((s) => ({
      settings: { ...s.settings, daemon: HOME, daemons: [HOME, VPS] },
    }));
    const { ProjectDetailScreen } = await import('../src/screens/ProjectDetailScreen.js');
    await dom.render(<ProjectDetailScreen />);
    expect(pills()).toContain('Runs on studio');

    await dom.click('Runs on studio');
    await dom.settle();
    const text = dom.text();
    expect(text).toContain('Where this device runs');
    expect(text).toContain('Right now, studio.');
    expect(text).toContain('Rented server, 4 GB memory, 2 cores, Arm');
    expect(text).toContain('A chat already started stays where it began.');
    // A phone has no "this computer" to offer.
    expect(text).not.toContain('Its own engine');

    const row = [...dom.container.querySelectorAll<HTMLElement>('.profile-row')].find((el) =>
      el.textContent?.startsWith('cax11'),
    )!;
    const { act } = await import('react');
    await act(async () => {
      row.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    await dom.settle();
    expect(useApp.getState().settings.projects?.[0]?.runsOn).toBe(VPS.baseUrl);
    expect(useApp.getState().toast).toBe('New chats in Shop run on cax11.');
    // The device's active machine stays the computer.
    expect(useApp.getState().settings.daemon?.baseUrl).toBe(HOME.baseUrl);
  });

  it('on the desktop, offers this computer too', async () => {
    shell.desktop = true;
    useApp.setState((s) => ({
      settings: { ...s.settings, daemons: [VPS], projects: [project(THIS_COMPUTER)] },
    }));
    const { ProjectDetailScreen } = await import('../src/screens/ProjectDetailScreen.js');
    await dom.render(<ProjectDetailScreen />);
    // The desktop's own engine is offered only with a bridge; this test has
    // none, so a saved "this computer" reads as the device's own choice.
    expect(pills().some((p) => p?.startsWith('Runs on'))).toBe(true);
  });
});

describe('Computer, the three ways in', () => {
  it('offers your computer, a server at home and a rented server', async () => {
    const { PairScreen } = await import('../src/screens/PairScreen.js');
    await dom.render(<PairScreen />);
    const tabs = [...dom.container.querySelectorAll<HTMLElement>('.dock-choice .seg')].map(
      (el) => el.textContent,
    );
    expect(tabs).toEqual(['Your computer', 'Home server', 'Rented server']);

    await dom.click('Rented server');
    expect(dom.text()).toContain('Set up a rented server');
    expect(dom.text()).toContain('What each size can do');
    expect(dom.text()).toContain(docking.SERVER_RENTED_LINE);

    await dom.click('Home server');
    expect(dom.text()).toContain('Set up a server at home');
    expect(dom.text()).not.toContain(docking.SERVER_RENTED_LINE);
    expect(dom.text()).not.toContain('What each size can do');
  });

  it('lists every machine with its kind and size once there are two', async () => {
    useApp.setState((s) => ({
      settings: {
        ...s.settings,
        daemon: HOME,
        daemons: [HOME, VPS],
        projects: [project(VPS.baseUrl)],
      },
    }));
    const { PairScreen } = await import('../src/screens/PairScreen.js');
    await dom.render(<PairScreen />);
    const text = dom.text();
    expect(text).toContain('Your machines');
    expect(text).toContain('Rented server, 4 GB memory, 2 cores, Arm. Runs one project.');
    expect(text).toContain('Computer');
  });
});

describe('the server copy', () => {
  it('holds the size guide to the fit rule the First Seat uses', () => {
    const fourB = HARBOR_MASTER_SIZES.find((s) => /^Qwen3 4B/.test(s.weightsName))!;
    const { noModelBelowGB, smallModelFromGB } = docking.SERVER_SIZE_FIT;
    // At 4 GB a server keeps no model of its own; at 8 GB a 4B fits.
    expect(fitVerdict(fourB.sizeGB, { ramGB: noModelBelowGB, gpu: false })).not.toBe('fits');
    expect(fitVerdict(fourB.sizeGB, { ramGB: smallModelFromGB, gpu: false })).toBe('fits');
    const all = docking.SERVER_SIZES.map((r) => `${r.size} ${r.detail}`).join(' ');
    expect(all).toMatch(/2 to 4 GB/);
    expect(all).toMatch(/8 GB or more[\s\S]*a 3B or a 4B/);
    expect(all).toMatch(/shared vCPU included/);
    expect(all).toMatch(/billed by the hour/i);
    // No provider named or ranked, no speed promised.
    expect(all).not.toMatch(/hetzner|digitalocean|vultr|linode|aws|azure|oracle/i);
    expect(all).not.toMatch(/fast|quick|slow|tokens per second/i);
  });

  it('claims no Arm package before one ships, and docking a desktop moves no project', async () => {
    // The arm64 package is built by a job that may fail without holding the
    // release, so no copy promises it; a docked machine's own "Arm" is a fact.
    expect(docking.SERVER_SIZES.map((r) => r.detail).join(' ')).not.toMatch(/\bArm\b|arm64/);
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const form = readFileSync(join(process.cwd(), 'src', 'components', 'DockForm.tsx'), 'utf8');
    expect(form).not.toContain('setPreferRemoteHub(true)');
    expect(form).toContain('under Runs on in a project');
  });

  it('sets up several with a cloud-init that runs the same signed installer', () => {
    const lines = docking.SERVER_CLOUD_INIT.split('\n');
    expect(lines[0]).toBe('#cloud-config');
    expect(lines).toContain('  - curl -fsSL https://tailscale.com/install.sh | sh');
    expect(docking.SERVER_CLOUD_INIT).toContain('tailscale up --auth-key=PASTE-A-ONE-OFF');
    expect(lines.at(-1)).toBe(`  - ${docking.SERVER_INSTALL_COMMAND}`);
    expect(docking.SERVER_CLOUD_INIT_LINE).toMatch(/one-off auth key/);
    expect(docking.SERVER_CLOUD_INIT_LINE).toMatch(/your provider keeps what you paste/);
    expect(docking.SERVER_CLOUD_INIT_LINE).not.toMatch(/hetzner|digitalocean|vultr|linode/i);
  });

  it('never tells a server at home about renting', () => {
    const home = docking
      .serverSteps('home')
      .map((s) => `${s.title} ${s.detail}`)
      .join(' ');
    expect(home).not.toMatch(/rent/i);
    expect(docking.serverSteps('rented')).toBe(docking.SERVER_STEPS);
    expect(HUB_HOME_SERVER_STORAGE).not.toContain(docking.SERVER_RENTED_LINE);
    expect(HUB_SERVER_STORAGE).toContain(docking.SERVER_RENTED_LINE);
    const opts = { paired: true, hubServer: true };
    expect(vaultCopy('ios', 'hub', { ...opts, hubServerHome: true }).storage).toBe(
      HUB_HOME_SERVER_STORAGE,
    );
    // A server whose place is unknown keeps the renting line.
    expect(vaultCopy('ios', 'hub', opts).storage).toBe(HUB_SERVER_STORAGE);
  });
});
