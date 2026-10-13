// The shell's four directions from the 2026-10-07 review, as a maintainer
// ruled them ("Do the remaining recommendations"): the setup page's idle
// paths are one tap each (D9, B), its headline is the App Store's line with a
// lead from the device in hand (D23, A), and on the desktop New project is
// the bar's action with search on top (D11, B). D10, the sidebar's order per
// device, is held in sidebarOrder.test.tsx and navRooms.test.ts. Beside them,
// the Chats row's second line starts on the title's edge.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mountDom, type TestDom } from './support/dom.js';

const device = vi.hoisted(() => ({ desktop: false }));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => (device.desktop ? 'electron' : 'ios'),
  isDesktop: () => device.desktop,
  isPhone: () => !device.desktop,
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

// The title flight's hand-off, seen by name: which row's title each open
// captured (null when nothing was there to fly from).
const hero = vi.hoisted(() => ({ from: [] as Array<string | null> }));
vi.mock('../src/lib/heroTitle.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/heroTitle.js')>()),
  captureTitleHero: (el: Element | null) => hero.from.push(el?.textContent ?? null),
}));

// Before anything imports react-dom/client (support/dom.ts).
const dom: TestDom = await mountDom();

const { useApp } = await import('../src/state/store.js');
const { OnboardingScreen, setupLead } = await import('../src/screens/OnboardingScreen.js');
const { ProjectsScreen } = await import('../src/screens/ProjectsScreen.js');
const { ReachDot } = await import('../src/screens/ChatsScreen.js');

const CSS = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8');

/** The window's width, the way useCompact reads it (900 is the breakpoint). */
function width(px: number) {
  Object.assign(window, { innerWidth: px });
}

/** The setup page's path cards: each idle one is the button itself. */
function pathCards(): HTMLElement[] {
  return [...dom.container.querySelectorAll<HTMLElement>('button.card-disclosure')];
}

const title = (card: HTMLElement) => card.querySelector('.path-card-title')?.textContent;

afterEach(async () => {
  await dom.render(null);
  device.desktop = false;
});

beforeEach(() => {
  width(390);
  useApp.setState({
    view: 'onboarding',
    harborDownload: undefined,
    settings: { onboarded: false, claudeModel: 'x', deviceModels: {} },
    saveSettings: async (patch) => {
      useApp.setState((s) => ({ settings: { ...s.settings, ...patch } }));
    },
  });
});

