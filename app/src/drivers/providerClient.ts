// One provider client for every network seat (build 2026-09-29, B1): Claude on
// the Anthropic SDK, an address you connect in the Anthropic format on the same
// SDK (2026-10-09), and every OpenAI-compatible endpoint (a connected cloud
// provider, or your own model server, BYOM). Each streams one request as the
// same events, text, thinking, usage and the round's tool calls, and each
// stops the moment the person presses Stop.
//
// The transport is chosen per shell (CTO ruling 7):
// - Electron: a main-process streaming channel (electron/chatStream.ts), since
//   these servers send no CORS headers and httpFetch cannot stream or reach a
//   server on your own network.
// - iPhone: the WebView's own streaming fetch. The request always declares a
//   JSON body, so a server that refuses cross-origin calls fails at the
//   preflight, before it generates a word, and the request goes once through
//   the native shim (whole, not streamed). Never after the first byte, never
//   after a stop.
// - The web build (dev): the streaming fetch.
//
// Thinking is yielded apart from the answer, so a driver shows it only while
// Chain of Thought is on and never copies it into history.
import type Anthropic from '@anthropic-ai/sdk';
import { ThinkTagSplitter, type ThoughtPiece } from 'os-code/protocol';
import { reasoningOf } from '../lib/chainOfThought.js';
import {
  finalizeToolCalls,
  mergeToolCallDeltas,
  type ToolCallAccum,
} from '../lib/codemagicTool.js';
import { bridge, type ChatStreamEvent, type OscodeBridge } from '../lib/electronBridge.js';
import { nativeFetch } from '../lib/nativeFetch.js';
import { platform } from '../lib/platform.js';
import { streamingFetch } from '../lib/streamingFetch.js';

// ---- stopping ---------------------------------------------------------------

/** The error a stopped request unwinds with; drivers read its name as a calm
 *  end, never an error. */
export function abortError(): Error {
  const err = new Error('Stopped.');
  err.name = 'AbortError';
  return err;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** `p`, or an AbortError the moment `signal` fires, whichever comes first. A
 *  call that cannot be cancelled (the native shim, a model load, the consent
 *  sheet) is left to finish on its own; its late answer goes nowhere. */
export function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) {
    p.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** A seat could not answer this request (no key, a refused request, an HTTP
 *  error). `status` is the server's, when one answered. The Stack reads it as
 *  "fall back to the anchor", and a 400, 404 or 422 on a request with tools as
 *  "this server takes no tools". */
export class ProviderUnavailable extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

// ---- events -----------------------------------------------------------------

/** One tool call a round asked for: parsed input (Claude) or the raw JSON
 *  arguments (OpenAI-compatible). */
export interface ProviderToolCall {
  id: string;
  name: string;
  parsed?: Record<string, unknown>;
  raw?: string;
}

/** One source a search-grounded answer cites. */
export interface Citation {
  title: string;
  url: string;
  snippet: string;
}

export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  /** The sources a search-grounded reply cited (Perplexity's Sonar), said
   *  once before the round ends; a reply with none says nothing. */
  | { type: 'sources'; citations: Citation[] }
  /** The round is over: its answer text (thinking left out), the tool calls
   *  it asked for, the assistant turn to replay before the tool results, and
   *  why the model stopped when the server says (Claude's `stop_reason`). */
  | {
      type: 'done';
      text: string;
      toolCalls: ProviderToolCall[];
      replay: unknown;
      stopReason?: string;
    };

/** One seat's client: `stream` sends one request and yields what comes back. */
export interface ProviderClient<M, T> {
  stream(messages: M[], tools: T[], signal?: AbortSignal): AsyncGenerator<ProviderEvent>;
}

// ---- a small async queue -----------------------------------------------------

/** Values pushed from callbacks, read as an async iterable. */
class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiting?: { resolve: (r: IteratorResult<T>) => void; reject: (e: unknown) => void };
  private ended = false;
  private failure?: { err: unknown };

  push(item: T): void {
    if (this.ended || this.failure) return;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = undefined;
      w.resolve({ value: item, done: false });
    } else this.items.push(item);
  }

  end(): void {
    if (this.ended || this.failure) return;
    this.ended = true;
    if (this.waiting && !this.items.length) {
      const w = this.waiting;
      this.waiting = undefined;
      w.resolve({ value: undefined as never, done: true });
    }
  }

  fail(err: unknown): void {
    if (this.ended || this.failure) return;
    this.failure = { err };
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = undefined;
      w.reject(err);
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
    if (this.failure) return Promise.reject(this.failure.err);
    if (this.ended) return Promise.resolve({ value: undefined as never, done: true });
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}

