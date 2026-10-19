// The break after the setup walk's opening and "help me get set up" (maintainer,
// 2026-10-01). After the intro, two buttons: Just chat says where setup waits
// and carries the person to the main chat page on the tide; Set up OpenShore
// introduces step one. In any chat, "help me get set up" answers with what is
// already set up and a button for each thing that is not, walks through the
// one picked, and brings the list back with what is left.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MENU_REPO_LATER,
  MENU_REST_WAITS,
  SETUP_INTRO,
  SETUP_LATER_LINE,
  START_CHOICES,
  STEP_COPY,
  guideContextLine,
  menuStepIntro,
  menuSteps,
  setupHelpIntent,
  setupMenuMessage,
  setupSteps,
  type SetupFacts,
} from '../src/lib/guidedSetup.js';
import { slackWaterGeometry } from '../src/lib/slackWater.js';

const NONE: SetupFacts = {
  harborReady: false,
  harborDownloading: false,
  computer: false,
  repo: false,
  key: false,
};
const EM_DASH = String.fromCharCode(0x2014);

describe('"help me get set up", heard', () => {
  it('hears the plain request in its usual forms', () => {
    for (const t of [
      'help me get set up',
      'Help me set up',
      'can you help me get setup?',
      'Please help me get set up.',
      'walk me through setup',
      'help me with the setup',
      'get me set up',
      'set me up please',
      'hey, help me get set up!',
    ]) {
      expect(setupHelpIntent(t), t).toBe(true);
    }
  });

  it('leaves everything else to the model', () => {
    for (const t of [
      "don't help me set up",
      'how does setup work?',
      'I set up my computer yesterday',
      'help me write a function',
      'help me get set up a cron job on my server',
    ]) {
      expect(setupHelpIntent(t), t).toBe(false);
    }
  });
});

describe('the setup list', () => {
  it('offers every phone step not set up, and the repository once the computer is in', () => {
    expect(menuSteps({ skipped: [] }, NONE)).toEqual(['harbor', 'computer', 'key']);
    expect(menuSteps({ skipped: [] }, { ...NONE, computer: true })).toEqual([
      'harbor',
      'repo',
      'key',
    ]);
    expect(menuSteps({ skipped: ['key'] }, NONE)).toEqual(['harbor', 'computer']);
  });

  it('offers the same four steps on the desktop (founder, 2026-10-19)', () => {
    expect(setupSteps({ desktop: true })).toEqual(['harbor', 'computer', 'repo', 'key']);
    // The repository never waits on a computer there: the desktop is one.
    expect(menuSteps({ skipped: [] }, { ...NONE, desktop: true })).toEqual([
      'harbor',
      'computer',
      'repo',
      'key',
    ]);
  });

  it('says what is set up, then what is left, and why a repository waits', () => {
    const none = setupMenuMessage({ skipped: [] }, NONE);
    expect(none).toMatch(/^Happy to\. Nothing is set up yet, and none of it is required\./);
    expect(none).toContain(MENU_REPO_LATER);
    const some = setupMenuMessage(
      { skipped: [] },
      { ...NONE, harborDownloading: true, computer: true },
    );
    expect(some).toMatch(/Already set up: Harbor \(still downloading\) and your computer\./);
    expect(some).not.toContain(MENU_REPO_LATER);
    const all = setupMenuMessage(
      { skipped: [] },
      { harborReady: true, harborDownloading: false, computer: true, repo: true, key: true },
    );
    expect(all).toBe(
      "You're all set: Harbor, your computer, a repository, and your API key. Nothing is left to connect, so ask me anything.",
    );
  });

  it('puts what just happened on top when it comes back, standing alone above the buttons', () => {
    const back = setupMenuMessage({ skipped: [] }, NONE, { step: 'key', how: 'done' });
    expect(back).toMatch(/^Your API key is connected\. Here's what's left\./);
    expect(back).not.toMatch(/Already set up/);
    expect(setupMenuMessage({ skipped: [] }, NONE, { step: 'computer', how: 'skipped' })).toMatch(
      /^No problem, that one can wait\. Here's what's left\./,
    );
    // Nothing left: no "here's what's left", the closing line instead.
    expect(
      setupMenuMessage({ skipped: ['harbor', 'computer', 'key'] }, NONE, {
        step: 'key',
        how: 'skipped',
      }),
    ).toBe(`No problem, that one can wait.\n\n${MENU_REST_WAITS}`);
  });

  it('sizes the water from the tap to the farthest corner', () => {
    const g = slackWaterGeometry(0, 0, 300, 400);
    expect(g.ring).toBeCloseTo(2 * (500 + 2));
    expect(g.reach).toBeCloseTo(500 + 2);
    const mid = slackWaterGeometry(150, 200, 300, 400);
    expect(mid.ring).toBeCloseTo(2 * (250 + 2));
  });

  it('introduces a picked step without a step number, since the list is not an order', () => {
    expect(menuStepIntro('computer')).toMatch(/^\*\*Connect your computer\.\*\*/);
    expect(menuStepIntro('computer')).not.toMatch(/Step \d of/);
  });

  it('tells the model the list and the break are on screen, and never to choose', () => {
    const list = guideContextLine({ conversationId: 'c', skipped: [], menu: 'asking' }, NONE)!;
    expect(list).toMatch(/list of what is not set up yet/);
    expect(list).toContain(`"${STEP_COPY.computer.title}"`);
    const start = guideContextLine(
      { conversationId: 'c', skipped: [], current: 'harbor', startChoice: 'asking' },
      NONE,
    )!;
    expect(start).toMatch(/"Just chat"/);
    // D4 (2026-10-07): a verb on the button, never "setup" as a noun.
    expect(start).toMatch(/"Set up OpenShore"/);
    expect(start).not.toMatch(/Start setup/);
    expect(start).toMatch(/Never choose for them/);
  });

  it('keeps every new line free of em dashes, and teaches the phrase', () => {
    expect(SETUP_LATER_LINE).toMatch(/help me get set up/);
    const all = [
      SETUP_INTRO,
      SETUP_LATER_LINE,
      ...START_CHOICES.map((c) => c.label),
      setupMenuMessage({ skipped: [] }, NONE),
      setupMenuMessage({ skipped: [] }, { ...NONE, computer: true }),
      setupMenuMessage({ skipped: ['harbor', 'computer', 'key'] }, NONE),
    ].join(' ');
    expect(all).not.toContain(EM_DASH);
  });
});

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

