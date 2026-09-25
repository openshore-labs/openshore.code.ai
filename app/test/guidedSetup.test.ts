// Guided setup (founder, 2026-09-23): a new person's first chat is Harbor Lite
// walking them through setup, one step at a time, with the buttons to do each
// one. A step's page brings them back to the chat once the connection lands,
// questions can be asked off script, and the walk ends by inviting questions
// about the app (and saying how to switch to Harbor if it came down).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EDIT_CHOICES,
  EDIT_CHOICE_QUESTION,
  HARBOR_SWITCH_HINT,
  STEP_COPY,
  advanceMessage,
  editChoiceMessage,
  finishMessage,
  guideContextLine,
  nextStep,
  openingMessage,
  setupIntent,
  repoConnectedMessage,
  stepIntro,
  walkActive,
  type SetupFacts,
} from '../src/lib/guidedSetup.js';
import { DEFAULT_PERMISSION_MODE } from '../src/lib/permissionMode.js';

const NONE: SetupFacts = {
  harborReady: false,
  harborDownloading: false,
  computer: false,
  repo: false,
  key: false,
};
const EM_DASH = String.fromCharCode(0x2014);

describe('the walk order', () => {
  it('starts with Harbor, then the computer, and ends with a key', () => {
    expect(nextStep({ skipped: [] }, NONE)).toBe('harbor');
    expect(nextStep({ skipped: ['harbor'] }, NONE)).toBe('computer');
  });

  it('passes by anything already set up, and a Harbor download already going', () => {
    expect(nextStep({ skipped: [] }, { ...NONE, harborDownloading: true })).toBe('computer');
    expect(nextStep({ skipped: [] }, { ...NONE, harborReady: true, computer: true })).toBe('repo');
  });

  it('holds the repository step until the computer is connected', () => {
    expect(nextStep({ skipped: ['harbor', 'computer'] }, NONE)).toBe('key');
    expect(nextStep({ skipped: ['harbor'] }, { ...NONE, computer: true })).toBe('repo');
  });

  it('ends when every step is done or skipped', () => {
    expect(nextStep({ skipped: ['harbor', 'computer', 'key'] }, NONE)).toBeUndefined();
  });
});

describe('reading the person (setup is offered, never pushed)', () => {
  it('hears "I would rather just chat" in its many forms', () => {
    for (const t of [
      "I don't want to set up right now, I just want to chat",
      'no setup please',
      'can we skip the setup?',
      'not now',
      'Maybe later.',
      "I'd rather just talk",
      'I just wanna chat for a bit',
      'stop setting things up',
    ]) {
      expect(setupIntent(t), t).toBe('pause');
    }
  });

  it('hears a plain "let\'s set up" as picking the walk back up', () => {
    for (const t of ["let's set up", 'OK, lets set up now', 'resume setup', 'set me up']) {
      expect(setupIntent(t), t).toBe('resume');
    }
  });

  it('takes a bare "skip" or "next" as skipping the step', () => {
    for (const t of ['skip', 'skip this one', 'next', 'Next step.']) {
      expect(setupIntent(t), t).toBe('skip');
    }
  });

  it('leaves ordinary conversation alone', () => {
    for (const t of [
      'What is the Vault?',
      'How do I set up a repository on my computer?',
      'Tell me a joke about boats',
      'I set up Tailscale already',
      'what comes next in the fibonacci sequence',
      'Tell me more about connecting my computer.',
    ]) {
      expect(setupIntent(t), t).toBeUndefined();
    }
  });

  it('puts a pleasant conversation first in every state of the walk', () => {
    const walking = guideContextLine(
      { conversationId: 'c', current: 'harbor', skipped: [] },
      NONE,
    )!;
    const paused = guideContextLine(
      { conversationId: 'c', current: 'harbor', skipped: [], paused: true },
      NONE,
    )!;
    for (const line of [walking, paused]) expect(line).toMatch(/pleasant, genuinely useful/);
    expect(walking).toMatch(/just chat, drop setup and chat/);
    expect(paused).toMatch(/Do not bring setup up again unless they ask/);
  });
});

