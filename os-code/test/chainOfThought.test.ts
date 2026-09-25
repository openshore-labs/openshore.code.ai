// Chain of Thought (founder, 2026-09-25): off by default; on, every model shows
// its reasoning above the answer. These guard the pure pieces (the <think> tag
// splitter, the native-reasoner test, the Claude thinking parameter, the
// precedence), each provider's request shape, and the loop's routing both ways.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ThinkTagSplitter,
  chainOfThoughtEnabled,
  chainOfThoughtPrompt,
  claudeThinking,
  reasonsNatively,
  splitThinkTags,
  type ThoughtPiece,
} from '../src/core/agent/chainOfThought.js';
import { ConfigSchema } from '../src/config/schema.js';
import { AnthropicProvider, toAnthropicMessages } from '../src/providers/anthropic.js';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import { _setProbeResult } from '../src/providers/capabilities.js';
import type { ChatEvent } from '../src/providers/types.js';
import { MockProvider, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function run(chunks: string[]): ThoughtPiece[] {
  const s = new ThinkTagSplitter();
  const out: ThoughtPiece[] = [];
  for (const c of chunks) out.push(...s.push(c));
  out.push(...s.end());
  // Coalesce across calls so the assertions read the whole stream.
  const merged: ThoughtPiece[] = [];
  for (const p of out) {
    const last = merged[merged.length - 1];
    if (last && last.kind === p.kind) last.text += p.text;
    else merged.push({ ...p });
  }
  return merged;
}

describe('ThinkTagSplitter', () => {
  it('routes tagged text to thinking and the rest to the answer', () => {
    expect(run(['<think>check the math</think>\n\nThe answer is 4.'])).toEqual([
      { kind: 'thinking', text: 'check the math' },
      { kind: 'text', text: 'The answer is 4.' },
    ]);
  });

  it('holds a tag split across chunks, in either direction', () => {
    expect(run(['<thi', 'nk>a', 'b</th', 'ink>', 'done'])).toEqual([
      { kind: 'thinking', text: 'ab' },
      { kind: 'text', text: 'done' },
    ]);
  });

  it('accepts <thinking> tags too', () => {
    expect(splitThinkTags('<thinking>x</thinking>y')).toEqual({ text: 'y', thinking: 'x' });
  });

  it('passes plain text straight through, including a lone < that is not a tag', () => {
    expect(run(['a < b', ' and c'])).toEqual([{ kind: 'text', text: 'a < b and c' }]);
  });

  it('drops a stray closing tag rather than showing it', () => {
    expect(splitThinkTags('reasoning left open by the template</think>\nAnswer')).toEqual({
      text: 'reasoning left open by the templateAnswer',
      thinking: '',
    });
  });

  it('an unclosed thought at the end stays thinking, never leaks into the answer', () => {
    expect(splitThinkTags('Hi <think>still going')).toEqual({
      text: 'Hi ',
      thinking: 'still going',
    });
  });
});

describe('the pure rules', () => {
  it('is off by default, and the app override wins both ways', () => {
    expect(ConfigSchema.parse({}).chainOfThought.enabled).toBe(false);
    expect(chainOfThoughtEnabled(undefined)).toBe(false);
    expect(chainOfThoughtEnabled(true)).toBe(true);
    expect(chainOfThoughtEnabled(false, true)).toBe(true);
    expect(chainOfThoughtEnabled(true, false)).toBe(false);
  });

  it('knows the native reasoners by name and prompts the rest', () => {
    for (const m of [
      'claude-opus-4-8',
      'qwen3:8b',
      'deepseek-r1:7b',
      'gpt-oss:20b',
      'qwq:32b',
      'o3-mini',
      'magistral-small',
    ])
      expect(reasonsNatively(m), m).toBe(true);
    for (const m of ['qwen2.5-coder:7b', 'qwen3-coder:30b', 'llama3.2:3b', 'gpt-4o', 'phi3'])
      expect(reasonsNatively(m), m).toBe(false);
  });

  it('asks Claude 4.6 and newer to think adaptively, with a readable summary', () => {
    for (const m of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-opus-5']) {
      const t = claudeThinking(m, 2048);
      expect(t.thinking, m).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(t.maxTokens).toBeGreaterThanOrEqual(16000);
    }
  });

  it('gives older Claude models a fixed budget under max_tokens', () => {
    for (const m of ['claude-haiku-4-5', 'claude-sonnet-4-5-20250929', 'claude-opus-4-20250514']) {
      const t = claudeThinking(m, 2048);
      expect(t.thinking.type, m).toBe('enabled');
      const budget = (t.thinking as { budget_tokens: number }).budget_tokens;
      expect(budget).toBeGreaterThanOrEqual(1024);
      expect(t.maxTokens).toBeGreaterThan(budget);
    }
  });

  it('the prompt names the tags the splitter reads', () => {
    expect(chainOfThoughtPrompt()).toContain('<think>');
    expect(chainOfThoughtPrompt()).toContain('</think>');
  });
});

function sse(obj: unknown): string {
  return 'data: ' + JSON.stringify(obj) + '\n';
}

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('Anthropic provider', () => {
  const provider = () =>
    new AnthropicProvider(
      'anthropic',
      {
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.test',
        auth: 'api-key',
        model: 'claude-opus-4-8',
      },
      () => 'sk-test',
    );

  function mockStream(body: string): { bodies: Array<Record<string, unknown>> } {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    return { bodies };
  }

  it('on: sends the thinking parameter, drops temperature, and returns signed blocks', async () => {
    const { bodies } = mockStream(
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }) +
        sse({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Plan it.' },
        }) +
        sse({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'sig123' },
        }) +
        sse({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tu_1', name: 'readFile' },
        }) +
        sse({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"path":"a.ts"}' },
        }) +
        sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
    );
    const events = await collect(
      provider().chat({
        model: 'claude-opus-4-8',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.2,
        maxTokens: 8192,
        reasoning: 'on',
      }),
    );
    expect(bodies[0]!.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(bodies[0]!.temperature).toBeUndefined();
    expect(bodies[0]!.max_tokens).toBeGreaterThanOrEqual(16000);
    expect(events).toContainEqual({ type: 'thinking', delta: 'Plan it.' });
    expect(events).toContainEqual({
      type: 'thinking-blocks',
      blocks: [{ type: 'thinking', thinking: 'Plan it.', signature: 'sig123' }],
    });
  });

  it('off: sends no thinking parameter, and a temperature where the model takes one', async () => {
    const { bodies } = mockStream(
      sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
    );
    await collect(
      provider().chat({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.2,
        reasoning: 'off',
      }),
    );
    expect(bodies[0]!.thinking).toBeUndefined();
    expect(bodies[0]!.temperature).toBe(0.2);
  });

  it('skips thinking when the last tool turn carries no signed thought (an escalation)', async () => {
    const { bodies } = mockStream(
      sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
    );
    await collect(
      provider().chat({
        model: 'claude-opus-4-8',
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'c1', name: 'readFile', argsText: '{}' }],
          },
          { role: 'tool', toolCallId: 'c1', content: 'text' },
        ],
        temperature: 0.2,
        reasoning: 'on',
      }),
    );
    expect(bodies[0]!.thinking).toBeUndefined();
    // Opus 4.8 rejects a temperature, so the fallback request carries none.
    expect(bodies[0]!.temperature).toBeUndefined();
  });

  it('replays a turn’s thinking blocks ahead of its tool calls', () => {
    const block = { type: 'thinking', thinking: 'Plan it.', signature: 'sig123' };
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        thinkingBlocks: [block],
        toolCalls: [{ id: 'tu_1', name: 'readFile', argsText: '{"path":"a.ts"}' }],
      },
      { role: 'tool', toolCallId: 'tu_1', content: 'file text' },
    ]);
    const assistant = messages[1]!.content as Array<Record<string, unknown>>;
    expect(assistant[0]).toEqual(block);
    expect(assistant[1]!.type).toBe('tool_use');
  });
});

