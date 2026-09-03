// The generic OpenAI-compatible cloud chat driver: on the device path (native
// shim, no streaming) it posts to /chat/completions, emits the answer, and
// reports the context meter from the reported prompt tokens. Mock the platform
// as ios and stub the native fetch, so no real network is touched.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const calls: Array<{ url: string; body: unknown }> = [];
// The next canned response the mocked native fetch returns; a test can drop the
// usage block to exercise the local estimate fallback.
let nextBody: Record<string, unknown> = {
  choices: [{ message: { content: 'Hi from GPT.' } }],
  usage: { prompt_tokens: 1000, completion_tokens: 20 },
};

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => false,
}));

vi.mock('../src/lib/nativeFetch.js', () => ({
  nativeFetch: vi.fn(async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => nextBody,
      text: async () => '',
    };
  }),
}));

const { CloudOpenAiDriver } = await import('../src/drivers/cloudOpenAiDriver.js');

/** Drive one turn and collect its events up to task-done. */
async function runTurn(text: string): Promise<DriverEvent[]> {
  const driver = new CloudOpenAiDriver(
    'https://api.openai.com/v1',
    'sk-test',
    'gpt-5',
    'OpenAI',
    undefined,
    undefined,
    400_000,
  );
  const events: DriverEvent[] = [];
  await new Promise<void>((resolve) => {
    driver.subscribe((e) => {
      events.push(e);
      if (e.type === 'task-done') resolve();
    });
    driver.send(text);
  });
  return events;
}

describe('CloudOpenAiDriver (device path)', () => {
  beforeEach(() => {
    calls.length = 0;
    nextBody = {
      choices: [{ message: { content: 'Hi from GPT.' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 20 },
    };
  });

  it('posts to the provider endpoint with the chosen model and streams off', async () => {
    await runTurn('hello');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    const body = calls[0]!.body as { model: string; stream: boolean; messages: unknown[] };
    expect(body.model).toBe('gpt-5');
    expect(body.stream).toBe(false);
  });

  it('emits the answer and a context reading from the prompt tokens', async () => {
    const events = await runTurn('hello');
    const final = events.find((e) => e.type === 'text-final');
    expect(final).toMatchObject({ text: 'Hi from GPT.' });
    const usage = events.find((e) => e.type === 'usage');
    // 1000 of a 400k window rounds to 0 percent, but the tokens are carried.
    expect(usage).toMatchObject({ promptTokens: 1000, dollars: 0 });
    expect(events.at(-1)).toMatchObject({ type: 'task-done', reason: 'complete' });
  });

  it('estimates prompt tokens locally when the provider omits usage', async () => {
    // Gemini and Kimi may not report usage. The meter should still fill from a
    // local estimate rather than sit at zero.
    nextBody = { choices: [{ message: { content: 'ok' } }] };
    const events = await runTurn('a fairly long prompt to estimate tokens over');
    const usage = events.find((e) => e.type === 'usage') as { promptTokens: number } | undefined;
    expect(usage?.promptTokens).toBeGreaterThan(0);
  });
});
