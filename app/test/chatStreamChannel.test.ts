// The main-process streaming channel for a model seat's reply (build
// 2026-09-29, CTO ruling 7; electron/chatStream.ts). The renderer is untrusted,
// so the channel is narrow: POST to a chat path only, a header allowlist, no
// redirects, public https pinned, plain http only on your own network, a cap
// and two clocks, and teardown when the page goes. These run the real module
// against a real local server; names resolve through a fake so no test
// touches DNS.
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LookupAddress } from 'node:dns';
import {
  CHAT_STREAM_HEADERS,
  ChatStreams,
  addressKind,
  chatStreamRequest,
  vetChatTarget,
  type ChatStreamEvent,
} from '../electron/chatStream.js';

const resolveTo =
  (...ips: string[]) =>
  async (): Promise<LookupAddress[]> =>
    ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

const req = (over: Record<string, unknown> = {}) => ({
  id: 'chat_1',
  url: 'http://127.0.0.1:11434/v1/chat/completions',
  headers: { 'content-type': 'application/json' },
  body: '{"model":"m","stream":true,"messages":[]}',
  ...over,
});

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

/** A local server that answers every request with `handle`, and its base. */
async function serve(
  handle: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<string> {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => handle(req, res, body));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('what the renderer may ask for', () => {
  it('refuses a path that is not a chat endpoint', () => {
    for (const url of [
      'https://api.openai.com/v1/models',
      'http://127.0.0.1:11434/api/pull',
      'http://127.0.0.1:11434/v1/chat/completions/../../api/delete',
      'http://127.0.0.1:11434/',
    ]) {
      expect(() => chatStreamRequest(req({ url })), url).toThrow(/blocked: .*chat endpoint/);
    }
  });

  it('refuses another scheme, a login in the address, and a malformed request', () => {
    expect(() => chatStreamRequest(req({ url: 'file:///etc/chat/completions' }))).toThrow(
      /blocked/,
    );
    expect(() =>
      chatStreamRequest(req({ url: 'http://me:pw@127.0.0.1/v1/chat/completions' })),
    ).toThrow(/blocked/);
    expect(() => chatStreamRequest(req({ id: '../../x' }))).toThrow(/blocked/);
    expect(() => chatStreamRequest(req({ body: 42 }))).toThrow(/blocked/);
    expect(() => chatStreamRequest('nope')).toThrow(/blocked/);
  });

  it('keeps only the allowlisted headers', () => {
    const r = chatStreamRequest(
      req({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer k',
          'x-hermes-session-id': 'oscode-1',
          Cookie: 'session=1',
          Host: 'evil.example',
        },
      }),
    );
    expect(Object.keys(r.headers).sort()).toEqual([
      'authorization',
      'content-type',
      'x-hermes-session-id',
    ]);
    expect([...CHAT_STREAM_HEADERS]).not.toContain('cookie');
  });
});

describe('where a request may go', () => {
  it('sorts addresses into public, your own network, and refused', () => {
    expect(addressKind('127.0.0.1')).toBe('local');
    expect(addressKind('192.168.1.20')).toBe('local');
    expect(addressKind('10.0.0.5')).toBe('local');
    expect(addressKind('172.20.0.1')).toBe('local');
    expect(addressKind('100.101.102.103')).toBe('local');
    expect(addressKind('::1')).toBe('local');
    expect(addressKind('8.8.8.8')).toBe('public');
    expect(addressKind('169.254.169.254')).toBe('refused');
    expect(addressKind('0.0.0.0')).toBe('refused');
    expect(addressKind('224.0.0.1')).toBe('refused');
    expect(addressKind('fe80::1')).toBe('refused');
  });

  it('refuses plain http to a public host', async () => {
    await expect(
      vetChatTarget(new URL('http://api.example.com/v1/chat/completions'), resolveTo('8.8.8.8')),
    ).rejects.toThrow(/blocked: plain http only reaches a server on your own network/);
  });

  it('allows plain http to your own network, and https to a public host, pinned', async () => {
    const local = await vetChatTarget(
      new URL('http://box.local:11434/v1/chat/completions'),
      resolveTo('192.168.1.20'),
    );
    expect(local.address).toBe('192.168.1.20');
    const tailnet = await vetChatTarget(
      new URL('http://mac:11434/api/chat'),
      resolveTo('100.64.0.7'),
    );
    expect(tailnet.address).toBe('100.64.0.7');
    const cloud = await vetChatTarget(
      new URL('https://api.openai.com/v1/chat/completions'),
      resolveTo('104.18.6.192'),
    );
    expect(cloud.address).toBe('104.18.6.192');
  });

  it('refuses a name that answers both inside and outside your network, or a refused range', async () => {
    await expect(
      vetChatTarget(
        new URL('https://rebind.example/v1/chat/completions'),
        resolveTo('104.18.6.192', '127.0.0.1'),
      ),
    ).rejects.toThrow(/blocked/);
    await expect(
      vetChatTarget(new URL('http://metadata/v1/chat/completions'), resolveTo('169.254.169.254')),
    ).rejects.toThrow(/blocked/);
  });
});