describe('Ollama think flag', () => {
  function mockOllama(capabilities: string[]) {
    const baseUrl = `http://ollama-${capabilities.join('-') || 'none'}.test`;
    _setProbeResult(baseUrl, {
      flavor: 'ollama',
      grammar: true,
      nativeTools: true,
      label: 'Ollama',
    });
    const chats: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith('/api/show')) {
        return new Response(JSON.stringify({ capabilities }), { status: 200 });
      }
      chats.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ message: { content: 'ok' }, done: true }) + '\n', {
        status: 200,
      });
    }) as unknown as typeof fetch;
    return {
      provider: new OpenAICompatibleProvider('ollama', { kind: 'openai-compatible', baseUrl }),
      chats,
    };
  }

  it('tells a thinking model to think, or not', async () => {
    const { provider, chats } = mockOllama(['completion', 'thinking']);
    await collect(provider.chat({ model: 'qwen3:8b', messages: [], reasoning: 'on' }));
    await collect(provider.chat({ model: 'qwen3:8b', messages: [], reasoning: 'off' }));
    expect(chats[0]!.think).toBe(true);
    expect(chats[1]!.think).toBe(false);
  });

  it('never sends the flag to a model without the capability', async () => {
    const { provider, chats } = mockOllama(['completion']);
    await collect(provider.chat({ model: 'qwen2.5-coder:7b', messages: [], reasoning: 'on' }));
    expect('think' in chats[0]!).toBe(false);
  });
});

