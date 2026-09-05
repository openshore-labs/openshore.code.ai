// The router. Matches a task need to an enabled specialist by capability and
// falls back to the orchestrator, quietly, when no specialist is enabled.
// Graceful degradation is the contract: one model enabled means that model
// does everything, and that is a fully supported setup, not an edge case.
import type { OscConfig } from '../config/schema.js';
import type { ChatMessage, ContentPart, Provider } from '../providers/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { adapterFor } from '../providers/adapters/index.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import type { DelegableRole } from './roles.js';
import type { ResolvedRole, ResolvedStack } from './stack.js';
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
  ) {}

  orchestrator(): ResolvedRole {
    return this.stack.orchestrator;
  }

  /** The chat role used for a delegated subtask, with quarterback fallback. */
  roleFor(role: DelegableRole): { resolved: ResolvedRole; fellBack: boolean } {
    if (this.config.routing.mode !== 'orchestrator-only') {
      const specialist = this.stack.specialists[role];
      if (specialist) return { resolved: specialist, fellBack: false };
    }
    return { resolved: this.stack.orchestrator, fellBack: true };
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

  escalationEnabled(): boolean {
    if (!this.config.routing.escalation.enabled) return false;
    const target = this.escalationTarget();
    if (!target) return false;
    // P2-3: a cloud target with no key connected is not a real escalation path.
    // Consult the injected key getter (via the provider) so escalation reads as
    // off, and the user is never asked to approve spend that would then error.
    if (target.provider instanceof AnthropicProvider && !target.provider.hasApiKey()) {
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
    const { resolved, fellBack } = this.roleFor(role);
    if (fellBack) {
      const note = `No ${role} specialist is enabled, so the quarterback handled it itself.`;
      this.notes.push({ role, message: note });
      log.info('delegation fell back to orchestrator', { role });
    }
    if (role === 'vision') {
      const caps = await resolved.provider.capabilities(resolved.ref.model);
      if (!caps.supportsVision) {
        throw new Error(
          `${resolved.ref.model} cannot read images. Enable a vision specialist (category "can read screenshots") to analyze screenshots.`,
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
    return answer.trim() || '(the specialist returned nothing)';
  }
}
