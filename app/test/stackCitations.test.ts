// A Perplexity seat's sources reach the chat from the Stack too (build
// 2026-09-29, the cloud package's note): the provider client reads Sonar's
// search_results, and the Stack says them once, as its direct chat does.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

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
import type { StackModelRef } from '../src/lib/stack.js';

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

function sonar(text: string): Response {
  const frame = {
    choices: [{ delta: { content: text } }],
    search_results: [{ title: 'Ollama docs', url: 'https://docs.example.com/ollama' }],
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const perplexity: StackModelRef = {
  kind: 'cloud',
  provider: 'perplexity',
  model: 'sonar',
  label: 'Sonar',
};

describe('a Perplexity seat in the Stack', () => {
  beforeEach(() => {
    h.stream.mockReset();
  });

  it('shows its sources once, after the answer', async () => {
    h.stream.mockImplementation(async () => sonar('Ollama runs local models.'));
    const driver = new StackDriver(
      { reasoning: perplexity, active: [], saved: {} },
      'offshore',
      {},
      undefined,
      { packSeat: (ref) => packSeatFor(ref, { ownTailnetSuffix: null }) },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('What is Ollama?');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
    const cited = events.filter((e) => e.type === 'citations');
    expect(cited).toHaveLength(1);
    expect(JSON.stringify(cited[0])).toContain('https://docs.example.com/ollama');
  });

  it('says nothing about sources when a provider sends none', async () => {
    h.stream.mockImplementation(async () => oai('Plain answer.'));
    const driver = new StackDriver(
      { reasoning: perplexity, active: [], saved: {} },
      'offshore',
      {},
      undefined,
      { packSeat: (ref) => packSeatFor(ref, { ownTailnetSuffix: null }) },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('Hello');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
    expect(events.some((e) => e.type === 'citations')).toBe(false);
  });
});
