// Cloud providers you can connect by API key. Connecting one puts its models on
// your Bench, so you can place, say, a big model as your Reasoning LLM and a
// cheaper one as a coding specialist. Keys live in the device Keychain, scoped
// to the provider, and are only ever spent with your approval.
//
// NOTE: model ids below should be verified against each provider's current API
// before shipping (this sandbox has no network to check them). They are wired
// so the Stack can reference them; the router (stage 3) calls them.
export interface ProviderModel {
  id: string;
  label: string;
  /** A rough capability hint, for the placement suggestion. */
  good?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  keyHint: string;
  /** OpenAI-compatible chat-completions base URL, when the router uses one. */
  openaiBaseUrl?: string;
  /** Where to sign in and copy a fresh key. Opened in an in-app browser on
   *  iOS (see openApiKeyPage in platform.ts) so getting a key never leaves
   *  the app. */
  apiKeyUrl: string;
  models: ProviderModel[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Claude',
    keyHint: 'sk-ant-...',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5', good: 'reasoning' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', good: 'coding' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', good: 'fast' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    keyHint: 'sk-...',
    openaiBaseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-5', label: 'GPT-5', good: 'reasoning' },
      { id: 'gpt-5-mini', label: 'GPT-5 mini', good: 'fast' },
    ],
  },
  {
    id: 'google',
    name: 'Gemini',
    keyHint: 'AIza...',
    openaiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', good: 'reasoning' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', good: 'fast' },
      { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', good: 'image-gen' },
    ],
  },
];

export function providerInfo(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providerModelLabel(providerId: string, modelId: string): string {
  const p = providerInfo(providerId);
  return p?.models.find((m) => m.id === modelId)?.label ?? modelId;
}

/** The secret-store key for a provider's API key. */
export function providerSecretKey(providerId: string): string {
  return `oscode.secret.${providerId}`;
}
