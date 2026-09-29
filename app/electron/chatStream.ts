// The main-process streaming channel for a model seat's chat request (build
// 2026-09-29, CTO ruling 7). An OpenAI-compatible provider or a model server on
// your own network (Ollama, llama.cpp, vLLM) sends no CORS headers, and the
// guarded httpFetch neither streams nor reaches a local server by design, so a
// streamed reply rides this narrow channel instead. The renderer is untrusted
// input, so every request is held to:
//
// - POST only, to a path ending /chat/completions or /api/chat;
// - a header allowlist (content type, the key, a bench session id);
// - https to a public host pinned to the address it was vetted at, the same
//   anti-rebinding pin httpFetch uses; https or plain http to your own network
//   (loopback, the LAN, and 100.64.0.0/10, the Tailscale range) and nowhere
//   else; link-local and every other reserved range is refused;
// - no redirects at all;
// - a cap on the request and on the streamed reply, five minutes for the first
//   byte (a cold local model is slow to load), two minutes of silence after;
// - teardown of every open stream when the page reloads or goes away.
//
// httpFetch stays exactly as it was. The response streams back as
// osc:chat-stream events tagged with the renderer's id, so a stopped request's
// late bytes are dropped on the renderer side by that id.
import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { StringDecoder } from 'node:string_decoder';

/** The headers a chat request may carry; any other is dropped. */
export const CHAT_STREAM_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'authorization',
  'x-hermes-session-id',
]);

/** The largest request body (a turn with images inlines them as base64). */
export const CHAT_STREAM_MAX_REQUEST_BYTES = 32 * 1024 * 1024;
/** The largest streamed reply; a runaway stream is cut here. */
export const CHAT_STREAM_MAX_BYTES = 16 * 1024 * 1024;
/** The wait for the first byte of the reply: a cold local model loads first. */
export const CHAT_STREAM_FIRST_BYTE_MS = 5 * 60_000;
/** The longest silence once the reply has begun. */
export const CHAT_STREAM_IDLE_MS = 2 * 60_000;
/** Streams open at once; a runaway renderer cannot open more. */
export const CHAT_STREAM_MAX_OPEN = 8;

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const CHAT_PATH_RE = /\/(chat\/completions|api\/chat)$/;

export interface ChatStreamRequest {
  id: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export type ChatStreamEvent =
  | { id: string; kind: 'data'; chunk: string }
  | { id: string; kind: 'end' }
  | { id: string; kind: 'error'; message: string };

function refuse(reason: string): never {
  throw new Error(`blocked: ${reason}`);
}

/** The renderer's request, field by field; anything off-shape is refused. */
export function chatStreamRequest(v: unknown): ChatStreamRequest {
  if (!v || typeof v !== 'object' || Array.isArray(v)) refuse('the request must be an object');
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID_RE.test(o.id)) refuse('the request id is not valid');
  if (typeof o.url !== 'string') refuse('the address must be a string');
  if (typeof o.body !== 'string') refuse('the body must be a string');
  if (Buffer.byteLength(o.body, 'utf8') > CHAT_STREAM_MAX_REQUEST_BYTES) {
    refuse('the request is too large');
  }
  const headers: Record<string, string> = {};
  if (o.headers !== undefined) {
    if (!o.headers || typeof o.headers !== 'object' || Array.isArray(o.headers)) {
      refuse('the headers must be an object');
    }
    for (const [k, val] of Object.entries(o.headers as Record<string, unknown>)) {
      if (typeof val !== 'string') refuse(`the header ${k} must be a string`);
      if (CHAT_STREAM_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = val;
    }
  }
  chatTargetUrl(o.url);
  return { id: o.id, url: o.url, headers, body: o.body };
}

/** The address, if it is one this channel may call at all: http or https, no
 *  credentials in it, and a chat path. Where it resolves is checked later. */
export function chatTargetUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return refuse('that is not a web address');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') refuse('only http and https are allowed');
  if (u.username || u.password) refuse('an address with a login in it is not allowed');
  if (!CHAT_PATH_RE.test(u.pathname)) {
    refuse('this channel only calls a chat endpoint (/chat/completions or /api/chat)');
  }
  return u;
}

