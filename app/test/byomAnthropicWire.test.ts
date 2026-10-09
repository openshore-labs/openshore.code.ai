// Your own model at an address in the Anthropic format (bring your own keys,
// Part 2, 2026-10-09). The Stack sends it a conservative Messages request: the
// address as the SDK's base, the person's key and nothing of Claude's (no
// workspace header, no thinking, no cache markers), a set max_tokens, plain
// system text, turns from one side merged, and the tools the OpenAI path
// offers, with the same fall back to no tools on a 400, 404 or 422 in round
// one. Chain of Thought prompts it to think in tags unless its name says it
// reasons natively, and a failure is said in the address's name, never
// Claude's. A gateway marked as passing requests on is cloud to every judge,
// so its vault read of a private note stays on this device.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { chainOfThoughtPrompt, compileVaultPrivacy, LOCAL_ONLY_STUB } from 'os-code/protocol';

type Reply =
  | {
      text?: string;
      /** A thinking block the server sends unasked, before its answer. */
      thinking?: string;
      tools?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
    }
  | { status: number }
  | 'drop';

const h = vi.hoisted(() => ({
  clients: [] as Array<Record<string, unknown>>,
  params: [] as Array<Record<string, any>>,
  replies: [] as Reply[],
  keys: {} as Record<string, string>,
}));

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class Anthropic {
    static APIUserAbortError = class extends Error {};
    static AuthenticationError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    constructor(opts: Record<string, unknown>) {
      h.clients.push(opts);
    }
    messages = {
      stream: (params: Record<string, unknown>) => {
        h.params.push(JSON.parse(JSON.stringify(params)));
        const reply = h.replies.shift() ?? { text: 'ok' };
        const handlers: Record<string, (delta: string) => void> = {};
        return {
          on: (event: string, cb: (delta: string) => void) => {
            handlers[event] = cb;
          },
          finalMessage: async () => {
            if (reply === 'drop') throw new TypeError('Failed to fetch');
            if ('status' in reply) {
              throw Object.assign(new APIError(`${reply.status} refused`), {
                status: reply.status,
              });
            }
            if (reply.text) handlers.text?.(reply.text);
            return {
              content: [
                ...(reply.thinking
                  ? [{ type: 'thinking', thinking: reply.thinking, signature: 'sig-1' }]
                  : []),
                ...(reply.text ? [{ type: 'text', text: reply.text }] : []),
                ...(reply.tools ?? []).map((t) => ({ type: 'tool_use', ...t })),
              ],
              stop_reason: reply.tools?.length ? 'tool_use' : 'end_turn',
            };
          },
        };
      },
    };
  }
  return { default: Anthropic };
});

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  secretGet: async (key: string) => h.keys[key] ?? null,
  // A workspace saved for Claude: an address must never be sent it.
  storeGetJson: async () => ({ anthropicWorkspaceId: 'wrkspc_claude' }),
}));
vi.mock('../src/lib/streamingFetch.js', () => ({
  streamingFetch: vi.fn(async () => {
    throw new Error('no OpenAI-compatible request is expected here');
  }),
}));
vi.mock('../src/lib/nativeFetch.js', () => ({
  nativeFetch: vi.fn(async () => {
    throw new Error('no OpenAI-compatible request is expected here');
  }),
}));
vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async () => ({ remove: async () => {} }),
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async () => ({ started: true }),
  },
}));

const { StackDriver, anthropicTurns, withTurnImages, BYOM_ANTHROPIC_MAX_TOKENS } =
  await import('../src/drivers/stackDriver.js');
const { ADDRESS_DROPPED_HEADERS } = await import('../src/drivers/addressClient.js');
const { streamingFetch } = await import('../src/lib/streamingFetch.js');
const { setChainOfThought } = await import('../src/lib/chainOfThought.js');
const { packSeatFor } = await import('../src/lib/vaultSeat.js');
const { byomRef } = await import('../src/lib/byom.js');
import type { AppStack, StackModelRef } from '../src/lib/stack.js';

const gateway = byomRef({
  id: 'gw',
  label: 'Gateway',
  baseUrl: 'https://gateway.example.com',
  model: 'llama-3.3-70b',
  wire: 'anthropic',
});
const anchor = (reasoning: StackModelRef, active: AppStack['active'] = []): AppStack => ({
  reasoning,
  active,
  saved: {},
});