describe('the setup page (D9, D23)', () => {
  it('heads with the App Store line, each phrase whole', async () => {
    await dom.render(<OnboardingScreen />);
    const h1 = dom.container.querySelector('h1')!;
    expect(h1.textContent).toBe('Your models. Your keys.');
    const phrases = [...h1.querySelectorAll('span')].map((s) => s.textContent);
    expect(phrases).toEqual(['Your models.', 'Your keys.']);
    expect(dom.text()).not.toContain('Your computer.');
  });

  it('says where OpenShore runs from the device in hand, in one sentence', async () => {
    await dom.render(<OnboardingScreen />);
    expect(dom.container.querySelector('.lead')?.textContent).toBe(
      'Chat and build on this phone and on your own computer. Everything below is\u00a0optional.',
    );
    expect(setupLead(true)).toBe('Chat and build on this computer, and from your phone.');
    for (const lead of [setupLead(true), setupLead(false)]) {
      expect(lead.match(/\./g)).toHaveLength(1);
    }
  });

  // Slide Over (320pt): the lead's last word and Harbor's size never stand
  // alone on a line. A no-break space holds each in every web view, and a
  // room's lead wraps pretty where the engine can.
  it('holds the last word of the lead and "about 2.5 GB" together at 320pt', async () => {
    const { SETUP_LEAD_TAIL } = await import('../src/screens/OnboardingScreen.js');
    const { HARBOR_APPROX_LABEL } = await import('../src/lib/harbor.js');
    expect(SETUP_LEAD_TAIL.endsWith('is\u00a0optional.')).toBe(true);
    expect(HARBOR_APPROX_LABEL).toMatch(/^about\u00a0[\d.]+\u00a0GB$/);
    expect(CSS).toMatch(/\.screen \.lead \{[^}]*text-wrap: pretty;/);
  });

  it('makes every idle path one tap target: a title, one line and a drawn chevron', async () => {
    await dom.render(<OnboardingScreen />);
    const cards = pathCards();
    expect(cards.map(title)).toEqual([
      'Get Harbor',
      'Connect your computer',
      'Set up a repository',
      'Add an API key',
    ]);
    for (const card of cards) {
      expect(card.querySelector('button')).toBeNull();
      expect(card.querySelectorAll('.sub')).toHaveLength(1);
      expect(card.querySelector('.disclosure-chevron')?.getAttribute('aria-hidden')).toBe('true');
      expect(card.className).toContain('press-fb');
    }
    expect(cards[0]!.querySelector('.sub')?.textContent).toBe(
      'A coding model on this phone, about\u00a02.5\u00a0GB',
    );
  });

  it('opens the room a path names, and marks the setup done', async () => {
    await dom.render(<OnboardingScreen />);
    const pair = pathCards().find((c) => title(c) === 'Connect your computer')!;
    const { act } = await import('react');
    await act(async () => {
      pair.click();
    });
    await dom.settle();
    expect(useApp.getState().view).toBe('pair');
    expect(useApp.getState().settings.onboarded).toBe(true);
  });

  it("keeps Harbor's download and retry controls", async () => {
    useApp.setState({
      harborDownload: { percent: 40, label: '1 GB of 2.5 GB', indeterminate: false } as never,
    });
    await dom.render(<OnboardingScreen />);
    expect(dom.text()).toContain('Getting Harbor');
    expect(dom.buttons()).toContain('Cancel download');
    expect(pathCards().map(title)).not.toContain('Get Harbor');

    useApp.setState({ harborDownload: { failed: true, label: 'It stopped.' } as never });
    await dom.render(<OnboardingScreen />);
    expect(dom.buttons()).toContain('Try again');
  });

  it('gives the desktop its own paths, one tap each', async () => {
    device.desktop = true;
    width(1280);
    await dom.render(<OnboardingScreen />);
    expect(pathCards().map(title)).toEqual([
      'Build your stack',
      'Open a repository',
      'Add an API key',
    ]);
    expect(dom.container.querySelector('.lead')?.textContent).toContain(
      'on this computer, and from your phone.',
    );
  });

  it('draws the card from the house card and press grammar', () => {
    expect(CSS).toMatch(/\.path-card-text \{[^}]*flex: 1;[^}]*min-width: 0;/);
    expect(CSS).toMatch(/\.path-card-title \{[^}]*font-weight: var\(--weight-semibold\)/);
  });
});

