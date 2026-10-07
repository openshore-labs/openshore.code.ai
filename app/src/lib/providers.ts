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
  /** The models come from the provider's own GET {base}/models once a key is
   *  connected, never a list typed here: a router carries hundreds and they
   *  change weekly, so a typed list would be dead buttons by the next week
   *  (connect-anywhere, 2026-10-07). The person's picks are kept on this
   *  device (settings.providerModels) and put back at launch. */
  liveModels?: boolean;
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
        tagline:
          'The deepest reasoner here. Plans long work and holds the whole repository in mind.',
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
        tagline:
          'Built for agentic coding. Leaner reasoning than K2.6 on the same repository work.',
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
  {
    // Perplexity's Sonar models. Every Sonar completion runs a live web search
    // and grounds its answer with citations, so it is a search engine with a
    // language model on top, not a plain chat model: a call always reaches the
    // network and costs more than its token count implies, and the payoff is a
    // current, sourced answer. It is OpenAI-compatible (POST /chat/completions
    // under api.perplexity.ai, swap base URL and model id), so key validation
    // and the stack router treat it like any other openai-compatible provider,
    // and a Sonar model places into a stack slot like the rest.
    //
    // Two honesty notes carried from the CTO review:
    //   1. Sonar returns its sources as top-level `citations`/`search_results`
    //      fields outside the OpenAI schema, which the plain openai-compatible
    //      driver path drops. Threading those through the driver event stream
    //      (the app already renders webSearch citations) is the open follow-up
    //      before a Sonar bench model is the best it can be.
    //   2. Model ids below are the 2026-09 Sonar lineup and, like every id in
    //      this file, must be verified against the live API before a release:
    //      a retired id is a dead button in the stack.
    id: 'perplexity',
    name: 'Perplexity',
    keyHint: 'pplx-...',
    openaiBaseUrl: 'https://api.perplexity.ai',
    apiKeyUrl: 'https://www.perplexity.ai/account/api/keys',
    models: [
      {
        id: 'sonar',
        label: 'Sonar',
        good: 'fast',
        tagline: 'Quick, cited web answers. Searches the live web on every turn.',
        categories: ['fast', 'analysis'],
      },
      {
        id: 'sonar-pro',
        label: 'Sonar Pro',
        good: 'analysis',
        tagline: 'Broader search with more sources per answer, for research that needs depth.',
        categories: ['analysis', 'writing'],
      },
      {
        id: 'sonar-reasoning-pro',
        label: 'Sonar Reasoning Pro',
        good: 'reasoning',
        tagline: 'Reasons step by step over live search results. For hard, current questions.',
        categories: ['reasoning', 'analysis'],
      },
      {
        id: 'sonar-deep-research',
        label: 'Sonar Deep Research',
        good: 'analysis',
        tagline: 'Runs an exhaustive multi-search report. Slow and thorough, higher cost.',
        categories: ['analysis', 'writing'],
      },
    ],
  },
  {
    // Venice: open models behind one OpenAI-compatible key (founder,
    // 2026-10-07, "my buddy uses Venice"). Its policy says it keeps no prompts
    // or outputs, and that some models are served through other providers it
    // binds not to train on them. We cannot check either, so copy only ever
    // says "Venice says". Models load live (liveModels).
    id: 'venice',
    name: 'Venice',
    keyHint: 'a Venice API key',
    openaiBaseUrl: 'https://api.venice.ai/api/v1',
    apiKeyUrl: 'https://venice.ai/settings/api',
    models: [],
    liveModels: true,
  },
  {
    // OpenRouter: one key and one bill for models from many providers. It
    // forwards each request to that model's own provider, whose policy then
    // applies. Models load live; a first set is picked for you and you
    // choose the rest (pickLiveModels).
    id: 'openrouter',
    name: 'OpenRouter',
    keyHint: 'sk-or-...',
    openaiBaseUrl: 'https://openrouter.ai/api/v1',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    models: [],
    liveModels: true,
  },
];

