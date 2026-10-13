// The free chat (tech review ruling 8, 2026-09-29): one answer from the person's own
// LOCAL model, and nothing else. It builds a provider and streams a single
// completion. There is no AgentSession, no LocalDriver, no ToolRegistry, no
// command lane, no outbox, no journal and no cloud escalation here, so this
// path cannot read, edit, run, or commit anything, and it leaves no session
// behind.
//
// Two hosts share it. The daemon's `POST /chat` writes each event as a server
// sent event for a paired phone, and the desktop app's main process forwards
// the same events over IPC to its own window (`osc:freeChat`). One function
// means the phone and the desktop get the same local-only rules: a seat that
// leaves this network is refused by address, the conversation is capped, one
// answer runs at a time per caller, and a named model must be one this
// computer serves.
//
// A refusal comes first and alone, as a `refused` event with the HTTP status
// the daemon answers with; once every check has passed, `open` says the
// answer is on its way, then the vault card (when the host builds a pack),
// the text, and `done` or `error` last.
import { loadConfig } from '../config/load.js';
import type { OscConfig } from '../config/schema.js';
import { ProviderRegistry } from '../providers/registry.js';
import { resolveStack } from '../router/stack.js';
import { getAnthropicKey } from '../auth/claude.js';
import { engineEthicsContext } from '../core/ethics/host.js';
import { seatLeaves, type ChatMessage, type Provider } from '../providers/types.js';
import {
  ThinkTagSplitter,
  chainOfThoughtPrompt,
  reasonsNatively,
  type ThoughtPiece,
} from '../core/agent/chainOfThought.js';
import { SEARCH_PROTOCOL_NOTE } from '../harness/localSearch.js';
import type { ChatContextPackEvent } from './vaultWire.js';

// The system line makes the model own that it is chat, not the coding agent.
const CHAT_SYSTEM = [
  "You are OpenShore, a warm, capable companion running as read-only chat with the person's own local model.",
  'Answer directly and concretely. Use markdown, and fence code with a language tag.',
  'You have no tools here: you cannot read or edit files, run commands, or commit. When a task needs that, say so and point the user to opening a repository with the coding agent on their computer.',
  'Lead with the answer. When the person has to do something, give one step at a time and wait. If you cannot help with something here, say so and name where in the app it lives.',
  'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
  'Never use em dashes. Use a period or a comma instead.',
].join('\n');

/** The most chat context (standing instructions, setup step) a chat carries. */
const CHAT_CONTEXT_MAX = 8000;

// The limits (H1): a conversation no longer than a local model could read
// anyway.
export const FREE_CHAT_MAX_MESSAGES = 200;
export const FREE_CHAT_MAX_TEXT_BYTES = 512 * 1024;
/** How long a chat waits for the model list before letting the model through. */
const MODEL_LIST_TIMEOUT_MS = 3_000;

/** The system line for one chat: the fixed line, then the chat's own context
 *  (the project's standing instructions, the guided setup's step), trimmed
 *  and capped, so the app's brief reaches this model the way it reaches every
 *  other brain. Anything that is not a string is ignored. */
export function desktopChatSystem(context: unknown, search = false): string {
  const extra = typeof context === 'string' ? context.trim().slice(0, CHAT_CONTEXT_MAX) : '';
  // With search on, the app runs any search itself and sends the results back
  // as the next turn, so this surface only learns how to ask; it never
  // fetches.
  const base = search ? `${CHAT_SYSTEM}\n${SEARCH_PROTOCOL_NOTE}` : CHAT_SYSTEM;
  return extra ? `${base}\n\n${extra}` : base;
}

/** One step of a free chat, in the order the host passes them on. */
export type FreeChatEvent =
  | { type: 'refused'; status: 400 | 409 | 413; error: string }
  | { type: 'open' }
  | ChatContextPackEvent
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** What a host's pack builder is handed (Vault M5, tech review J6). */
export interface FreeChatPackContext {
  config: OscConfig;
  model: string;
  provider: Provider;
  turns: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  signal: AbortSignal;
}

export interface FreeChatOptions {
  signal: AbortSignal;
  /** One answer at a time per caller (H1): the caller's key, and the keys
   *  answering right now, shared by every call the host makes. */
  lane?: { key: string; busy: Set<string> };
  /** The vault pack for this chat. The daemon builds one over the caller's
   *  own root; the desktop's own window passes none, so a signed-out chat
   *  carries no notes. */
  pack?: (ctx: FreeChatPackContext) => Promise<{ text?: string; event?: ChatContextPackEvent }>;
  /** The config to read. Unset loads it fresh, so the chat reflects the
   *  stack as it is now, not a snapshot from when the host started. */
  config?: OscConfig;
}

function refused(status: 400 | 409 | 413, error: string): FreeChatEvent {
  return { type: 'refused', status, error };
}

/** One free chat answer, as events. The body is the `/chat` body: `messages`,
 *  and optionally `model`, `context`, `search`, `chainOfThought`, and the
 *  vault fields a host's pack builder reads. */