function chat(
  stack: AppStack,
  opts: ConstructorParameters<typeof StackDriver>[4] = {},
  seed?: ConstructorParameters<typeof StackDriver>[3],
) {
  const driver = new StackDriver(stack, 'offshore', {}, seed, opts);
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return { driver, events };
}

const settle = async (ms = 20) => {
  for (let i = 0; i < ms; i++) await new Promise((r) => setTimeout(r, 0));
};
const dones = (events: DriverEvent[]) => events.filter((e) => e.type === 'task-done');
const finalText = (events: DriverEvent[]) =>
  (events.findLast((e) => e.type === 'text-final') as { text: string } | undefined)?.text;

beforeEach(() => {
  h.clients.length = 0;
  h.params.length = 0;
  h.replies.length = 0;
  h.keys = { 'oscode.secret.byom.gw': 'sk-gw' };
  setChainOfThought(false);
});
afterEach(() => setChainOfThought(false));

describe('the request an Anthropic-format address is sent', () => {
  it('goes to the address on its own key, with nothing of Claude', async () => {
    h.replies.push({ text: 'Hello from the gateway.' });
    const { driver, events } = chat(anchor(gateway));
    driver.send('hi');
    await settle();
    expect(finalText(events)).toBe('Hello from the gateway.');
    expect(h.clients).toHaveLength(1);
    const client = h.clients[0]!;
    expect(client).toMatchObject({
      apiKey: 'sk-gw',
      authToken: null,
      baseURL: 'https://gateway.example.com',
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
    });
    // No workspace header, though one is saved for Claude.
    expect(JSON.stringify(client)).not.toContain('wrkspc_claude');
    expect(client.defaultHeaders).toBeUndefined();
    // The transport is the Claude path's streaming fetch, with the SDK's own
    // client headers and any bearer taken off on the way (the real SDK's
    // headers are read in byomAnthropicHeaders.test.ts).
    expect(ADDRESS_DROPPED_HEADERS).toContain('x-stainless-os');
    expect(ADDRESS_DROPPED_HEADERS).toContain('x-stainless-helper-method');
    expect(ADDRESS_DROPPED_HEADERS).toContain('authorization');
    vi.mocked(streamingFetch).mockResolvedValueOnce(new Response('{}'));
    await (client.fetch as typeof fetch)('https://gateway.example.com/v1/messages', {
      headers: { 'x-api-key': 'sk-gw', 'x-stainless-os': 'MacOS', authorization: 'Bearer t' },
    });
    const init = vi.mocked(streamingFetch).mock.calls.at(-1)![1]!;
    const sent = new Headers(init.headers);
    expect(sent.get('x-api-key')).toBe('sk-gw');
    expect(sent.has('x-stainless-os')).toBe(false);
    expect(sent.has('authorization')).toBe(false);
    const params = h.params[0]!;
    expect(params.model).toBe('llama-3.3-70b');
    expect(params.max_tokens).toBe(BYOM_ANTHROPIC_MAX_TOKENS);
    expect(typeof params.system).toBe('string');
    expect(params.thinking).toBeUndefined();
    expect(params.cache_control).toBeUndefined();
    expect(JSON.stringify(params)).not.toContain('cache_control');
    expect(params.messages).toEqual([{ role: 'user', content: 'hi' }]);
    driver.dispose();
  });

  it('takes a pasted /v1 or /v1/messages off the address', async () => {
    const pasted = { ...gateway, baseUrl: 'https://gateway.example.com/v1/messages/' };
    const { driver } = chat(anchor(pasted));
    driver.send('hi');
    await settle();
    expect(h.clients[0]!.baseURL).toBe('https://gateway.example.com');
    driver.dispose();
  });

  it('sends no key to a keyless server, and says so to the SDK', async () => {
    h.keys = {};
    const local = { ...gateway, baseUrl: 'http://192.168.1.20:8080' };
    const { driver, events } = chat(anchor(local));
    driver.send('hi');
    await settle();
    expect(dones(events)[0]).toMatchObject({ reason: 'complete' });
    expect(h.clients[0]).toMatchObject({ apiKey: null, defaultHeaders: { 'x-api-key': null } });
    driver.dispose();
  });

  it('merges turns from one side and opens on a person', () => {
    expect(
      anthropicTurns([
        { role: 'assistant', content: 'Welcome.' },
        { role: 'user', content: 'first' },
        { role: 'user', content: 'RESULTS for tides' },
        { role: 'assistant', content: '' },
        { role: 'assistant', content: 'High tide is at six.' },
        { role: 'user', content: '   ' },
        { role: 'user', content: 'thanks' },
      ]),
    ).toEqual([
      { role: 'user', content: '(This chat began with the message below.)' },
      { role: 'assistant', content: 'Welcome.' },
      { role: 'user', content: 'first\n\nRESULTS for tides' },
      { role: 'assistant', content: 'High tide is at six.' },
      { role: 'user', content: 'thanks' },
    ]);
  });

  it('sends a chat with two user turns in a row as one', async () => {
    h.replies.push({ text: 'Merged.' });
    const { driver } = chat(anchor(gateway), {}, [
      { role: 'user', text: 'one' },
      { role: 'user', text: 'two' },
    ]);
    driver.send('three');
    await settle();
    expect(h.params[0]!.messages).toEqual([{ role: 'user', content: 'one\n\ntwo\n\nthree' }]);
    driver.dispose();
  });
});

