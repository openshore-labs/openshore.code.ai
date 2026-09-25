// Harbor Lite stuck on "Warming up" (2026-09-24): its system prompt alone ran
// past the 2048-token window it loaded with, so the prompt overflowed and the
// reply came back empty, leaving the chat on the warming-up line. These pin the
// three parts of the fix: every device model loads with a window that holds
// the prompt, a long chat is trimmed to fit, and an empty reply says so.
import { afterEach, describe, expect, it, vi } from 'vitest';

const { calls, handlers, generated } = vi.hoisted(() => ({
  calls: [] as string[],
  handlers: new Map<string, (data: unknown) => void>(),
  generated: [] as Array<{ requestId: string; messages: unknown[] }>,
}));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async (event: string, cb: (data: unknown) => void) => {
      handlers.set(event, cb);
      return { remove: async () => {} };
    },
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async ({ id, contextSize }: { id: string; contextSize: number }) => {
      calls.push(`load:${id}:${contextSize}`);
      return { ok: true };
    },
    generate: async (opts: { requestId: string; messages: unknown[] }) => {
      generated.push(opts);
      return { started: true };
    },
  },
}));

const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');
const {
  DEVICE_CONTEXT_TOKENS,
  TRIMMED_HISTORY_OPENER,
  estimateTokens,
  fitDeviceHistory,
  forgetDeviceModel,
} = await import('../src/drivers/deviceModel.js');
const { buildHarborMiniSystemPrompt, HARBOR_MINI_MODEL_ID, HARBOR_MINI_MODEL_NAME } =
  await import('../src/lib/harborMini.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  calls.length = 0;
  generated.length = 0;
  forgetDeviceModel();
});

describe('Harbor Lite fits its window', () => {
  it("leaves room for a question and a reply beside Harbor Lite's system prompt", () => {
    const room = DEVICE_CONTEXT_TOKENS - estimateTokens(buildHarborMiniSystemPrompt()) - 512;
    expect(room).toBeGreaterThan(200);
  });

  it('loads Harbor Lite with the full device window, not 2048', async () => {
    const driver = new OnDeviceDriver(HARBOR_MINI_MODEL_ID, HARBOR_MINI_MODEL_NAME);
    await tick();
    driver.send('How does Stack work?');
    await tick();
    await tick();
    expect(calls).toContain(`load:${HARBOR_MINI_MODEL_ID}:${DEVICE_CONTEXT_TOKENS}`);
    driver.dispose();
  });
});

describe('fitDeviceHistory', () => {
  const turn = (role: 'user' | 'assistant', n: number) => ({ role, content: 'x'.repeat(n) });

  it('keeps a short chat whole', () => {
    const msgs = [turn('user', 10), turn('assistant', 10), turn('user', 10)];
    expect(fitDeviceHistory('sys', msgs, 512)).toBe(msgs);
  });

  it('drops the oldest turns of a long chat, keeps the question, and opens on a user turn', () => {
    const msgs = [
      turn('user', 4000),
      turn('assistant', 4000),
      turn('user', 4000),
      turn('assistant', 4000),
      turn('user', 20),
    ];
    const fitted = fitDeviceHistory('s'.repeat(6000), msgs, 512);
    expect(fitted.at(-1)).toBe(msgs.at(-1));
    expect(fitted[0]!.role).toBe('user');
    expect(fitted.length).toBeLessThan(msgs.length);
    const used = fitted.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    expect(used + estimateTokens('s'.repeat(6000)) + 512).toBeLessThanOrEqual(
      DEVICE_CONTEXT_TOKENS,
    );
  });

  it('keeps the guide lines before the question when the setup walk posted several in a row', () => {
    // The onboarding shape: an older exchange that no longer fits, then two
    // scripted guide lines back to back, then the person's question.
    const msgs = [
      turn('user', 4000),
      turn('assistant', 6000),
      turn('assistant', 300),
      turn('assistant', 300),
      turn('user', 20),
    ];
    const fitted = fitDeviceHistory('s'.repeat(6000), msgs, 512);
    expect(fitted).toEqual([
      { role: 'user', content: TRIMMED_HISTORY_OPENER },
      msgs[2],
      msgs[3],
      msgs[4],
    ]);
  });

  it('always keeps the question, even when nothing else fits', () => {
    const msgs = [turn('user', 4000), turn('assistant', 4000), turn('user', 20000)];
    expect(fitDeviceHistory('sys', msgs, 512)).toEqual([msgs[2]]);
  });
});

describe('an empty device reply is not a silent success', () => {
  it('ends the task with an error that names the model', async () => {
    const driver = new OnDeviceDriver(HARBOR_MINI_MODEL_ID, HARBOR_MINI_MODEL_NAME);
    const done: Array<{ reason: string; message?: string }> = [];
    driver.subscribe((e) => {
      if (e.type === 'task-done') done.push({ reason: e.reason, message: e.message });
    });
    await tick();
    driver.send('How does Stack work?');
    await tick();
    await tick();
    const { requestId } = generated[0]!;
    handlers.get('generationDone')!({ requestId, stopReason: 'end' });
    await tick();
    expect(done).toHaveLength(1);
    expect(done[0]!.reason).toBe('error');
    expect(done[0]!.message).toContain(HARBOR_MINI_MODEL_NAME);
    driver.dispose();
  });
});
