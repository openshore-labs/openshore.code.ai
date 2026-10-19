// Agents (once Crew, renamed 2026-10-19; Crew command is now Routines), as a
// maintainer ruled it on 2026-10-07. D17: before a computer is
// paired, with no routine, the door to Crew command is a plain card row and
// the dark hero waits for work to show; Crew command keeps the crew to one
// line with Manage. D18: the whole crew card is the Edit tap, a swipe left
// deletes it as Crew command's routines do, and the editor's foot holds the
// same delete for a pointer or a screen reader. Mounted in a real DOM
// (test/support/dom.ts) so the taps are the ones a person makes.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

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

const { useApp } = await import('../src/state/store.js');

const src = (rel: string) =>
  readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');

const member = {
  id: 'a1',
  name: 'Reviewer',
  persona: 'Careful reviewer.',
  whenCalled: 'Before anything ships',
  activityLevel: 'review' as const,
  projectIds: [],
  createdAt: '2026-10-07T00:00:00.000Z',
};

const routine = {
  id: 'r1',
  name: 'Morning review',
  agentId: 'a1',
  agentName: 'Reviewer',
  persona: 'p',
  task: 't',
  cwd: '/repo',
  schedule: { hour: 9, minute: 0, days: [1, 2, 3, 4, 5] },
  access: 'read-only',
  enabled: true,
  presence: 'idle',
};

const hub = { baseUrl: 'http://100.64.0.2:4816', token: 'osc_owner', name: 'Studio Mac' };

let dom: TestDom | undefined;
const noop = async () => {};

beforeEach(() => {
  useApp.setState({
    view: 'crew',
    viewTrail: [],
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {}, crew: [member] },
    routines: { routines: [], runs: [], loaded: true, available: false, live: false },
    refreshRoutines: noop,
    refreshConnectivity: noop,
  } as never);
});

afterEach(async () => {
  await dom?.render(null);
});

async function renderCrew(): Promise<TestDom> {
  const { CrewScreen } = await import('../src/screens/CrewScreen.js');
  dom ??= await mountDom();
  await dom.render(<CrewScreen />);
  return dom;
}

