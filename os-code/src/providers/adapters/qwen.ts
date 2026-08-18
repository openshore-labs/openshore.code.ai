// Qwen family (Qwen 2.5, Qwen 2.5 Coder, Qwen 3, QwQ). Strong native tool
// calling via Hermes-style templates; likes concise, imperative system
// prompts; QwQ variants think out loud, so give the thinking a channel.
import type { ModelAdapter } from './index.js';

export const qwenAdapter: ModelAdapter = {
  family: 'qwen',
  matches: (model) => /qwen|qwq/i.test(model),
  systemPreamble: (base) =>
    [
      base,
      'Be direct and complete the task with the fewest necessary tool calls.',
      'When you call a tool, output ONLY the tool call, no commentary before it.',
    ].join('\n'),
  stopTokens: () => ['<|im_end|>'],
  toolFormat: () => 'native',
  temperature: () => 0.2,
};