describe('the stream', () => {
  it('streams a reply from a server on this machine, then ends', async () => {
    let seen: { method?: string; headers?: IncomingMessage['headers']; body?: string } = {};
    const base = await serve((r, res, body) => {
      seen = { method: r.method, headers: r.headers, body };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
        res.end('data: [DONE]\n\n');
      }, 10);
    });
    const events: ChatStreamEvent[] = [];
    const streams = new ChatStreams((e) => events.push(e), resolveTo('127.0.0.1'));
    const head = await streams.start(
      req({ url: `${base}/v1/chat/completions`, headers: { Cookie: 'x', authorization: 'k' } }),
    );
    expect(head).toEqual({ status: 200 });
    await expect.poll(() => events.at(-1)?.kind).toBe('end');
    const text = events
      .filter((e) => e.kind === 'data')
      .map((e) => (e as { chunk: string }).chunk)
      .join('');
    expect(text).toContain('"Hel"');
    expect(text).toContain('[DONE]');
    expect(seen.method).toBe('POST');
    expect(seen.headers?.cookie).toBeUndefined();
    expect(seen.headers?.authorization).toBe('k');
    expect(seen.body).toContain('"stream":true');
    expect(streams.size).toBe(0);
  });

  it('refuses a redirect and never follows it', async () => {
    let hits = 0;
    const base = await serve((_r, res) => {
      hits++;
      res.writeHead(302, { location: 'http://127.0.0.1:1/v1/chat/completions' });
      res.end();
    });
    const events: ChatStreamEvent[] = [];
    const streams = new ChatStreams((e) => events.push(e), resolveTo('127.0.0.1'));
    await expect(streams.start(req({ url: `${base}/v1/chat/completions` }))).rejects.toThrow(
      /blocked: .*redirect/,
    );
    expect(hits).toBe(1);
    expect(events).toEqual([]);
    expect(streams.size).toBe(0);
  });

  it('hands back an error status with its body, for the renderer to explain', async () => {
    const base = await serve((_r, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":"model does not support tools"}');
    });
    const events: ChatStreamEvent[] = [];
    const streams = new ChatStreams((e) => events.push(e), resolveTo('127.0.0.1'));
    expect(await streams.start(req({ url: `${base}/v1/chat/completions` }))).toEqual({
      status: 400,
    });
    await expect.poll(() => events.at(-1)?.kind).toBe('end');
  });

  it('stops a stream on abort, and every stream when the page goes', async () => {
    let closed = 0;
    const base = await serve((r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {}\n\n');
      r.socket.on('close', () => closed++);
    });
    const events: ChatStreamEvent[] = [];
    const streams = new ChatStreams((e) => events.push(e), resolveTo('127.0.0.1'));
    await streams.start(req({ id: 'a', url: `${base}/v1/chat/completions` }));
    await streams.start(req({ id: 'b', url: `${base}/v1/chat/completions` }));
    expect(streams.size).toBe(2);
    streams.abort('a');
    expect(streams.size).toBe(1);
    streams.closeAll();
    expect(streams.size).toBe(0);
    await expect.poll(() => closed).toBe(2);
    // Nothing more is said for a stream that was stopped.
    const after = events.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(events.length).toBe(after);
    expect(events.some((e) => e.kind === 'error')).toBe(false);
  });

  it('ends a reply that goes quiet, and one that runs past the cap', async () => {
    const base = await serve((r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (r.url?.includes('big')) res.write('x'.repeat(4096));
      else res.write('data: {}\n\n');
    });
    const events: ChatStreamEvent[] = [];
    const quiet = new ChatStreams((e) => events.push(e), resolveTo('127.0.0.1'), {
      firstByteMs: 1000,
      idleMs: 30,
      maxBytes: 1024,
    });
    await quiet.start(req({ id: 'q', url: `${base}/v1/chat/completions` }));
    await expect
      .poll(() => events.find((e) => e.id === 'q' && e.kind === 'error'))
      .toMatchObject({ message: expect.stringMatching(/quiet/) });
    await quiet.start(req({ id: 'big', url: `${base}/big/v1/chat/completions` }));
    await expect
      .poll(() => events.find((e) => e.id === 'big' && e.kind === 'error'))
      .toMatchObject({ message: expect.stringMatching(/larger/) });
    expect(quiet.size).toBe(0);
  });
});