describe('Projects on the desktop (D11)', () => {
  beforeEach(() => {
    useApp.setState((s) => ({
      view: 'projects',
      viewTrail: [],
      order: [],
      conversations: {},
      settings: {
        ...s.settings,
        onboarded: true,
        activeProjectId: 'a',
        projects: [
          { id: 'a', name: 'Harbor website', repoIds: [], createdAt: '2026-10-01T00:00:00Z' },
          { id: 'b', name: 'Tide tables', repoIds: [], createdAt: '2026-10-02T00:00:00Z' },
        ],
      } as never,
    }));
  });

  const barNew = () =>
    [...dom.container.querySelectorAll('.topbar button')].find(
      (b) => b.textContent?.trim() === 'New project',
    );

  it('puts New project in the bar and search on top, with no dock', async () => {
    width(1280);
    await dom.render(<ProjectsScreen />);
    expect(barNew()?.className).toContain('btn primary sm');
    const pill = dom.container.querySelector('.chat-search input');
    expect(pill?.getAttribute('placeholder')).toBe('Search projects');
    // The pill sits above the list it searches.
    const inner = dom.container.querySelector('.screen-inner.projects')!;
    expect(inner.firstElementChild?.className).toContain('chat-search');
    expect(dom.container.querySelector('.projects-dock')).toBeNull();
  });

  it('filters the list from the top pill', async () => {
    width(1280);
    await dom.render(<ProjectsScreen />);
    await dom.type('Search projects', 'tide');
    const names = [...dom.container.querySelectorAll('.project-row-name')].map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['Tide tables']);
  });

  // Enter in the top pill opens the top match the way a tap does, so its
  // name flies up into the room's title from the first row.
  it('flies the top match from its row on Enter, the same as a tap', async () => {
    width(1280);
    hero.from = [];
    await dom.render(<ProjectsScreen />);
    await dom.type('Search projects', 'tide');
    const pill = dom.container.querySelector('.chat-search input')!;
    const { act } = await import('react');
    await act(async () => {
      const enter = new window.Event('keydown', { bubbles: true });
      Object.assign(enter, { key: 'Enter' });
      pill.dispatchEvent(enter);
    });
    expect(hero.from).toEqual(['Tide tables']);
    expect(useApp.getState().view).toBe('project');
    expect(useApp.getState().viewProjectId).toBe('b');

    // A tap captures the same title.
    hero.from = [];
    useApp.setState({ view: 'projects' } as never);
    await dom.render(<ProjectsScreen />);
    await act(async () => {
      (dom.container.querySelector('.project-row') as HTMLElement).click();
    });
    expect(hero.from).toEqual(['Tide tables']);
  });

  it('opens the New project sheet from the bar', async () => {
    width(1280);
    await dom.render(<ProjectsScreen />);
    const { act } = await import('react');
    await act(async () => {
      (barNew() as HTMLElement).click();
    });
    expect(dom.text()).toContain('What are you working on?');
  });

  it('keeps the dock on the phone, and nothing in the bar', async () => {
    width(390);
    await dom.render(<ProjectsScreen />);
    expect(dom.container.querySelector('.projects-dock')).not.toBeNull();
    expect(barNew()).toBeUndefined();
    expect(dom.container.querySelector('.chat-search')).toBeNull();
  });

  // The phone's dock keeps one gutter on both sides: its one grid track is the
  // padded box, so the search field's own width cannot push New project past
  // the right edge.
  it('keeps the phone dock inside its gutters', () => {
    expect(CSS).toMatch(/\.projects-dock \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  });

  it('holds the bar button on one line beside its glyph', () => {
    expect(CSS).toMatch(/\.projects-bar-new \{[^}]*display: inline-flex;[^}]*gap: 6px;/);
  });

  // One room deeper, the same grammar: the project room's New chat sits in
  // the bar on the desktop, and in the dock on the phone.
  const barChat = () =>
    [...dom.container.querySelectorAll('.topbar button')].find(
      (b) => b.textContent?.trim() === 'New chat',
    );

  it("puts the project room's New chat in the bar on the desktop, with no dock", async () => {
    width(1280);
    useApp.setState({ view: 'project', viewProjectId: 'a' } as never);
    const { ProjectDetailScreen } = await import('../src/screens/ProjectDetailScreen.js');
    await dom.render(<ProjectDetailScreen />);
    expect(barChat()?.className).toContain('btn primary sm');
    expect(dom.container.querySelector('.project-room-dock')).toBeNull();
  });

  it('gives desktop Chats the same labelled bar button, and the phone its pen and row', async () => {
    const { ChatsScreen } = await import('../src/screens/ChatsScreen.js');
    const now = new Date().toISOString();
    useApp.setState({
      view: 'chats',
      order: ['c1'],
      conversations: {
        c1: {
          id: 'c1',
          title: 'Tide math',
          source: { kind: 'stack' },
          createdAt: now,
          updatedAt: now,
          projectId: 'a',
          thread: { items: [], busy: false, dollars: 0, contextPercent: 0 },
        },
      },
    } as never);
    width(1280);
    await dom.render(<ChatsScreen />);
    expect(barChat()?.className).toContain('btn primary sm');
    expect(dom.container.querySelector('.chat-row-new')).toBeNull();
    await dom.render(null);
    width(390);
    await dom.render(<ChatsScreen />);
    expect(barChat()).toBeUndefined();
    expect(dom.container.querySelector('.topbar [aria-label="New chat"]')).not.toBeNull();
    expect(dom.container.querySelector('.chat-row-new')).not.toBeNull();
  });

  it("keeps the project room's dock on the phone, and no New chat in the bar", async () => {
    width(390);
    useApp.setState({ view: 'project', viewProjectId: 'a' } as never);
    const { ProjectDetailScreen } = await import('../src/screens/ProjectDetailScreen.js');
    await dom.render(<ProjectDetailScreen />);
    expect(barChat()).toBeUndefined();
    expect(dom.container.querySelector('.project-room-dock')).not.toBeNull();
  });
});

// A chat whose reach is not known yet draws no dot and takes no space, so
// "Yesterday · Stack" starts on the title's edge, not 13px in.
describe('the chat row second line', () => {
  it('draws no dot, and no box, when the reach is not known', () => {
    expect(renderToStaticMarkup(<ReachDot reach={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<ReachDot reach="local" />)).toContain(
      'chat-reach chat-reach-local',
    );
    expect(CSS).not.toContain('.chat-reach-unknown');
  });
});
