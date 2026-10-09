// What an address in the Anthropic format is actually sent (bring your own
// keys, Part 2, 2026-10-09), read off the wire of the real Anthropic SDK with
// a capturing transport, never a mocked one: the key as x-api-key (or no key
// at all), the format's version, and none of the SDK's own client and
// platform headers, the per-request helper header included, and no bearer.
// The one SDK header that still goes is named here, so the review doc's list
// stays true.
import { afterEach, describe, expect, it } from 'vitest';
import { ADDRESS_DROPPED_HEADERS, addressAnthropic } from '../src/drivers/addressClient.js';

/** A streamed Messages answer, as an address in the format sends it. */
const SSE = [
  [
    'message_start',
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'house',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
  ],
  [
    'content_block_start',
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ],
  [
    'content_block_delta',
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi.' } },
  ],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  [
    'message_delta',
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 },
    },
  ],
  ['message_stop', { type: 'message_stop' }],
]
  .map(([event, data]) => `event: ${event as string}\ndata: ${JSON.stringify(data)}\n\n`)
  .join('');

function capture() {
  const seen: Array<{ url: string; headers: Headers }> = [];
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { seen, transport };
}

async function streamOnce(key: string | null) {
  const { seen, transport } = capture();
  const client = addressAnthropic({ baseUrl: 'http://192.168.1.20:4000/v1', key, transport });
  const final = await client.messages
    .stream({ model: 'house', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] })
    .finalMessage();
  expect(final.content).toMatchObject([{ type: 'text', text: 'Hi.' }]);
  expect(seen).toHaveLength(1);
  return seen[0]!;
}

const ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('the headers an Anthropic-format address is sent, by the real SDK', () => {
  it('the key as x-api-key, the version, and nothing of the SDK', async () => {
    const { url, headers } = await streamOnce('sk-house');
    expect(url).toBe('http://192.168.1.20:4000/v1/messages');
    expect(headers.get('x-api-key')).toBe('sk-house');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    for (const name of ADDRESS_DROPPED_HEADERS) expect(headers.has(name), name).toBe(false);
    expect([...headers.keys()].filter((k) => k.startsWith('x-stainless'))).toEqual([]);
    // What still goes, said in the review doc: nothing that names the person.
    expect([...headers.keys()].sort()).toEqual([
      'accept',
      'anthropic-dangerous-direct-browser-access',
      'anthropic-version',
      'content-type',
      'x-api-key',
    ]);
  });

  it('a keyless server gets no key and no bearer, whatever the machine holds', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-the-machine';
    process.env.ANTHROPIC_AUTH_TOKEN = 'token-from-the-machine';
    const { headers } = await streamOnce(null);
    expect(headers.has('x-api-key')).toBe(false);
    expect(headers.has('authorization')).toBe(false);
    expect(JSON.stringify([...headers.entries()])).not.toContain('from-the-machine');
  });
});