describe('tools on an Anthropic-format address', () => {
  const privacy = compileVaultPrivacy({
    exclude: [],
    localOnly: { paths: ['Private/**'], tags: [] },
  });
  const NOTES: Record<string, string> = { 'Private/Diary.md': '# Diary\nThe secret is teal.' };
  const vaultTools = {
    privacy: async () => privacy,
    search: async () => [],
    read: async (p: string) =>
      NOTES[p] !== undefined ? { text: NOTES[p]!, version: 'v1' } : undefined,
    write: async () => ({ ok: true as const, version: 'v2' }),
  };
  const read = { id: 'tu1', name: 'vaultRead', input: { path: 'Private/Diary.md' } };

  it('runs a tool call and sends the result back as a tool_result', async () => {
    const home = { ...gateway, baseUrl: 'http://192.168.1.20:4000' };
    h.replies.push({ text: 'Let me look.', tools: [read] }, { text: 'Read it.' });
    const seat = (ref: StackModelRef) => packSeatFor(ref, { ownTailnetSuffix: null });
    const { driver, events } = chat(anchor(home), {
      packSeat: seat,
      vaultTools: vaultTools as never,
    });
    driver.send('what is in my diary?');
    await settle(40);
    expect(h.params[0]!.tools.map((t: { name: string }) => t.name)).toContain('vaultRead');
    const second = h.params[1]!.messages as Array<{ role: string; content: unknown }>;
    expect(second.at(-2)).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', ...read },
      ],
    });
    const result = (second.at(-1)!.content as Array<Record<string, string>>)[0]!;
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1' });
    // A server on your own network, unmarked, reads the private note.
    expect(result.content).toContain('The secret is teal.');
    expect(finalText(events)).toContain('Read it.');
    driver.dispose();
  });

  it('keeps a private note from a gateway marked as passing requests on', async () => {
    const marked = { ...gateway, baseUrl: 'http://192.168.1.20:4000', forwardsToCloud: true };
    h.replies.push({ tools: [read] }, { text: 'It stays put.' });
    const seat = (ref: StackModelRef) => packSeatFor(ref, { ownTailnetSuffix: null });
    expect(seat(marked)?.leavesNetwork).toBe(true);
    const { driver } = chat(anchor(marked), { packSeat: seat, vaultTools: vaultTools as never });
    driver.send('what is in my diary?');
    await settle(40);
    const sent = JSON.stringify(h.params[1]!.messages);
    expect(sent).toContain('stays on this computer');
    expect(sent).not.toContain('teal');
    driver.dispose();
  });

  it('sends a marked gateway the placeholder for a private turn', async () => {
    const marked = { ...gateway, baseUrl: 'http://100.101.102.103:4000', forwardsToCloud: true };
    h.replies.push({ text: 'Noted.' });
    const seat = (ref: StackModelRef) => packSeatFor(ref, { ownTailnetSuffix: null });
    const { driver } = chat(anchor(marked), { packSeat: seat }, [
      { role: 'user', text: 'diary?' },
      { role: 'assistant', text: 'The secret is teal.', localOnly: true },
    ]);
    driver.send('and then?');
    await settle();
    const sent = JSON.stringify(h.params[0]!.messages);
    expect(sent).not.toContain('teal');
    expect(sent).toContain(LOCAL_ONLY_STUB.slice(0, 40));
    driver.dispose();
  });

  it('falls back to no tools when round one is refused with a 400, 404 or 422', async () => {
    for (const status of [400, 404, 422]) {
      h.params.length = 0;
      h.replies.push({ status }, { text: 'Plain answer.' }, { text: 'Still plain.' });
      const seat = (ref: StackModelRef) => packSeatFor(ref, { ownTailnetSuffix: null });
      const { driver, events } = chat(anchor(gateway), {
        packSeat: seat,
        vaultTools: vaultTools as never,
      });
      driver.send('hi');
      await settle(30);
      expect(h.params[0]!.tools?.length).toBeGreaterThan(0);
      expect(h.params[1]!.tools).toBeUndefined();
      expect(finalText(events)).toBe('Plain answer.');
      // The seat stays on the plain path for the rest of the chat.
      driver.send('again');
      await settle(30);
      expect(h.params[2]!.tools).toBeUndefined();
      driver.dispose();
    }
  });

  it('offers the codemagic tool where the OpenAI path does', async () => {
    const driver = new StackDriver(anchor(gateway), 'offshore', { codemagicAccess: true });
    driver.subscribe(() => undefined);
    driver.send('kick off a build');
    await settle();
    expect(h.params[0]!.tools.map((t: { name: string }) => t.name)).toEqual(['codemagic']);
    driver.dispose();
  });
});

