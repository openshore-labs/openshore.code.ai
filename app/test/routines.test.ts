// Crew routines, app side: the presence and copy helpers the command center
// and the Crew cards render with, the preset builder, and which client the
// device reaches the scheduler through. Pure, so nothing here touches a
// daemon or the bridge.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/platform.js', () => ({
  isDesktop: () => (globalThis as { __desktop?: boolean }).__desktop === true,
}));

// The bridge reads window.oscode; vitest runs these in node, so `window` is
// the global here, the way it is in the WebView.
(globalThis as { window?: unknown }).window = globalThis;

const {
  CLOCK_ELSEWHERE_LINE,
  agentPresenceLine,
  clockKeptElsewhere,
  controlBlurb,
  controlLabel,
  crewControl,
  crewHeadline,
  customRoutinesUnlocked,
  presenceLabel,
  presenceTone,
  presetRoutineInput,
  routinesClient,
  routinesForAgent,
  runWhen,
} = await import('../src/lib/routines.js');
import type { RoutineRun, RoutineView } from '../src/lib/routines.js';

function view(over: Partial<RoutineView> = {}): RoutineView {
  return {
    id: 'r1',
    name: 'Morning review',
    agentName: 'Reviewer',
    persona: 'p',
    task: 't',
    cwd: '/home/u/OSCode/repo',
    schedule: { hour: 6, minute: 0, days: [1, 2, 3, 4, 5] },
    enabled: true,
    access: 'read-only',
    maxMinutes: 15,
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    presence: 'idle',
    ...over,
  };
}

function run(over: Partial<RoutineRun> = {}): RoutineRun {
  return {
    id: 'run1',
    routineId: 'r1',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    state: 'done',
    trigger: 'schedule',
    ...over,
  };
}

afterEach(() => {
  delete (globalThis as { __desktop?: boolean }).__desktop;
  delete (window as unknown as { oscode?: unknown }).oscode;
});

describe('presence copy', () => {
  it('names each presence in the app voice', () => {
    const now = new Date(2026, 8, 7, 9, 0).getTime();
    expect(presenceLabel(view({ presence: 'working' }), now)).toBe('Working');
    expect(presenceLabel(view({ presence: 'waiting' }), now)).toBe('Waiting for you');
    expect(presenceLabel(view({ presence: 'paused', enabled: false }), now)).toBe('Paused');
    const finished = new Date(2026, 8, 7, 6, 12).toISOString();
    expect(
      presenceLabel(view({ presence: 'done', lastRun: run({ finishedAt: finished }) }), now),
    ).toBe('Done 6:12');
    const next = new Date(2026, 8, 8, 6, 0).toISOString();
    expect(presenceLabel(view({ presence: 'idle', nextRunAt: next }), now)).toBe('Next Tue 6:00');
  });

  it('maps presence to the colour language: teal working, amber waiting', () => {
    expect(presenceTone('working')).toBe('working');
    expect(presenceTone('waiting')).toBe('waiting');
    expect(presenceTone('done')).toBe('ok');
    expect(presenceTone('failed')).toBe('failed');
    expect(presenceTone('paused')).toBe('muted');
  });

  it('writes the headline from what matters most: needs you, then working, then results', () => {
    expect(crewHeadline([], [])).toContain('ready to work');
    // Routines run while the computer is on, never "while you are away".
    expect(crewHeadline([], [])).toBe('Your crew is ready to work while your computer is on.');
    expect(
      crewHeadline([view({ presence: 'waiting' }), view({ id: 'r2', presence: 'working' })], []),
    ).toBe('1 routine needs you.');
    expect(crewHeadline([view({ presence: 'working' })], [])).toBe(
      '1 routine is working right now.',
    );
    expect(crewHeadline([view({ presence: 'done' })], [run()])).toBe('1 result waiting for you.');
    const now = new Date(2026, 8, 7, 9, 0).getTime();
    const next = new Date(2026, 8, 8, 6, 0).toISOString();
    expect(crewHeadline([view({ nextRunAt: next })], [], now)).toBe('Quiet. Next run Tue 6:00.');
    expect(crewHeadline([view({ enabled: false, presence: 'paused' })], [], now)).toBe(
      'Quiet. Every routine is paused.',
    );
  });

  it('lights a crew card from its busiest routine, matched by id or by name', () => {
    const byId = view({ agentId: 'a1', presence: 'working' });
    const byName = view({ id: 'r2', agentName: 'Reviewer', presence: 'done' });
    const routines = [byName, byId];
    expect(routinesForAgent(routines, { id: 'a1', name: 'Someone else' })).toEqual([byId]);
    expect(routinesForAgent(routines, { id: 'zz', name: 'Reviewer' })).toEqual([byName]);
    expect(agentPresenceLine([byName, byId])).toBe('Working · Morning review');
    expect(agentPresenceLine([])).toBeUndefined();
  });

  it('unlocks custom routines after the first run finishes, and stamps runs by day', () => {
    expect(customRoutinesUnlocked([run({ state: 'skipped' })])).toBe(false);
    expect(customRoutinesUnlocked([run({ state: 'done' })])).toBe(true);
    const now = new Date(2026, 8, 7, 9, 0).getTime();
    expect(runWhen(run({ finishedAt: new Date(2026, 8, 6, 22, 5).toISOString() }), now)).toBe(
      'yesterday 22:05',
    );
  });
});

describe('the preset', () => {
  it('builds a read-only weekday morning review for a workspace and a crew member', () => {
    const input = presetRoutineInput('/home/u/OSCode/repo', {
      id: 'a1',
      name: 'Reviewer',
      persona: 'calm',
    });
    expect(input.name).toBe('Morning review');
    expect(input.access).toBe('read-only');
    expect(input.schedule).toEqual({ hour: 6, minute: 0, days: [1, 2, 3, 4, 5] });
    expect(input.agentId).toBe('a1');
    expect(input.task).toContain('gitLog');
  });
});

