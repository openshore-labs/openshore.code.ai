// The local workhorse. One provider speaks to Ollama, LM Studio, llama.cpp,
// and vLLM. Ollama gets its native /api/chat (tools, images, structured
// output, keep_alive); everything else gets /v1/chat/completions with SSE.
import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ContentPart,
  EmbeddingProvider,
  MoreRoom,
  Provider,
  ProviderCapabilities,
  ToolCallRequest,
} from './types.js';
import { ProviderError } from './types.js';
import type { OpenAICompatibleEndpoint } from '../config/schema.js';
import {
  defaultContextTokens,
  looksVisionCapable,
  probeBackend,
  type BackendProfile,
} from './capabilities.js';
import type { CapabilityCategory } from '../router/roles.js';
import { logger } from '../util/log.js';
import { isLocalUrl } from '../core/security/egress.js';
import { idleError, idleGuard, type IdleGuard } from './streamIdle.js';
import { deriveModelClass, servedContextTokens } from '../harness/profile.js';
import { hostRamGB } from './hostMemory.js';
import { getCredential } from '../auth/store.js';
import { isProviderKeyRef } from '../config/providerKeyRef.js';
import { extraGB, hasMoreRoom, kvBytesPerToken, ollamaDefaultNumCtx } from './servedWindow.js';

const log = logger('openai-compatible');

/** OpenAI's reasoning models, which take only the default temperature. */
const OPENAI_REASONING_MODEL = /^(?:gpt-5|o\d)/i;

/** What a provider's API is treated as: OpenAI-compatible, native tools, no
 *  grammar decoding (validate and repair applies). */
const GENERIC_BACKEND: BackendProfile = {
  flavor: 'generic',
  grammar: false,
  nativeTools: true,
  label: 'OpenAI-compatible API',
};

interface ShowInfo {
  contextTokens?: number;
  /** The `num_ctx` the model's Modelfile sets (the /api/show parameters
   *  block), which Ollama serves when a request names none. */
  modelfileNumCtx?: number;
  /** Bytes one token of context holds (from model_info), for what a larger
   *  window costs. */
  kvBytesPerToken?: number;
  vision?: boolean;
  toolCapable?: boolean;
  /** Ollama reports "thinking" for a model that takes the think flag. */
  thinking?: boolean;
}

/** Construction options. Everything here has a production default; tests
 *  inject to pin a value. */
export interface OpenAICompatibleOptions {
  /** This computer's memory in GB, for the served window's ceiling (tech review I1).
   *  Defaults to `hostRamGB`, read once per process. */
  ramGB?: () => number;
}

/** The credential store entry that holds the key a config names by variable.
 *  The desktop's Connect ChatGPT writes the key here and points the provider
 *  at OPENAI_API_KEY; nothing puts it in this process's environment (a child
 *  shell would inherit it), so after a relaunch the store is where it lives.
 *  Named one by one, so a config naming some other variable never reads an
 *  unrelated credential out of the store. */
const CREDENTIAL_FOR_ENV: Readonly<Record<string, string>> = {
  OPENAI_API_KEY: 'openai-api-key',
};

/** The key an endpoint sends: its variable from the environment when it is
 *  set, else the credential store entry that stands in for that variable,
 *  else the store entry its `apiKeyRef` names (keys on your server,
 *  2026-10-09). A bare variable name reads as `{ apiKeyEnv }`. */
export function endpointApiKey(
  source: string | undefined | Pick<OpenAICompatibleEndpoint, 'apiKeyEnv' | 'apiKeyRef'>,
  env: NodeJS.ProcessEnv = process.env,
  readCredential: (name: string) => string | undefined = getCredential,
): string | undefined {
  const { apiKeyEnv, apiKeyRef } =
    typeof source === 'object' ? source : { apiKeyEnv: source, apiKeyRef: undefined };
  if (apiKeyEnv) {
    const fromEnv = env[apiKeyEnv];
    if (fromEnv) return fromEnv;
    const name = CREDENTIAL_FOR_ENV[apiKeyEnv];
    const stored = name ? readCredential(name) : undefined;
    if (stored) return stored;
  }
  return keyFromRef(apiKeyRef, readCredential);
}

