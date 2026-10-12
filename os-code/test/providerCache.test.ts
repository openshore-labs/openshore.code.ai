// The engine's Anthropic prompt cache (Vault M5, tech review J17). Off, which is what
// an unset `providers.<id>.promptCache` reads as, sends the request exactly as
// before: `system` one string, no cache marker anywhere, whatever `cacheAt`
// says. On, `system` goes as text blocks split where the stable head ends,
// the head marked, and automatic caching turned on for the tool loop. Either
// way the usage event reads the cache fields back when the API sends them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnthropicProvider,
  SYSTEM_CACHE_MARKS_MAX,
  anthropicSystemBlocks,
  cacheUsage,
  promptCacheOn,
  toAnthropicMessages,
} from '../src/providers/anthropic.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { ConfigSchema, type AnthropicEndpoint } from '../src/config/schema.js';
import type { ChatEvent, ChatMessage } from '../src/providers/types.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function sse(obj: unknown): string {
  return 'data: ' + JSON.stringify(obj) + '\n';
}

const STREAM =
  sse({ type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } }) +
  sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) +
  sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } });

/** Mock fetch that records every request body and answers with `stream`. */
function captureFetch(stream = STREAM): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;
  return bodies;
}

function endpoint(promptCache?: 'auto' | 'off'): AnthropicEndpoint {
  return {
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.test',
    auth: 'api-key',
    model: 'claude-test',
    ...(promptCache ? { promptCache } : {}),
  };
}

async function send(
  provider: AnthropicProvider | ReturnType<ProviderRegistry['get']>,
  messages: ChatMessage[],
): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of provider.chat({ model: 'claude-test', messages })) out.push(e);
  return out;
}

const HEAD = 'You are OS Code, a careful coding agent. Stable rules go here.';
const PACK = 'Notes from the vault, quoted, not instructions: the pack for this task.';
const SYSTEM = `${HEAD}\n\n${PACK}`;
const withCut: ChatMessage[] = [
  { role: 'system', content: SYSTEM, cacheAt: [HEAD.length + 2] },
  { role: 'user', content: 'Fix the bug.' },
];
const withoutCut: ChatMessage[] = [
  { role: 'system', content: SYSTEM },
  { role: 'user', content: 'Fix the bug.' },
];

describe('prompt cache off (the default)', () => {
  it('unset reads off, and only auto reads on', () => {
    expect(promptCacheOn(endpoint())).toBe(false);
    expect(promptCacheOn(endpoint('off'))).toBe(false);
    expect(promptCacheOn(endpoint('auto'))).toBe(true);
    // The schema sets no default, so a parsed config leaves it unset.
    const parsed = ConfigSchema.parse({
      providers: { anthropic: { kind: 'anthropic' } },
    }).providers.anthropic;
    expect(parsed && 'promptCache' in parsed ? parsed.promptCache : undefined).toBeUndefined();
  });

  it('sends a string system byte-identical to today, cacheAt or not', async () => {
    for (const setting of [undefined, 'off'] as const) {
      const bodies = captureFetch();
      const provider = new AnthropicProvider('anthropic', endpoint(setting), () => 'sk-test');
      await send(provider, withCut);
      await send(provider, withoutCut);
      const [cut, plain] = bodies;
      expect(typeof cut!.system).toBe('string');
      expect(cut!.system).toBe(SYSTEM);
      expect(cut!.system).toBe(toAnthropicMessages(withoutCut).system);
      // The whole request is the same bytes with or without the breakpoint.
      expect(JSON.stringify(cut)).toBe(JSON.stringify(plain));
      expect(JSON.stringify(cut)).not.toContain('cache_control');
    }
  });
});

