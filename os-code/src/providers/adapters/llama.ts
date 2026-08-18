// Llama family (Llama 3.x, CodeLlama descendants). Native tool support is
// template-dependent and flaky on smaller quants, so this adapter prefers the
// JSON-in-text bridge, which the parser handles with repair and, where the
// backend allows, grammar-constrained decoding.
import type { ModelAdapter } from './index.js';

export const llamaAdapter: ModelAdapter = {
  family: 'llama',
  matches: (model) => /llama|codellama/i.test(model),
  systemPreamble: (base) =>
    [
      base,
      'Follow the tool-call format exactly. Never invent tool names.',
      'Think briefly, act, then report what you did in one or two sentences.',
    ].join('\n'),
  stopTokens: () => ['<|eot_id|>'],
  toolFormat: () => 'json-text',
  temperature: () => 0.15,
};