const { useApp } = await import('../src/state/store.js');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const guided = () => useApp.getState().settings.guidedSetup!;
const items = (id: string) => useApp.getState().conversations[id]!.thread.items;
const lastText = (id: string) => {
  const last = items(id).at(-1)!;
  return last.kind === 'assistant' || last.kind === 'user' ? last.text : '';
};

function reset() {
  mem.clear();
  deviceSends.length = 0;
  useApp.setState({
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {}, harborMiniReady: true },
    conversations: {},
    order: [],
    activeId: undefined,
    view: 'chat',
    harborDownload: undefined,
    cloudKeyPresent: false,
    connectedProviders: {},
    connectedRepoPlatforms: {},
    tideTurn: undefined,
  });
}

async function openWalk(): Promise<string> {
  await useApp.getState().beginGuidedSetup();
  await wait(760);
  return guided().conversationId;
}

describe('the break after the opening, in the store', () => {
  beforeEach(reset);

  it('holds on the intro with two buttons, and Set up OpenShore brings step one', async () => {
    const id = await openWalk();
    expect(guided().startChoice).toBe('asking');
    expect(lastText(id)).toBe(SETUP_INTRO);
    useApp.getState().chooseStart('setup');
    await wait(5);
    expect(guided().startChoice).toBe('setup');
    expect(guided().current).toBe('harbor');
    expect(lastText(id)).toMatch(/\*\*Step 1 of 4: Get Harbor\.\*\*/);
  });

  it('Just chat says where setup waits, then lands on the main chat page', async () => {
    const id = await openWalk();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      useApp.getState().chooseStart('chat', { x: 100, y: 600 });
      expect(lastText(id)).toBe(SETUP_LATER_LINE);
      expect(guided().startChoice).toBe('chat');
      expect(guided().paused).toBe(true);
      // Still in the walk's chat while the line is read.
      expect(useApp.getState().activeId).toBe(id);
      await vi.advanceTimersByTimeAsync(10_000);
    } finally {
      vi.useRealTimers();
    }
    // No screen here, so no tide: straight to the greeting.
    expect(useApp.getState().activeId).toBeUndefined();
    expect(useApp.getState().view).toBe('chat');
    expect(deviceSends).toEqual([]);
  });

  it('never moves someone who already went elsewhere', async () => {
    const id = await openWalk();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      useApp.getState().chooseStart('chat');
      useApp.setState({ view: 'stack' });
      await vi.advanceTimersByTimeAsync(10_000);
    } finally {
      vi.useRealTimers();
    }
    expect(useApp.getState().activeId).toBe(id);
    expect(useApp.getState().view).toBe('stack');
  });

  it('takes the answer in words, without asking the model', async () => {
    const id = await openWalk();
    useApp.setState({ activeId: id });
    useApp.getState().send("I'd rather just chat");
    await wait(5);
    expect(guided().startChoice).toBe('chat');
    expect(items(id).some((i) => i.kind === 'user' && i.text === "I'd rather just chat")).toBe(
      true,
    );
    expect(deviceSends).toEqual([]);
  });

  it('picks setup back up as the list, the same as asking for help', async () => {
    const id = await openWalk();
    useApp.getState().chooseStart('chat');
    await wait(5);
    useApp.getState().resumeGuidedSetup();
    await wait(5);
    expect(guided().menu).toBe('asking');
    expect(guided().menuItemId).toBe(items(id).at(-1)!.id);
    expect(lastText(id)).toMatch(/^Happy to\. Nothing is set up yet/);
  });
});

