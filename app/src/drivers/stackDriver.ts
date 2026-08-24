// The phone-side router. Chatting with "your stack" runs through here: each
// turn is classified into a category, routed to the specialist placed for that
// category when it is reachable in the current connectivity profile, and
// otherwise handled by the Reasoning LLM (which is exactly the quarterback
// fallback the engine's router uses on the desktop). It honors each
// specialist's persona and the active profile, and calls the right backend:
// on-device (llama.cpp), Anthropic, or an OpenAI-compatible cloud endpoint.
//
// v1 SIMPLIFICATIONS (surface for the code review): the classifier is a keyword
// heuristic, not a model; there is no tool use or multi-step subtask delegation
// (each turn goes to one model end to end); the image-gen category routes as
// text and does not yet render images; "home" models require the desktop
// pairing and are treated as unreachable here.
import Anthropic from '@anthropic-ai/sdk';
import type { PluginListenerHandle } from '@capacitor/core';
import type { ApprovalAnswer } from 'os-code/protocol';
import { Llama } from '../lib/llamaPlugin.js';
import { platform, secretGet } from '../lib/platform.js';
import { nativeFetch } from '../lib/nativeFetch.js';
import { providerInfo, providerSecretKey } from '../lib/providers.js';
import { byomSecretKey } from '../lib/byom.js';
import { buildHarborSystemPrompt, isHarbor } from '../lib/harbor.js';
import { buildHarborMiniSystemPrompt, isHarborMini } from '../lib/harborMini.js';
import { locationAllowed, type ProfileId } from '../lib/profiles.js';
import {
  harborRef,
  refName,
  type AppStack,
  type Placement,
  type StackCategory,
  type StackModelRef,
} from '../lib/stack.js';
import type { CrewAgent } from '../state/types.js';
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';

/** Extra context a chat carries into the router: its project and its crew. */
export interface StackContext {
  projectName?: string;
  projectInstructions?: string;
  /** Crew that speaks in this chat (already scoped to project + level). */
  crew?: CrewAgent[];
}

const BASE_SYSTEM = [
  'You are OS Code, a warm, capable coding companion.',
  'Answer directly and concretely. Use markdown, and fence code with a language tag.',
  'Never use em dashes. Use a period or a comma instead.',
].join('\n');

/** A crude keyword classifier. Placeholder for a real routing model. */
export function classifyTask(text: string): StackCategory | 'reasoning' {
  const t = text.toLowerCase();
  if (
    /\b(code|coding|function|bug|refactor|compile|regex|api|typescript|javascript|python|sql|stack ?trace|npm|git|class|import|debug)\b/.test(
      t,
    )
  )
    return 'coding';
  if (
    /\b(write|draft|essay|email|blog|copy|rephrase|proofread|paragraph|story|caption|tone)\b/.test(
      t,
    )
  )
    return 'writing';
  if (
    /\b(calculate|analy|data|numbers|statistic|math|equation|spreadsheet|percentage|forecast|chart)\b/.test(
      t,
    )
  )
    return 'analysis';
  if (/\b(image|picture|draw|illustrat|logo|render|generate an? image)\b/.test(t))
    return 'image-gen';
  return 'reasoning';
}

type Msg = { role: 'user' | 'assistant'; content: string };

function locationOf(ref: StackModelRef): 'home' | 'cloud' | 'device' {
  // A BYOM endpoint goes over the network (its own or someone else's server),
  // so it shares the cloud reachability rules: available online, held back on
  // the strictest offline profile. Only a truly on-device model is 'device'.
  return ref.kind === 'device' ? 'device' : 'cloud';
}

export class StackDriver implements ChatDriver {
  readonly kind = 'stack' as const;
  private emitter = new DriverEmitter();
  private history: Msg[] = [];
  private aborted = false;
  private answer = '';
  private activeRequestId?: string;
  private listenersReady: Promise<void>;
  private deviceListeners: PluginListenerHandle[] = [];
  private abortController?: AbortController;
  private loadedDeviceId?: string;