/** Where an address sits: a public host, your own network (loopback, the
 *  LAN, the Tailscale range), or a range nothing here should call
 *  (unspecified, link-local, where a cloud machine's metadata service
 *  answers, multicast, reserved, benchmarking, translation). */
export function addressKind(ip: string): 'public' | 'local' | 'refused' {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split('.').map(Number) as [number, number, number, number];
    if (a === 127 || a === 10) return 'local';
    if (a === 192 && b === 168) return 'local';
    if (a === 172 && b >= 16 && b <= 31) return 'local';
    if (a === 169 && b === 254) return 'refused';
    if (a === 100 && b >= 64 && b <= 127) return 'local';
    if (a === 0) return 'refused';
    if (a === 192 && b === 0 && c === 0) return 'refused';
    if (a === 198 && (b === 18 || b === 19)) return 'refused';
    if (a >= 224) return 'refused';
    return 'public';
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return 'local';
    if (lower === '::') return 'refused';
    if (lower.startsWith('::ffff:')) return addressKind(lower.slice(7));
    if (/^fe[89ab]/.test(lower)) return 'refused';
    if (lower.startsWith('fc') || lower.startsWith('fd')) return 'local';
    if (/^fe[c-f]/.test(lower) || lower.startsWith('ff')) return 'refused';
    if (lower.startsWith('64:ff9b:') || lower.startsWith('0064:ff9b:')) return 'refused';
    return 'public';
  }
  return 'refused';
}

export type Resolve = (host: string) => Promise<LookupAddress[]>;

const systemResolve: Resolve = (host) => dnsLookup(host, { all: true });

/** Resolve the host once, judge every address it maps to, and return the one
 *  the connection is pinned to. Plain http reaches only your own network; https
 *  reaches a public host or your own network, never a mix (a name that answers
 *  both ways is a rebinding trick). */
export async function vetChatTarget(
  u: URL,
  resolve: Resolve = systemResolve,
): Promise<LookupAddress> {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(host);
  const addrs: LookupAddress[] = family
    ? [{ address: host, family }]
    : await resolve(host).catch(() => [] as LookupAddress[]);
  if (!addrs.length) refuse('that server could not be found');
  const kinds = new Set(addrs.map((a) => addressKind(a.address)));
  if (kinds.has('refused')) refuse('that address is not one a model server can use');
  if (kinds.size > 1) refuse('that name points both at your own network and outside it');
  const kind = [...kinds][0];
  if (u.protocol === 'http:' && kind !== 'local') {
    refuse('plain http only reaches a server on your own network; use https for anything else');
  }
  return addrs[0]!;
}

interface Open {
  req?: ClientRequest;
  res?: IncomingMessage;
  timer?: ReturnType<typeof setTimeout>;
  done: boolean;
  /** Settles the renderer's call while the response head has not come. */
  refuseHead?: (reason: string) => void;
}

/** Every open stream, keyed by the renderer's id. */
export class ChatStreams {
  private open = new Map<string, Open>();

  constructor(
    private readonly send: (event: ChatStreamEvent) => void,
    private readonly resolve: Resolve = systemResolve,
    private readonly limits = {
      firstByteMs: CHAT_STREAM_FIRST_BYTE_MS,
      idleMs: CHAT_STREAM_IDLE_MS,
      maxBytes: CHAT_STREAM_MAX_BYTES,
    },
  ) {}

  /** Streams open right now. */
  get size(): number {
    return this.open.size;
  }

