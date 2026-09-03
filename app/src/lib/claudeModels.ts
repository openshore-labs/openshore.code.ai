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
  /** A one-line description, in the Claude app's shape. The older models in the
   *  "more" tier carry none, matching how the app lists them plainly. */
  blurb?: string;
  contextWindow: number;
  /** `primary` is the current lineup shown first (the Claude app's top list);
   *  `more` is the older, still-reachable models behind "More models". */
  tier: 'primary' | 'more';
}

// The lineup mirrors the Claude app's model picker: the current family up top,
// the older releases behind "More models". A user reaches every one on their own
// key, and can pin any as a favorite. Ordered most capable first within a tier.
//
// NOTE: the `more` tier's ids and context windows follow the house convention
// and Claude 4-era 200K windows; verify each against the Claude API reference
// (this sandbox has no network) before a device ship, so no row is a dead button
// and the context meter reads honestly.
export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  {
    id: 'claude-fable-5-1',
    label: 'Fable 5.1',
    blurb: 'For your toughest challenges',
    contextWindow: 1_000_000,
    tier: 'primary',
  },
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    blurb: 'For complex tasks',
    contextWindow: 1_000_000,
    tier: 'primary',
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    blurb: 'Most efficient for everyday tasks',
    contextWindow: 1_000_000,
    tier: 'primary',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    blurb: 'Fastest for quick answers',
    contextWindow: 200_000,
    tier: 'primary',
  },
  { id: 'claude-fable-5', label: 'Fable 5', contextWindow: 1_000_000, tier: 'more' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', contextWindow: 200_000, tier: 'more' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', contextWindow: 200_000, tier: 'more' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', contextWindow: 200_000, tier: 'more' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', contextWindow: 200_000, tier: 'more' },
] as const;

/** The current lineup, shown first. */
export const CLAUDE_MODELS_PRIMARY = CLAUDE_MODELS.filter((m) => m.tier === 'primary');
/** The older, still-reachable models behind "More models". */
export const CLAUDE_MODELS_MORE = CLAUDE_MODELS.filter((m) => m.tier === 'more');

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

export function claudeModel(id: string): ClaudeModel | undefined {
  return CLAUDE_MODELS.find((m) => m.id === id);
}

export function claudeModelLabel(id: string): string {
  return claudeModel(id)?.label ?? id;
}