describe('D17: the door to Crew command', () => {
  it('is a plain card row before a computer is paired and with no routine', async () => {
    const d = await renderCrew();
    const door = d.container.querySelector('.crew-command-row');
    expect(door, 'the quiet row').not.toBeNull();
    expect(door!.className).toMatch(/\bcard\b/);
    expect(door!.querySelector('.disclosure-chevron')).not.toBeNull();
    expect(door!.textContent).toBe('RoutinesRoutines run on your computer while it is on.');
    expect(d.container.querySelector('.crew-command-door')).toBeNull();
  });

  it('is the hero again once a routine exists, or a computer is paired', async () => {
    useApp.setState({
      routines: { routines: [routine], runs: [], loaded: true, available: true, live: false },
    } as never);
    let d = await renderCrew();
    expect(d.container.querySelector('.crew-command-door')).not.toBeNull();
    expect(d.container.querySelector('.crew-command-row')).toBeNull();

    useApp.setState({
      routines: { routines: [], runs: [], loaded: true, available: true, live: false },
      settings: { ...useApp.getState().settings, daemon: hub, daemons: [hub] },
      connectivity: { ...useApp.getState().connectivity, homeReachable: false },
    } as never);
    d = await renderCrew();
    const hero = d.container.querySelector('.crew-command-door');
    expect(hero).not.toBeNull();
    // Away from the computer, the door speaks the "while it is on" voice.
    expect(hero!.textContent).toContain(
      'Routines run on your computer while it is on. Reconnect to take control.',
    );
    expect(hero!.textContent).not.toMatch(/Watch here/);
  });

  it('counts the crew in Crew command, in one line under its head', async () => {
    const second = { ...member, id: 'a2', name: 'Strategy', activityLevel: 'request' as const };
    useApp.setState({
      settings: {
        ...useApp.getState().settings,
        crew: [member, second],
        daemon: hub,
        daemons: [hub],
      },
      connectivity: { ...useApp.getState().connectivity, homeReachable: true },
      routines: { routines: [routine], runs: [], loaded: true, available: true, live: true },
    } as never);
    const { CrewCommandScreen } = await import('../src/screens/CrewCommandScreen.js');
    dom ??= await mountDom();
    await dom.render(<CrewCommandScreen />);
    expect(dom.container.querySelector('.cc-crew-count')?.textContent).toBe(
      '2 agents, 1 with a routine.',
    );
    expect(dom.container.querySelector('.cc-member')).toBeNull();
    await dom.click('Manage');
    expect(useApp.getState().view).toBe('crew');
  });

  it('never promises a first routine while routines outlive their members', async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, crew: [], daemon: hub, daemons: [hub] },
      connectivity: { ...useApp.getState().connectivity, homeReachable: true },
      routines: { routines: [routine], runs: [], loaded: true, available: true, live: true },
    } as never);
    const { CrewCommandScreen } = await import('../src/screens/CrewCommandScreen.js');
    dom ??= await mountDom();
    await dom.render(<CrewCommandScreen />);
    expect(dom.container.querySelector('.cc-crew-count')?.textContent).toBe(
      'No agents. The routines below keep their schedule.',
    );
    expect(dom.text()).not.toContain('The first routine adds a Reviewer');
    expect(dom.text()).toContain('Morning review');
  });

  it('keeps Crew command to one line of crew, with Manage back to Crew', () => {
    const room = src('screens/CrewCommandScreen.tsx');
    expect(room).toContain('<p className="cc-crew-count">{crewCountLine(crew, routines)}</p>');
    expect(room).toMatch(/onClick=\{\(\) => setView\('crew'\)\}> Manage </);
    // No second roster of members: the grid is left for a current's cards.
    expect(room).not.toMatch(/roster\.map\(/);
    expect(room).not.toContain("'No routine yet'");
  });
});

describe('D18: a crew card is the Edit tap, and a swipe deletes it', () => {
  it('opens the editor from the card itself, with no Edit or Delete pills', async () => {
    const d = await renderCrew();
    const card = d.container.querySelector('.crew-card') as HTMLButtonElement | null;
    expect(card?.tagName).toBe('BUTTON');
    expect(card!.className).toMatch(/press-fb/);
    expect(card!.closest('.swipe-row')?.className).toMatch(/crew-card-swipe/);
    expect(d.container.querySelector('.swipe-action-danger')?.textContent).toBe('Delete');
    expect(d.buttons()).not.toContain('Edit');
    expect(d.buttons()).not.toContain('Delete');
    await act(() => card!.dispatchEvent(new window.Event('click', { bubbles: true })));
    expect(d.text()).toContain('Edit agent');
  });

  it("puts the same delete at the editor's foot, named for the member as saved", async () => {
    const d = await renderCrew();
    const card = d.container.querySelector('.crew-card') as HTMLButtonElement;
    await act(() => card.dispatchEvent(new window.Event('click', { bubbles: true })));
    // Renaming in the editor does not rename the delete until it is saved.
    await d.type('e.g. Security Reviewer, Ghostwriter, Contrarian', 'Gatekeeper');
    expect(d.buttons()).toContain('Delete Reviewer');
    await d.click('Delete Reviewer');
    expect(d.text()).toContain('Delete Reviewer?');
    expect(d.text()).toContain('Routines that use it keep their schedule.');
    expect(d.buttons()).toContain('Keep');
  });

  it("offers no delete in a new member's editor", async () => {
    const d = await renderCrew();
    await d.click('New agent');
    expect(d.buttons().some((b) => b.startsWith('Delete'))).toBe(false);
  });
});

async function act(fn: () => unknown): Promise<void> {
  const { act: reactAct } = await import('react');
  await reactAct(async () => {
    fn();
  });
}