describe('what the guide says', () => {
  it('tells what each step is, why it helps, and how it works', () => {
    for (const id of ['harbor', 'computer', 'repo', 'key'] as const) {
      const intro = stepIntro(id);
      expect(intro).toContain(STEP_COPY[id].what);
      expect(intro).toContain(`**Why:** ${STEP_COPY[id].why}`);
      expect(intro).toContain(`**How:** ${STEP_COPY[id].how}`);
      expect(STEP_COPY[id].ask.endsWith('.') || STEP_COPY[id].ask.endsWith('?')).toBe(true);
    }
    expect(openingMessage('harbor', NONE)).toMatch(/connect it, skip it, or ask me first/);
  });

  it('offers connect, ask, and skip on every step', () => {
    const actions = readFileSync(
      join(process.cwd(), 'src/components/SetupStepActions.tsx'),
      'utf8',
    );
    expect(actions).toContain('{STEP_COPY[step].action}');
    expect(actions).toContain('send(STEP_COPY[step].ask)');
    expect(actions).toContain('Ask about this');
    expect(actions).toContain('Skip for now');
  });

  it('never puts the step buttons under the hello (they would flash, then jump)', () => {
    // The letter's reading pause leaves the hello as the latest message for a
    // few seconds; the buttons wait for the setup message instead.
    const screen = readFileSync(join(process.cwd(), 'src/screens/ChatScreen.tsx'), 'utf8');
    const guard = screen.indexOf('if (itemId === `${conv.id}-hello`) return null;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(screen.indexOf('<SetupStepActions step={guided.current} />'));
  });

  it('opens on the first step and closes by inviting questions', () => {
    expect(openingMessage('harbor', NONE)).toContain(stepIntro('harbor'));
    expect(finishMessage(NONE)).toMatch(/ask me anything about OpenShore/i);
  });

  it('says how to switch to Harbor once it is downloaded', () => {
    expect(HARBOR_SWITCH_HINT).toMatch(/chat box/);
    expect(HARBOR_SWITCH_HINT).toMatch(/go to Stack,/);
    expect(finishMessage({ ...NONE, harborReady: true })).toContain(HARBOR_SWITCH_HINT);
    expect(advanceMessage('harbor', 'done', 'computer', { ...NONE, harborReady: true })).toContain(
      HARBOR_SWITCH_HINT,
    );
  });

  it('acknowledges a finished step before the next one', () => {
    const m = advanceMessage('computer', 'done', 'repo', { ...NONE, computer: true });
    expect(m.startsWith(STEP_COPY.computer.done)).toBe(true);
    expect(m).toContain(stepIntro('repo'));
  });

  it('tells the model where the walk stands, so off-script answers lead back', () => {
    const line = guideContextLine({ conversationId: 'c', current: 'computer', skipped: [] }, NONE)!;
    expect(line).toContain('step 2 of 4');
    expect(line).toContain('Skip for now');
    expect(guideContextLine(undefined, NONE)).toBeUndefined();
  });

  it('keeps every line free of em dashes', () => {
    const lines = [
      ...Object.values(STEP_COPY).flatMap((c) => Object.values(c)),
      finishMessage({ ...NONE, harborReady: true }),
      HARBOR_SWITCH_HINT,
    ];
    for (const l of lines) expect(l).not.toContain(EM_DASH);
  });
});

// ---- the walk, end to end through the real store ----------------------------

const mem = new Map<string, string>();

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => false,
  isPhone: () => true,
  openExternal: () => {},
  openInAppBrowser: () => {},
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

const deviceSends: string[] = [];
vi.mock('../src/drivers/onDeviceDriver.js', () => ({
  // Answers like a real driver: every send opens a turn and closes it, so the
  // chat is busy only while a reply is on its way.
  OnDeviceDriver: class {
    readonly kind = 'device' as const;
    private sink?: (event: unknown, seq: number) => void;
    subscribe(sink: (event: unknown, seq: number) => void) {
      this.sink = sink;
      return () => {
        this.sink = undefined;
      };
    }
    send(text: string) {
      deviceSends.push(text);
      queueMicrotask(() => {
        this.sink?.({ type: 'task-start', input: text }, 0);
        this.sink?.({ type: 'text-final', text: 'Sure.' }, 0);
        this.sink?.({ type: 'task-done', reason: 'complete' }, 0);
      });
    }
    abort() {}
    answerApproval() {}
    dispose() {}
  },
}));

// CX ruling (2026-09-24), from reading Zed's first-run page: of its eight
// options only the trust question fits OpenShore, and as one narrow choice
// about edits at the moment there is code to edit, not a blanket switch.
describe('the edit choice at the end of the repository step', () => {
  it('never promises a check before every edit, since edits flow by default', () => {
    expect(DEFAULT_PERMISSION_MODE).toBe('acceptEdits');
    const repo = Object.values(STEP_COPY.repo).join(' ');
    expect(repo).not.toMatch(/every edit/i);
    expect(repo).toMatch(/commands always ask/i);
    const guides = readFileSync(join(__dirname, '../src/lib/setupGuides.ts'), 'utf8');
    expect(guides).not.toMatch(/every edit shows you a diff/i);
  });

  it('offers exactly Ask first and Accept edits, and names the instruction files', () => {
    expect(EDIT_CHOICES.map((c) => c.mode)).toEqual(['default', 'acceptEdits']);
    expect(repoConnectedMessage()).toContain(STEP_COPY.repo.done);
    expect(EDIT_CHOICE_QUESTION).toMatch(/CLAUDE\.md, AGENTS\.md, or OSCODE\.md/);
    expect(EDIT_CHOICE_QUESTION).toMatch(/Settings, under Approvals/);
  });

  it('says what was chosen, then moves on', () => {
    expect(editChoiceMessage('default', 'key', NONE)).toMatch(/^Ask first/);
    expect(editChoiceMessage('acceptEdits', 'key', NONE)).toContain(stepIntro('key'));
    expect(editChoiceMessage(undefined, undefined, NONE)).toContain(finishMessage(NONE));
  });

  it('keeps the walk alive while the choice waits, and tells the guide so', () => {
    const p = { conversationId: 'c', skipped: [], finished: true, editChoice: 'asking' as const };
    expect(walkActive(p)).toBe(true);
    expect(walkActive({ ...p, editChoice: 'later' })).toBe(false);
    const line = guideContextLine(p, NONE)!;
    expect(line).toMatch(/choosing how edits are handled/);
    expect(line).toMatch(/never choose for them/i);
  });

  it('lives on in Settings, under Approvals', () => {
    const src = readFileSync(join(__dirname, '../src/screens/SettingsScreen.tsx'), 'utf8');
    expect(src).toContain('<SettingsGroup title="Approvals"');
    expect(src).toContain('label="When the agent edits"');
    expect(src).toContain("setPermissionMode(m, 'settings')");
  });
});

const { useApp } = await import('../src/state/store.js');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const guided = () => useApp.getState().settings.guidedSetup!;
const texts = () =>
  useApp
    .getState()
    .conversations[guided().conversationId].thread.items.map((i) =>
      i.kind === 'assistant' ? i.text : '',
    );

describe('the guided walk in the store', () => {
  beforeEach(() => {
    mem.clear();
    useApp.setState({
      settings: {
        onboarded: true,
        claudeModel: 'x',
        deviceModels: {},
        harborMiniReady: true,
      },
      conversations: {},
      order: [],
      activeId: undefined,
      view: 'chat',
      harborDownload: undefined,
      cloudKeyPresent: false,
      connectedProviders: {},
      connectedRepoPlatforms: {},
    });
  });

  it('walks, skips, sends to a page, and comes back when it connects', async () => {
    await useApp.getState().beginGuidedSetup();
    await wait(760);
    expect(guided().current).toBe('harbor');
    expect(texts().at(-1)).toContain(stepIntro('harbor'));

    useApp.getState().skipSetupStep();
    await wait(5);
    expect(guided().current).toBe('computer');
    expect(texts().at(-1)).toContain(stepIntro('computer'));

    // The button opens the step's page...
    useApp.getState().openSetupStep();
    await wait(5);
    expect(useApp.getState().view).toBe('pair');
    // ...and pairing brings the person back to the chat with the next step.
    useApp.setState((s) => ({
      settings: { ...s.settings, daemon: { baseUrl: 'http://box', token: 't' } as never },
    }));
    await wait(5);
    expect(useApp.getState().view).toBe('chat');
    expect(useApp.getState().activeId).toBe(guided().conversationId);
    expect(guided().current).toBe('repo');
    expect(texts().at(-1)).toContain(STEP_COPY.computer.done);

    useApp.getState().skipSetupStep();
    await wait(5);
    useApp.getState().skipSetupStep();
    await wait(5);
    expect(guided().finished).toBe(true);
    expect(texts().at(-1)).toMatch(/ask me anything about OpenShore/i);
  });

  it('asks how edits are handled once a repository connects, and holds until a tap', async () => {
    useApp.setState((s) => ({
      settings: {
        ...s.settings,
        harborReady: true,
        daemon: { baseUrl: 'http://box', token: 't' } as never,
      },
    }));
    await useApp.getState().beginGuidedSetup();
    await wait(760);
    expect(guided().current).toBe('repo');
    useApp.setState({ connectedRepoPlatforms: { github: true } as never });
    await wait(5);
    expect(guided().editChoice).toBe('asking');
    expect(texts().at(-1)).toBe(repoConnectedMessage());
    // A key landing while the choice waits does not move the walk past it.
    useApp.setState({ cloudKeyPresent: true });
    await wait(5);
    expect(texts().at(-1)).toBe(repoConnectedMessage());

    // A double tap answers once.
    await Promise.all([
      useApp.getState().chooseEditMode('default'),
      useApp.getState().chooseEditMode('acceptEdits'),
    ]);
    await wait(5);
    expect(texts().filter((t) => /^(Ask first it is|Edits will flow)/.test(t))).toHaveLength(1);
    expect(useApp.getState().settings.permissionMode).toBe('default');
    expect(guided().editChoice).toBe('default');
    expect(guided().finished).toBe(true);
    expect(texts().at(-1)).toMatch(/^Ask first it is/);
  });

  it('treats a bare "skip" at the edit choice as decide later', async () => {
    useApp.setState((s) => ({
      settings: {
        ...s.settings,
        harborReady: true,
        daemon: { baseUrl: 'http://box', token: 't' } as never,
      },
    }));
    await useApp.getState().beginGuidedSetup();
    await wait(760);
    useApp.setState({ connectedRepoPlatforms: { github: true } as never });
    await wait(5);
    useApp.setState({ activeId: guided().conversationId });
    useApp.getState().send('skip');
    await wait(5);
    expect(guided().editChoice).toBe('later');
    expect(useApp.getState().settings.permissionMode).toBeUndefined();
    expect(guided().current).toBe('key');
    expect(texts().at(-1)).toContain(stepIntro('key'));
  });

  it('says how to switch once Harbor finishes, even after the walk', async () => {
    await useApp.getState().beginGuidedSetup();
    await wait(760);
    for (let i = 0; i < 3; i++) {
      useApp.getState().skipSetupStep();
      await wait(5);
    }
    expect(guided().finished).toBe(true);
    useApp.setState((s) => ({ settings: { ...s.settings, harborReady: true } }));
    await wait(5);
    expect(texts().at(-1)).toContain(HARBOR_SWITCH_HINT);
    expect(guided().harborAnnounced).toBe(true);
  });

  it('starts Harbor in place, moves on while it downloads, then says how to switch', async () => {
    await useApp.getState().beginGuidedSetup();
    await wait(760);
    useApp.getState().openSetupStep();
    await wait(20);
    expect(useApp.getState().view).toBe('chat');
    expect(guided().current).toBe('computer');
    expect(texts().at(-1)).toContain(STEP_COPY.harbor.done);
    // The web stub's download lands in about a second.
    await wait(1600);
    expect(useApp.getState().settings.harborReady).toBe(true);
    expect(texts().at(-1)).toContain(HARBOR_SWITCH_HINT);
  });

  it('steps back when the person would rather chat, and picks up when asked', async () => {
    await useApp.getState().beginGuidedSetup();
    await wait(760);
    const id = guided().conversationId;
    useApp.setState({ activeId: id });
    useApp.getState().send('Not now, I just want to chat');
    await wait(5);
    expect(guided().paused).toBe(true);
    expect(guided().current).toBe('harbor');
    // The message went to the guide as an ordinary turn (the store appends no
    // scripted reply for a pause).
    expect(texts().at(-1)).not.toContain("Here's where we left off");
    // A connection landing while paused says nothing and does not move the walk.
    useApp.setState((s) => ({
      settings: { ...s.settings, daemon: { baseUrl: 'http://box', token: 't' } as never },
    }));
    await wait(5);
    expect(guided().current).toBe('harbor');

    useApp.getState().send("let's set up");
    await wait(5);
    expect(guided().paused).toBe(false);
    expect(texts().at(-1)).toContain("Here's where we left off");
    expect(texts().at(-1)).toContain(stepIntro('harbor'));

    useApp.getState().send('skip');
    await wait(5);
    // The computer connected while paused, so the walk passes it by.
    expect(guided().current).toBe('repo');
  });

  it('opens the walk at once, before Harbor Lite is ready, and holds an early message', async () => {
    deviceSends.length = 0;
    useApp.setState((st) => ({ settings: { ...st.settings, harborMiniReady: false } }));
    const started = Date.now();
    await useApp.getState().beginGuidedSetup();
    // No wait on the model: the chat and its hello are there right away.
    expect(Date.now() - started).toBeLessThan(300);
    const id = guided().conversationId;
    expect(useApp.getState().activeId).toBe(id);
    expect(texts()[0]).toContain("Hi, I'm Harbor Lite");
    expect(useApp.getState().settings.harborMiniReady).toBeFalsy();

    // A message typed before the model is ready waits, visibly, then goes out.
    useApp.getState().send('What can you do?');
    await wait(5);
    expect(useApp.getState().conversations[id].thread.queued).toEqual(['What can you do?']);
    expect(deviceSends).toEqual([]);
    await wait(1700); // the web stub's download
    expect(useApp.getState().settings.harborMiniReady).toBe(true);
    expect(useApp.getState().conversations[id].thread.queued).toEqual([]);
    expect(deviceSends).toEqual(['What can you do?']);
  });
});
