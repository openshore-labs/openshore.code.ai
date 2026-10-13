// Cloud providers you can connect by API key. Connecting one puts its models on
// your Bench, so you can place, say, a big model as your Reasoning model and a
// cheaper one as a coding specialist. Keys live in the device Keychain, scoped
// to the provider, and are only ever spent with your approval.
//
// NOTE: model ids below should be verified against each provider's current API
// before shipping (this sandbox has no network to check them). They are wired
// so the Stack can reference them; the router (stage 3) calls them.
import type { CapabilityCategory } from 'os-code/protocol';
import { nativeFetch } from './nativeFetch.js';
import { CLAUDE_MODELS, claudeModelLabel, visionFallbackClaudeModel } from './claudeModels.js';

export interface ProviderModel {
  id: string;
  label: string;
  /** A rough capability hint, for the placement suggestion. */
  good?: string;
  /** Plain language: what this model is good at, for the Local Library. */
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
  /** Listed under More providers in Cloud Connections until its key is in,
   *  so the room keeps its familiar seven at the top (2026-10-09). */
  more?: boolean;
  /** The statuses its key check reads as a rejected key, when a provider
   *  answers a bad key with more than 401 or 403 (xAI answers 400). */
  rejectsWith?: number[];
  /** Other words More providers' search finds it by (xAI's Grok). */
  searchTerms?: string[];
  /** One line under the key field, when the provider's key needs a word
   *  more than where to get it (Hugging Face's token permission). */
  keyNote?: string;
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
    // Two honesty notes carried from the tech review:
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
    // Venice: open models behind one OpenAI-compatible key (maintainer,
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
  // Named providers on your own key (2026-10-09: bring your own keys,
  // any provider; OpenShore runs no gateway and resells nothing). Each one's
  // OpenAI-compatible base is the one its own documentation gives (read
  // 2026-10-09). Not every model list's shape is confirmed there: DeepSeek's,
  // Mistral's, Cerebras's, Hugging Face's, Novita's and MiniMax's are;
  // Groq's, Together's (a bare list), xAI's, Nebius's wrapper and NVIDIA's
  // are modeled on community code, SDKs and mirrors until a real answer is
  // pinned. Away from the desktop, anyone else connects by its address in
  // the Stack.
  // Models load live on the person's key, nothing is typed here, and nothing
  // here says a provider is private or fast. A key page whose exact path no
  // documentation confirmed opens the provider's console instead. A key hint
  // is the key's prefix only where the provider documents one.
  {
    id: 'groq',
    name: 'Groq',
    keyHint: 'a Groq API key',
    openaiBaseUrl: 'https://api.groq.com/openai/v1',
    apiKeyUrl: 'https://console.groq.com',
    models: [],
    liveModels: true,
    more: true,
  },
  {
    id: 'together',
    name: 'Together AI',
    keyHint: 'a Together AI API key',
    openaiBaseUrl: 'https://api.together.ai/v1',
    apiKeyUrl: 'https://api.together.ai',
    models: [],
    liveModels: true,
    more: true,
  },
  {
    // DeepSeek's /models and /chat/completions sit at the root, with no /v1.
    id: 'deepseek',
    name: 'DeepSeek',
    keyHint: 'a DeepSeek API key',
    openaiBaseUrl: 'https://api.deepseek.com',
    apiKeyUrl: 'https://platform.deepseek.com',
    models: [],
    liveModels: true,
    more: true,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    keyHint: 'a Mistral API key',
    openaiBaseUrl: 'https://api.mistral.ai/v1',
    apiKeyUrl: 'https://admin.mistral.ai/plateforme/api-keys',
    models: [],
    liveModels: true,
    more: true,
  },
  {
    // xAI answers a bad key with 400, not 401.
    id: 'xai',
    name: 'xAI',
    keyHint: 'an xAI API key',
    openaiBaseUrl: 'https://api.x.ai/v1',
    apiKeyUrl: 'https://console.x.ai',
    models: [],
    liveModels: true,
    more: true,
    rejectsWith: [400],
    searchTerms: ['grok'],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    keyHint: 'a Cerebras API key',
    openaiBaseUrl: 'https://api.cerebras.ai/v1',
    apiKeyUrl: 'https://cloud.cerebras.ai',
    models: [],
    liveModels: true,
    more: true,
  },
  {
    // A fine-grained token needs the "Make calls to Inference Providers"
    // permission, and nothing more: the key note says so, so a token that
    // can write to the person's repositories is never the one asked for.
    // The router forwards each request to one of the providers listed for
    // that model, whose policy then applies.
    id: 'huggingface',
    name: 'Hugging Face',
    keyHint: 'hf_...',
    openaiBaseUrl: 'https://router.huggingface.co/v1',
    apiKeyUrl: 'https://huggingface.co/settings/tokens',
    models: [],
    liveModels: true,
    more: true,
    searchTerms: ['hf'],
    keyNote:
      'Make a fine-grained token with only the "Make calls to Inference Providers" permission. OpenShore needs nothing more.',
  },
  {
    // Nebius AI Studio's successor (2025-11).
    id: 'nebius',
    name: 'Nebius Token Factory',
    keyHint: 'a Nebius API key',
    openaiBaseUrl: 'https://api.tokenfactory.nebius.com/v1',
    apiKeyUrl: 'https://tokenfactory.nebius.com',
    models: [],
    liveModels: true,
    more: true,
    searchTerms: ['ai studio'],
  },
  {
    id: 'novita',
    name: 'Novita AI',
    keyHint: 'sk_...',
    openaiBaseUrl: 'https://api.novita.ai/openai/v1',
    apiKeyUrl: 'https://novita.ai/settings/key-management',
    models: [],
    liveModels: true,
    more: true,
  },
  {
    // The international platform; an account in mainland China uses another
    // host.
    id: 'minimax',
    name: 'MiniMax',
    keyHint: 'a MiniMax API key',
    openaiBaseUrl: 'https://api.minimax.io/v1',
    apiKeyUrl: 'https://platform.minimax.io',
    models: [],
    liveModels: true,
    more: true,
  },
  {
    // The build.nvidia.com key, not an NGC key.
    id: 'nvidia',
    name: 'NVIDIA',
    keyHint: 'nvapi-...',
    openaiBaseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyUrl: 'https://build.nvidia.com/settings/api-keys',
    models: [],
    liveModels: true,
    more: true,
    searchTerms: ['nim'],
  },
];