describe('"help me get set up" in any chat, in the store', () => {
  beforeEach(reset);

  it('answers with the list, walks the picked step, and brings the list back', async () => {
    await openWalk();
    useApp.getState().chooseStart('chat');
    await wait(5);
    const other = (await useApp.getState().newConversation({
      kind: 'device',
      modelId: 'harbor-mini',
      modelName: 'Harbor Lite',
    }))!;
    await wait(5);
    useApp.getState().send('help me get set up');
    await wait(5);
    expect(deviceSends).toEqual([]);
    expect(guided().conversationId).toBe(other);
    expect(guided().menu).toBe('asking');
    expect(useApp.getState().setupMenuOffer()).toEqual(['harbor', 'computer', 'key']);
    expect(lastText(other)).toContain(MENU_REPO_LATER);

    useApp.getState().pickSetupStep('key');
    await wait(5);
    expect(guided().menu).toBe('step');
    expect(guided().current).toBe('key');
    expect(lastText(other)).toBe(menuStepIntro('key'));

    // The key lands somewhere in the app: the list comes back with the rest.
    useApp.setState({ cloudKeyPresent: true });
    await wait(5);
    expect(guided().menu).toBe('asking');
    expect(lastText(other)).toMatch(/^Your API key is connected\. Here's what's left\./);
    expect(useApp.getState().setupMenuOffer()).toEqual(['harbor', 'computer']);

    // A skipped step leaves the list until it is asked for again.
    useApp.getState().pickSetupStep('computer');
    await wait(5);
    useApp.getState().skipSetupStep();
    await wait(5);
    expect(lastText(other)).toMatch(/^No problem, that one can wait\. Here's what's left\./);
    expect(useApp.getState().setupMenuOffer()).toEqual(['harbor']);
    useApp.getState().send('help me get set up');
    await wait(5);
    expect(useApp.getState().setupMenuOffer()).toEqual(['harbor', 'computer']);
  });

  it('answers a new chat whose first words ask for it, with nothing sent to a model', async () => {
    const id = (await useApp
      .getState()
      .newConversation(
        { kind: 'device', modelId: 'harbor-mini', modelName: 'Harbor Lite' },
        { firstMessage: { text: 'Help me get set up' } },
      ))!;
    await wait(5);
    expect(useApp.getState().conversations[id]!.pendingFirstMessage).toBeUndefined();
    expect(items(id).map((i) => i.kind)).toEqual(['user', 'assistant']);
    expect(guided().conversationId).toBe(id);
    expect(guided().menu).toBe('asking');
    expect(deviceSends).toEqual([]);
  });

  it('says so when everything is set up', async () => {
    useApp.setState((s) => ({
      settings: { ...s.settings, harborReady: true, daemon: { baseUrl: 'http://h', token: 't' } },
      cloudKeyPresent: true,
      connectedRepoPlatforms: { github: true },
    }));
    const id = (await useApp
      .getState()
      .newConversation(
        { kind: 'device', modelId: 'harbor-mini', modelName: 'Harbor Lite' },
        { firstMessage: { text: 'help me get set up' } },
      ))!;
    await wait(5);
    expect(lastText(id)).toMatch(/^You're all set: /);
    expect(guided().menu).toBeUndefined();
    expect(guided().finished).toBe(true);
  });
});
