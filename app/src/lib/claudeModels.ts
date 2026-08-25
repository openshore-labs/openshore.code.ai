// The Claude models a user can reach with their own API key, so OpenShore is a
// complete Claude client: every current model is listed and usable, no need to
// leave for the Claude app. OpenShore does not price usage. The connection runs
// on the user's own Anthropic account (subscription or pay-as-you-go), so their
// account handles all billing; when it is out of usage the driver says so and
// points to a local model. The only quantity we track is the context window, so
// the context meter reads honestly. Context windows are the first-party values
// (verified against the Claude API reference, 2026). Ordered most capable to
// fastest. Keep this the single source of truth: the cloud driver reads context
// from here, the model sheet lists from here, and sourceLabel names models here.
export interface ClaudeModel {
  id: string;
  label: string;
  blurb: string;
  contextWindow: number;
}

export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  {
    id: 'claude-fable-5',
    label: 'Fable 5',
    blurb: 'For your toughest challenges',
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    blurb: 'For complex tasks',
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    blurb: 'Most efficient for everyday tasks',
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    blurb: 'Fastest for quick answers',
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
