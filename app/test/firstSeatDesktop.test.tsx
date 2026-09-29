// The desktop's first minutes, mounted in a real (small) DOM (build
// 2026-09-29, package F1). The First Seat says what happens to a waiting
// message in CX ruling 2's words, offers sign-in only while DeepBlue comes
// down (never in the way), and its link opens the plain Sign in sheet. The
// model sheet on the desktop never names the phone's download: its Local
// models list the free chat with this computer's own model, or the way to
// DeepBlue in the Stack.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';
import type { ConversationSource } from '../src/state/types.js';

type Status = {
  ollama: { up: boolean; detail: string; models: string[] };
  hardwareSummary: string;
  stack: {
    configured: boolean;
    description: string;
    orchestrator?: { model: string; provider: string; kind: 'local' | 'cloud' };
    specialists: Array<{ role: string; model: string }>;
  };
  connections: { anthropic: boolean; openai: boolean; github: boolean };
};

const app = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const views: string[] = [];
  const state: Record<string, unknown> = {};
  const reset = () => {
    for (const k of Object.keys(state)) delete state[k];
    views.length = 0;
    Object.assign(state, {
      settings: { deviceModels: {}, pinnedModels: [] },
      connectedProviders: {},
      cloudKeyPresent: false,
      saveSettings: async () => {},
      setView: (v: string) => {
        views.push(v);
      },
      sourceReady: () => false,
      harborDownload: undefined,
      harborMasterDownload: undefined,
      ensureHarborMaster: async () => false,
      needsAccountNow: () => true,
      authSession: undefined,
    });
  };
  reset();
  return { state, views, listeners, reset };
});
vi.mock('../src/state/store.js', () => ({
  useApp: <T,>(select?: (s: typeof app.state) => T) => (select ? select(app.state) : app.state),
}));

const machine = vi.hoisted(() => ({ status: undefined as unknown }));
vi.mock('../src/lib/electronBridge.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/electronBridge.js')>()),
  bridge: () => ({ status: async () => machine.status }),
}));
vi.mock('../src/lib/platform.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/platform.js')>()),
  platform: () => 'electron',
  isDesktop: () => true,
  isPhone: () => false,
}));
// The sign-in card itself is the account package's; here it only has to show.
vi.mock('../src/components/SignInCard.js', () => ({
  SignInCard: () => <div className="sign-in-card-stub">The sign-in card</div>,
}));

function status(model?: string, kind: 'local' | 'cloud' = 'local'): Status {
  return {
    ollama: { up: true, detail: 'running', models: [] },
    hardwareSummary: 'no dedicated GPU detected, 8 GB system RAM',
    stack: {
      configured: Boolean(model),
      description: model ?? 'not set up yet',
      orchestrator: model ? { model, provider: 'ollama', kind } : undefined,
      specialists: [],
    },
    connections: { anthropic: false, openai: false, github: false },
  };
}

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
  app.reset();
  machine.status = status();
});
afterEach(async () => {
  await dom.unmount();
});