/** A model as a provider's live list describes it, before the person picks. */
export interface LiveModel extends ProviderModel {
  /** It takes tool calls, so it can drive the coding agent. */
  tools: boolean;
  /** The list says nothing either way about tool calls (a plain OpenAI
   *  list), so nothing here claims it takes them or does not. */
  toolsUnknown?: boolean;
  /** When the provider added it (seconds since 1970), for "newest first". */
  created?: number;
  /** Other ids the list gives the same model (Mistral's aliases), so a first
   *  set takes it once. */
  aliases?: string[];
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** Row types that are chat models: Venice's text, Together's chat, and an
 *  Anthropic-shaped list's model. Mistral's base and fine-tuned cards count
 *  when their capabilities say they chat. Any other type is left out. */
const CHAT_TYPES = new Set(['text', 'chat', 'model']);
const CARD_TYPES = new Set(['base', 'fine-tuned']);

/** A plain list (Groq, DeepSeek, xAI, Cerebras, MiniMax, NVIDIA, Nebius) says
 *  nothing about what a row is, so a row whose id plainly names an embedding,
 *  rerank, speech, image, or safety model is left out. Only such rows: a row
 *  that says what it is is taken at its word. */
const NOT_CHAT_ID =
  /embed|rerank|whisper|guard|moderation|transcri|(?:^|[^a-z0-9])(?:tts|asr|ocr|image|imagen|imagine|audio|speech|video|music|reward|bge|e5|flux|sdxl|stable-diffusion)(?![a-z])/i;

/** A provider's "created" before 2020 is no release date (NVIDIA stamps
 *  every row 1993), so it never reads as one. */
const RELEASED_FLOOR = Date.UTC(2020, 0, 1) / 1000;

/** A provider's GET /models answer, read the way each named provider writes
 *  it: OpenAI's `data` array or a bare array (Together), with Venice's
 *  `model_spec`, OpenRouter's and Hugging Face's `architecture`, OpenRouter's
 *  `supported_parameters`, Mistral's `capabilities`, Hugging Face's
 *  per-provider `providers`, or nothing beside it. Only chat models that
 *  answer in text and are not marked offline or inactive; anything unreadable
 *  is left out rather than guessed at. */
export function parseLiveModels(providerId: string, body: unknown): LiveModel[] {
  const rows = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: LiveModel[] = [];
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = str(r.id);
    if (!id || seen.has(id)) continue;
    // Mistral's card: what the model does, and what it takes.
    const card = obj(r.capabilities);
    if (r.type !== undefined) {
      const type = typeof r.type === 'string' ? r.type : '';
      const chats =
        CHAT_TYPES.has(type) || (CARD_TYPES.has(type) && card?.completion_chat === true);
      if (!chats) continue;
    }
    if (card?.completion_chat === false) continue;
    if (r.active === false) continue;
    const spec = (r.model_spec ?? {}) as Record<string, unknown>;
    if (spec.offline === true) continue;
    const arch = (r.architecture ?? {}) as Record<string, unknown>;
    const outputs = arch.output_modalities;
    if (Array.isArray(outputs) && !outputs.includes('text')) continue;
    const saysWhat = typeof r.type === 'string' || Array.isArray(outputs) || Boolean(card);
    if (!saysWhat && NOT_CHAT_ID.test(id)) continue;
    const inputs = Array.isArray(arch.input_modalities) ? arch.input_modalities : [];
    const caps = (spec.capabilities ?? {}) as Record<string, unknown>;
    const params = Array.isArray(r.supported_parameters) ? r.supported_parameters : undefined;
    // Hugging Face lists each provider that serves the model: it takes tools
    // when one does, and its window is the smallest one served.
    const hosts = (Array.isArray(r.providers) ? r.providers : []).map((p) => obj(p) ?? {});
    const vision =
      caps.supportsVision === true || inputs.includes('image') || card?.vision === true;
    const tools =
      caps.supportsFunctionCalling === true ||
      Boolean(params?.includes('tools')) ||
      card?.function_calling === true ||
      r.supports_tools === true ||
      hosts.some((p) => p.supports_tools === true);
    const toolsSaid =
      Boolean(obj(spec.capabilities)) ||
      Boolean(params) ||
      Boolean(card) ||
      typeof r.supports_tools === 'boolean' ||
      hosts.some((p) => typeof p.supports_tools === 'boolean');
    const hostWindows = hosts.map((p) => num(p.context_length)).filter((n) => n !== undefined);
    const contextTokens =
      num(spec.availableContextTokens) ??
      num(r.context_length) ??
      num(r.context_window) ??
      num(r.max_context_length) ??
      (hostWindows.length ? Math.min(...hostWindows) : undefined);
    const created = num(r.created);
    const aliases = (Array.isArray(r.aliases) ? r.aliases : [])
      .map(str)
      .filter((a): a is string => Boolean(a) && a !== id);
    seen.add(id);
    out.push({
      id,
      label: str(spec.name) ?? str(r.name) ?? str(r.display_name) ?? id,
      tagline: liveTagline(providerId),
      categories: [
        ...(tools ? (['coding', 'reasoning'] as const) : (['writing'] as const)),
        ...(vision ? (['vision'] as const) : []),
      ],
      ...(contextTokens ? { contextTokens } : {}),
      ...(created ? { created } : {}),
      ...(created && created >= RELEASED_FLOOR
        ? { released: new Date(created * 1000).toISOString().slice(0, 10) }
        : {}),
      tools,
      ...(toolsSaid ? {} : { toolsUnknown: true }),
      ...(aliases.length ? { aliases } : {}),
    });
  }
  // A list that stamps every row alike (one stamped when it is asked, as
  // Mistral's may be) dates none of them: the stamp is no release date, and
  // no order for newest first.
  const stamps = out.flatMap((m) => (m.created === undefined ? [] : [m.created]));
  if (stamps.length >= 2 && new Set(stamps).size === 1) {
    for (const m of out) {
      delete m.created;
      delete m.released;
    }
  }
  return out;
}

