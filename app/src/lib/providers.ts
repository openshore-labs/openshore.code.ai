// Cloud providers you can connect by API key. Connecting one puts its models on
// your Bench, so you can place, say, a big model as your Reasoning LLM and a
// cheaper one as a coding specialist. Keys live in the device Keychain, scoped
// to the provider, and are only ever spent with your approval.
//
// NOTE: model ids below should be verified against each provider's current API
// before shipping (this sandbox has no network to check them). They are wired
// so the Stack can reference them; the router (stage 3) calls them.
import { nativeFetch } from './nativeFetch.js';

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
  {
    // Moonshot's Kimi models. Kimi K2 is a cloud-scale MoE that does not run
    // locally, so it lives here as a bring-your-own-key cloud provider, the
    // same way OpenAI and Gemini do, not as a local download. Moonshot's API
    // is OpenAI-compatible, so key validation and the stack router treat it
    // like any other openai-compatible provider. Model ids follow Moonshot's
    // current API; verify against their console before a release.
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    keyHint: 'sk-...',
    openaiBaseUrl: 'https://api.moonshot.ai/v1',
    apiKeyUrl: 'https://platform.moonshot.ai/console/api-keys',
    models: [
      { id: 'kimi-k2-0711-preview', label: 'Kimi K2', good: 'reasoning' },
      { id: 'kimi-latest', label: 'Kimi (latest)', good: 'reasoning' },
      { id: 'moonshot-v1-128k', label: 'Kimi 128k context', good: 'analysis' },
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

// Whether a pasted key actually works, so a mistyped key never lands as a
// cheerful "connected" that only fails later mid-chat. 'invalid' is a real
// rejection from the provider (block the save); 'unverifiable' means we could
// not reach the provider to check right now, e.g. offline or a browser CORS
// wall in dev (save, but say it is unverified rather than claim it works).
export type KeyCheck = 'valid' | 'invalid' | 'unverifiable' | 'needs-workspace';

/** The header an identity-linked Anthropic key must carry: the workspace it
 *  acts in. A workspace-scoped key needs nothing. */
export function anthropicHeaders(key: string, workspaceId?: string): Record<string, string> {
  const ws = workspaceId?.trim();
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    ...(ws ? { 'anthropic-workspace-id': ws } : {}),
  };
}

/** True when an error body is the API asking for anthropic-workspace-id. */
export function needsWorkspaceId(text: string): boolean {
  return /anthropic-workspace-id/i.test(text);
}

export const WORKSPACE_HINT =
  'This key is linked to your identity, so Claude needs the id of the workspace it acts in. Find it in the Anthropic Console under Settings, Workspaces (it starts with wrkspc_), and add it under Cloud Connections.';

export async function validateProviderKey(
  id: string,
  key: string,
  workspaceId?: string,
): Promise<KeyCheck> {
  try {
    if (id === 'anthropic') {
      const res = await nativeFetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: anthropicHeaders(key, workspaceId),
        responseType: 'json',
      });
      if (res.status === 401 || res.status === 403) return 'invalid';
      if (res.status === 400 && needsWorkspaceId(await res.text().catch(() => ''))) {
        return 'needs-workspace';
      }
      return res.ok ? 'valid' : 'unverifiable';
    }
    const info = providerInfo(id);
    if (info?.openaiBaseUrl) {
      const res = await nativeFetch(`${info.openaiBaseUrl}/models`, {
        method: 'GET',
        headers: { authorization: `Bearer ${key}` },
        responseType: 'json',
      });
      if (res.status === 401 || res.status === 403) return 'invalid';
      return res.ok ? 'valid' : 'unverifiable';
    }
    return 'unverifiable';
  } catch {
    return 'unverifiable';
  }
}
