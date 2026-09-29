// Prompt size by seat class (build 2026-09-29, B2). A Stack seat is classed by
// the pack seat's own reading (packSeatFor, by name and size): a tiny or small
// model on any host carries neither the UX standard (about 1.3k tokens) nor
// the humanizer (about 2k), so a 3B model on your own computer keeps its small
// window for the chat. Larger seats keep both, unchanged until an eval says
// otherwise (tenet 2). And a stack with only its anchor makes one model call
// per message: no hidden framing call before the answer.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { humanizerStandardPrompt, uxStandardPrompt } from 'os-code/protocol';

const h = vi.hoisted(() => ({
  stream: vi.fn(),
  claude: [] as Array<Record<string, unknown>>,
  claudeReplies: [] as string[],
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  secretGet: async (key: string) => (key.includes('.byom.') ? null : 'sk-test'),
  storeGetJson: async () => null,
}));
vi.mock('../src/lib/streamingFetch.js', () => ({ streamingFetch: h.stream }));
vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async () => ({ remove: async () => {} }),
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async () => ({ started: true }),
  },
}));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class Anthropic {
    static APIUserAbortError = class extends Error {};
    static AuthenticationError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    messages = {
      stream: (params: Record<string, unknown>) => {
        h.claude.push(params);
        const reply = h.claudeReplies.shift() ?? 'ok';
        const handlers: Record<string, (delta: string) => void> = {};
        return {
          on: (event: string, cb: (delta: string) => void) => {
            handlers[event] = cb;
          },
          finalMessage: async () => {
            // Streamed in two pieces, the way a real reply arrives.
            handlers.text?.(reply.slice(0, 3));
            handlers.text?.(reply.slice(3));
            return { content: [{ type: 'text', text: reply }] };
          },
        };
      },
    };
  }
  return { default: Anthropic };
});

const { StackDriver } = await import('../src/drivers/stackDriver.js');
const { packSeatFor } = await import('../src/lib/vaultSeat.js');
import type { AppStack, StackModelRef } from '../src/lib/stack.js';

/** The most a small seat's system prompt may take with no project, crew or
 *  pack: the base, the search line and the effort line. The two standards
 *  together are over 10 KB, so this budget cannot hold them. */
const SMALL_SEAT_PROMPT_BUDGET_BYTES = 2 * 1024;