/** Iterate `source`, unwinding the moment `signal` fires. */
async function* abortable<T>(source: AsyncIterable<T>, signal?: AbortSignal): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      const r = await raceAbort(it.next(), signal);
      if (r.done) return;
      yield r.value;
    }
  } finally {
    void it.return?.()?.catch?.(() => undefined);
  }
}

// ---- Claude -----------------------------------------------------------------

/** The per-request fields a Claude seat sends besides the messages and tools:
 *  the model, its token budget and thinking, the system prompt, and the
 *  history cache marker. */
export type AnthropicRequest = Omit<Anthropic.MessageStreamParams, 'messages' | 'tools' | 'stream'>;

/** An address the person connected in the Anthropic format (2026-10-09), as
 *  its client needs it: the name a refusal is said in, so a failure there
 *  reads as that address's, never as Claude's. */
export interface AnthropicAddress {
  label: string;
}

/** What went wrong at an address, as the Stack reads every seat's failure: a
 *  status the server answered (so a 400, 404 or 422 on a round with tools
 *  reads as "takes no tools"), or no answer at all. A stop stays a stop. */
function addressFailure(err: unknown, label: string): Error {
  if (isAbortError(err) || (err instanceof Error && err.name === 'APIUserAbortError')) {
    return abortError();
  }
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') {
    return new ProviderUnavailable(`${label} answered ${status}.`, status);
  }
  return new ProviderUnavailable(`Could not reach ${label}.`);
}

export function anthropicClient(
  client: Anthropic,
  request: AnthropicRequest,
  address?: AnthropicAddress,
): ProviderClient<Anthropic.MessageParam, Anthropic.Tool> {
  return {
    async *stream(messages, tools, signal) {
      if (signal?.aborted) throw abortError();
      const queue = new AsyncQueue<ProviderEvent>();
      const stream = client.messages.stream(
        {
          ...request,
          messages,
          ...(tools.length ? { tools } : {}),
        } as Anthropic.MessageStreamParams,
        { signal },
      );
      let text = '';
      // An address is prompted to think in tags, like any model that does not
      // reason through its own API, so its text is split here; Claude's own
      // thinking arrives on its own event and needs no splitting.
      const splitter = address ? new ThinkTagSplitter() : undefined;
      const say = (ps: ThoughtPiece[]) => {
        for (const p of ps) {
          if (!p.text) continue;
          if (p.kind === 'text') {
            text += p.text;
            queue.push({ type: 'text', text: p.text });
          } else queue.push({ type: 'thinking', text: p.text });
        }
      };
      stream.on('thinking', (delta: string) => {
        if (delta) queue.push({ type: 'thinking', text: delta });
      });
      stream.on('text', (delta: string) => {
        if (!delta) return;
        if (splitter) {
          say(splitter.push(delta));
          return;
        }
        text += delta;
        queue.push({ type: 'text', text: delta });
      });
      stream.finalMessage().then(
        (final) => {
          if (splitter) say(splitter.end());
          const usage = final.usage;
          if (usage) {
            queue.push({
              type: 'usage',
              inputTokens: usage.input_tokens ?? 0,
              outputTokens: usage.output_tokens ?? 0,
            });
          }
          const toolCalls = (final.content ?? [])
            .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
            .map((b) => ({
              id: b.id,
              name: b.name,
              parsed: (b.input ?? {}) as Record<string, unknown>,
            }));
          // An address replays the thinking blocks it sent as they came (a
          // server that always thinks, though it was asked for none, may want
          // them back with its tool calls, as Claude does), then its answer
          // with the thought it wrote in tags left out, then its tool calls.
          const blocks = final.content ?? [];
          const replay = address
            ? [
                ...blocks.filter((b) => b.type === 'thinking' || b.type === 'redacted_thinking'),
                ...(text ? [{ type: 'text' as const, text }] : []),
                ...blocks.filter((b) => b.type === 'tool_use'),
              ]
            : final.content;
          queue.push({
            type: 'done',
            text,
            toolCalls,
            replay,
            ...(final.stop_reason ? { stopReason: final.stop_reason } : {}),
          });
          queue.end();
        },
        (err: unknown) => queue.fail(address ? addressFailure(err, address.label) : err),
      );
      yield* abortable(queue, signal);
    },
  };
}

