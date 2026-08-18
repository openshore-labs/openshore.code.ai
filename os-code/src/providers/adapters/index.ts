// Per-model prompt adapters. Claude-tuned prompts port poorly to local
// models: each family has its own chat-template quirks, stop tokens, and
// tolerance for tool formats. The adapter shapes the system prompt and tool
// guidance per family; the generic adapter is deliberately conservative.

export interface ModelAdapter {
  family: string;
  matches(model: string): boolean;
  /** Rework the base system prompt into the phrasing this family follows best. */
  systemPreamble(base: string): string;
  stopTokens(): string[];
  /** Native OpenAI-style tools, or JSON-in-text through the bridge. */
  toolFormat(): 'native' | 'json-text';
  /** Recommended sampling temperature for agentic work. */
  temperature(): number | undefined;
}

export const genericAdapter: ModelAdapter = {
  family: 'generic',
  matches: () => true,
  systemPreamble: (base) => base,
  stopTokens: () => [],
  toolFormat: () => 'native',
  temperature: () => 0.2,
};

import { qwenAdapter } from './qwen.js';
import { llamaAdapter } from './llama.js';

const ADAPTERS: ModelAdapter[] = [qwenAdapter, llamaAdapter];

export function adapterFor(model: string): ModelAdapter {
  return ADAPTERS.find((a) => a.matches(model)) ?? genericAdapter;
}