const enc = new TextEncoder();
function oai(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`),
      );
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const byom = (id: string, model: string): StackModelRef => ({
  kind: 'byom',
  id,
  label: 'Box',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model,
});
const gpt: StackModelRef = { kind: 'cloud', provider: 'openai', model: 'gpt-x', label: 'GPT' };
const claude: StackModelRef = {
  kind: 'cloud',
  provider: 'anthropic',
  model: 'claude-x',
  label: 'Claude',
};

function chat(stack: AppStack, humanize?: boolean) {
  const driver = new StackDriver(stack, 'offshore', { humanize }, undefined, {
    packSeat: (ref) => packSeatFor(ref, { ownTailnetSuffix: null }),
  });
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return { driver, events };
}
const anchorOnly = (reasoning: StackModelRef): AppStack => ({ reasoning, active: [], saved: {} });
const sent = (i: number) =>
  JSON.parse((h.stream.mock.calls[i]![1] as RequestInit).body as string) as {
    messages: Array<{ role: string; content: string }>;
    options?: unknown;
  };
const systemOf = (i: number) => sent(i).messages.find((m) => m.role === 'system')!.content;
const done = (events: DriverEvent[]) => events.find((e) => e.type === 'task-done');

beforeEach(() => {
  h.stream.mockReset();
  h.stream.mockImplementation(async () => oai('Hi there.'));
  h.claude.length = 0;
  h.claudeReplies.length = 0;
});

describe('a small seat carries a small prompt', () => {
  it('a 3B model on your computer: under budget, with neither standard', async () => {
    const { driver, events } = chat(anchorOnly(byom('b3', 'llama3.2:3b')));
    driver.send('hello');
    await vi.waitFor(() => expect(done(events)).toBeDefined());
    const system = systemOf(0);
    expect(system).not.toContain(uxStandardPrompt().slice(0, 80));
    expect(system).not.toContain(humanizerStandardPrompt().slice(0, 80));
    expect(enc.encode(system).length).toBeLessThan(SMALL_SEAT_PROMPT_BUDGET_BYTES);
    expect(enc.encode(uxStandardPrompt() + humanizerStandardPrompt()).length).toBeGreaterThan(
      SMALL_SEAT_PROMPT_BUDGET_BYTES * 5,
    );
    // Nothing configures num_ctx on the app side, so Ollama is sent none
    // (CTO ruling 5: the served window's default flips only on an eval).
    expect(sent(0).options).toBeUndefined();
    driver.dispose();
  });

  it('a larger model on the same computer keeps both standards', async () => {
    const { driver, events } = chat(anchorOnly(byom('b14', 'qwen2.5:14b')));
    driver.send('hello');
    await vi.waitFor(() => expect(done(events)).toBeDefined());
    expect(systemOf(0)).toContain(uxStandardPrompt());
    expect(systemOf(0)).toContain(humanizerStandardPrompt());
    driver.dispose();
  });

  it('a cloud model keeps both standards', async () => {
    const { driver, events } = chat(anchorOnly(gpt));
    driver.send('hello');
    await vi.waitFor(() => expect(done(events)).toBeDefined());
    expect(systemOf(0)).toContain(uxStandardPrompt());
    expect(systemOf(0)).toContain(humanizerStandardPrompt());
    driver.dispose();
  });
});

describe('one model call per message', () => {
  it('an anchor with no one to hand off to: your own model', async () => {
    const { driver, events } = chat(anchorOnly(byom('b3', 'llama3.2:3b')));
    driver.send('explain closures');
    await vi.waitFor(() => expect(done(events)).toMatchObject({ reason: 'complete' }));
    expect(h.stream).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === 'status' && /Framing/.test(e.message))).toBe(false);
    driver.dispose();
  });

  it('an anchor with no one to hand off to: a cloud model and Claude', async () => {
    const one = chat(anchorOnly(gpt));
    one.driver.send('explain closures');
    await vi.waitFor(() => expect(done(one.events)).toMatchObject({ reason: 'complete' }));
    expect(h.stream).toHaveBeenCalledTimes(1);
    one.driver.dispose();

    const two = chat(anchorOnly(claude));
    two.driver.send('explain closures');
    await vi.waitFor(() => expect(done(two.events)).toMatchObject({ reason: 'complete' }));
    expect(h.claude).toHaveLength(1);
    two.driver.dispose();
  });

  it('with a specialist placed, a simple request is answered by the framing call itself', async () => {
    h.claudeReplies.push('Closures capture the scope they were made in.');
    const { driver, events } = chat({
      reasoning: claude,
      active: [{ ref: byom('b14', 'qwen2.5:14b'), placement: { category: 'coding' } }],
      saved: {},
    });
    driver.send('what is a closure?');
    await vi.waitFor(() => expect(done(events)).toMatchObject({ reason: 'complete' }));
    expect(h.claude).toHaveLength(1);
    expect(h.stream).not.toHaveBeenCalled();
    // The lead's prose streamed as the answer, named as the anchor's turn.
    expect(events.find((e) => e.type === 'turn-start')).toMatchObject({ model: 'Claude' });
    const final = events.findLast((e) => e.type === 'text-final') as { text: string };
    expect(final.text).toBe('Closures capture the scope they were made in.');
    driver.dispose();
  });

  it('with a specialist placed, a plan still hands off', async () => {
    h.claudeReplies.push(
      JSON.stringify({
        clear: true,
        summary: 'Write code',
        steps: [{ id: 's1', title: 'Write it', category: 'coding', brief: 'Write the function.' }],
      }),
    );
    const { driver, events } = chat({
      reasoning: claude,
      active: [{ ref: byom('b14', 'qwen2.5:14b'), placement: { category: 'coding' } }],
      saved: {},
    });
    driver.send('write a typescript function that adds two numbers');
    await vi.waitFor(() => expect(done(events)).toMatchObject({ reason: 'complete' }));
    // The plan never showed; the coding seat answered.
    expect(
      events
        .filter((e) => e.type === 'text-delta')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toBe('Hi there.');
    expect(h.stream).toHaveBeenCalledTimes(1);
    driver.dispose();
  });
});