  constructor(
    private readonly stack: AppStack,
    private readonly profile: ProfileId,
    private readonly context: StackContext = {},
  ) {
    this.listenersReady = this.attachDeviceListeners();
  }

  subscribe(sink: DriverEventSink): () => void {
    return this.emitter.subscribe(sink);
  }

  send(text: string): void {
    void this.run(text);
  }

  private emit = (e: Parameters<DriverEmitter['emit']>[0]) => this.emitter.emit(e);

  // ---- routing ------------------------------------------------------------

  private reachable(ref: StackModelRef): boolean {
    return locationAllowed(this.profile, locationOf(ref));
  }

  /** Pick the model for this turn: a placed specialist if reachable, else the
   *  Reasoning LLM, else any reachable model. */
  private route(text: string): {
    ref: StackModelRef;
    placement?: Placement;
    category: StackCategory | 'reasoning';
  } {
    const category = classifyTask(text);
    if (category !== 'reasoning') {
      const specialist = this.stack.active.find(
        (m) => m.placement.category === category && this.reachable(m.ref),
      );
      if (specialist) return { ref: specialist.ref, placement: specialist.placement, category };
    }
    const reasoning = this.stack.reasoning ?? harborRef();
    if (this.reachable(reasoning)) return { ref: reasoning, category };
    // Last resort: any reachable placed model, then any reachable at all.
    const anyActive = this.stack.active.find((m) => this.reachable(m.ref));
    if (anyActive) return { ref: anyActive.ref, placement: anyActive.placement, category };
    return { ref: reasoning, category }; // will surface an unreachable error
  }

  private systemFor(ref: StackModelRef, placement?: Placement): string {
    const guideSystem =
      ref.kind === 'device' && isHarborMini(ref.modelId)
        ? buildHarborMiniSystemPrompt()
        : ref.kind === 'device' && isHarbor(ref.modelId)
          ? buildHarborSystemPrompt(false)
          : undefined;
    // Harbor's own web-search protocol only exists in the standalone guide
    // chat (OnDeviceDriver); placed in a full stack it answers from what it
    // knows, same as any other Reasoning LLM here (no tool use in v1, see the
    // file header). Its persona still applies so it identifies itself
    // correctly and stays honest about not being a coder.
    const parts = [guideSystem ?? BASE_SYSTEM];
    // Project context: name + standing instructions, injected into every turn.
    const proj = this.context.projectInstructions?.trim();
    if (this.context.projectName || proj) {
      const head = this.context.projectName
        ? `You are working in the project "${this.context.projectName}".`
        : '';
      parts.push([head, proj].filter(Boolean).join('\n'));
    }
    const crewNote = this.crewGuidance();
    if (crewNote) parts.push(crewNote);
    if (placement?.persona && placement.persona.trim()) {
      parts.push(`Persona for this specialist: ${placement.persona.trim()}`);
    }
    return parts.join('\n\n');
  }

  /** Describe the crew this chat can draw on. "auto" members may be consulted
   *  by the Reasoning LLM on its own; "request" members wait to be named. */
  private crewGuidance(): string | undefined {
    const crew = this.context.crew ?? [];
    if (!crew.length) return undefined;
    const describe = (a: CrewAgent) => {
      const when = a.whenCalled?.trim() ? ` Called when: ${a.whenCalled.trim()}.` : '';
      return `- ${a.name}: ${a.persona.trim()}.${when}`;
    };
    const auto = crew.filter((a) => a.activityLevel === 'auto');
    const request = crew.filter((a) => a.activityLevel === 'request');
    const lines: string[] = ['Your crew (user-authored perspectives you can bring in):'];
    if (auto.length) {
      lines.push(
        'You may consult these on your own when they would help. Speak in their voice when you do, and say which crew member you are channeling:',
      );
      lines.push(...auto.map(describe));
    }
    if (request.length) {
      lines.push('These wait to be summoned. Bring one in only when the user names it:');
      lines.push(...request.map(describe));
    }
    return lines.join('\n');
  }