describe('the agent loop', () => {
  async function runWith(chainOfThought: boolean, model: string, turn = textTurn('ok')) {
    const provider = new MockProvider('mock', [turn]);
    const session = makeTestSession(provider, {
      configOverrides: {
        chainOfThought: { enabled: chainOfThought },
        stack: { orchestrator: { provider: 'mock', model } },
      },
    });
    await session.agent.run('hello');
    const req = provider.requests[0]!;
    const system = req.messages.find((m) => m.role === 'system')?.content;
    return { req, system: String(system), events: session.events };
  }

  it('off by default: no prompt, and reasoning off on the request', async () => {
    const { req, system } = await runWith(false, 'llama3.2:3b');
    expect(req.reasoning).toBe('off');
    expect(system).not.toContain('Chain of thought is on');
  });

  it('on: a prompted model is told to think in tags, a native reasoner is not', async () => {
    const prompted = await runWith(true, 'llama3.2:3b');
    expect(prompted.req.reasoning).toBe('on');
    expect(prompted.system).toContain('Chain of thought is on');
    const native = await runWith(true, 'qwen3:8b');
    expect(native.system).not.toContain('Chain of thought is on');
  });

  it('on: tagged and native thinking both reach the transcript, the answer stays clean', async () => {
    const { events } = await runWith(true, 'llama3.2:3b', [
      { type: 'thinking', delta: 'native part. ' },
      { type: 'text', delta: '<think>tagged part</think>\n\nThe answer.' },
      { type: 'done', stopReason: 'end' },
    ]);
    const thinking = events
      .filter((e) => e.type === 'thinking-delta')
      .map((e) => (e as { text: string }).text)
      .join('');
    expect(thinking).toBe('native part. tagged part');
    const final = events.find((e) => e.type === 'text-final') as { text: string };
    expect(final.text).toBe('The answer.');
  });

  it('off: any thinking a model sends anyway is kept out of the transcript', async () => {
    const { events } = await runWith(false, 'qwen3:8b', [
      { type: 'thinking', delta: 'native part' },
      { type: 'text', delta: '<think>tagged</think>The answer.' },
      { type: 'done', stopReason: 'end' },
    ]);
    expect(events.some((e) => e.type === 'thinking-delta')).toBe(false);
    const final = events.find((e) => e.type === 'text-final') as { text: string };
    expect(final.text).toBe('The answer.');
  });
});
