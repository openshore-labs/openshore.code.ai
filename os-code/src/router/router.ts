// The router. Matches a task need to an enabled specialist by capability and
// falls back to the orchestrator, quietly, when no specialist is enabled.
// Graceful degradation is the contract: one model enabled means that model
// does everything, and that is a fully supported setup, not an edge case.
import type { OscConfig } from '../config/schema.js';
import {
  leavesThisNetwork,
  seatLeaves,
  type ChatMessage,
  type ContentPart,
  type Provider,
} from '../providers/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { rankLocalModels } from '../core/agent/offline.js';
import { adapterFor } from '../providers/adapters/index.js';
import { splitThinkTags } from '../core/agent/chainOfThought.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import type { DelegableRole } from './roles.js';
import { resolveStack, type ResolvedRole, type ResolvedStack } from './stack.js';
import { logger } from '../util/log.js';

const log = logger('router');

export interface RouterNote {
  role: string;
  message: string;
}

/** What a delegated turn cost, reported back so the loop can count it. */
export interface DelegatedUsage {
  model: string;
  kind: 'local' | 'cloud';
  promptTokens: number;
  completionTokens: number;
}

/** How the router learns this computer is offline (Desktop Offline, maintainer
 *  2026-10-07), read at every use so a change applies to the next call. */
export interface RouterOptions {
  /** True while this computer works offline: only a model whose requests
   *  stay on this network may answer. Undefined reads as online. */
  offline?: () => boolean;
}

/** The specialists that can stand in for a cloud orchestrator while offline,
 *  best first: each is a chat model the person placed in the stack. */
const OFFLINE_STAND_INS = ['coding', 'analysis', 'writing', 'fast'] as const;

/** How long the router waits for a local server's model list. */
const LOCAL_LIST_TIMEOUT_MS = 3_000;

export interface DelegateOptions {
  /** The calling task's abort signal: Stop stops the specialist too (DAE-4). */
  signal?: AbortSignal;
  /** Receives the delegated turn's usage once its stream ends. */
  onUsage?: (usage: DelegatedUsage) => void;
}

export class Router {
  /** Quiet notes ("no vision specialist, the orchestrator answered") for the TUI. */
  readonly notes: RouterNote[] = [];

  constructor(
    private readonly config: OscConfig,
    private readonly registry: ProviderRegistry,
    readonly stack: ResolvedStack,
    private readonly options: RouterOptions = {},
  ) {}

  orchestrator(): ResolvedRole {
    return this.stack.orchestrator;
  }

  /** Whether this computer works offline right now. */
  offline(): boolean {
    return this.options.offline?.() === true;
  }

  /** The chat role used for a delegated subtask, with Reasoning model fallback.
   *  While offline a specialist that leaves this network is skipped, the way
   *  a missing one is, so the subtask falls to the orchestrator. */
  roleFor(role: DelegableRole): { resolved: ResolvedRole; fellBack: boolean } {
    if (this.config.routing.mode !== 'orchestrator-only') {
      const specialist = this.stack.specialists[role];
      if (specialist && !(this.offline() && leaves(specialist))) {
        return { resolved: specialist, fellBack: false };
      }
    }
    return { resolved: this.stack.orchestrator, fellBack: true };
  }

  /**
   * The best model on this network to answer while offline (Desktop Offline):
   * the orchestrator when its requests stay here; else a specialist the stack
   * places that stays (coding first); else the best chat model a server on
   * this network already serves (DeepBlue, or any installed Ollama model),
   * by rankLocalModels. Judged by address and by an Ollama cloud tag
   * (seatLeaves), never by a label. Undefined when nothing on this network
   * can answer.
   */
  async localSeat(): Promise<ResolvedRole | undefined> {
    if (!leaves(this.stack.orchestrator)) return this.stack.orchestrator;
    for (const role of OFFLINE_STAND_INS) {
      const specialist = this.stack.specialists[role];
      if (specialist && !leaves(specialist)) return specialist;
    }
    for (const [id, provider] of this.registry.all()) {
      if (leavesThisNetwork(provider)) continue;
      const best = rankLocalModels(await listWithin(provider))[0];
      if (best) return { ref: { provider: id, model: best }, provider };
    }
    return undefined;
  }

