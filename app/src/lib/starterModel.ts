// The one-tap starter model for a desktop with no model yet (CFO ruling: free
// users get exactly one curated starter, the full Marketplace stays Personal).
// A real coder at a size most machines can run. Both ids are pinned against the
// engine's bundled catalog by starterModel.test.ts, so a catalog rename can
// never leave this button pointing at nothing.
export const STARTER_MODEL = {
  /** Catalog id, what bridge.installModel() takes. */
  catalogId: 'qwen2.5-coder-7b',
  /** Ollama ref, what bridge.setOrchestrator() takes once it is pulled. */
  ollamaRef: 'qwen2.5-coder:7b',
  name: 'Qwen 2.5 Coder 7B',
  sizeGB: 4.7,
} as const;