describe('an image sent to an Anthropic-format address', () => {
  const png = {
    id: 'img1',
    name: 'tide.png',
    mime: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
    isImage: true,
  };
  const imageBlock = {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
  };

  it('rides on the words sent with it, as image blocks', () => {
    expect(withTurnImages([{ role: 'user', content: 'what is this?' }], [png])).toEqual([
      { role: 'user', content: [imageBlock, { type: 'text', text: 'what is this?' }] },
    ]);
  });

  it('sent alone, opens a turn of its own, never on the reply before it', () => {
    // A first message with no words: one turn, the image, no empty text.
    expect(withTurnImages([], [png])).toEqual([{ role: 'user', content: [imageBlock] }]);
    // After an exchange: the reply stays as it was.
    expect(
      withTurnImages(
        [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'Hello.' },
        ],
        [png],
      ),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello.' },
      { role: 'user', content: [imageBlock] },
    ]);
  });

  it('end to end: an image with no words, first and after an exchange', async () => {
    const home = { ...gateway, baseUrl: 'http://192.168.1.20:4000' };
    h.replies.push({ text: 'A tide chart.' }, { text: 'Another chart.' });
    // Nothing is set for Image reading, so the chat asks before the anchor
    // reads it; the person says yes.
    const approveImage = async (
      driver: InstanceType<typeof StackDriver>,
      events: DriverEvent[],
    ) => {
      await settle();
      const ask = events.find((e) => e.type === 'approval-request') as
        { request: { id: string } } | undefined;
      driver.answerApproval(ask!.request.id, { approve: true });
      await settle();
    };
    const after = chat(anchor(home), {}, [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'Hello.' },
    ]);
    after.driver.send('', [png]);
    await approveImage(after.driver, after.events);
    expect(h.params[0]!.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello.' },
      { role: 'user', content: [imageBlock] },
    ]);
    after.driver.dispose();
    const first = chat(anchor(home));
    first.driver.send('', [png]);
    await approveImage(first.driver, first.events);
    expect(h.params[1]!.messages).toEqual([{ role: 'user', content: [imageBlock] }]);
    first.driver.dispose();
  });
});

describe('a server that thinks though it was asked for none', () => {
  it('gets its thinking blocks back with its tool calls, its tag thought kept out', async () => {
    const home = { ...gateway, baseUrl: 'http://192.168.1.20:4000' };
    const look = { id: 'tu1', name: 'vaultSearch', input: { query: 'tide' } };
    h.replies.push(
      { thinking: 'I should search.', text: '<think>tags</think>Let me look.', tools: [look] },
      { text: 'Found nothing.' },
    );
    const vaultTools = {
      privacy: async () => compileVaultPrivacy({ exclude: [], localOnly: { paths: [], tags: [] } }),
      search: async () => [],
      read: async () => undefined,
      write: async () => ({ ok: true as const, version: 'v2' }),
    };
    const seat = (ref: StackModelRef) => packSeatFor(ref, { ownTailnetSuffix: null });
    const { driver } = chat(anchor(home), { packSeat: seat, vaultTools: vaultTools as never });
    driver.send('anything about tides?');
    await settle(40);
    const second = h.params[1]!.messages as Array<{ role: string; content: unknown }>;
    expect(second.at(-2)).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'I should search.', signature: 'sig-1' },
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', ...look },
      ],
    });
    driver.dispose();
  });
});

