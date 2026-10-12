// The engine's Anthropic prompt cache end to end (Vault M5, tech review J17): the loop
// marks where the vault pack begins on the system message (`cacheAt`), the
// Anthropic provider splits `system` there when the endpoint's promptCache is
// 'auto', and the usage the API reports for cache reads and writes rides the
// loop's `usage` event. With promptCache 'off' (and unset) the request is
// byte-identical to one built with no cache offset at all: the offset is
// invisible on the wire until the person, or the eval, turns it on.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import type { AnthropicEndpoint } from '../src/config/schema.js';
import type { ChatMessage, ChatRequest } from '../src/providers/types.js';
import type { AgentEvent } from '../src/core/agent/types.js';
import type { PreparedVaultContext, VaultContextSource } from '../src/harness/vaultContext.js';
import { VAULT_NOTES_FRAMING } from '../src/harness/vaultContext.js';
import { makeTestSession } from './helpers/session.js';
import type { MockProvider } from './helpers/mockProvider.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function sse(obj: unknown): string {
  return 'data: ' + JSON.stringify(obj) + '\n';
}

// One plain answer, with the cache fields the API reports beside input_tokens.
const STREAM =
  sse({
    type: 'message_start',
    message: {
      usage: {
        input_tokens: 40,
        output_tokens: 0,
        cache_read_input_tokens: 1200,
        cache_creation_input_tokens: 300,
      },
    },
  }) +
  sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
  sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } }) +
  sse({ type: 'content_block_stop', index: 0 }) +
  sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }) +
  sse({ type: 'message_stop' });

/** Mock fetch that records every raw request body. */
function captureFetch(): string[] {
  const bodies: string[] = [];
  globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ''));
    return new Response(STREAM, { status: 200 });
  }) as unknown as typeof fetch;
  return bodies;
}

const CS_PATH = 'OpenShore Project Demo MDs/Current State.md';
const CS_TEXT =
  '# Current State\n\n## What last landed and launched\n- the parser landed MARKER-CS';

function source(): VaultContextSource {
  return {
    async prepare(): Promise<PreparedVaultContext> {
      return {
        index: null,
        bodies: new Map(),
        currentState: { path: CS_PATH, text: CS_TEXT },
        pins: [],
        privacy: { visibility: () => 'open' },
      };
    },
  };
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

/** An Anthropic provider that also records the messages the loop hands it. */
function recordingClaude(promptCache?: 'auto' | 'off') {
  const provider = new AnthropicProvider('claude', endpoint(promptCache), () => 'sk-test');
  const requests: ChatRequest[] = [];
  const chat = provider.chat.bind(provider);
  provider.chat = (request, signal) => {
    requests.push(request);
    return chat(request, signal);
  };
  return { provider, requests };
}

async function runOnce(promptCache?: 'auto' | 'off') {
  const bodies = captureFetch();
  const { provider, requests } = recordingClaude(promptCache);
  const session = makeTestSession(provider as unknown as MockProvider, {
    projectName: 'Demo',
    vaultContext: source(),
  });
  await session.agent.run('what landed last?');
  return { bodies, requests, events: session.events };
}

const usageOf = (events: AgentEvent[]) =>
  events.filter((e) => e.type === 'usage') as Array<Extract<AgentEvent, { type: 'usage' }>>;

describe('the prompt cache through the loop (J17)', () => {
  it("'auto' carries cache_control at the pack boundary, and the usage event reads it back", async () => {
    const { bodies, requests, events } = await runOnce('auto');
    expect(bodies).toHaveLength(1);
    const body = JSON.parse(bodies[0]!) as {
      system: Array<{ type: string; text: string; cache_control?: unknown }>;
      cache_control?: unknown;
    };
    // The loop marked the offset where the pack begins.
    const system = requests[0]!.messages.find((m) => m.role === 'system')!;
    expect(system.cacheAt).toHaveLength(1);
    const at = system.cacheAt![0]!;
    const text = system.content as string;
    expect(text.slice(at).startsWith(VAULT_NOTES_FRAMING)).toBe(true);

    // Two blocks: the stable head marked, the pack (the volatile tail) not.
    expect(body.system).toHaveLength(2);
    expect(body.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system[1]!.cache_control).toBeUndefined();
    expect(body.system[0]!.text).toBe(text.slice(0, at));
    expect(body.system[1]!.text.startsWith(VAULT_NOTES_FRAMING)).toBe(true);
    expect(body.system[1]!.text).toContain('MARKER-CS');
    expect(body.system[0]!.text).not.toContain('MARKER-CS');
    // The model reads the same text either way.
    expect(body.system.map((b) => b.text).join('')).toBe(text);
    // Automatic caching for the growing history.
    expect(body.cache_control).toEqual({ type: 'ephemeral' });

    const usage = usageOf(events);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      promptTokens: 40,
      completionTokens: 2,
      cacheReadTokens: 1200,
      cacheWriteTokens: 300,
    });
  });

  for (const setting of ['off', undefined] as const) {
    it(`'${setting ?? 'unset'}' sends the request byte-identical to one with no cache offset`, async () => {
      const { bodies, requests, events } = await runOnce(setting);
      expect(bodies).toHaveLength(1);
      const sent = bodies[0]!;
      expect(sent).not.toContain('cache_control');
      const body = JSON.parse(sent) as { system: unknown };
      expect(typeof body.system).toBe('string');
      expect(body.system as string).toContain('MARKER-CS');

      // The loop still marked the offset; strip it and rebuild the request on
      // a fresh provider: the bytes on the wire are the same.
      const withOffset = requests[0]!;
      expect(withOffset.messages.some((m) => m.cacheAt?.length)).toBe(true);
      const stripped: ChatMessage[] = withOffset.messages.map((m) => {
        const { cacheAt: _drop, ...rest } = m;
        return rest;
      });
      const replay = captureFetch();
      const fresh = new AnthropicProvider('claude', endpoint(setting), () => 'sk-test');
      for await (const _event of fresh.chat({ ...withOffset, messages: stripped })) {
        // drain
      }
      expect(replay).toEqual([sent]);

      // No cache fields are invented when the endpoint is off: the API's own
      // report still rides, since it is what the API said.
      expect(usageOf(events)[0]).toMatchObject({ promptTokens: 40, completionTokens: 2 });
    });
  }
});