/** The key a `provider-key:<id>` reference names. The namespace is checked
 *  again here, at the read, so a config that got past the schema some other
 *  way still never reads the Claude key, a token or the data key. */
export function keyFromRef(
  ref: string | undefined,
  readCredential: (name: string) => string | undefined = getCredential,
): string | undefined {
  return isProviderKeyRef(ref) ? readCredential(ref) : undefined;
}

export class OpenAICompatibleProvider implements Provider, EmbeddingProvider {
  readonly kind = 'local' as const;
  /** Off this computer's network, by address (see Provider.remote). */
  readonly remote: boolean;
  private showCache = new Map<string, ShowInfo>();
  /** The served window per model, fixed for the process once computed: a
   *  changed `num_ctx` reloads the model in Ollama (tech review I1), and without one
   *  the Modelfile and the server default hold for the process too. */
  private servedCache = new Map<string, { mode: 'auto' | 'off'; served: number }>();
  private readonly ramGB: () => number;
  /** Models observed to reject native tools; the bridge falls back to JSON-in-text. */
  private toolRejects = new Set<string>();

  constructor(
    readonly id: string,
    private readonly endpoint: OpenAICompatibleEndpoint,
    /** Optional category tags from the stack config / catalog. */
    private readonly categoriesByModel: Record<string, CapabilityCategory[]> = {},
    options: OpenAICompatibleOptions = {},
  ) {
    this.remote = !isLocalUrl(endpoint.baseUrl);
    this.ramGB = options.ramGB ?? hostRamGB;
  }

  get label(): string {
    return this.endpoint.label ?? this.id;
  }

  private get baseUrl(): string {
    return this.endpoint.baseUrl.replace(/\/$/, '');
  }

  /** Whether this endpoint is OpenAI's own API (keys on your server,
   *  2026-10-09), which names two request fields its own way. */
  private get atOpenAi(): boolean {
    try {
      return new URL(this.endpoint.baseUrl).hostname === 'api.openai.com';
    } catch {
      return false;
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const key = endpointApiKey(this.endpoint);
    if (key) headers.authorization = `Bearer ${key}`;
    return headers;
  }

  /** An OpenAI-compatible path on this endpoint: under /v1 unless the base
   *  already carries its version (`versionedBase`). */
  private api(path: '/models' | '/chat/completions' | '/embeddings'): string {
    return `${this.baseUrl}${this.endpoint.versionedBase ? '' : '/v1'}${path}`;
  }

  /** An endpoint `osc key` wrote (`apiKeyRef`), or a versioned base off this
   *  network, is a provider's API, not a model server someone runs: it is
   *  never sent the four unauthenticated probes that tell Ollama from LM
   *  Studio, llama.cpp and vLLM (keys on your server, 2026-10-09). Any other
   *  endpoint, a hand-written one with `apiKeyEnv` at a public address
   *  included, is probed as before, since its flavor sets the window it
   *  serves. */
  private get providerApi(): boolean {
    return (
      this.remote && (Boolean(this.endpoint.apiKeyRef) || this.endpoint.versionedBase === true)
    );
  }

  /** The server's own root, where its native paths live (/api/version,
   *  /api/show, /props, /version): the base itself, or a versioned base
   *  with its trailing /v1 taken off. Undefined for a versioned base with no
   *  such segment, which is then treated as a generic API. */
  private get nativeRoot(): string | undefined {
    if (!this.endpoint.versionedBase) return this.baseUrl;
    const root = this.baseUrl.replace(/\/v\d+$/, '');
    return root === this.baseUrl ? undefined : root;
  }

  async backend(): Promise<BackendProfile> {
    const root = this.nativeRoot;
    if (this.providerApi || root === undefined) return GENERIC_BACKEND;
    return probeBackend(root);
  }

  /** A native (non-OpenAI) path on this server; only an Ollama the probe
   *  found reaches one, so the root is known. */
  private native(path: '/api/tags' | '/api/show' | '/api/chat' | '/api/embed'): string {
    return `${this.nativeRoot ?? this.baseUrl}${path}`;
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const backend = await this.backend();
      const models = await this.listModels();
      return {
        ok: true,
        detail: `${backend.label} at ${this.baseUrl}, ${models.length} model${models.length === 1 ? '' : 's'} available`,
      };
    } catch (err) {
      return { ok: false, detail: this.connectHint(err) };
    }
  }