describe('the control distinction: set up and control only while docked', () => {
  it('is in control on the machine itself, always', () => {
    expect(crewControl({ onDesktop: true, hasDaemon: false, homeReachable: false })).toEqual({
      can: true,
      where: 'desktop',
    });
    // A desktop pointed at a remote hub is gated on reach like a phone.
    expect(
      crewControl({
        onDesktop: true,
        hasDaemon: true,
        homeReachable: false,
        preferRemoteHub: true,
      }),
    ).toEqual({ can: false, where: 'away' });
  });

  it('is in control when a paired device can reach home (docked), view-only when away', () => {
    expect(crewControl({ onDesktop: false, hasDaemon: true, homeReachable: true })).toEqual({
      can: true,
      where: 'docked',
    });
    expect(crewControl({ onDesktop: false, hasDaemon: true, homeReachable: false })).toEqual({
      can: false,
      where: 'away',
    });
  });

  it('is unpaired when no machine is set up at all', () => {
    expect(crewControl({ onDesktop: false, hasDaemon: false, homeReachable: true })).toEqual({
      can: false,
      where: 'unpaired',
    });
  });

  it('labels the state and names the away and unpaired blurbs', () => {
    expect(controlLabel('docked')).toBe('In control');
    expect(controlLabel('desktop')).toBe('In control');
    expect(controlLabel('away')).toBe('View only');
    expect(controlLabel('unpaired')).toBe('Not set up');
    expect(controlBlurb('away', 'the Mac mini')).toContain('Reconnect over Tailscale');
    expect(controlBlurb('away', 'the Mac mini')).toContain('the Mac mini');
    expect(controlBlurb('away', 'the Mac mini')).toContain('while it is on');
    expect(controlBlurb('away', 'the Mac mini')).not.toContain('keeps working');
    // It sits over the Connect your computer button, so it uses that verb.
    expect(controlBlurb('unpaired', 'your main machine')).toContain('Connect this device');
    expect(controlBlurb('unpaired', 'your main machine')).not.toMatch(/\bPair\b/);
  });
});

describe('a run refused for want of a local model', () => {
  it('is recognized by its exact line, so the card can wear amber and point at the Stack', async () => {
    const { runNeedsLocalModel, ROUTINE_NEEDS_LOCAL_MODEL } =
      await import('../src/lib/routines.js');
    expect(ROUTINE_NEEDS_LOCAL_MODEL).toMatch(/local model on this computer/);
    expect(ROUTINE_NEEDS_LOCAL_MODEL).toMatch(/Stack/);
    expect(runNeedsLocalModel({ state: 'failed', summary: ROUTINE_NEEDS_LOCAL_MODEL })).toBe(true);
    expect(runNeedsLocalModel({ state: 'failed', summary: 'Could not start: x' })).toBe(false);
    expect(runNeedsLocalModel({ state: 'done', summary: ROUTINE_NEEDS_LOCAL_MODEL })).toBe(false);
    expect(runNeedsLocalModel(undefined)).toBe(false);
  });
});

describe('which client reaches the scheduler', () => {
  it('uses the bridge on the desktop, the daemon on a paired phone, nothing otherwise', () => {
    expect(routinesClient({})).toBeUndefined();
    const daemon = { baseUrl: 'http://100.1.1.1:4816', token: 't' };
    expect(routinesClient({ daemon })?.where).toBe('daemon');
    (globalThis as { __desktop?: boolean }).__desktop = true;
    (window as unknown as { oscode?: unknown }).oscode = { platform: 'electron' };
    expect(routinesClient({ daemon })?.where).toBe('desktop');
    // A desktop pointed at a remote hub runs routines there, like its chats.
    expect(routinesClient({ daemon, preferRemoteHub: true })?.where).toBe('daemon');
  });
});

describe("the Crew room's clock line (CX cleanup 6)", () => {
  const held = { live: false, heldBy: { pid: 4242, since: '2026-09-29T06:00:00Z' } };

  it('shows only on the desktop, reading its own engine live, while another OpenShore keeps it', () => {
    expect(clockKeptElsewhere({ where: 'desktop', live: true, clock: held })).toBe(true);
    // This app keeps the schedule itself.
    expect(clockKeptElsewhere({ where: 'desktop', live: true, clock: { live: true } })).toBe(false);
    // A phone, or a desktop pointed at a hub, reads another computer's clock.
    expect(clockKeptElsewhere({ where: 'daemon', live: true, clock: held })).toBe(false);
    // A cached picture, or an older engine that does not say.
    expect(clockKeptElsewhere({ where: 'desktop', live: false, clock: held })).toBe(false);
    expect(clockKeptElsewhere({ where: 'desktop', live: true })).toBe(false);
  });

  it('says what to do with no process number and no time, now that the takeover ships', () => {
    expect(CLOCK_ELSEWHERE_LINE).toBe(
      'Another OpenShore on this computer, such as one in a terminal, is keeping the routine schedule. If you close it, routines run here.',
    );
    expect(CLOCK_ELSEWHERE_LINE).not.toMatch(/\d/);
  });

  it("the desktop client hands the engine's clock through", async () => {
    (globalThis as { __desktop?: boolean }).__desktop = true;
    (window as unknown as { oscode?: unknown }).oscode = {
      platform: 'electron',
      routinesList: async () => ({ routines: [], runs: [], clock: held }),
    };
    const snap = await routinesClient({})!.list();
    expect(snap.clock).toEqual(held);
  });
});