  embeddingRole(): ResolvedRole | undefined {
    return this.stack.specialists.embedding;
  }

  /** The cloud escalation target, when an Anthropic provider is configured. */
  escalationTarget(): { provider: Provider; model: string } | undefined {
    for (const [, provider] of this.registry.all()) {
      if (provider.kind === 'cloud') {
        const endpoint = this.config.providers[provider.id];
        const model =
          endpoint && endpoint.kind === 'anthropic' ? endpoint.model : 'claude-sonnet-5';
        return { provider, model };
      }
    }
    return undefined;
  }

  /** Whether any seat this stack places sends its requests off this network
   *  (the orchestrator, a specialist, or a ready escalation), judged by
   *  address: what "cloud models wait for a connection" speaks of. A stack
   *  that is all on this network loses no model offline, so a session says
   *  nothing of it (Desktop Offline). */
  anySeatLeaves(): boolean {
    if (leaves(this.stack.orchestrator)) return true;
    for (const specialist of Object.values(this.stack.specialists)) {
      if (specialist && leaves(specialist)) return true;
    }
    return this.escalationReady();
  }

  escalationEnabled(): boolean {
    // Offline, nothing escalates: there is no cloud to reach.
    if (this.offline()) return false;
    return this.escalationReady();
  }

  /** Whether escalation is configured and could run, online or not. */
  private escalationReady(): boolean {
    if (!this.config.routing.escalation.enabled) return false;
    const target = this.escalationTarget();
    if (!target) return false;
    // P2-3: a cloud target with no key connected is not a real escalation path.
    // Consult the injected key getter (via the provider) so escalation reads as
    // off, and the user is never asked to approve spend that would then error.
    // The registry hands out ethics-guarded providers, so the key question goes
    // to the raw endpoint underneath; the guarded wrapper is what actually runs
    // the completion, and that is still the only object anything here calls.
    const endpoint = this.registry.rawProvider(target.provider.id) ?? target.provider;
    if (endpoint instanceof AnthropicProvider && !endpoint.hasApiKey()) {
      return false;
    }
    return true;
  }

