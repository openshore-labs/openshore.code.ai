// Runs on, on screen (2026-10-12). The project room gains a third
// pill once a machine is docked, and its sheet picks this computer (on the
// desktop), any docked machine with its kind and size, or the device's own
// choice. Computer offers a maintainer's three ways in: your computer, a
// server at home, a rented server. A rented server's setup says what each
// size can do, held to the same fit rule the First Seat uses, and how to set
// up several at once; a server at home is never told about renting. Mounted
// in a real DOM (test/support/dom.ts) so the taps are the ones a person makes.
import { hostOf } from '../src/components/DockForm.js';
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
const runsOn = () =>
  dom.container.querySelector<HTMLElement>('.runs-on-pill')?.textContent ?? undefined;

describe('the project room', () => {
  it('shows no Runs on until a machine is docked', async () => {
    const { ProjectDetailScreen } = await import('../src/screens/ProjectDetailScreen.js');
    await dom.render(<ProjectDetailScreen />);
    expect(pills()).toEqual(['Add repositories', 'Project Wayfinder', 'Agents']);
    expect(runsOn()).toBeUndefined();
  });

  it('names where new chats run, and the sheet moves them to another machine', async () => {
    useApp.setState((s) => ({
      settings: { ...s.settings, daemon: HOME, daemons: [HOME, VPS] },
    }));
    const { ProjectDetailScreen } = await import('../src/screens/ProjectDetailScreen.js');
    await dom.render(<ProjectDetailScreen />);
    // Under the title, where Active was (founder, 2026-10-27).
    expect(runsOn()).toBe('Runs on studio');

    await dom.click('Runs on studio');
    await dom.settle();
    const text = dom.text();
    expect(text).toContain('Automatic');
    expect(text).toContain("Follows this device's default. Right now, studio.");
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
    expect(runsOn()?.startsWith('Runs on')).toBe(true);
  });
});

describe('Computer, the three ways in', () => {
  it('offers your computer, a server at home and a rented server', async () => {
    const { PairScreen } = await import('../src/screens/PairScreen.js');
    await dom.render(<PairScreen />);
    const tabs = [...dom.container.querySelectorAll<HTMLElement>('.dock-choice .seg')].map(
      (el) => el.textContent,
    );
    expect(tabs).toEqual(['Computer', 'Home server', 'Rented server']);

    await dom.click('Rented server');
    expect(dom.text()).toContain('Set up a rented server');
    // The size guide waits behind its question (2026-10-13).
    expect(dom.text()).not.toContain('2 to 4 GB');
    await dom.click('Which size do I need?');
    expect(dom.text()).toContain('2 to 4 GB');
    expect(dom.text()).toContain(docking.SERVER_RENTED_LINE);

    await dom.click('Home server');
    expect(dom.text()).toContain('Set up a server at home');
    expect(dom.text()).not.toContain(docking.SERVER_RENTED_LINE);
    expect(dom.text()).not.toContain('Which size do I need?');
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

// The CX pass (founder, 2026-10-13: "Build it all"): docked, the ways in
// fold; one idea, the default, replaces Active and the desktop's switch; a
// chat names its machine and, when that machine is forgotten, offers the way
// back; the first choice in Runs on is Automatic.
describe('the CX pass', () => {
  it('folds the ways in behind Dock another machine once docked, and unfolds on a tap', async () => {
    useApp.setState((s) => ({ settings: { ...s.settings, daemon: HOME, daemons: [HOME] } }));
    const { PairScreen } = await import('../src/screens/PairScreen.js');
    await dom.render(<PairScreen />);
    expect(dom.container.querySelector('.dock-choice')).toBeNull();
    expect(dom.buttons()).toContain('Dock another machine');
    await dom.click('Dock another machine');
    expect(dom.container.querySelector('.dock-choice')).not.toBeNull();
  });

  // Creative Studio, 2026-10-19: docked, the room is the machine. Its name
  // leads with its address under it, and what you can do is one list of
  // rows, forgetting last and in red, beside naming it.
  it('shows the docked machine by name, with its actions as rows', async () => {
    useApp.setState((s) => ({ settings: { ...s.settings, daemon: HOME, daemons: [HOME] } }));
    const { PairScreen } = await import('../src/screens/PairScreen.js');
    await dom.render(<PairScreen />);
    expect(dom.container.querySelector('h1')?.textContent).toContain('Computer');
    expect(dom.text()).not.toContain('Dock to a computer');
    const hero = dom.container.querySelector('.dock-hero')!;
    expect(hero.querySelector('.dock-hero-name')?.textContent).toBe(
      HOME.name?.trim() || 'Your computer',
    );
    expect(hero.querySelector('.dock-hero-address')?.textContent).toBe(hostOf(HOME.baseUrl));
    expect(hero.querySelector('.dock-dot')).not.toBeNull();
    const rows = [...dom.container.querySelectorAll('.settings-row-label')].map(
      (r) => r.textContent,
    );
    expect(rows.indexOf('Forget this computer')).toBe(rows.indexOf('Name') + 1);
    expect(dom.container.querySelector('.settings-row.danger')?.textContent).toBe(
      'Forget this computer',
    );
    expect(dom.container.querySelector('.pill')?.textContent ?? '').not.toMatch(/Reachable/);
  });

  it('names one default, and a tap makes another machine the default', async () => {
    useApp.setState((s) => ({
      settings: { ...s.settings, daemon: HOME, daemons: [HOME, VPS] },
    }));
    const { PairScreen } = await import('../src/screens/PairScreen.js');
    await dom.render(<PairScreen />);
    expect(dom.text()).toContain('Default');
    expect(dom.text()).not.toMatch(/\bActive\b/);
    const row = [...dom.container.querySelectorAll<HTMLElement>('.machine-row-main')].find((el) =>
      el.textContent?.startsWith('cax11'),
    )!;
    const { act } = await import('react');
    await act(async () => {
      row.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    await dom.settle();
    expect(useApp.getState().settings.daemon?.baseUrl).toBe(VPS.baseUrl);
  });

  it('on the desktop, the default replaces the "Run on another computer" switch', async () => {
    const screen = (await import('node:fs')).readFileSync(
      (await import('node:path')).join(process.cwd(), 'src', 'screens', 'PairScreen.tsx'),
      'utf8',
    );
    expect(screen).not.toContain('Run on another computer');
    expect(screen).toContain('setDefaultMachine(THIS_COMPUTER)');
    expect(screen).toContain('Dock by address and key');
  });

  it('a chat names its machine, and a forgotten one offers Dock again', async () => {
    const { goneLine } = await import('../src/lib/runsOn.js');
    const key = 'http://127.0.0.1:9';
    expect(goneLine(key, 'cax11', false)).toBe(
      'This chat ran on cax11, which this device no longer docks to.',
    );
    expect(goneLine(key, 'cax11')).toMatch(/Dock to it again from Computer/);
    const chat = (await import('node:fs')).readFileSync(
      (await import('node:path')).join(process.cwd(), 'src', 'screens', 'ChatScreen.tsx'),
      'utf8',
    );
    expect(chat).toContain('<span className="chat-runs-on" title="Where this chat runs">');
    expect(chat).toContain("chatWhere?.kind === 'gone'");
    expect(chat).toMatch(/onClick=\{\(\) => setView\('pair'\)\}>\s*Dock again/);
  });
});
