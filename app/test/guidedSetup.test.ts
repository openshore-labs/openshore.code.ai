// Guided setup (founder, 2026-09-23): a new person's first chat is Harbor Lite
// walking them through setup, one step at a time, with the buttons to do each
// one. A step's page brings them back to the chat once the connection lands,
// questions can be asked off script, and the walk ends by inviting questions
// about the app (and saying how to switch to Harbor if it came down).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HARBOR_SWITCH_HINT,
  STEP_COPY,
  advanceMessage,
  finishMessage,
  guideContextLine,
  nextStep,
  openingMessage,
  stepIntro,
  type SetupFacts,
} from '../src/lib/guidedSetup.js';

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

describe('what the guide says', () => {
  it('tells what each step is, why it helps, and how it works', () => {
    for (const id of ['harbor', 'computer', 'repo', 'key'] as const) {
      const intro = stepIntro(id);
      expect(intro).toContain(STEP_COPY[id].what);
      expect(intro).toContain(`**Why:** ${STEP_COPY[id].why}`);
      expect(intro).toContain(`**How:** ${STEP_COPY[id].how}`);
      expect(STEP_COPY[id].ask.endsWith('.') || STEP_COPY[id].ask.endsWith('?')).toBe(true);
    }
    expect(openingMessage('harbor', NONE)).toMatch(/connect it, skip it, or ask me more/);
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

  it('opens on the first step and closes by inviting questions', () => {
    expect(openingMessage('harbor', NONE)).toContain(stepIntro('harbor'));
    expect(finishMessage(NONE)).toMatch(/ask me anything about OpenShore/i);
  });

  it('says how to switch to Harbor once it is downloaded', () => {
    expect(HARBOR_SWITCH_HINT).toMatch(/chat box/);
    expect(HARBOR_SWITCH_HINT).toMatch(/Your stack/);
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

vi.mock('../src/drivers/onDeviceDriver.js', () => ({
  OnDeviceDriver: class {
    readonly kind = 'device' as const;
    subscribe() {
      return () => {};
    }
    send() {}
    abort() {}
    answerApproval() {}
    dispose() {}
  },
}));

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
});