/** One honest line per live model: whose words a privacy claim is, never ours. */
function liveTagline(providerId: string): string {
  // No privacy words for Venice yet (tech review 2026-10-08): the field they
  // would read is unconfirmed until a real /models answer is pinned as a
  // fixture, and a saved tagline would go stale when Venice changes a model.
  if (providerId === 'venice') return 'On Venice, on your key.';
  if (providerId === 'openrouter') {
    return "Through OpenRouter, on your key. It goes on to the model's own provider.";
  }
  if (providerId === 'huggingface') {
    return 'Through Hugging Face, on your key. It goes on to one of the providers it lists for the model.';
  }
  const name = providerInfo(providerId)?.name;
  return name ? `On ${name}, on your key.` : 'On your key.';
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
 *  (it lists few), for OpenRouter the newest model each well-known maker
 *  offers that can take tool calls, and for any other provider its models
 *  that take tool calls first (then those its list says nothing about),
 *  newest first where the list dates them, each model once. The person
 *  changes the set any time. */
export function pickLiveModels(providerId: string, all: LiveModel[]): LiveModel[] {
  if (providerId === 'venice') return all.slice(0, LIVE_FIRST_PICKS_MAX);
  if (providerId !== 'openrouter') return firstPicks(all);
  const picks: LiveModel[] = [];
  for (const maker of OPENROUTER_FIRST_MAKERS) {
    const newest = all
      .filter((m) => m.tools && m.id.startsWith(`${maker}/`) && !m.id.endsWith(':free'))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
    if (newest) picks.push(newest);
  }
  return picks;
}

function firstPicks(all: LiveModel[]): LiveModel[] {
  const rank = (m: LiveModel) => (m.tools ? 2 : m.toolsUnknown ? 1 : 0);
  const ordered = all
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(b.m) - rank(a.m) || (b.m.created ?? 0) - (a.m.created ?? 0) || a.i - b.i)
    .map((x) => x.m);
  const taken = new Set<string>();
  const picks: LiveModel[] = [];
  for (const m of ordered) {
    if (picks.length >= LIVE_FIRST_PICKS_MAX) break;
    // Once, whichever of its ids the list gives first, and whichever row
    // names the other.
    if (taken.has(m.id) || m.aliases?.some((a) => taken.has(a))) continue;
    picks.push(m);
    taken.add(m.id);
    for (const a of m.aliases ?? []) taken.add(a);
  }
  return picks;
}