describe('the First Seat with a waiting message (CX ruling 2)', () => {
  async function seat() {
    const { FirstSeat } = await import('../src/components/FirstSeat.js');
    await dom.render(<FirstSeat fallback={<p>greeting</p>} />);
    await dom.settle();
  }
  const held = { text: 'what is a closure?', at: 'now', untilReady: true };

  it('says the message is saved and sends when DeepBlue is ready', async () => {
    const { FIRST_SEAT_COPY } = await import('../src/state/firstRunOps.js');
    Object.assign(app.state, { settings: { deviceModels: {}, heldFirstMessage: held } });
    await seat();
    expect(dom.text()).toContain(FIRST_SEAT_COPY.held);
    // Not downloading yet: no sign-in line, and no sign-in sheet at all.
    expect(dom.text()).not.toContain(FIRST_SEAT_COPY.signIn.after);
    expect(dom.text()).not.toContain('The sign-in card');
  });

  it('while DeepBlue comes down, offers sign-in in one quiet line that opens the plain Sign in sheet', async () => {
    const { FIRST_SEAT_COPY } = await import('../src/state/firstRunOps.js');
    const { before, link, after } = FIRST_SEAT_COPY.signIn;
    Object.assign(app.state, {
      settings: { deviceModels: {}, heldFirstMessage: held },
      harborMasterDownload: { percent: 40, label: '40%', indeterminate: false },
    });
    await seat();
    expect(dom.text()).toContain(`${before}${link}${after}`);
    expect(dom.text()).toContain(FIRST_SEAT_COPY.held);
    // The download goes on: its button shows progress, not a sign-in.
    expect(dom.buttons()).toContain('40% of DeepBlue');
    await dom.click(link);
    expect(dom.text()).toContain('The sign-in card');
    expect(dom.container.querySelector('.sheet h2')?.textContent).toBe('Sign in');
  });

  it('signed in, the download shows no sign-in line', async () => {
    const { FIRST_SEAT_COPY } = await import('../src/state/firstRunOps.js');
    Object.assign(app.state, {
      settings: { deviceModels: {}, heldFirstMessage: held },
      harborMasterDownload: { percent: 40, label: '40%', indeterminate: false },
      needsAccountNow: () => false,
    });
    await seat();
    expect(dom.text()).not.toContain(FIRST_SEAT_COPY.signIn.after);
    expect(dom.text()).toContain(FIRST_SEAT_COPY.held);
  });

  it('on a failed download, says the message is still saved', async () => {
    const { FIRST_SEAT_COPY } = await import('../src/state/firstRunOps.js');
    Object.assign(app.state, {
      settings: { deviceModels: {}, heldFirstMessage: held },
      harborMasterDownload: { percent: 0, label: 'Could not get DeepBlue.', failed: true },
    });
    await seat();
    expect(dom.text()).toContain(FIRST_SEAT_COPY.failed);
    expect(dom.text()).not.toContain(FIRST_SEAT_COPY.held);
    expect(dom.buttons()).toContain('Try DeepBlue again');
  });

  it('"Edit" takes the saved message back, the line folds away, and the download goes on (CX cleanup 8)', async () => {
    const { FIRST_SEAT_COPY } = await import('../src/state/firstRunOps.js');
    const { FirstSeat } = await import('../src/components/FirstSeat.js');
    Object.assign(app.state, {
      settings: { deviceModels: {}, heldFirstMessage: held },
      harborMasterDownload: { percent: 40, label: '40%', indeterminate: false },
    });
    let edits = 0;
    const card = () => <FirstSeat fallback={<p>greeting</p>} onEditHeld={() => edits++} />;
    await dom.render(card());
    await dom.settle();
    const line = dom.container.querySelector('.first-seat-held');
    expect(line?.textContent).toBe(`${FIRST_SEAT_COPY.held} Edit`);
    const edit = dom.container.querySelector(
      'button[aria-label="Edit your saved message"]',
    ) as HTMLButtonElement;
    expect(edit.textContent).toBe('Edit');
    await dom.click('Edit');
    expect(edits).toBe(1);

    // The store hands the words to the composer and clears the saved message:
    // the line folds shut (it never snaps), out of reach of Tab, and the
    // download keeps going.
    Object.assign(app.state, { settings: { deviceModels: {} } });
    await dom.render(card());
    await dom.settle();
    const fold = dom.container.querySelector('.first-seat-held-fold');
    expect(fold?.className).not.toMatch(/\bopen\b/);
    expect(fold?.getAttribute('aria-hidden')).toBe('true');
    expect(edit.getAttribute('tabindex')).toBe('-1');
    expect(dom.buttons()).toContain('40% of DeepBlue');
    // A tap on the folding link does nothing.
    await dom.click('Edit');
    expect(edits).toBe(1);

    // Send saves it again: the line opens once more.
    Object.assign(app.state, { settings: { deviceModels: {}, heldFirstMessage: held } });
    await dom.render(card());
    expect(dom.container.querySelector('.first-seat-held-fold')?.className).toMatch(/\bopen\b/);
  });

  it('after a failed download, the saved line keeps its Edit link', async () => {
    const { FIRST_SEAT_COPY } = await import('../src/state/firstRunOps.js');
    const { FirstSeat } = await import('../src/components/FirstSeat.js');
    Object.assign(app.state, {
      settings: { deviceModels: {}, heldFirstMessage: held },
      harborMasterDownload: { percent: 0, label: 'Could not get DeepBlue.', failed: true },
    });
    await dom.render(<FirstSeat fallback={<p>greeting</p>} onEditHeld={() => {}} />);
    await dom.settle();
    expect(dom.container.querySelector('.first-seat-held')?.textContent).toBe(
      `${FIRST_SEAT_COPY.failed} Edit`,
    );
  });

  it('the chat screen hands the words back through its restore, with no toast', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const chat = readFileSync(join(process.cwd(), 'src', 'screens', 'ChatScreen.tsx'), 'utf8');
    const at = chat.indexOf('onEditHeld={() => {');
    expect(at).toBeGreaterThan(-1);
    const body = chat.slice(at, chat.indexOf('}}', at));
    expect(body).toMatch(/const held = takeHeldFirstMessage\(\);/);
    expect(body).toMatch(/setRestore\(\(r\) => restoreFromHeld\(held, r\)\)/);
    expect(body).not.toMatch(/showToast/);
  });

  it('with no message waiting, the card says nothing about one', async () => {
    const { FIRST_SEAT_COPY } = await import('../src/state/firstRunOps.js');
    await seat();
    expect(dom.text()).not.toContain(FIRST_SEAT_COPY.held);
    expect(dom.buttons()).toContain('Set up DeepBlue');
  });
});

