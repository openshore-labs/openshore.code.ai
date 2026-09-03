// Cloud providers you can connect by API key. Connecting one puts its models on
// your Bench, so you can place, say, a big model as your Reasoning LLM and a
// cheaper one as a coding specialist. Keys live in the device Keychain, scoped
// to the provider, and are only ever spent with your approval.
//
// NOTE: model ids below should be verified against each provider's current API
// before shipping (this sandbox has no network to check them). They are wired
// so the Stack can reference them; the router (stage 3) calls them.
import type { CapabilityCategory } from 'os-code/protocol';
import { nativeFetch } from './nativeFetch.js';

export interface ProviderModel {
  id: string;
  label: string;
  /** A rough capability hint, for the placement suggestion. */
  good?: string;
  /** Plain language: what this model is good at, for the Marketplace. */
  tagline?: string;
  /** Capability categories (router/roles.ts taxonomy), for shelves and search. */
  categories?: CapabilityCategory[];
  contextTokens?: number;
  /** The provider's public release date (YYYY-MM-DD), for the newest lens. */
  released?: string;
  /** The weights are published (open), so the model can also run elsewhere. */
  openWeights?: boolean;
  /** The Ollama cloud tag for the same model, when Ollama hosts it: a desktop
   *  with Ollama can pull it (`ollama pull <ref>`) and run it on Ollama's
   *  cloud under an Ollama account, no provider key needed. */
  ollamaCloudRef?: string;
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
      {
        id: 'claude-opus-5',
        label: 'Claude Opus 5',
        good: 'reasoning',
        tagline: 'The deepest reasoner here. Plans long work and holds the whole repo in mind.',
        categories: ['reasoning', 'coding', 'writing', 'vision'],
      },
      {
        id: 'claude-sonnet-5',
        label: 'Claude Sonnet 5',
        good: 'coding',
        tagline: 'The everyday coding brain: fast, careful edits, reliable with tools.',
        categories: ['coding', 'reasoning', 'vision'],
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        good: 'fast',
        tagline: 'Quick and cheap for trivial edits and short answers.',
        categories: ['fast', 'coding'],
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    keyHint: 'sk-...',
    openaiBaseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      {
        id: 'gpt-5',
        label: 'GPT-5',
        good: 'reasoning',
        tagline: 'A strong generalist that reasons through hard problems and reads images.',
        categories: ['reasoning', 'coding', 'writing', 'vision'],
      },
      {
        id: 'gpt-5-mini',
        label: 'GPT-5 mini',
        good: 'fast',
        tagline: 'The quick lane: cheap, brisk answers for small tasks.',
        categories: ['fast', 'coding'],
      },
    ],
  },
  {
    id: 'google',
    name: 'Gemini',
    keyHint: 'AIza...',
    openaiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    models: [
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        good: 'reasoning',
        tagline: 'A million tokens of context. Reads whole codebases and long documents.',
        categories: ['reasoning', 'analysis', 'vision', 'coding'],
        contextTokens: 1_048_576,
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        good: 'fast',
        tagline: 'Fast and inexpensive, with the same long context.',
        categories: ['fast', 'vision'],
        contextTokens: 1_048_576,
      },
      {
        id: 'gemini-2.5-flash-image',
        label: 'Gemini 2.5 Flash Image',
        good: 'image-gen',
        tagline: 'Generates and edits images from a prompt.',
        categories: ['image-gen', 'vision'],
      },
    ],
  },
  {
    // Moonshot's Kimi models. They are trillion-parameter mixtures of experts
    // that do not run on a laptop, so they live here as a bring-your-own-key
    // cloud provider, the same way OpenAI and Gemini do, not as a local
    // download. Moonshot's API is OpenAI-compatible, so key validation and the
    // stack router treat it like any other openai-compatible provider.
    //
    // Lineup as of 2026-09 (Moonshot's platform docs, cross-checked against
    // OpenRouter, Ollama, and the Kimi Code CLI docs): kimi-k3 is the flagship
    // (API 2026-07-16, weights 2026-07-27), kimi-k2.7-code the coding model
    // (2026-06-12), kimi-k2.6 the open all-rounder (2026-04-20). The kimi-k2
    // preview ids were retired 2026-05-25 and kimi-k2.5 plus the moonshot-v1
    // series sunset 2026-08-31, so none of those may be listed: a retired id
    // is a dead button in the stack. Same models are on Ollama's cloud under
    // the :cloud tags below.
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    keyHint: 'sk-...',
    openaiBaseUrl: 'https://api.moonshot.ai/v1',
    apiKeyUrl: 'https://platform.kimi.ai/console/api-keys',
    models: [
      {
        id: 'kimi-k3',
        label: 'Kimi K3',
        good: 'reasoning',
        tagline:
          'The flagship. A million tokens of context, reads images, runs long agent sessions.',
        categories: ['reasoning', 'coding', 'vision', 'analysis'],
        contextTokens: 1_048_576,
        released: '2026-07-16',
        openWeights: true,
        ollamaCloudRef: 'kimi-k3:cloud',
      },
      {
        id: 'kimi-k2.7-code',
        label: 'Kimi K2.7 Code',
        good: 'coding',
        tagline: 'Built for agentic coding. Leaner reasoning than K2.6 on the same repo work.',
        categories: ['coding', 'reasoning'],
        contextTokens: 262_144,
        released: '2026-06-12',
        openWeights: true,
        ollamaCloudRef: 'kimi-k2.7-code:cloud',
      },
      {
        id: 'kimi-k2.7-code-highspeed',
        label: 'Kimi K2.7 Code (high speed)',
        good: 'fast',
        tagline: 'The same coding model on a faster lane, for quick edits.',
        categories: ['fast', 'coding'],
        contextTokens: 262_144,
        released: '2026-06-12',
        openWeights: true,
      },
      {
        id: 'kimi-k2.6',
        label: 'Kimi K2.6',
        good: 'reasoning',
        tagline: 'The open all-rounder: long-horizon coding, design work, and reads images.',
        categories: ['reasoning', 'coding', 'writing', 'vision'],
        contextTokens: 262_144,
        released: '2026-04-20',
        openWeights: true,
        ollamaCloudRef: 'kimi-k2.6:cloud',
      },
    ],
  },
];

/** Provider model ids their provider has retired. Listing one would be a dead
 *  button in the stack, so a test pins that none of these appear. */
export const RETIRED_PROVIDER_MODEL_IDS = [
  'kimi-k2-0711-preview',
  'kimi-k2-turbo-preview',
  'kimi-k2.5',
  'moonshot-v1-8k',
  'moonshot-v1-32k',
  'moonshot-v1-128k',
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