  /** Start one request. Resolves with the status once the response head
   *  arrives; the body follows as events. Rejects (and sends nothing) when the
   *  request is refused, stopped, or the server cannot be reached before its
   *  head. */
  async start(raw: unknown): Promise<{ status: number }> {
    const r = chatStreamRequest(raw);
    if (this.open.has(r.id)) refuse('that request id is already streaming');
    if (this.open.size >= CHAT_STREAM_MAX_OPEN) refuse('too many replies are streaming at once');
    const u = chatTargetUrl(r.url);
    // Held from here, so a Stop that lands while the name resolves is kept.
    const entry: Open = { done: false };
    this.open.set(r.id, entry);
    let pinned: LookupAddress;
    try {
      pinned = await vetChatTarget(u, this.resolve);
    } catch (err) {
      this.clear(r.id);
      throw err;
    }
    if (entry.done) refuse('stopped');
    return new Promise((resolveHead, rejectHead) => {
      let headed = false;
      entry.refuseHead = (reason) => {
        if (!headed) rejectHead(new Error(`blocked: ${reason}`));
      };
      const pinnedLookup = (
        _hostname: string,
        options: LookupOptions,
        cb: (
          err: NodeJS.ErrnoException | null,
          address: string | LookupAddress[],
          family?: number,
        ) => void,
      ): void => {
        if (options.all) cb(null, [pinned]);
        else cb(null, pinned.address, pinned.family);
      };
      const fail = (message: string) => {
        if (entry.done) return;
        entry.done = true;
        this.clear(r.id);
        entry.req?.destroy();
        entry.res?.destroy();
        if (!headed) rejectHead(new Error(`blocked: ${message}`));
        else this.send({ id: r.id, kind: 'error', message });
      };
      const arm = (ms: number, message: string) => {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => fail(message), ms);
      };
      const hostname = u.hostname.replace(/^\[|\]$/g, '');
      const options = {
        hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          ...r.headers,
          'content-length': String(Buffer.byteLength(r.body, 'utf8')),
        },
        lookup: pinnedLookup,
      };
      const onResponse = (res: IncomingMessage) => {
        entry.res = res;
        if (entry.done) {
          res.destroy();
          return;
        }
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          fail('the server tried to redirect the request, and this channel never follows one');
          return;
        }
        headed = true;
        resolveHead({ status });
        const decoder = new StringDecoder('utf8');
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          if (entry.done) return;
          total += chunk.length;
          if (total > this.limits.maxBytes) {
            fail('the reply was larger than this app accepts');
            return;
          }
          // The first byte is in: from here the limit is silence, not load.
          arm(this.limits.idleMs, 'the model went quiet for 2 minutes');
          const text = decoder.write(chunk);
          if (text) this.send({ id: r.id, kind: 'data', chunk: text });
        });
        res.on('end', () => {
          if (entry.done) return;
          entry.done = true;
          this.clear(r.id);
          const tail = decoder.end();
          if (tail) this.send({ id: r.id, kind: 'data', chunk: tail });
          this.send({ id: r.id, kind: 'end' });
        });
        res.on('error', (err) => fail(err.message || 'the connection dropped'));
        res.on('close', () => {
          if (!entry.done) fail('the connection dropped before the reply finished');
        });
      };
      entry.req =
        u.protocol === 'https:'
          ? httpsRequest({ ...options, servername: hostname }, onResponse)
          : httpRequest(options, onResponse);
      // A cold local model loads before it says anything: five minutes for
      // the first byte, counted from the request.
      arm(this.limits.firstByteMs, 'the model did not start answering within 5 minutes');
      entry.req.on('error', (err) => fail(err.message || 'the server could not be reached'));
      entry.req.end(r.body);
    });
  }

  /** Stop one stream (the person pressed Stop). Nothing more is sent for it. */
  abort(id: unknown): void {
    if (typeof id !== 'string') return;
    const entry = this.open.get(id);
    if (!entry) return;
    entry.done = true;
    this.clear(id);
    entry.refuseHead?.('stopped');
    entry.req?.destroy();
    entry.res?.destroy();
  }

  /** Stop every stream: the page reloaded, crashed, or closed. */
  closeAll(): void {
    for (const id of [...this.open.keys()]) this.abort(id);
  }

  private clear(id: string): void {
    const entry = this.open.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    this.open.delete(id);
  }
}