/** A model as a provider's live list describes it, before the person picks. */
export interface LiveModel extends ProviderModel {
  /** It takes tool calls, so it can drive the coding agent. */
  tools: boolean;
  /** When the provider added it (seconds since 1970), for "newest first". */
  created?: number;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** A provider's GET /models answer, read the way both live providers write
 *  it: OpenAI's `data` array, with Venice's `model_spec` or OpenRouter's
 *  `architecture` and `supported_parameters` beside it. Only models that
 *  answer in text and are not marked offline; anything unreadable is left
 *  out rather than guessed at. */
export function parseLiveModels(providerId: string, body: unknown): LiveModel[] {
  const rows = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: LiveModel[] = [];
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = str(r.id);
    if (!id || seen.has(id)) continue;
    if (r.type !== undefined && r.type !== 'text') continue;
    const spec = (r.model_spec ?? {}) as Record<string, unknown>;
    if (spec.offline === true) continue;
    const arch = (r.architecture ?? {}) as Record<string, unknown>;
    const outputs = arch.output_modalities;
    if (Array.isArray(outputs) && !outputs.includes('text')) continue;
    const inputs = Array.isArray(arch.input_modalities) ? arch.input_modalities : [];
    const caps = (spec.capabilities ?? {}) as Record<string, unknown>;
    const params = Array.isArray(r.supported_parameters) ? r.supported_parameters : [];
    const vision = caps.supportsVision === true || inputs.includes('image');
    const tools = caps.supportsFunctionCalling === true || params.includes('tools');
    const contextTokens = num(spec.availableContextTokens) ?? num(r.context_length);
    const created = num(r.created);
    seen.add(id);
    out.push({
      id,
      label: str(spec.name) ?? str(r.name) ?? id,
      tagline: liveTagline(providerId, spec.privacy),
      categories: [
        ...(tools ? (['coding', 'reasoning'] as const) : (['writing'] as const)),
        ...(vision ? (['vision'] as const) : []),
      ],
      ...(contextTokens ? { contextTokens } : {}),
      ...(created
        ? { created, released: new Date(created * 1000).toISOString().slice(0, 10) }
        : {}),
      tools,
    });
  }
  return out;
}

/** One honest line per live model: whose words a privacy claim is, never ours. */
function liveTagline(providerId: string, privacy: unknown): string {
  if (providerId === 'venice') {
    if (privacy === 'private') return 'On Venice, on your key. Venice says it keeps no prompts.';
    if (privacy === 'anonymized')
      return 'On Venice, on your key. Venice passes it to another provider without your name.';
    return 'On Venice, on your key.';
  }
  if (providerId === 'openrouter') {
    return "Through OpenRouter, on your key. It goes on to the model's own provider.";
  }
  return 'On your key.';
}

/** The makers whose newest model a first OpenRouter connection picks, so the
 *  Bench opens with a sensible set instead of hundreds. By maker, never by a
 *  model id typed here: the newest one each maker lists is taken. */
const OPENROUTER_FIRST_MAKERS = [
  'anthropic',
  'openai',
  'google',
  'moonshotai',
  'qwen',
  'deepseek',
  'x-ai',
  'mistralai',
  'meta-llama',
  'z-ai',
];

/** How many models a first connection puts on the Bench at most. */
export const LIVE_FIRST_PICKS_MAX = 24;

/** The models a first connection puts on the Bench: every one Venice lists
 *  (it lists few), and for OpenRouter the newest model each well-known maker
 *  offers that can take tool calls. The person changes the set any time. */
export function pickLiveModels(providerId: string, all: LiveModel[]): LiveModel[] {
  if (providerId !== 'openrouter') return all.slice(0, LIVE_FIRST_PICKS_MAX);
  const picks: LiveModel[] = [];
  for (const maker of OPENROUTER_FIRST_MAKERS) {
    const newest = all
      .filter((m) => m.tools && m.id.startsWith(`${maker}/`) && !m.id.endsWith(':free'))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
    if (newest) picks.push(newest);
  }
  return picks;
}

/** Put the person's picks for a live provider on the list every reader uses
 *  (the Bench, the model menu, the Marketplace shelf, context windows), in
 *  place, so nothing that reads PROVIDERS needs to know a list came live. */
export function applyLiveModels(providerId: string, models: ProviderModel[]): void {
  const info = providerInfo(providerId);
  if (!info?.liveModels) return;
  info.models.splice(
    0,
    info.models.length,
    ...models.map((m) => ({
      id: m.id,
      label: m.label,
      ...(m.tagline ? { tagline: m.tagline } : {}),
      ...(m.categories ? { categories: m.categories } : {}),
      ...(m.contextTokens ? { contextTokens: m.contextTokens } : {}),
      ...(m.released ? { released: m.released } : {}),
    })),
  );
}

/** A live provider's whole list, on the person's key. Undefined when it could
 *  not be read (offline, a rejected key), so the caller keeps what it had. */
export async function fetchLiveModels(
  providerId: string,
  key: string,
): Promise<LiveModel[] | undefined> {
  const info = providerInfo(providerId);
  if (!info?.openaiBaseUrl || !info.liveModels) return undefined;
  try {
    const res = await nativeFetch(`${info.openaiBaseUrl}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}` },
      responseType: 'json',
    });
    if (!res.ok) return undefined;
    const models = parseLiveModels(providerId, await res.json());
    return models.length ? models : undefined;
  } catch {
    return undefined;
  }
}

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

/** Whether a provider model can read images (its catalog lists the vision
 *  capability), so the composer offers the attach button only where it works. */
export function providerModelVision(providerId: string, modelId: string): boolean {
  return Boolean(
    providerInfo(providerId)
      ?.models.find((m) => m.id === modelId)
      ?.categories?.includes('vision'),
  );
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
  'This API key is linked to your identity, so Claude needs the id of the workspace it acts in. Find it in the Anthropic Console under Settings, Workspaces (it starts with wrkspc_), and add it under Cloud Connections.';

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
