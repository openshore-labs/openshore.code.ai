// Chain of Thought (founder, 2026-09-25): a Settings switch, OFF by default.
// When it is on, a model's reasoning shows above its answer the way Claude
// shows it: live while the model thinks, then folded to "Thought for Ns". When
// it is off, no model is asked to think out loud and any reasoning a model
// sends anyway is kept out of the transcript.
//
// Kept dependency-free like effort.ts: the store mirrors the persisted setting
// here on load and on every change, and the drivers read it at send time, so a
// flip reaches the very next message without rebuilding a driver (the store
// imports the drivers, so they cannot import the store). The routing rules
// themselves (the <think> splitter, which models reason natively, Claude's
// thinking parameter) live in the engine and arrive through os-code/protocol,
// so the app and the desktop agree exactly.
import { chainOfThoughtPrompt, claudeThinking, reasonsNatively } from 'os-code/protocol';

let active = false;

export function setChainOfThought(on: boolean): void {
  active = on;
}

/** Whether Chain of Thought is on right now. */
export function chainOfThoughtOn(): boolean {
  return active;
}

/** The system line a model gets while Chain of Thought is on, or undefined.
 *  Only a model that does not reason through its own API is prompted; Claude
 *  and the open reasoning families are asked through their API instead. */
export function chainOfThoughtLine(model: string, on: boolean = active): string | undefined {
  return on && !reasonsNatively(model) ? chainOfThoughtPrompt() : undefined;
}

/** The Claude request fields for this turn: the thinking parameter and a
 *  max_tokens with room for it while on; the caller's own max_tokens while off. */
export function claudeRequestThinking(
  model: string,
  baseMaxTokens: number,
  on: boolean = active,
): { max_tokens: number; thinking?: ReturnType<typeof claudeThinking>['thinking'] } {
  if (!on) return { max_tokens: baseMaxTokens };
  const t = claudeThinking(model, baseMaxTokens);
  return { max_tokens: t.maxTokens, thinking: t.thinking };
}

/** The reasoning an OpenAI-compatible chunk or message carries, if any
 *  (DeepSeek-style reasoning_content, or vLLM/OpenRouter/Ollama reasoning). */
export function reasoningOf(part: unknown): string | undefined {
  const p = part as { reasoning_content?: unknown; reasoning?: unknown } | undefined;
  const r = p?.reasoning_content ?? p?.reasoning;
  return typeof r === 'string' && r ? r : undefined;
}
