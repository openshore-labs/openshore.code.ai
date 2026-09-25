// Conversing and building across model switches (chat UX review, 2026-09-25).
// The seams the review found between one brain and the next: Stop while a
// phone model warms up, the guided setup's line reaching only the chat it is
// about, a play that can read the thread it was handed, and a Claude request
// that opens on the app's own greeting.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const llama = vi.hoisted(() => ({
  releaseLoad: null as null | (() => void),
  generates: 0,
}));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async () => ({ remove: async () => {} }),
    ensureLocal: async () => ({ ready: true }),
    // The load holds until the test releases it: a model warming up.
    load: () =>
      new Promise<{ ok: boolean }>((resolve) => {
        llama.releaseLoad = () => resolve({ ok: true });
      }),
    generate: async () => {
      llama.generates += 1;
      return { started: true };
    },
    stop: async () => {},
  },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  secretGet: async () => null,
  storeGetJson: async () => null,
}));

const { StackDriver } = await import('../src/drivers/stackDriver.js');
const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');
const { fitDeviceHistory, forgetDeviceModel } = await import('../src/drivers/deviceModel.js');
const { CHAT_OPENER, opensOnUser } = await import('../src/drivers/cloudClaudeDriver.js');
const { planPrompt } = await import('../src/lib/play.js');
const { guideContextLine, FIRST_CHAT_GOAL, STEP_COPY } = await import('../src/lib/guidedSetup.js');
const { guidedSetupLine, setHarborMiniContext } = await import('../src/lib/harborMini.js');
import type { AppStack } from '../src/lib/stack.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { reduceEvent } = await import('../src/state/transcript.js');
const { emptyThread } = await import('../src/state/types.js');

const deviceStack: AppStack = {
  reasoning: { kind: 'device', modelId: 'pocket', modelName: 'Pocket' },
  active: [],
  saved: {},
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Stop while a phone model warms up', () => {
  beforeEach(() => {
    forgetDeviceModel();
    llama.generates = 0;
    llama.releaseLoad = null;
  });
  afterEach(() => {
    llama.releaseLoad?.();
  });

  it('ends a Stack turn at once, and never starts the reply', async () => {
    const driver = new StackDriver(deviceStack, 'offline');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('hello');
    await tick();
    expect(llama.releaseLoad).not.toBeNull();

    driver.abort();
    const done = events.filter((e) => e.type === 'task-done');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ reason: 'aborted' });

    llama.releaseLoad!();
    await tick();
    await tick();
    expect(llama.generates).toBe(0);
    // The unwinding run says nothing more: one ending, not two.
    expect(events.filter((e) => e.type === 'task-done')).toHaveLength(1);
    driver.dispose();
  });

  it('ends a phone chat turn at once, and never starts the reply', async () => {
    const driver = new OnDeviceDriver('pocket', 'Pocket');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('hello');
    await tick();
    await tick();
    expect(llama.releaseLoad).not.toBeNull();

    driver.abort();
    const done = events.filter((e) => e.type === 'task-done');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ reason: 'aborted' });

    llama.releaseLoad!();
    await tick();
    await tick();
    expect(llama.generates).toBe(0);
    expect(events.filter((e) => e.type === 'task-done')).toHaveLength(1);
    driver.dispose();
  });

  it('a driver torn down with no turn open records no Stop', () => {
    for (const driver of [
      new OnDeviceDriver('pocket', 'Pocket'),
      new StackDriver(deviceStack, 'offline'),
    ]) {
      const events: DriverEvent[] = [];
      driver.subscribe((e) => events.push(e));
      driver.dispose();
      expect(events).toEqual([]);
    }
  });
});

