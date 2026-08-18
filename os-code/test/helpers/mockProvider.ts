// A scripted Provider for tests: yields exactly the events you queue, turn
// by turn, and records every request it receives.
import type {
  ChatEvent,
  ChatRequest,
  Provider,
  ProviderCapabilities,
} from '../../src/providers/types.js';

export type ScriptedTurn = ChatEvent[];

export class MockProvider implements Provider {
  readonly kind: 'local' | 'cloud';
  readonly requests: ChatRequest[] = [];
  private turns: ScriptedTurn[];
  caps: ProviderCapabilities;

  constructor(
    readonly id: string,
    turns: ScriptedTurn[],
    options: { kind?: 'local' | 'cloud'; caps?: Partial<ProviderCapabilities> } = {},
  ) {
    this.turns = [...turns];
    this.kind = options.kind ?? 'local';
    this.caps = {
      supportsTools: true,
      supportsVision: false,
      supportsGrammar: false,
      contextTokens: 32768,
      costTier: this.kind === 'cloud' ? 'metered' : 'free',
      latencyTier: 'fast',
      categories: ['reasoning', 'coding'],
      ...options.caps,
    };
  }

  get label(): string {
    return this.id;
  }

  queue(turn: ScriptedTurn): void {
    this.turns.push(turn);
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return this.caps;
  }

  async listModels(): Promise<string[]> {
    return ['mock-model'];
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'mock' };
  }

  async *chat(request: ChatRequest): AsyncGenerator<ChatEvent, void, void> {
    // Snapshot: the loop mutates its history array after the call.
    this.requests.push({ ...request, messages: request.messages.map((m) => ({ ...m })) });
    const turn = this.turns.shift();
    if (!turn) {
      yield { type: 'text', delta: 'No scripted turns left.' };
      yield { type: 'done', stopReason: 'end' };
      return;
    }
    for (const event of turn) yield event;
  }
}

/** Convenience: a text-only turn ending normally. */
export function textTurn(text: string): ScriptedTurn {
  return [
    { type: 'text', delta: text },
    { type: 'usage', promptTokens: 10, completionTokens: 10 },
    { type: 'done', stopReason: 'end' },
  ];
}

/** Convenience: a native tool-call turn. */
export function toolTurn(name: string, args: Record<string, unknown>, id = 'call_1'): ScriptedTurn {
  return [
    { type: 'tool-call', call: { id, name, argsText: JSON.stringify(args), args } },
    { type: 'usage', promptTokens: 10, completionTokens: 5 },
    { type: 'done', stopReason: 'tool-calls' },
  ];
}
