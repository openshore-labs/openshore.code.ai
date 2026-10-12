// A server that sends `reasoning_content` with a tool round (DeepSeek) answers
// 400 when the round is replayed without it, and Mistral sends `content` as
// chunks. Both are read by the OpenAI-compatible provider the keyed server
// seats use (2026-10-09, the whole-feature review of bring your own keys).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import { _setProbeResult } from '../src/providers/capabilities.js';
import type { ChatEvent, ChatMessage } from '../src/providers/types.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const BASE = 'http://127.0.0.1:59999';
function provider(): OpenAICompatibleProvider {
  _setProbeResult(BASE, { flavor: 'vllm', grammar: true, nativeTools: true, label: 'vLLM' });
  return new OpenAICompatibleProvider('p', { kind: 'openai-compatible', baseUrl: BASE });
}
const sse = (...chunks: unknown[]): string =>
  chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';

async function run(
  p: OpenAICompatibleProvider,
  messages: ChatMessage[],
  body: string,
): Promise<{ events: ChatEvent[]; sent: any }> {
  let sent: any;
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  const events: ChatEvent[] = [];
  for await (const e of p.chat({ model: 'm', messages })) events.push(e);
  return { events, sent };
}

describe('reasoning_content on a tool round', () => {
  it('is gathered with the tool call, and sent back only inside the same user turn', async () => {
    const stream = sse(
      { choices: [{ delta: { reasoning_content: 'think ' } }] },
      { choices: [{ delta: { reasoning_content: 'hard' } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    );
    const first = await run(provider(), [{ role: 'user', content: 'go' }], stream);
    const kept = first.events.find((e) => e.type === 'reasoning-content');
    expect(kept).toEqual({ type: 'reasoning-content', text: 'think hard' });

    const round: ChatMessage[] = [
      { role: 'user', content: 'earlier' },
      {
        role: 'assistant',
        content: '',
        reasoningContent: 'old thought',
        toolCalls: [{ id: 'a', name: 'f', args: {}, argsText: '{}' }],
      },
      { role: 'tool', content: 'ok', toolCallId: 'a' },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        reasoningContent: 'think hard',
        toolCalls: [{ id: 'c1', name: 'f', args: {}, argsText: '{}' }],
      },
      { role: 'tool', content: 'ok', toolCallId: 'c1' },
    ];
    const second = await run(provider(), round, sse({ choices: [{ delta: { content: 'done' } }] }));
    const assistants = second.sent.messages.filter((m: any) => m.role === 'assistant');
    expect(assistants[0].reasoning_content).toBeUndefined();
    expect(assistants[1].reasoning_content).toBe('think hard');
  });

  it('sends nothing for a server that sent no reasoning_content', async () => {
    const { events } = await run(
      provider(),
      [{ role: 'user', content: 'go' }],
      sse(
        { choices: [{ delta: { reasoning: 'vllm style' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{}' } }],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ),
    );
    expect(events.some((e) => e.type === 'reasoning-content')).toBe(false);
  });
});

describe('Mistral chunked content', () => {
  it('reads text chunks as the answer and thinking chunks as thinking', async () => {
    const { events } = await run(
      provider(),
      [{ role: 'user', content: 'hi' }],
      sse(
        {
          choices: [
            {
              delta: {
                content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'hm ' }] }],
              },
            },
          ],
        },
        { choices: [{ delta: { content: [{ type: 'text', text: 'Hello' }] } }] },
        { choices: [{ delta: { content: ' there' }, finish_reason: 'stop' }] },
      ),
    );
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    const thought = events.flatMap((e) => (e.type === 'thinking' ? [e.delta] : [])).join('');
    expect(text).toBe('Hello there');
    expect(thought).toBe('hm ');
    expect(text).not.toContain('[object');
  });
});
