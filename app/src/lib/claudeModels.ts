// The Claude models a user can reach with their own API key, so OpenShore is a
// complete Claude client: every current model is listed and usable, no need to
// leave for the Claude app. Pricing and context windows are the first-party API
// rates (verified against the Claude API reference, 2026). Ordered most capable
// to fastest. Keep this the single source of truth: the cloud driver reads
// pricing and context from here, the model sheet lists from here, and
// sourceLabel names models from here.
export interface ClaudeModel {
  id: string;
  label: string;
  blurb: string;
  /** USD per 1M input tokens. */
  inPerM: number;
  /** USD per 1M output tokens. */
  outPerM: number;
  contextWindow: number;
}

export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  {
    id: 'claude-fable-5',
    label: 'Fable 5',
    blurb: 'For your toughest challenges',
    inPerM: 10,
    outPerM: 50,
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    blurb: 'For complex tasks',
    inPerM: 5,
    outPerM: 25,
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    blurb: 'Most efficient for everyday tasks',
    inPerM: 2,
    outPerM: 10,
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    blurb: 'Fastest for quick answers',
    inPerM: 1,
    outPerM: 5,
    contextWindow: 200_000,
  },
] as const;

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

export function claudeModel(id: string): ClaudeModel | undefined {
  return CLAUDE_MODELS.find((m) => m.id === id);
}

export function claudeModelLabel(id: string): string {
  return claudeModel(id)?.label ?? id;
}