export async function* freeChat(
  body: Record<string, unknown>,
  opts: FreeChatOptions,
): AsyncGenerator<FreeChatEvent> {
  const rawMessages = Array.isArray(body.messages) ? body.messages : undefined;
  if (!rawMessages) {
    yield refused(400, 'Send {"messages": [{"role","content"}, ...]}.');
    return;
  }
  // A conversation no local model could read in one go is refused whole,
  // before any model is asked.
  if (
    rawMessages.length > FREE_CHAT_MAX_MESSAGES ||
    chatTextBytes(rawMessages) > FREE_CHAT_MAX_TEXT_BYTES
  ) {
    yield refused(
      413,
      'This conversation is too long to send in one go. Start a new chat to keep going.',
    );
    return;
  }
  // One answer at a time per caller: a second request while the first still
  // streams would make the model answer twice at once.
  const lane = opts.lane;
  if (lane?.busy.has(lane.key)) {
    yield refused(
      409,
      'Your computer is still answering your last message. Wait for it to finish, or stop it, then send again.',
    );
    return;
  }
  lane?.busy.add(lane.key);
  try {
    const config = opts.config ?? loadConfig().config;
    // Guarded like every other path: the registry hands out ethics-wrapped
    // providers, and blocks here are journaled on this machine.
    const providers = new ProviderRegistry(config, getAnthropicKey, engineEthicsContext());
    let orchestrator;
    try {
      orchestrator = resolveStack(config, providers).orchestrator;
    } catch (err) {
      yield refused(400, `No local model to chat with: ${(err as Error).message}`);
      return;
    }
    // Pin to local: a free surface never spends the person's cloud budget,
    // and "local" means on this computer's own network, by address, and not
    // an Ollama cloud tag, which answers on ollama.com (seatLeaves).
    if (seatLeaves(orchestrator.provider, orchestrator.ref.model)) {
      yield refused(
        400,
        'Free desktop chat runs your local models. Set a local orchestrator in your stack.',
      );
      return;
    }
    const model =
      typeof body.model === 'string' && body.model ? body.model : orchestrator.ref.model;
    // A model the app names is a seat too: a cloud tag never answers here.
    if (seatLeaves(orchestrator.provider, model)) {
      yield refused(400, `That model runs on Ollama's cloud, not your computer: ${model}.`);
      return;
    }
    // A model the app names is checked against what this computer serves,
    // when the server can say; an unknown list lets it pass.
    if (model !== orchestrator.ref.model && !(await modelServed(orchestrator.provider, model))) {
      yield refused(400, `That model is not on your computer: ${model}. Pick one from your Stack.`);
      return;
    }
    // Client system turns are dropped below; the chat's context rides its own
    // capped field instead (desktopChatSystem). Chain of Thought (off unless
    // the app says on): a native reasoner is asked through its API, any other
    // model is prompted to think in tags, and the splitter keeps tags out of
    // the answer.
    const cot = body.chainOfThought === true;
    const system = desktopChatSystem(body.context, body.search === true);
    const turns = rawMessages
      .filter(
        (m: unknown): m is { role: string; content: string } =>
          Boolean(m) &&
          typeof (m as { content?: unknown }).content === 'string' &&
          ['user', 'assistant'].includes((m as { role?: unknown }).role as string),
      )
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    yield { type: 'open' };
    const chatPack = opts.pack
      ? await opts.pack({
          config,
          model,
          provider: orchestrator.provider,
          turns,
          signal: opts.signal,
        })
      : {};
    let systemText =
      cot && !reasonsNatively(model) ? `${system}\n\n${chainOfThoughtPrompt()}` : system;
    // The pack is the last system part (tech review J16): volatile, so it trails.
    if (chatPack.text) systemText = `${systemText}\n\n${chatPack.text}`;
    const messages: ChatMessage[] = [{ role: 'system', content: systemText }, ...turns];
    // The card goes before the first text, like the engine's event.
    if (chatPack.event) yield chatPack.event;
    try {
      const splitter = new ThinkTagSplitter();
      for await (const ev of orchestrator.provider.chat(
        { model, messages, reasoning: cot ? 'on' : 'off' },
        opts.signal,
      )) {
        // Tools are never sent, so a tool-call event cannot occur; only text
        // (and, with Chain of Thought on, the thinking) is passed on.
        // Anything else is ignored, keeping the surface inert.
        if (ev.type === 'text' && ev.delta) yield* pieces(splitter.push(ev.delta), cot);
        else if (ev.type === 'thinking' && ev.delta && cot) {
          yield { type: 'thinking', delta: ev.delta };
        }
      }
      yield* pieces(splitter.end(), cot);
      yield { type: 'done' };
    } catch (err) {
      yield { type: 'error', message: (err as Error).message };
    }
  } finally {
    lane?.busy.delete(lane.key);
  }
}

function* pieces(parts: ThoughtPiece[], cot: boolean): Generator<FreeChatEvent> {
  for (const p of parts) {
    if (p.kind === 'text') yield { type: 'text', delta: p.text };
    else if (cot) yield { type: 'thinking', delta: p.text };
  }
}

/** The text a chat carries, in bytes, over every message's content. */
function chatTextBytes(messages: unknown[]): number {
  let total = 0;
  for (const m of messages) {
    const content = (m as { content?: unknown } | null)?.content;
    if (typeof content === 'string') total += Buffer.byteLength(content, 'utf8');
  }
  return total;
}

/** Whether the provider serves this model, by its own list. A list it cannot
 *  give (an error, a timeout, an empty answer) lets the model through: the
 *  check guards a typo, it never blocks a working chat on a slow server. An
 *  Ollama name without a tag means `:latest`. */
async function modelServed(provider: Provider, model: string): Promise<boolean> {
  let listed: string[] = [];
  try {
    listed = await Promise.race([
      provider.listModels(),
      new Promise<string[]>((resolve) => {
        const timer = setTimeout(() => resolve([]), MODEL_LIST_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } catch {
    return true;
  }
  if (!listed.length) return true;
  const norm = (m: string): string => (m.includes(':') ? m : `${m}:latest`);
  return listed.some((m) => m === model || norm(m) === norm(model));
}