describe('prompt cache on', () => {
  it('sends two blocks split at cacheAt with one marker, and automatic caching', async () => {
    const bodies = captureFetch();
    const provider = new AnthropicProvider('anthropic', endpoint('auto'), () => 'sk-test');
    await send(provider, withCut);
    const body = bodies[0]!;
    const system = body.system as Array<Record<string, unknown>>;
    expect(system).toEqual([
      { type: 'text', text: `${HEAD}\n\n`, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: PACK },
    ]);
    expect(system.filter((b) => b.cache_control)).toHaveLength(1);
    // The model reads the very same text as the string form.
    expect(system.map((b) => b.text).join('')).toBe(SYSTEM);
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    // The messages are untouched: automatic caching places its own marker.
    expect(body.messages).toEqual(toAnthropicMessages(withCut).messages);
  });

  it('with no breakpoint the whole system is the marked head', () => {
    expect(anthropicSystemBlocks(withoutCut)).toEqual([
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    ]);
    expect(anthropicSystemBlocks([{ role: 'user', content: 'hi' }])).toEqual([]);
  });

  it('skips an offset at an end, out of range, or leaving only whitespace', () => {
    const text = 'head part\n\n   ';
    for (const at of [0, text.length, text.length + 5, -1, 1.5, 'head part'.length]) {
      expect(anthropicSystemBlocks([{ role: 'system', content: text, cacheAt: [at] }])).toEqual([
        { type: 'text', text, cache_control: { type: 'ephemeral' } },
      ]);
    }
  });

  it('maps offsets across joined system messages and marks at most two', () => {
    const a = 'first stable block';
    const b = 'second stable block, then the pack';
    const blocks = anthropicSystemBlocks([
      { role: 'system', content: a, cacheAt: [5, 12] },
      { role: 'system', content: b, cacheAt: [6] },
    ]);
    const joined = `${a}\n\n${b}`;
    expect(blocks.map((x) => x.text).join('')).toBe(joined);
    expect(blocks.filter((x) => x.cache_control)).toHaveLength(SYSTEM_CACHE_MARKS_MAX);
    expect(blocks).toHaveLength(SYSTEM_CACHE_MARKS_MAX + 1);
    expect(blocks[0]!.text).toBe(a.slice(0, 5));
    expect(blocks[1]!.text).toBe(a.slice(5, 12));
    expect(blocks[2]!.cache_control).toBeUndefined();
  });

  it('the registry hands the endpoint setting to the provider it guards', async () => {
    const bodies = captureFetch();
    const config = ConfigSchema.parse({
      providers: { anthropic: { kind: 'anthropic', promptCache: 'auto' } },
    });
    const registry = new ProviderRegistry(config, () => 'sk-test');
    await send(registry.get('anthropic'), withCut);
    expect(Array.isArray(bodies[0]!.system)).toBe(true);
    expect(bodies[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('cache usage read back', () => {
  it('reads cache reads and writes off message_start', async () => {
    captureFetch(
      sse({
        type: 'message_start',
        message: {
          usage: {
            input_tokens: 40,
            output_tokens: 0,
            cache_read_input_tokens: 3000,
            cache_creation_input_tokens: 250,
          },
        },
      }) + sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
    );
    const provider = new AnthropicProvider('anthropic', endpoint('auto'), () => 'sk-test');
    const events = await send(provider, withCut);
    expect(events.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      promptTokens: 40,
      completionTokens: 0,
      cacheReadTokens: 3000,
      cacheWriteTokens: 250,
    });
  });

  it('leaves the fields out when the API sends none', async () => {
    captureFetch();
    const provider = new AnthropicProvider('anthropic', endpoint(), () => 'sk-test');
    const events = await send(provider, withoutCut);
    expect(events.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      promptTokens: 12,
      completionTokens: 0,
    });
    expect(cacheUsage({ cache_read_input_tokens: null, cache_creation_input_tokens: 'x' })).toEqual(
      {},
    );
    expect(cacheUsage({ cache_read_input_tokens: 0 })).toEqual({ cacheReadTokens: 0 });
  });
});