/** Put the person's picks for a live provider on the list every reader uses
 *  (the Bench, the model menu, the Local Library shelf, context windows), in
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

/** A cloud provider's selectable models for the bench. Claude comes from the
 *  full client lineup (claudeModels.ts, the same list and tiers the chat sheet
 *  uses), so the bench offers every Claude model and its favorites, not the
 *  short Local Library set; other providers keep their own model list. */
export type BenchModel = { id: string; label: string; tier?: 'primary' | 'more' };
export function providerBenchModels(p: ProviderInfo): BenchModel[] {
  return p.id === 'anthropic'
    ? CLAUDE_MODELS.map((m) => ({ id: m.id, label: m.label, tier: m.tier }))
    : p.models.map((m) => ({ id: m.id, label: m.label }));
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

/** A cloud model that can read an image the stack has no reader for. */
export interface CloudImageReader {
  provider: string;
  model: string;
  /** The name the Stack, the approval card and a play's brief all show. */
  label: string;
}

/** The cloud models an image may go to when nothing in the stack reads it, in
 *  the order they are tried: Claude's image reader first (the least costly
 *  Claude model, visionFallbackClaudeModel, kept and named by a maintainer on
 *  2026-10-07, D13), then each other provider's first model that reads images.
 *  The chat path takes the first one it can reach with a stored key, and the
 *  Stack's Image reading rows name the first one connected, so the row and the
 *  card always name the same model. A label that already carries the
 *  provider's name is not prefixed again ("Gemini 2.5 Pro", never "Gemini
 *  Gemini 2.5 Pro"). */
export function cloudImageReaders(): CloudImageReader[] {
  const claude = visionFallbackClaudeModel();
  const out: CloudImageReader[] = [
    { provider: 'anthropic', model: claude.id, label: `Claude ${claudeModelLabel(claude.id)}` },
  ];
  for (const p of PROVIDERS) {
    if (p.id === 'anthropic') continue;
    const m = p.models.find((x) => x.categories?.includes('vision'));
    if (!m) continue;
    const brand = p.name.split(' ')[0]!;
    out.push({
      provider: p.id,
      model: m.id,
      label: m.label.startsWith(brand) ? m.label : `${p.name} ${m.label}`,
    });
  }
  return out;
}

/** The secret-store key for a provider's API key. */
export function providerSecretKey(providerId: string): string {
  return `oscode.secret.${providerId}`;
}

// Whether a pasted key actually works, so a mistyped key never lands as a
// cheerful "connected" that only fails later mid-chat. 'invalid' is a real
// rejection from the provider (block the save); 'unverifiable' means we could
// not reach the provider to check right now, e.g. offline or a browser CORS
// wall in dev (save, but say it is unverified rather than claim it works);
// 'unchecked' means the provider answered, but it answers a made-up key the
// same way, so its answer says nothing about this one (save, and say the
// first chat is the check).
export type KeyCheck = 'valid' | 'invalid' | 'unverifiable' | 'unchecked' | 'needs-workspace';

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

/** The model the key check counts tokens against: the cheapest Claude here,
 *  read from the list so a lineup change cannot leave the probe stale. */
const ANTHROPIC_PROBE_MODEL =
  PROVIDERS.find((p) => p.id === 'anthropic')?.models.at(-1)?.id ?? 'claude-haiku-4-5';

/** The key the control ask sends: plainly not a key, so a provider that
 *  answers it with its list is not checking keys there. */
export const KEY_CHECK_CONTROL = 'oscode-key-check-not-a-key';

/** Whether a key check's answer is the provider turning the key down: 401 or
 *  403 everywhere, and a provider's own status where it uses another (xAI
 *  answers a bad key with 400), so a mistyped key never saves as unverified. */
export function keyRejectedBy(info: Pick<ProviderInfo, 'rejectsWith'>, status: number): boolean {
  return status === 401 || status === 403 || Boolean(info.rejectsWith?.includes(status));
}

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
      if (!res.ok) return 'unverifiable';
      // Listing models can pass where a chat is refused: an identity-linked
      // key reads /v1/models without a workspace, then every message asks for
      // one (maintainer's phone, 2026-10-08). Counting tokens takes the message
      // path's auth and costs nothing, so the check asks it too.
      const probe = await nativeFetch('https://api.anthropic.com/v1/messages/count_tokens', {
        method: 'POST',
        headers: { ...anthropicHeaders(key, workspaceId), 'content-type': 'application/json' },
        body: JSON.stringify({
          model: ANTHROPIC_PROBE_MODEL,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        responseType: 'json',
      });
      if (probe.status === 401 || probe.status === 403) return 'invalid';
      if (probe.status === 400 && needsWorkspaceId(await probe.text().catch(() => ''))) {
        return 'needs-workspace';
      }
      return 'valid';
    }
    const info = providerInfo(id);
    if (info?.openaiBaseUrl) {
      const ask = (bearer: string) =>
        nativeFetch(`${info.openaiBaseUrl}/models`, {
          method: 'GET',
          headers: { authorization: `Bearer ${bearer}` },
          responseType: 'json',
        });
      const res = await ask(key);
      if (keyRejectedBy(info, res.status)) return 'invalid';
      if (!res.ok) return 'unverifiable';
      // A list some providers serve to anyone would pass any string, so a
      // yes counts only once the same ask with a made-up key is turned down
      // (2026-10-09). That second ask carries nothing of the person's.
      const control = await ask(KEY_CHECK_CONTROL);
      if (keyRejectedBy(info, control.status)) return 'valid';
      return control.ok ? 'unchecked' : 'unverifiable';
    }
    return 'unverifiable';
  } catch {
    return 'unverifiable';
  }
}