describe('the model sheet on the desktop', () => {
  async function sheet(initialStage: 'root' | 'local', picks: ConversationSource[] = []) {
    const { ModelSheet } = await import('../src/components/ModelSheet.js');
    await dom.render(
      <ModelSheet initialStage={initialStage} onPick={(s) => picks.push(s)} onClose={() => {}} />,
    );
    await dom.settle();
  }

  it('never names the phone download, and points at DeepBlue in the Stack when nothing is set up', async () => {
    const { DESKTOP_LOCAL_EMPTY } = await import('../src/components/ModelSheet.js');
    await sheet('local');
    expect(dom.text()).not.toMatch(/Get Harbor|Settings, Harbor|on-device model/);
    expect(dom.text()).toContain(DESKTOP_LOCAL_EMPTY);
    expect(DESKTOP_LOCAL_EMPTY).toContain('DeepBlue');
    expect(DESKTOP_LOCAL_EMPTY).toContain('Stack');
    await dom.click(DESKTOP_LOCAL_EMPTY);
    for (let i = 0; i < 200 && !app.views.length; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await dom.settle();
    }
    expect(app.views).toEqual(['stack']);
  });

  it("lists the free chat with this computer's own model", async () => {
    const { DESKTOP_CHAT_ROW, DESKTOP_CHAT_SUB } = await import('../src/components/ModelSheet.js');
    machine.status = status('qwen2.5:3b');
    await sheet('local');
    expect(dom.text()).toContain('qwen2.5:3b');
    expect(dom.text()).toContain(DESKTOP_CHAT_SUB);
    expect(dom.text()).not.toMatch(/Get Harbor/);
    // And at the top of the sheet, beside the agent.
    await dom.unmount();
    dom = await mountDom();
    const picks: ConversationSource[] = [];
    await sheet('root', picks);
    expect(dom.text()).toContain(DESKTOP_CHAT_ROW);
    await dom.click(`${DESKTOP_CHAT_ROW}${DESKTOP_CHAT_SUB}`);
    for (let i = 0; i < 200 && !picks.length; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await dom.settle();
    }
    expect(picks).toEqual([{ kind: 'desktop-chat' }]);
  });

  it('a cloud model on the engine is not offered as the free chat', async () => {
    const { DESKTOP_CHAT_ROW, DESKTOP_LOCAL_EMPTY } =
      await import('../src/components/ModelSheet.js');
    machine.status = status('claude-sonnet', 'cloud');
    await sheet('root');
    expect(dom.text()).not.toContain(DESKTOP_CHAT_ROW);
    await dom.unmount();
    dom = await mountDom();
    await sheet('local');
    expect(dom.text()).toContain(DESKTOP_LOCAL_EMPTY);
  });
});