describe("the guided setup's line", () => {
  const walking = {
    conversationId: 'walk',
    current: 'computer' as const,
    finished: false,
  };
  const facts = {
    harborReady: false,
    harborDownloading: false,
    computer: false,
    repo: false,
    key: false,
  };

  it("tells a switched-in model the step, without Harbor Lite's first-chat persona", () => {
    const line = guideContextLine(walking as never, facts, 'other')!;
    expect(line).toContain(STEP_COPY.computer.title);
    expect(line).not.toContain(FIRST_CHAT_GOAL);
  });

  it('says nothing to a switched-in model once setup is finished or set aside', () => {
    expect(
      guideContextLine({ ...walking, finished: true } as never, facts, 'other'),
    ).toBeUndefined();
    expect(guideContextLine({ ...walking, paused: true } as never, facts, 'other')).toBeUndefined();
    // Harbor Lite still hears both: it is the guide.
    expect(guideContextLine({ ...walking, finished: true } as never, facts)).toContain(
      FIRST_CHAT_GOAL,
    );
  });

  it('reaches only the chat the reply is for, never the chat on screen', () => {
    setHarborMiniContext((conversationId, audience) =>
      conversationId === 'walk' ? guideContextLine(walking as never, facts, audience) : undefined,
    );
    try {
      expect(guidedSetupLine('walk')).toContain(STEP_COPY.computer.title);
      expect(guidedSetupLine('another-chat')).toBeUndefined();
      expect(guidedSetupLine(undefined)).toBeUndefined();
    } finally {
      setHarborMiniContext(() => undefined);
    }
  });
});

describe('a play reads the thread it was handed', () => {
  it('carries the conversation into the framing prompt', () => {
    const prompt = planPrompt(
      'now add tests for it',
      deviceStack,
      undefined,
      'User: build a React date picker\nAssistant: Here is the DatePicker component.',
    );
    expect(prompt).toContain('The conversation so far');
    expect(prompt).toContain('DatePicker component');
    expect(prompt).toContain('User request: now add tests for it');
  });

  it('leaves the block out when there is nothing before the request', () => {
    expect(planPrompt('hello', deviceStack)).not.toContain('The conversation so far');
  });
});

describe('a history that opens on the app greeting', () => {
  it('goes to a phone model as it is when nothing was trimmed', () => {
    const msgs = [
      { role: 'assistant' as const, content: 'Hi, I am Harbor Lite.' },
      { role: 'user' as const, content: 'hello' },
    ];
    expect(fitDeviceHistory('sys', msgs, 512)).toBe(msgs);
  });

  it('gets a neutral user opener for Claude, which takes a user turn first', () => {
    const history = [
      { role: 'assistant' as const, content: 'Hi, I am Harbor Lite.' },
      { role: 'user' as const, content: 'hello' },
    ];
    expect(opensOnUser(history)).toEqual([{ role: 'user', content: CHAT_OPENER }, ...history]);
    const userFirst = [{ role: 'user' as const, content: 'hello' }];
    expect(opensOnUser(userFirst)).toBe(userFirst);
  });
});

describe('a message the ethics layer withheld', () => {
  it('is marked on its bubble, so no later model is handed it', () => {
    let thread = emptyThread();
    thread = reduceEvent(thread, { type: 'task-start', input: 'something blocked' });
    thread = reduceEvent(thread, {
      type: 'ethics-block',
      category: 'weapons',
      tier: 1,
      side: 'input',
      message: 'This request was not sent.',
    } as never);
    const bubble = thread.items.find((i) => i.kind === 'user');
    expect(bubble).toMatchObject({ text: 'something blocked', withheld: true });
  });

  it('an output block leaves the question as it was', () => {
    let thread = emptyThread();
    thread = reduceEvent(thread, { type: 'task-start', input: 'fine question' });
    thread = reduceEvent(thread, {
      type: 'ethics-block',
      category: 'weapons',
      tier: 1,
      side: 'output',
      message: 'The rest of this answer was withheld.',
    } as never);
    expect(thread.items.find((i) => i.kind === 'user')).not.toHaveProperty('withheld');
  });
});

describe("the setup walk's buttons", () => {
  it('follow the walk in its chat whichever model is answering', () => {
    const chat = readFileSync(
      fileURLToPath(new URL('../src/screens/ChatScreen.tsx', import.meta.url)),
      'utf8',
    );
    const after = chat.slice(chat.indexOf('afterItem={(itemId) => {'));
    const walk = after.indexOf('guided.conversationId === conv.id');
    const liteGate = after.indexOf('conv.source.modelId !== HARBOR_MINI_MODEL_ID');
    // The walk's branch comes first; only the plain Harbor Lite door is gated.
    expect(walk).toBeGreaterThan(-1);
    expect(liteGate).toBeGreaterThan(walk);
  });
});