  private connectHint(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|fetch failed|network|abort/i.test(msg)) {
      // The command on its own paragraph, never in the sentence (tenet 9).
      return `Nothing is answering at ${this.baseUrl}. If this is Ollama, start it.\n\nollama serve`;
    }
    return `${this.label} at ${this.baseUrl} answered with an error: ${msg}`;
  }

  async listModels(): Promise<string[]> {
    const backend = await this.backend();
    if (backend.flavor === 'ollama') {
      const res = await fetch(this.native('/api/tags'), { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new ProviderError(this.id, `GET /api/tags returned ${res.status}`);
      const body = (await res.json()) as { models?: Array<{ name: string }> };
      return (body.models ?? []).map((m) => m.name);
    }
    const res = await fetch(this.api('/models'), {
      headers: this.headers(),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new ProviderError(this.id, `GET models returned ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id);
  }

  /** Ollama /api/show enriches context length and vision detection. Best effort. */
  private async showInfo(model: string): Promise<ShowInfo> {
    const cached = this.showCache.get(model);
    if (cached) return cached;
    const info: ShowInfo = {};
    try {
      const backend = await this.backend();
      if (backend.flavor === 'ollama') {
        const res = await fetch(this.native('/api/show'), {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ model }),
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const body = (await res.json()) as {
            model_info?: Record<string, unknown>;
            parameters?: unknown;
            capabilities?: string[];
            details?: { families?: string[] };
          };
          const modelInfo = body.model_info ?? {};
          for (const [k, v] of Object.entries(modelInfo)) {
            if (k.endsWith('.context_length') && typeof v === 'number') info.contextTokens = v;
          }
          const kv = kvBytesPerToken(modelInfo);
          if (kv !== undefined) info.kvBytesPerToken = kv;
          // The parameters block is the Modelfile's PARAMETER lines as text,
          // one "name value" per line. Absent or unparseable leaves the server
          // default in force.
          if (typeof body.parameters === 'string') {
            const numCtx = /^\s*num_ctx\s+(\d+)\s*$/m.exec(body.parameters);
            if (numCtx && Number(numCtx[1]) > 0) info.modelfileNumCtx = Number(numCtx[1]);
          }
          const caps = body.capabilities ?? [];
          const families = body.details?.families ?? [];
          if (caps.includes('vision') || families.includes('clip') || families.includes('mllama')) {
            info.vision = true;
          }
          if (caps.length > 0) info.toolCapable = caps.includes('tools');
          if (caps.includes('thinking')) info.thinking = true;
        }
      }
    } catch (err) {
      log.debug('show probe failed', { model, err: String(err) });
    }
    this.showCache.set(model, info);
    return info;
  }

  /** Whether this endpoint asks Ollama for a window: set to 'auto' in config,
   *  or given more room by the person since the process started (the
   *  truncation card's action, which also wrote 'auto' to machine config). */
  private get numCtxMode(): 'auto' | 'off' {
    return this.endpoint.numCtx === 'auto' || hasMoreRoom(this.endpoint.baseUrl) ? 'auto' : 'off';
  }

  /** The window to ask Ollama for (`options.num_ctx`), or undefined when this
   *  endpoint sends none: `numCtx` unset or 'off', or a backend other than
   *  Ollama (llama.cpp and vLLM fix the window at start). With 'auto' it is
   *  the served window, the one number the request and the budget share. */
  private async requestedWindow(
    model: string,
    backend: BackendProfile,
  ): Promise<number | undefined> {
    if (this.numCtxMode !== 'auto' || backend.flavor !== 'ollama') return undefined;
    return this.servedWindow(model, backend);
  }

  /** The window Ollama actually serves `model`, or undefined on a backend
   *  other than Ollama (its window is whatever it was started with, which we
   *  cannot read, so the model's own stands in as before). With `numCtx:
   *  'auto'`, the lower of the model's own window and the per-class ceiling
   *  for this computer's memory (`autoWindow`). Otherwise what Ollama serves a
   *  request that names none: the Modelfile's `num_ctx`, else the default for
   *  that Ollama version, never more than the model's own. Budgeting against
   *  the model's own window instead let a 32k budget run into a 4k server that
   *  cuts the prompt without a word. Memoized per model and mode: the same
   *  model is always served the same window until the person gives it more. */
  private async servedWindow(model: string, backend: BackendProfile): Promise<number | undefined> {
    if (backend.flavor !== 'ollama') return undefined;
    const mode = this.numCtxMode;
    const cached = this.servedCache.get(model);
    if (cached?.mode === mode) return cached.served;
    const served =
      mode === 'auto'
        ? await this.autoWindow(model)
        : Math.min(
            await this.nativeWindow(model),
            (await this.showInfo(model)).modelfileNumCtx ?? ollamaDefaultNumCtx(backend.version),
          );
    this.servedCache.set(model, { mode, served });
    return served;
  }

  /** The window 'auto' serves: the lower of the model's own and the class
   *  ceiling for this computer's memory. The class comes from the name and
   *  size only, so the window never feeds back into its own class. */
  private async autoWindow(model: string): Promise<number> {
    return servedContextTokens(
      await this.nativeWindow(model),
      deriveModelClass({ model, kind: 'local' }),
      this.ramGB(),
    );
  }

  /** What giving `model` more room would do (the truncation card's action):
   *  'more' when 'auto' would serve it a larger window than it has now on this
   *  computer, 'full' when this computer's memory allows none larger, and
   *  undefined when the window is not ours to set (a backend other than
   *  Ollama). */
  async moreRoom(model: string): Promise<MoreRoom | undefined> {
    const backend = await this.backend();
    const current = await this.servedWindow(model, backend);
    if (current === undefined) return undefined;
    const larger = await this.autoWindow(model);
    if (larger <= current) return { room: 'full' };
    const gb = extraGB(current, larger, (await this.showInfo(model)).kvBytesPerToken);
    return { room: 'more', window: larger, ...(gb !== undefined ? { gb } : {}) };
  }

  /** The model's own window: what Ollama's /api/show says, else, for an
   *  endpoint off this network, the window the app placed it with
   *  (`contextWindows`), else a guess by family. A local server's listed
   *  window is never read: the engine budgets against the one it serves. */
  private async nativeWindow(model: string): Promise<number> {
    const windows = this.remote ? this.endpoint.contextWindows : undefined;
    const listed = windows && Object.hasOwn(windows, model) ? windows[model] : undefined;
    return (await this.showInfo(model)).contextTokens ?? listed ?? defaultContextTokens(model);
  }

  async capabilities(model: string): Promise<ProviderCapabilities> {
    const backend = await this.backend();
    const show = await this.showInfo(model);
    const native = await this.nativeWindow(model);
    const served = await this.servedWindow(model, backend);
    return {
      supportsTools:
        !this.toolRejects.has(model) && backend.nativeTools && show.toolCapable !== false,
      supportsVision: show.vision ?? looksVisionCapable(model),
      supportsGrammar: backend.grammar,
      contextTokens: served ?? native,
      ...(served !== undefined ? { nativeContextTokens: native } : {}),
      costTier: 'free',
      latencyTier: 'standard',
      categories: this.categoriesByModel[model] ?? ['reasoning', 'coding'],
    };
  }

  /** Called by the bridge when a backend rejects native tools for a model. */
  noteToolReject(model: string): void {
    this.toolRejects.add(model);
  }

  async *chat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent, void, void> {
    const backend = await this.backend();
    try {
      if (backend.flavor === 'ollama') {
        yield* this.chatOllama(request, backend, signal);
      } else {
        yield* this.chatOpenAI(request, backend, signal);
      }
    } catch (err) {
      if (signal?.aborted) {
        yield { type: 'done', stopReason: 'aborted' };
        return;
      }
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(this.id, this.connectHint(err), err);
    }
  }

  // -------------------------------------------------------------------------
  // Ollama native path: NDJSON streaming over /api/chat.
  // -------------------------------------------------------------------------

  private async *chatOllama(
    request: ChatRequest,
    backend: BackendProfile,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatEvent, void, void> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(toOllamaMessage),
      stream: true,
    };
    if (request.tools?.length && !this.toolRejects.has(request.model)) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (request.jsonSchema) body.format = request.jsonSchema;
    if (request.keepAlive) body.keep_alive = request.keepAlive;
    // Chain of Thought: a thinking-capable model is told to think or not. Only
    // sent to a model that reports the capability; Ollama refuses the flag on
    // a model without it. Unset leaves Ollama's own default.
    if (request.reasoning && (await this.showInfo(request.model)).thinking) {
      body.think = request.reasoning === 'on';
    }
    const options: Record<string, unknown> = {};
    if (request.temperature !== undefined) options.temperature = request.temperature;
    if (request.maxTokens !== undefined) options.num_predict = request.maxTokens;
    if (request.stop?.length) options.stop = request.stop;
    // The served window (tech review I1). Only with `numCtx: 'auto'`; off leaves the
    // body exactly as it was, so Ollama keeps its own default.
    const numCtx = await this.requestedWindow(request.model, backend);
    if (numCtx !== undefined) options.num_ctx = numCtx;
    if (Object.keys(options).length) body.options = options;

    const guard = idleGuard(signal);
    const res = await this.fetchGuarded(this.native('/api/chat'), body, guard);
    if (!res.ok) {
      guard.stop();
      const text = await res.text();
      if (/does not support tools/i.test(text)) {
        this.noteToolReject(request.model);
        throw new ProviderError(
          this.id,
          `TOOLS_UNSUPPORTED: ${request.model} does not support native tool calls; retrying with the text bridge.`,
        );
      }
      throw new ProviderError(this.id, `Ollama answered ${res.status}: ${truncate(text, 300)}`);
    }

    let sawToolCall = false;
    let callSeq = 0;
    for await (const line of this.ndjsonLines(res, signal, guard)) {
      let chunk: any;
      try {
        chunk = JSON.parse(line);
      } catch {
        continue;
      }
      const msg = chunk.message;
      if (msg?.content) yield { type: 'text', delta: String(msg.content) };
      if (msg?.thinking) yield { type: 'thinking', delta: String(msg.thinking) };
      if (Array.isArray(msg?.tool_calls)) {
        for (const tc of msg.tool_calls) {
          sawToolCall = true;
          const args = tc.function?.arguments ?? {};
          const call: ToolCallRequest = {
            id: tc.id ?? `call_${callSeq++}`,
            name: tc.function?.name ?? '',
            argsText: typeof args === 'string' ? args : JSON.stringify(args),
            args: typeof args === 'object' && args !== null ? args : undefined,
          };
          yield { type: 'tool-call', call };
        }
      }
      if (chunk.done) {
        yield {
          type: 'usage',
          promptTokens: Number(chunk.prompt_eval_count ?? 0),
          completionTokens: Number(chunk.eval_count ?? 0),
        };
        yield { type: 'done', stopReason: sawToolCall ? 'tool-calls' : 'end' };
        return;
      }
    }
    yield { type: 'done', stopReason: signal?.aborted ? 'aborted' : 'end' };
  }

  // -------------------------------------------------------------------------
  // OpenAI-compatible path: SSE streaming over /v1/chat/completions.
  // -------------------------------------------------------------------------

  private async *chatOpenAI(
    request: ChatRequest,
    backend: BackendProfile,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatEvent, void, void> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m, i, all) =>
        toOpenAIMessage(m, i > all.map((x) => x.role).lastIndexOf('user')),
      ),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.tools?.length && !this.toolRejects.has(request.model)) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    // OpenAI's own API refuses `max_tokens` on its reasoning models and any
    // temperature but the default on them (gpt-5, the o series), so there
    // the cap goes as `max_completion_tokens`, which every OpenAI chat model
    // takes, and a reasoning model is sent no temperature.
    const openai = this.atOpenAi;
    const fixedTemperature = openai && OPENAI_REASONING_MODEL.test(request.model);
    if (request.temperature !== undefined && !fixedTemperature) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body[openai ? 'max_completion_tokens' : 'max_tokens'] = request.maxTokens;
    }
    if (request.stop?.length) body.stop = request.stop;
    if (request.jsonSchema) {
      // llama.cpp, vLLM, and LM Studio all take OpenAI-style json_schema.
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'osc_constrained', schema: request.jsonSchema, strict: true },
      };
    }

    const guard = idleGuard(signal);
    const res = await this.fetchGuarded(this.api('/chat/completions'), body, guard);
    if (!res.ok) {
      guard.stop();
      const text = await res.text();
      if (/tool|function/i.test(text) && res.status === 400 && request.tools?.length) {
        this.noteToolReject(request.model);
        throw new ProviderError(
          this.id,
          `TOOLS_UNSUPPORTED: ${request.model} on ${backend.label} rejected native tools; retrying with the text bridge.`,
        );
      }
      throw new ProviderError(
        this.id,
        `${backend.label} answered ${res.status}: ${truncate(text, 300)}`,
      );
    }

    // Accumulate streamed tool-call fragments by index.
    const pending = new Map<number, { id: string; name: string; args: string }>();
    let sawToolCall = false;
    let finish: string | undefined;
    let reasoningContent = '';

    for await (const data of this.sseData(res, signal, guard)) {
      if (data === '[DONE]') break;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.usage) {
        yield {
          type: 'usage',
          promptTokens: Number(chunk.usage.prompt_tokens ?? 0),
          completionTokens: Number(chunk.usage.completion_tokens ?? 0),
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta ?? {};
      // Mistral sends content as chunks (a thinking chunk, then text chunks).
      for (const part of contentParts(delta.content)) yield part;
      // DeepSeek-style servers send reasoning_content; vLLM, OpenRouter, and
      // Ollama's /v1 send reasoning.
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === 'string' && reasoning) yield { type: 'thinking', delta: reasoning };
      if (typeof delta.reasoning_content === 'string') reasoningContent += delta.reasoning_content;
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const slot = pending.get(idx) ?? { id: tc.id ?? `call_${idx}`, name: '', args: '' };
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
          pending.set(idx, slot);
        }
      }
    }

    // C3: on abort the SSE stream is truncated, so the accumulated tool-call
    // fragments are partial. Mirror chatOllama: report the abort and skip the
    // flush rather than emitting a phantom tool-call from a fragment.
    if (signal?.aborted) {
      yield { type: 'done', stopReason: 'aborted' };
      return;
    }

    if (pending.size && reasoningContent) {
      yield { type: 'reasoning-content', text: reasoningContent };
    }
    for (const [, slot] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
      sawToolCall = true;
      yield {
        type: 'tool-call',
        call: { id: slot.id, name: slot.name, argsText: slot.args },
      };
    }
    const stopReason =
      finish === 'length'
        ? 'length'
        : sawToolCall || finish === 'tool_calls'
          ? 'tool-calls'
          : 'end';
    yield { type: 'done', stopReason };
  }

  // -------------------------------------------------------------------------
  // Stream plumbing: one fetch and two line readers, all under the idle guard
  // (DAE-3). A stall surfaces as a ProviderError naming this endpoint; the
  // caller's own abort still reads as an abort (chat() checks its signal).
  // -------------------------------------------------------------------------

  private async fetchGuarded(url: string, body: unknown, guard: IdleGuard): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: guard.signal,
      });
    } catch (err) {
      guard.stop();
      if (guard.idled) throw idleError(this.id, this.stallLabel(), guard.idleMs);
      throw err;
    }
  }

  private stallLabel(): string {
    return `${this.label} (${this.baseUrl})`;
  }

  private async *ndjsonLines(
    res: Response,
    signal: AbortSignal | undefined,
    guard: IdleGuard,
  ): AsyncGenerator<string> {
    yield* this.splitStream(res, '\n', signal, guard);
  }

  private async *sseData(
    res: Response,
    signal: AbortSignal | undefined,
    guard: IdleGuard,
  ): AsyncGenerator<string> {
    for await (const line of this.splitStream(res, '\n', signal, guard)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim();
    }
  }

  private async *splitStream(
    res: Response,
    sep: string,
    signal: AbortSignal | undefined,
    guard: IdleGuard,
  ): AsyncGenerator<string> {
    if (!res.body) {
      guard.stop();
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        if (signal?.aborted) break;
        let step: Awaited<ReturnType<typeof reader.read>>;
        try {
          step = await reader.read();
        } catch (err) {
          if (guard.idled) throw idleError(this.id, this.stallLabel(), guard.idleMs);
          throw err;
        }
        guard.touch();
        const { done, value } = step;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf(sep)) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + sep.length);
          if (line.trim()) yield line;
        }
      }
      if (buffer.trim()) yield buffer;
    } finally {
      guard.stop();
      try {
        reader.releaseLock();
      } catch {}
    }
  }

  // -------------------------------------------------------------------------
  // Embeddings (the Embedder role rides the same endpoint).
  // -------------------------------------------------------------------------

  async embed(model: string, texts: string[]): Promise<number[][]> {
    const backend = await this.backend();
    if (backend.flavor === 'ollama') {
      const res = await fetch(this.native('/api/embed'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok)
        throw new ProviderError(this.id, `Embedding failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { embeddings: number[][] };
      return body.embeddings;
    }
    const res = await fetch(this.api('/embeddings'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok)
      throw new ProviderError(this.id, `Embedding failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return body.data.map((d) => d.embedding);
  }
}

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

function partsText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');
}

function toOllamaMessage(m: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role, content: partsText(m.content) };
  if (Array.isArray(m.content)) {
    const images = m.content
      .filter((p) => p.type === 'image' && p.imageBase64)
      .map((p) => p.imageBase64);
    if (images.length) out.images = images;
  }
  if (m.toolCalls?.length) {
    out.tool_calls = m.toolCalls.map((c) => ({
      function: { name: c.name, arguments: c.args ?? safeParse(c.argsText) ?? {} },
    }));
  }
  if (m.role === 'tool' && m.name) out.tool_name = m.name;
  return out;
}

/** A delta's `content` as events: a string is text; Mistral's chunks are text
 *  chunks (the answer) and thinking chunks (thinking, never replayed). */
function contentParts(content: unknown): ChatEvent[] {
  if (typeof content === 'string') return content ? [{ type: 'text', delta: content }] : [];
  if (!Array.isArray(content)) return [];
  const out: ChatEvent[] = [];
  for (const part of content as Array<Record<string, unknown>>) {
    if (part?.type === 'text' && typeof part.text === 'string' && part.text) {
      out.push({ type: 'text', delta: part.text });
    } else if (part?.type === 'thinking' && Array.isArray(part.thinking)) {
      for (const t of part.thinking as Array<Record<string, unknown>>) {
        if (t?.type === 'text' && typeof t.text === 'string' && t.text) {
          out.push({ type: 'thinking', delta: t.text });
        }
      }
    }
  }
  return out;
}

function toOpenAIMessage(m: ChatMessage, thisTurn = false): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role };
  if (Array.isArray(m.content)) {
    out.content = m.content.map((p) =>
      p.type === 'image'
        ? {
            type: 'image_url',
            image_url: { url: `data:${p.mediaType ?? 'image/png'};base64,${p.imageBase64}` },
          }
        : { type: 'text', text: p.text ?? '' },
    );
  } else {
    out.content = m.content;
  }
  if (m.toolCalls?.length) {
    out.tool_calls = m.toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: c.argsText || JSON.stringify(c.args ?? {}) },
    }));
  }
  // A DeepSeek-style server wants the reasoning of a tool round back, inside
  // the same user turn only.
  if (thisTurn && m.role === 'assistant' && m.toolCalls?.length && m.reasoningContent) {
    out.reasoning_content = m.reasoningContent;
  }
  if (m.role === 'tool' && m.toolCallId) out.tool_call_id = m.toolCallId;
  return out;
}

function safeParse(text: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null ? v : undefined;
  } catch {
    return undefined;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}