  // ---- turn ---------------------------------------------------------------

  private async run(text: string): Promise<void> {
    this.aborted = false;
    this.abortController = new AbortController();
    this.history.push({ role: 'user', content: text });
    this.emit({ type: 'task-start', input: text });

    const target = this.route(text);
    if (!this.reachable(target.ref)) {
      this.emit({
        type: 'task-done',
        reason: 'error',
        message: `Nothing in your stack is reachable while ${this.profile}. Download an on-device model or change your connection.`,
      });
      return;
    }

    this.emit({
      type: 'turn-start',
      turn: this.history.length,
      model: refName(target.ref),
      providerKind: target.ref.kind === 'device' ? 'local' : 'cloud',
    });
    if (target.category !== 'reasoning' && target.placement) {
      this.emit({
        type: 'status',
        message: `Routing this to ${refName(target.ref)} for ${target.category}.`,
      });
    }

    this.answer = '';
    try {
      if (target.ref.kind === 'device') await this.runDevice(target.ref, target.placement);
      else if (target.ref.kind === 'byom') await this.runByom(target.ref, target.placement);
      else await this.runCloud(target.ref, target.placement);
    } catch (err) {
      this.emit({
        type: 'task-done',
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private finish(reason: 'complete' | 'aborted' | 'error', message?: string): void {
    const text = this.answer.trim();
    if (text) this.history.push({ role: 'assistant', content: text });
    this.emit({ type: 'text-final', text });
    this.emit({ type: 'task-done', reason, message });
  }

  // ---- on-device backend --------------------------------------------------

  private async attachDeviceListeners(): Promise<void> {
    this.deviceListeners.push(
      await Llama.addListener('token', ({ requestId, delta }) => {
        if (requestId !== this.activeRequestId) return;
        this.answer += delta;
        this.emit({ type: 'text-delta', text: delta });
      }),
    );
    this.deviceListeners.push(
      await Llama.addListener('generationDone', ({ requestId, stopReason, detail }) => {
        if (requestId !== this.activeRequestId) return;
        this.activeRequestId = undefined;
        if (stopReason === 'error')
          this.finish('error', detail ?? 'The on-device model hit a problem.');
        else this.finish(stopReason === 'stopped' ? 'aborted' : 'complete');
      }),
    );
  }

  private async runDevice(
    ref: Extract<StackModelRef, { kind: 'device' }>,
    placement?: Placement,
  ): Promise<void> {
    await this.listenersReady;
    if (this.loadedDeviceId !== ref.modelId) {
      this.emit({ type: 'status', message: `Warming up ${ref.modelName} on this device.` });
      const load = await Llama.load({
        id: ref.modelId,
        contextSize: isHarborMini(ref.modelId) ? 2048 : 4096,
      });
      if (!load.ok) {
        this.emit({
          type: 'task-done',
          reason: 'error',
          message: load.detail ?? `${ref.modelName} would not load.`,
        });
        return;
      }
      this.loadedDeviceId = ref.modelId;
    }
    this.activeRequestId = `req_${Date.now()}`;
    await Llama.generate({
      requestId: this.activeRequestId,
      system: this.systemFor(ref, placement),
      messages: this.history,
      maxTokens: isHarborMini(ref.modelId) ? 512 : 1024,
      temperature: 0.6,
    });
  }

  // ---- cloud backends -----------------------------------------------------

  private async runCloud(
    ref: Extract<StackModelRef, { kind: 'cloud' }>,
    placement?: Placement,
  ): Promise<void> {
    const key = await secretGet(providerSecretKey(ref.provider));
    if (!key) {
      this.emit({
        type: 'task-done',
        reason: 'error',
        message: `Connect ${ref.provider} under Cloud Connections first.`,
      });
      return;
    }
    const system = this.systemFor(ref, placement);
    if (ref.provider === 'anthropic') await this.runAnthropic(key, ref.model, system);
    else {
      const base = providerInfo(ref.provider)?.openaiBaseUrl;
      if (!base) {
        this.emit({
          type: 'task-done',
          reason: 'error',
          message: `No endpoint configured for ${ref.provider}.`,
        });
        return;
      }
      await this.runOpenAiCompatible(ref.provider, base, key, ref.model, system);
    }
  }

  private async runByom(
    ref: Extract<StackModelRef, { kind: 'byom' }>,
    placement?: Placement,
  ): Promise<void> {
    // A BYOM key is optional: a local or trusted-network server may accept
    // unauthenticated requests, so an absent key is not an error here.
    const key = (await secretGet(byomSecretKey(ref.id))) ?? undefined;
    const system = this.systemFor(ref, placement);
    await this.runOpenAiCompatible(ref.label, ref.baseUrl, key, ref.model, system);
  }

  private async runAnthropic(key: string, model: string, system: string): Promise<void> {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const stream = client.messages.stream(
      {
        model,
        max_tokens: 2048,
        system,
        messages: this.history.map((m) => ({ role: m.role, content: m.content })),
      },
      { signal: this.abortController?.signal },
    );
    stream.on('text', (delta) => {
      if (this.aborted) return;
      this.answer += delta;
      this.emit({ type: 'text-delta', text: delta });
    });
    try {
      await stream.finalMessage();
    } catch (err) {
      if (this.aborted) {
        this.finish('aborted');
        return;
      }
      throw err;
    }
    this.finish(this.aborted ? 'aborted' : 'complete');
  }

  // The shared OpenAI-compatible path, driven by an explicit base URL and an
  // optional key, so it serves both the built-in cloud providers and a
  // bring-your-own-model endpoint. `label` names the source in error copy.
  private async runOpenAiCompatible(
    label: string,
    base: string,
    key: string | undefined,
    model: string,
    system: string,
  ): Promise<void> {
    const messages = [{ role: 'system', content: system }, ...this.history];
    const authHeaders: Record<string, string> = { 'content-type': 'application/json' };
    if (key) authHeaders.authorization = `Bearer ${key}`;

    // On a device or the desktop shell, these providers send no CORS headers, so
    // the request goes through the native shim, which cannot stream. Ask for a
    // whole answer and emit it once. On the web (dev) we keep true streaming.
    if (platform() === 'ios' || platform() === 'electron') {
      const res = await nativeFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ model, stream: false, messages }),
      });
      if (!res.ok) {
        this.emit({
          type: 'task-done',
          reason: 'error',
          message: `${label} answered ${res.status}.`,
        });
        return;
      }
      if (!this.aborted) {
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content) {
          this.answer += content;
          this.emit({ type: 'text-delta', text: content });
        }
      }
      this.finish(this.aborted ? 'aborted' : 'complete');
      return;
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ model, stream: true, messages }),
      signal: this.abortController?.signal,
    });
    if (!res.ok || !res.body) {
      this.emit({
        type: 'task-done',
        reason: 'error',
        message: `${label} answered ${res.status}.`,
      });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done || this.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            this.answer += delta;
            this.emit({ type: 'text-delta', text: delta });
          }
        } catch {
          // skip a partial or non-JSON keepalive line
        }
      }
    }
    this.finish(this.aborted ? 'aborted' : 'complete');
  }

  // ---- lifecycle ----------------------------------------------------------

  abort(): void {
    this.aborted = true;
    this.abortController?.abort();
    if (this.activeRequestId) void Llama.stop({ requestId: this.activeRequestId });
  }

  answerApproval(_id: string, _answer: ApprovalAnswer): void {
    // No tools in v1, so nothing asks for approval.
  }

  dispose(): void {
    this.abort();
    for (const h of this.deviceListeners) void h.remove();
    this.deviceListeners = [];
    this.emitter.clear();
  }
}