  /**
   * One-shot delegation: run a self-contained subtask on a specialist (or the
   * orchestrator when the specialist is missing) and return the final text.
   */
  async delegate(
    role: DelegableRole,
    task: string,
    images?: Array<{ base64: string; mediaType: string }>,
    options?: DelegateOptions,
  ): Promise<string> {
    const roled = this.roleFor(role);
    let resolved = roled.resolved;
    const offline = this.offline();
    // Whether being offline moved this subtask off the seat that would take
    // it online (a cloud specialist skipped, or a cloud orchestrator).
    const placed = this.stack.specialists[role];
    let movedOffline = Boolean(
      offline &&
      roled.fellBack &&
      placed &&
      leaves(placed) &&
      this.config.routing.mode !== 'orchestrator-only',
    );
    if (roled.fellBack) {
      const note = movedOffline
        ? `Offline, so the ${role} specialist waits and a model on your computer takes it.`
        : `No ${role} specialist is enabled, so your Reasoning model handled it itself.`;
      this.notes.push({ role, message: note });
      log.info('delegation fell back to orchestrator', { role, offline });
    }
    // Offline, a cloud orchestrator cannot take the subtask either: the best
    // model on this network does, or nothing can.
    if (offline && leaves(resolved)) {
      const local = await this.localSeat();
      if (!local) throw new Error('Offline, and no model on your computer can take this on.');
      resolved = local;
      movedOffline = true;
    }
    if (role === 'vision') {
      const caps = await resolved.provider.capabilities(resolved.ref.model);
      if (!caps.supportsVision) {
        throw new Error(
          movedOffline
            ? `Offline, and ${resolved.ref.model} on your computer cannot read images, so this waits for a connection.`
            : `${resolved.ref.model} cannot read images. Enable a vision specialist (category "can read screenshots") to analyze screenshots.`,
        );
      }
    }

    const SPECIALIST_SYSTEM: Record<DelegableRole, string> = {
      vision:
        'You are a precise visual analyst. Answer the question about the image concretely and concisely.',
      writing:
        'You are a skilled writer. Produce polished, human prose for exactly the piece requested, and return only the piece.',
      analysis:
        'You are a careful analyst. Work step by step, show the numbers, and state the answer plainly at the end.',
      coding:
        'You are a focused coding specialist. Complete exactly the subtask you are given and return only the result, no preamble.',
      fast: 'You are a quick helper. Answer the small task directly, nothing extra.',
    };
    const adapter = adapterFor(resolved.ref.model);
    const system = adapter.systemPreamble(SPECIALIST_SYSTEM[role]);
    const content: string | ContentPart[] = images?.length
      ? [
          { type: 'text', text: task },
          ...images.map((i): ContentPart => ({
            type: 'image',
            imageBase64: i.base64,
            mediaType: i.mediaType,
          })),
        ]
      : task;
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content },
    ];

    let answer = '';
    let promptTokens = 0;
    let completionTokens = 0;
    for await (const event of resolved.provider.chat(
      {
        model: resolved.ref.model,
        messages,
        temperature: adapter.temperature(),
        keepAlive: this.config.resourceBudget.keepAlive,
        // A specialist's answer is folded into the parent's, never shown with
        // its own thinking, so it thinks only when Chain of Thought is on.
        reasoning: this.config.chainOfThought?.enabled ? 'on' : 'off',
      },
      options?.signal,
    )) {
      if (event.type === 'text') answer += event.delta;
      else if (event.type === 'usage') {
        // Last-seen-wins per field, the same rule the loop applies.
        if (event.promptTokens) promptTokens = event.promptTokens;
        if (event.completionTokens) completionTokens = event.completionTokens;
      }
    }
    // A backend that reports no usage still spent something; estimate it
    // (4 chars per token, erring high) so cloud dollars are never invisible.
    options?.onUsage?.({
      model: resolved.ref.model,
      kind: resolved.provider.kind,
      promptTokens: promptTokens || Math.ceil((system.length + task.length) / 4),
      completionTokens: completionTokens || Math.ceil(answer.length / 4),
    });
    // Any <think> text a specialist wrote on its own stays out of its answer.
    return splitThinkTags(answer).text.trim() || '(the specialist returned nothing)';
  }
}

/** Whether a seat's requests leave this network: its server's address, or
 *  an Ollama cloud tag a local Ollama passes on (seatLeaves). */
function leaves(seat: ResolvedRole): boolean {
  return seatLeaves(seat.provider, seat.ref.model);
}

/** A model a room names, as the wire carries it. */
export interface SeatRef {
  model: string;
  provider: string;
}

/**
 * The model this computer's engine seats while offline (Router.localSeat,
 * the same rule, never a second copy of it), so a room names what will
 * actually answer: the desktop's status and the daemon's GET /stack read it.
 * Every configured provider is judged by address, never by its label.
 * Undefined when no stack is set up or nothing on this network can answer.
 */
export async function offlineSeatFor(
  config: OscConfig,
  registry: ProviderRegistry,
): Promise<SeatRef | undefined> {
  let stack: ResolvedStack;
  try {
    stack = resolveStack(config, registry);
  } catch {
    return undefined;
  }
  const seat = await new Router(config, registry, stack).localSeat();
  return seat ? { model: seat.ref.model, provider: seat.ref.provider } : undefined;
}

/** A provider's model list, or none when it cannot say in time (a server
 *  that is down, or slow to answer): offline, a seat that cannot be found
 *  is no seat. */
async function listWithin(provider: Provider): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.listModels(),
      new Promise<string[]>((resolve) => {
        timer = setTimeout(() => resolve([]), LOCAL_LIST_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}