describe('Chain of Thought on an Anthropic-format address', () => {
  const thoughts = (events: DriverEvent[]) =>
    events
      .filter((e) => e.type === 'thinking-delta')
      .map((e) => (e as { text: string }).text)
      .join('');

  it('on: a model that does not reason natively is prompted, and its tags are split', async () => {
    setChainOfThought(true);
    h.replies.push({ text: '<think>Check the tide table.</think>High tide is at six.' });
    const { driver, events } = chat(anchor(gateway));
    driver.send('when is high tide?');
    await settle();
    expect(h.params[0]!.system).toContain(chainOfThoughtPrompt());
    expect(h.params[0]!.thinking).toBeUndefined();
    expect(thoughts(events)).toBe('Check the tide table.');
    expect(finalText(events)).toBe('High tide is at six.');
    driver.dispose();
  });

  it('on: a model whose name says it reasons natively is not prompted, and gets no thinking', async () => {
    setChainOfThought(true);
    const { driver } = chat(anchor({ ...gateway, model: 'claude-sonnet-4-5' }));
    driver.send('hi');
    await settle();
    expect(h.params[0]!.system).not.toContain(chainOfThoughtPrompt());
    expect(h.params[0]!.thinking).toBeUndefined();
    driver.dispose();
  });

  it('off: nothing asks it to think, and a thought it writes anyway stays out', async () => {
    h.replies.push({ text: '<think>private musing</think>Answer.' });
    const { driver, events } = chat(anchor(gateway));
    driver.send('hi');
    await settle();
    expect(h.params[0]!.system).not.toContain(chainOfThoughtPrompt());
    expect(thoughts(events)).toBe('');
    expect(finalText(events)).toBe('Answer.');
    driver.dispose();
  });
});

describe('a failure at an Anthropic-format address', () => {
  it("is said in the address's name, never Claude's", async () => {
    h.replies.push({ status: 401 });
    const { driver, events } = chat(anchor(gateway));
    driver.send('hi');
    await settle();
    expect(dones(events)[0]).toMatchObject({ reason: 'error', message: 'Gateway answered 401.' });
    expect(JSON.stringify(events)).not.toMatch(/Claude/);
    driver.dispose();
  });

  it('a dropped connection reads as the address not reached', async () => {
    h.replies.push('drop');
    const { driver, events } = chat(anchor(gateway));
    driver.send('hi');
    await settle();
    expect(dones(events)[0]).toMatchObject({
      reason: 'error',
      message: 'Could not reach Gateway.',
    });
    driver.dispose();
  });

  it('a specialist at an address that fails falls back to the Reasoning model', async () => {
    const home = {
      kind: 'byom' as const,
      id: 'home',
      label: 'Home',
      baseUrl: 'https://home.example.com',
      model: 'coder',
      wire: 'anthropic' as const,
    };
    // The anchor frames (one step: the coding specialist), the specialist is
    // refused, and the anchor answers itself.
    h.replies.push(
      {
        text: JSON.stringify({
          clear: true,
          summary: 's',
          steps: [{ id: 'a', title: 'Code', category: 'coding', brief: 'b' }],
        }),
      },
      { status: 500 },
      { text: 'The anchor answers.' },
    );
    const { driver, events } = chat(
      anchor(gateway, [{ ref: home, placement: { category: 'coding' } }]),
    );
    driver.send('write a function that adds two numbers');
    await settle(40);
    expect(h.clients.map((c) => c.baseURL)).toContain('https://home.example.com');
    expect(dones(events).at(-1)).toMatchObject({ reason: 'complete' });
    expect(finalText(events)).toContain('The anchor answers.');
    driver.dispose();
  });
});

describe('a play on an Anthropic-format Reasoning model', () => {
  it('frames through the same conservative request', async () => {
    const writer = {
      kind: 'byom' as const,
      id: 'w',
      label: 'Writer',
      baseUrl: 'https://writer.example.com/v1',
      model: 'writer-1',
    };
    h.replies.push({ text: 'A direct answer, no plan needed.' });
    const { driver, events } = chat(
      anchor(gateway, [{ ref: writer, placement: { category: 'writing' } }]),
    );
    driver.send('what is a haiku?');
    await settle(30);
    expect(h.params[0]!.max_tokens).toBe(BYOM_ANTHROPIC_MAX_TOKENS);
    expect(typeof h.params[0]!.system).toBe('string');
    expect(h.params[0]!.thinking).toBeUndefined();
    expect(h.clients[0]!.baseURL).toBe('https://gateway.example.com');
    expect(dones(events).at(-1)).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });
});