// ---- OpenAI-compatible ------------------------------------------------------

/** One OpenAI-compatible seat: a connected cloud provider or your own server. */
export interface OpenAiSeat {
  /** Names the source in an error ("Ollama answered 500."). */
  label: string;
  /** The base URL, without /chat/completions. */
  baseUrl: string;
  key?: string;
  model: string;
  extraHeaders?: Record<string, string>;
  /** Ollama's num_ctx, sent only to an Ollama endpoint and only when set.
   *  Nothing on the app side sets it today, so no request carries it (CTO
   *  ruling 5: the served window's default flips only on an eval). */
  numCtx?: number;
  /** Ask a streamed reply to report its usage in its last chunk
   *  (`stream_options.include_usage`). Only a connected cloud provider asks,
   *  where the context meter reads it; a whole reply reports usage anyway,
   *  and a provider refuses the option on a request that does not stream. */
  streamUsage?: boolean;
}

export type OaiMessage = Record<string, unknown>;

/** An Ollama server: its default port, or its native API path. */
export function isOllamaBase(baseUrl: string): boolean {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`);
    return u.port === '11434' || /\/api\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** The request body for one round. `stream` is false only on the native
 *  shim, which cannot stream. */
export function openAiBody(
  seat: OpenAiSeat,
  messages: OaiMessage[],
  tools: unknown[],
  stream: boolean,
): string {
  const numCtx =
    seat.numCtx !== undefined && Number.isFinite(seat.numCtx) && seat.numCtx > 0
      ? Math.floor(seat.numCtx)
      : undefined;
  return JSON.stringify({
    model: seat.model,
    stream,
    messages,
    ...(stream && seat.streamUsage ? { stream_options: { include_usage: true } } : {}),
    ...(tools.length ? { tools } : {}),
    ...(numCtx !== undefined && isOllamaBase(seat.baseUrl) ? { options: { num_ctx: numCtx } } : {}),
  });
}

/** Perplexity's Sonar grounds its answer in a live web search and sends the
 *  sources as top-level fields outside the OpenAI schema: `search_results`
 *  (title, url, snippet) on current replies, or a bare `citations` URL list
 *  on older ones. Every other provider sends neither, so this reads nothing
 *  for them. Read defensively, never throwing on a missing field. */
export function sonarCitations(raw: unknown): Citation[] {
  const data = (raw && typeof raw === 'object' ? raw : {}) as {
    citations?: unknown;
    search_results?: unknown;
  };
  const results: unknown[] = Array.isArray(data.search_results) ? data.search_results : [];
  const fromResults = results
    .filter((r): r is { url: string; title?: unknown; snippet?: unknown } => {
      const url = (r as { url?: unknown } | null)?.url;
      return typeof url === 'string' && url.length > 0;
    })
    .map((r) => ({
      title: typeof r.title === 'string' && r.title ? r.title : hostOfUrl(r.url),
      url: r.url,
      snippet: typeof r.snippet === 'string' ? r.snippet : '',
    }));
  if (fromResults.length) return fromResults;
  const urls: unknown[] = Array.isArray(data.citations) ? data.citations : [];
  return urls
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map((url) => ({ title: hostOfUrl(url), url, snippet: '' }));
}

/** The host of a URL, for a readable citation title; the raw string on a
 *  malformed URL rather than throwing. */
function hostOfUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function openAiCompatibleClient(seat: OpenAiSeat): ProviderClient<OaiMessage, unknown> {
  return {
    async *stream(messages, tools, signal) {
      if (signal?.aborted) throw abortError();
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(seat.extraHeaders ?? {}),
      };
      if (seat.key) headers.authorization = `Bearer ${seat.key}`;
      const opened = await openChatStream({
        url: `${seat.baseUrl}/chat/completions`,
        headers,
        body: (stream) => openAiBody(seat, messages, tools, stream),
        signal,
      });
      if (opened.status < 200 || opened.status >= 300) {
        opened.discard?.();
        throw new ProviderUnavailable(`${seat.label} answered ${opened.status}.`, opened.status);
      }
      if (opened.chunks) yield* readSse(abortable(opened.chunks, signal));
      else yield* readWhole(opened.json);
    },
  };
}

/** Text and thinking out of one slice of a reply, the <think> tags split off. */
function* pieces(ps: ThoughtPiece[], keep: (t: string) => void): Generator<ProviderEvent> {
  for (const p of ps) {
    if (!p.text) continue;
    if (p.kind === 'text') {
      keep(p.text);
      yield { type: 'text', text: p.text };
    } else yield { type: 'thinking', text: p.text };
  }
}

function usageOf(raw: unknown): ProviderEvent | undefined {
  const u = raw as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
  if (!u || typeof u !== 'object') return undefined;
  const input = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : undefined;
  const output = typeof u.completion_tokens === 'number' ? u.completion_tokens : undefined;
  if (input === undefined && output === undefined) return undefined;
  return { type: 'usage', inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

/** A streamed (Server-Sent Events) reply. */
async function* readSse(chunks: AsyncIterable<string>): AsyncGenerator<ProviderEvent> {
  const splitter = new ThinkTagSplitter();
  const acc = new Map<number, ToolCallAccum>();
  let text = '';
  let usage: ProviderEvent | undefined;
  // A DeepSeek-style reasoner's reasoning_content, kept whole for the tool
  // round's replay (replayReasoning).
  let reasoning = '';
  // Sonar sends its sources with the stream (often on every chunk); the last
  // set it sent is the one said, once, at the end.
  let sources: Citation[] = [];
  const keep = (t: string) => {
    text += t;
  };
  let buffer = '';
  function* line(raw: string): Generator<ProviderEvent> {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let chunk: { choices?: Array<Record<string, any>>; usage?: unknown };
    try {
      chunk = JSON.parse(payload);
    } catch {
      return; // a keepalive or a partial line
    }
    const choice = chunk?.choices?.[0];
    const thought = reasoningOf(choice?.delta);
    if (thought) yield { type: 'thinking', text: thought };
    const rc = choice?.delta?.reasoning_content;
    if (typeof rc === 'string') reasoning += rc;
    const part = contentParts(choice?.delta?.content);
    if (part.thinking) yield { type: 'thinking', text: part.thinking };
    if (part.text) yield* pieces(splitter.push(part.text), keep);
    mergeToolCallDeltas(acc, choice?.delta?.tool_calls);
    usage = usageOf(chunk?.usage) ?? usage;
    const cited = sonarCitations(chunk);
    if (cited.length) sources = cited;
  }
  for await (const chunk of chunks) {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const l of lines) yield* line(l);
  }
  if (buffer) yield* line(buffer);
  yield* pieces(splitter.end(), keep);
  if (sources.length) yield { type: 'sources', citations: sources };
  if (usage) yield usage;
  const calls = finalizeToolCalls(acc);
  const replay: Record<string, unknown> = calls.length
    ? {
        role: 'assistant',
        content: text || null,
        ...replayReasoning(reasoning),
        tool_calls: calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.args },
        })),
      }
    : { role: 'assistant', content: text };
  yield {
    type: 'done',
    text,
    toolCalls: calls.map((tc) => ({ id: tc.id, name: tc.name, raw: tc.args })),
    replay,
  };
}

/** A whole reply from the native shim, yielded as the same events. */
async function* readWhole(json: unknown): AsyncGenerator<ProviderEvent> {
  const data = json as {
    choices?: Array<{
      message?: {
        content?: unknown;
        reasoning_content?: unknown;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
    usage?: unknown;
  };
  const msg = data?.choices?.[0]?.message;
  let text = '';
  const keep = (t: string) => {
    text += t;
  };
  const thought = reasoningOf(msg);
  if (thought) yield { type: 'thinking', text: thought };
  const part = contentParts(msg?.content);
  if (part.thinking) yield { type: 'thinking', text: part.thinking };
  if (part.text) {
    const splitter = new ThinkTagSplitter();
    yield* pieces([...splitter.push(part.text), ...splitter.end()], keep);
  }
  const sources = sonarCitations(data);
  if (sources.length) yield { type: 'sources', citations: sources };
  const usage = usageOf(data?.usage);
  if (usage) yield usage;
  const raw = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
  const content = part.text;
  yield {
    type: 'done',
    text,
    toolCalls: raw.map((tc) => ({ id: tc.id, name: tc.function.name, raw: tc.function.arguments })),
    replay: raw.length
      ? {
          role: 'assistant',
          content,
          ...replayReasoning(
            typeof msg?.reasoning_content === 'string' ? msg.reasoning_content : '',
          ),
          tool_calls: raw,
        }
      : { role: 'assistant', content },
  };
}

/** A reply's content, as a string or as the chunks Mistral's reasoning
 *  models send (2026-10-09): a thinking chunk, then a text chunk. Text chunks
 *  are the answer; a thinking chunk is thinking, never the answer, and is not
 *  replayed. Anything else in the array is left out. */
function contentParts(content: unknown): { text: string; thinking: string } {
  if (typeof content === 'string') return { text: content, thinking: '' };
  let text = '';
  let thinking = '';
  if (!Array.isArray(content)) return { text, thinking };
  for (const raw of content) {
    const c = (raw ?? {}) as { type?: unknown; text?: unknown; thinking?: unknown };
    if (c.type === 'text' && typeof c.text === 'string') text += c.text;
    else if (c.type === 'thinking') thinking += chunkText(c.thinking);
  }
  return { text, thinking };
}

/** A thinking chunk's words: a string, or its own list of text chunks. */
function chunkText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!Array.isArray(v)) return '';
  return v
    .map((x) => (typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : ''))
    .join('');
}

/** The reasoning a tool round's replay carries back: DeepSeek's thinking
 *  mode answers 400 when a tool call's assistant message comes back without
 *  its reasoning_content (2026-10-09). Only that field, only when the reply
 *  sent it, and only on the replay inside the turn: it never joins the
 *  answer or the history a later turn sends. A server that sends `reasoning`
 *  instead is sent nothing new. */
function replayReasoning(reasoning: string): { reasoning_content?: string } {
  return reasoning ? { reasoning_content: reasoning } : {};
}

// ---- transport ----------------------------------------------------------------

/** An opened request: its status, and either a streamed body (text chunks) or
 *  a whole JSON body (the native shim). `discard` lets go of a body nobody
 *  will read (an error status). */
export interface OpenedChatStream {
  status: number;
  chunks?: AsyncIterable<string>;
  json?: unknown;
  discard?: () => void;
}

export interface ChatStreamSpec {
  url: string;
  headers: Record<string, string>;
  /** The body for a streamed request (`true`) or the shim's whole one. */
  body: (stream: boolean) => string;
  signal?: AbortSignal;
}

let requestSeq = 0;

/** A fresh id for one request, so a stopped request's late data is dropped
 *  by id, never mixed into the next answer. */
export function newRequestId(): string {
  return `chat_${Date.now().toString(36)}_${(requestSeq++).toString(36)}`;
}

/** Open one chat request on this shell's transport. */
export async function openChatStream(spec: ChatStreamSpec): Promise<OpenedChatStream> {
  if (spec.signal?.aborted) throw abortError();
  const where = platform();
  if (where === 'electron') {
    const b = bridge();
    if (b?.chatStream) return openIpc(b, spec);
  }
  if (where === 'ios') return openWithShimFallback(spec);
  return openFetch(spec);
}

/** The streaming fetch (web, and the iPhone's first try). */
async function openFetch(spec: ChatStreamSpec): Promise<OpenedChatStream> {
  const res = await streamingFetch(spec.url, {
    method: 'POST',
    headers: spec.headers,
    body: spec.body(true),
    signal: spec.signal,
  });
  if (!res.body) {
    return { status: res.ok ? 502 : res.status };
  }
  const body = res.body;
  return {
    status: res.status,
    chunks: readBody(body),
    discard: () => void body.cancel().catch(() => undefined),
  };
}

async function* readBody(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) yield text;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

/** The iPhone: stream through the WebView's fetch; a server that refuses the
 *  cross-origin call fails at the preflight (no byte, no generation), and the
 *  request goes once through the native shim instead. A stop, or any failure
 *  after the response began, is never retried. */
async function openWithShimFallback(spec: ChatStreamSpec): Promise<OpenedChatStream> {
  try {
    return await openFetch(spec);
  } catch (err) {
    if (spec.signal?.aborted || isAbortError(err)) throw abortError();
    if (!(err instanceof TypeError)) throw err;
  }
  const res = await raceAbort(
    nativeFetch(spec.url, { method: 'POST', headers: spec.headers, body: spec.body(false) }),
    spec.signal,
  );
  if (!res.ok) return { status: res.status };
  return { status: res.status, json: await raceAbort(res.json(), spec.signal) };
}

// The Electron channel: one listener for every stream, routed by id. An id
// that is no longer here (stopped, finished) has its late data dropped.
const ipcSinks = new Map<string, (event: ChatStreamEvent) => void>();
let ipcBridge: OscodeBridge | undefined;

function listenIpc(b: OscodeBridge): void {
  if (ipcBridge === b) return;
  ipcBridge = b;
  b.onChatStream((event) => ipcSinks.get(event.id)?.(event));
}

/** The words main refused a request with, without the IPC wrapping. */
function ipcRefusal(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const at = text.indexOf('blocked: ');
  return at >= 0 ? text.slice(at + 'blocked: '.length) : text;
}

async function openIpc(b: OscodeBridge, spec: ChatStreamSpec): Promise<OpenedChatStream> {
  listenIpc(b);
  const id = newRequestId();
  const queue = new AsyncQueue<string>();
  const close = () => {
    ipcSinks.delete(id);
    spec.signal?.removeEventListener('abort', onAbort);
  };
  const onAbort = () => {
    close();
    void b.chatStreamAbort(id).catch(() => undefined);
    queue.fail(abortError());
  };
  ipcSinks.set(id, (event) => {
    if (event.kind === 'data') queue.push(event.chunk);
    else if (event.kind === 'end') {
      close();
      queue.end();
    } else {
      close();
      queue.fail(new ProviderUnavailable(event.message));
    }
  });
  spec.signal?.addEventListener('abort', onAbort, { once: true });
  let head: { status: number };
  try {
    head = await raceAbort(
      b.chatStream({ id, url: spec.url, headers: spec.headers, body: spec.body(true) }),
      spec.signal,
    );
  } catch (err) {
    close();
    if (isAbortError(err)) throw err;
    throw new ProviderUnavailable(ipcRefusal(err));
  }
  return {
    status: head.status,
    chunks: queue,
    discard: () => {
      close();
      void b.chatStreamAbort(id).catch(() => undefined);
    },
  };
}

// ---- the wait before the first word ------------------------------------------

/** How long a local model may sit silent before the chat says it can be slow
 *  to start (CX ruling 5). */
export const SLOW_START_MS = 30_000;

/** The working row's line while a model on your computer loads (CX 5). */
export function warmingLine(model: string): string {
  return `Warming up ${model} on your computer.`;
}

/** Said once, after SLOW_START_MS with no word from a local model (CX 5). */
export const SLOW_START_LINE =
  'Models on your own computer can be slow to start. You can stop it any time.';

/** A one-shot timer for the first word: `onSlow` runs once when no word has
 *  come by `ms`; a word, or `stop`, disarms it. */
export function watchFirstWord(
  onSlow: () => void,
  ms = SLOW_START_MS,
): { word(): void; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    timer = undefined;
    onSlow();
  }, ms);
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return { word: stop, stop };
}
