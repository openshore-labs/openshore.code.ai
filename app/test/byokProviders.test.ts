// Bring your own keys, any provider (founder, 2026-10-09; docs/byok-any-
// provider-plan.md, Part 1): eleven named providers join Cloud Connections as
// data, each OpenAI-compatible with its key page and its models loaded live
// on the person's key. Each provider's list is read in the shape its own
// documentation gives where it gives one (DeepSeek, Mistral, Cerebras,
// Hugging Face, Novita AI, MiniMax), and otherwise in the shape community
// code, SDKs and mirrors show (Groq, Together AI, xAI, Nebius, NVIDIA); the
// fixtures below are modeled on those, trimmed, until a real answer is
// pinned. Each yields its chat models and nothing else; a key check a
// provider answers with its own status reads as rejected, and a list that
// answers a made-up key too proves nothing; and a first connection puts a
// sensible set on the Bench. Venice and OpenRouter keep their own pins in
// docking.test.ts, unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const net = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; headers: Record<string, string> }>,
  status: 200,
  // The status the made-up key of the key check's control ask gets, when it
  // differs from the person's key's.
  controlStatus: undefined as number | undefined,
  body: {} as unknown,
}));
vi.mock('../src/lib/nativeFetch.js', () => ({
  nativeFetch: async (url: string, req: { headers?: Record<string, string> } = {}) => {
    net.calls.push({ url, headers: req.headers ?? {} });
    const control = /not-a-key/.test(req.headers?.authorization ?? '');
    const status = control && net.controlStatus !== undefined ? net.controlStatus : net.status;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => net.body,
      text: async () => JSON.stringify(net.body),
    };
  },
}));

const {
  KEY_CHECK_CONTROL,
  LIVE_FIRST_PICKS_MAX,
  PROVIDERS,
  applyLiveModels,
  cloudImageReaders,
  fetchLiveModels,
  keyRejectedBy,
  parseLiveModels,
  pickLiveModels,
  providerInfo,
  validateProviderKey,
} = await import('../src/lib/providers.js');
const { HOSTED_SHELF, hostedModels } = await import('../src/lib/hosted.js');

beforeEach(() => {
  net.calls.length = 0;
  net.status = 200;
  net.controlStatus = undefined;
  net.body = {};
});

const ids = (models: Array<{ id: string }>) => models.map((m) => m.id);

describe('the named providers', () => {
  const NAMED: Array<[string, string, string]> = [
    ['groq', 'Groq', 'https://api.groq.com/openai/v1'],
    ['together', 'Together AI', 'https://api.together.ai/v1'],
    ['deepseek', 'DeepSeek', 'https://api.deepseek.com'],
    ['mistral', 'Mistral', 'https://api.mistral.ai/v1'],
    ['xai', 'xAI', 'https://api.x.ai/v1'],
    ['cerebras', 'Cerebras', 'https://api.cerebras.ai/v1'],
    ['huggingface', 'Hugging Face', 'https://router.huggingface.co/v1'],
    ['nebius', 'Nebius Token Factory', 'https://api.tokenfactory.nebius.com/v1'],
    ['novita', 'Novita AI', 'https://api.novita.ai/openai/v1'],
    ['minimax', 'MiniMax', 'https://api.minimax.io/v1'],
    ['nvidia', 'NVIDIA', 'https://integrate.api.nvidia.com/v1'],
  ];

  it('follow OpenRouter in order, each live, waiting under More providers', () => {
    const at = PROVIDERS.findIndex((p) => p.id === 'openrouter');
    expect(PROVIDERS.slice(at + 1).map((p) => p.id)).toEqual(NAMED.map(([id]) => id));
    for (const [id, name, base] of NAMED) {
      const p = providerInfo(id)!;
      expect(p.name, id).toBe(name);
      expect(p.openaiBaseUrl, id).toBe(base);
      expect(p.apiKeyUrl, id).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/);
      expect(p.liveModels, id).toBe(true);
      expect(p.more, id).toBe(true);
      expect(p.models, id).toEqual([]);
      expect(p.keyHint.trim(), id).not.toBe('');
    }
    // The familiar seven are never under More providers.
    expect(PROVIDERS.slice(0, at + 1).some((p) => p.more)).toBe(false);
  });

  it('a key hint is a prefix only where the provider documents one', () => {
    expect(providerInfo('huggingface')!.keyHint).toBe('hf_...');
    expect(providerInfo('novita')!.keyHint).toBe('sk_...');
    expect(providerInfo('nvidia')!.keyHint).toBe('nvapi-...');
    expect(providerInfo('groq')!.keyHint).toBe('a Groq API key');
    expect(providerInfo('xai')!.keyHint).toBe('an xAI API key');
  });

  it('ids are short, unique, and take no secret name another feature holds', () => {
    const all = PROVIDERS.map((p) => p.id);
    expect(new Set(all).size).toBe(all.length);
    const taken = ['codemagic', 'search', 'byom', 'hub', 'repo', 'harness', 'gdrive'];
    for (const [id] of NAMED) {
      expect(id).toMatch(/^[a-z]+$/);
      expect(taken).not.toContain(id);
    }
  });

  it('say nothing about privacy or speed', () => {
    const named = PROVIDERS.filter((p) => p.more);
    for (const p of named) {
      expect(`${p.name} ${p.keyHint}`, p.id).not.toMatch(/private|secure|fast|speed|free/i);
    }
  });
});

describe('each list, in its documented shape', () => {
  it('Groq: active chat models, never its speech or guard models', () => {
    const models = parseLiveModels('groq', {
      object: 'list',
      data: [
        {
          id: 'llama-3.3-70b-versatile',
          object: 'model',
          created: 1733447754,
          owned_by: 'Meta',
          active: true,
          context_window: 131072,
          max_completion_tokens: 32768,
        },
        {
          id: 'openai/gpt-oss-120b',
          object: 'model',
          created: 1754408224,
          owned_by: 'OpenAI',
          active: true,
          context_window: 131072,
        },
        { id: 'whisper-large-v3', object: 'model', created: 1693721698, active: true },
        { id: 'playai-tts', object: 'model', created: 1740682771, active: true },
        { id: 'meta-llama/llama-guard-4-12b', object: 'model', created: 1746743847 },
        { id: 'meta-llama/llama-prompt-guard-2-86m', object: 'model', created: 1748632165 },
        { id: 'retired-model', object: 'model', created: 1700000000, active: false },
      ],
    });
    expect(ids(models)).toEqual(['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']);
    expect(models[0]).toMatchObject({
      label: 'llama-3.3-70b-versatile',
      contextTokens: 131072,
      released: '2024-12-06',
      tagline: 'On Groq, on your key.',
      tools: false,
      toolsUnknown: true,
    });
    // A plain list says nothing about tools, so nothing claims it.
    expect(models[0]!.categories).toEqual(['writing']);
    // Newest first.
    expect(ids(pickLiveModels('groq', models))).toEqual([
      'openai/gpt-oss-120b',
      'llama-3.3-70b-versatile',
    ]);
  });

  it('Together: a bare list, chat rows only, by their display name', () => {
    const rows = [
      {
        id: 'openai/gpt-oss-20b',
        object: 'model',
        created: 1754438400,
        type: 'chat',
        display_name: 'OpenAI GPT-OSS 20B',
        organization: 'OpenAI',
        context_length: 131072,
        pricing: { input: 0.05, output: 0.2 },
      },
      { id: 'BAAI/bge-large-en-v1.5', object: 'model', type: 'embedding' },
      { id: 'black-forest-labs/FLUX.1-schnell', object: 'model', type: 'image' },
      { id: 'meta-llama/Llama-Guard-4-12B', object: 'model', type: 'moderation' },
      { id: 'Salesforce/Llama-Rank-V1', object: 'model', type: 'rerank' },
      { id: 'meta-llama/Meta-Llama-3-70B', object: 'model', type: 'language' },
      { id: 'cartesia/sonic-2', object: 'model', type: 'audio' },
    ];
    const bare = parseLiveModels('together', rows);
    expect(ids(bare)).toEqual(['openai/gpt-oss-20b']);
    expect(bare[0]).toMatchObject({
      label: 'OpenAI GPT-OSS 20B',
      contextTokens: 131072,
      tagline: 'On Together AI, on your key.',
    });
    // The same rows in a data list read the same.
    expect(parseLiveModels('together', { data: rows })).toEqual(bare);
  });

  it('DeepSeek: its list at the root, with its window, undated', async () => {
    net.body = {
      object: 'list',
      data: [
        { id: 'deepseek-flash', object: 'model', owned_by: 'deepseek', context_window: 131072 },
        { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek', context_window: 131072 },
      ],
    };
    const models = await fetchLiveModels('deepseek', 'sk-test');
    expect(net.calls[0]).toMatchObject({
      url: 'https://api.deepseek.com/models',
      headers: { authorization: 'Bearer sk-test' },
    });
    expect(ids(models!)).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    expect(models![0]).toMatchObject({ contextTokens: 131072, toolsUnknown: true });
    expect(models![0]!.released).toBeUndefined();
    // No dates: the list's own order.
    expect(ids(pickLiveModels('deepseek', models!))).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
  });

  it('Mistral: base and fine-tuned cards that chat, read from their capabilities, aliases once', () => {
    const caps = (over: Record<string, boolean>) => ({
      completion_chat: true,
      completion_fim: false,
      function_calling: true,
      fine_tuning: false,
      vision: false,
      classification: false,
      ...over,
    });
    const card = (id: string, over: Record<string, unknown>) => ({
      id,
      object: 'model',
      created: 1760000000,
      owned_by: 'mistralai',
      name: id,
      description: '',
      max_context_length: 131072,
      aliases: [],
      deprecation: null,
      type: 'base',
      ...over,
    });
    const models = parseLiveModels('mistral', {
      object: 'list',
      data: [
        card('mistral-large-2411', { capabilities: caps({}), aliases: ['mistral-large-latest'] }),
        card('mistral-large-latest', { capabilities: caps({}), aliases: ['mistral-large-2411'] }),
        card('pixtral-large-2411', { capabilities: caps({ vision: true }) }),
        card('mistral-embed', {
          capabilities: caps({ completion_chat: false, function_calling: false }),
          max_context_length: 8192,
        }),
        card('mistral-moderation-latest', {
          capabilities: caps({ completion_chat: false, classification: true }),
        }),
        card('ft:open-mistral-7b:abc:20260101', {
          type: 'fine-tuned',
          capabilities: caps({ function_calling: false }),
          created: 1767225600,
        }),
      ],
    });
    expect(ids(models)).toEqual([
      'mistral-large-2411',
      'mistral-large-latest',
      'pixtral-large-2411',
      'ft:open-mistral-7b:abc:20260101',
    ]);
    const [large, , pixtral, ft] = models;
    expect(large).toMatchObject({ tools: true, contextTokens: 131072 });
    expect(large!.toolsUnknown).toBeUndefined();
    expect(large!.categories).toEqual(['coding', 'reasoning']);
    expect(pixtral!.categories).toContain('vision');
    // Its card says no tools, so that is what it says.
    expect(ft).toMatchObject({ tools: false });
    expect(ft!.toolsUnknown).toBeUndefined();
    // A first set takes a model once, whichever alias comes first, tools first.
    expect(ids(pickLiveModels('mistral', models))).toEqual([
      'mistral-large-2411',
      'pixtral-large-2411',
      'ft:open-mistral-7b:abc:20260101',
    ]);
  });

  it('xAI: its chat models, never its image or video models', () => {
    const models = parseLiveModels('xai', {
      object: 'list',
      data: [
        { id: 'grok-4', object: 'model', created: 1752019200, owned_by: 'xai' },
        { id: 'grok-code-fast-1', object: 'model', created: 1755993600, owned_by: 'xai' },
        { id: 'grok-2-image-1212', object: 'model', created: 1736726400, owned_by: 'xai' },
        { id: 'grok-imagine-video', object: 'model', created: 1760000000, owned_by: 'xai' },
      ],
    });
    expect(ids(models)).toEqual(['grok-4', 'grok-code-fast-1']);
    expect(models[0]!.tagline).toBe('On xAI, on your key.');
  });

  it('Cerebras: a short list, undated rows kept', () => {
    const models = parseLiveModels('cerebras', {
      object: 'list',
      data: [
        { id: 'gpt-oss-120b', object: 'model', created: 0, owned_by: 'Cerebras' },
        { id: 'qwen-3-235b-a22b-instruct-2507', object: 'model', created: 1753000000 },
      ],
    });
    expect(ids(models)).toEqual(['gpt-oss-120b', 'qwen-3-235b-a22b-instruct-2507']);
    expect(models[0]!.created).toBeUndefined();
    // Dated before undated.
    expect(ids(pickLiveModels('cerebras', models))).toEqual([
      'qwen-3-235b-a22b-instruct-2507',
      'gpt-oss-120b',
    ]);
  });

  it('Hugging Face: tools from any provider that serves it, the smallest window, and whose policy applies', () => {
    const models = parseLiveModels('huggingface', {
      object: 'list',
      data: [
        {
          id: 'openai/gpt-oss-120b',
          object: 'model',
          created: 1754389889,
          owned_by: 'openai',
          architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          providers: [
            {
              provider: 'cerebras',
              status: 'live',
              context_length: 131072,
              pricing: { input: 0.25, output: 0.69 },
              supports_tools: true,
              supports_structured_output: true,
            },
            { provider: 'novita', status: 'live', context_length: 65536, supports_tools: false },
          ],
        },
        {
          id: 'Qwen/Qwen2.5-VL-7B-Instruct',
          object: 'model',
          created: 1737936000,
          owned_by: 'Qwen',
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          providers: [{ provider: 'hyperbolic', status: 'live', supports_tools: false }],
        },
      ],
    });
    const [oss, vl] = models;
    expect(oss).toMatchObject({ tools: true, contextTokens: 65536 });
    expect(oss!.tagline).toBe(
      'Through Hugging Face, on your key. It goes on to one of the providers it lists for the model.',
    );
    expect(vl).toMatchObject({ tools: false });
    expect(vl!.toolsUnknown).toBeUndefined();
    expect(vl!.categories).toEqual(['writing', 'vision']);
  });

  it('Nebius: chat models, never its embedding or image models', () => {
    const models = parseLiveModels('nebius', {
      object: 'list',
      data: [
        { id: 'meta-llama/Llama-3.3-70B-Instruct', object: 'model', created: 1733000000 },
        { id: 'BAAI/bge-en-icl', object: 'model', created: 1733000000 },
        { id: 'intfloat/e5-mistral-7b-instruct', object: 'model', created: 1733000000 },
        { id: 'Qwen/Qwen3-Embedding-8B', object: 'model', created: 1750000000 },
        { id: 'black-forest-labs/flux-schnell', object: 'model', created: 1733000000 },
        { id: 'stability-ai/sdxl', object: 'model', created: 1733000000 },
      ],
    });
    expect(ids(models)).toEqual(['meta-llama/Llama-3.3-70B-Instruct']);
  });

  it('Novita: its list with prices beside each row, chat models kept', () => {
    const models = parseLiveModels('novita', {
      object: 'list',
      data: [
        {
          id: 'deepseek/deepseek-v3.1',
          object: 'model',
          created: 1755600000,
          owned_by: 'unknown',
          title: 'DeepSeek V3.1',
          input_token_price_per_m: 2700,
          output_token_price_per_m: 10000,
        },
        { id: 'baai/bge-m3', object: 'model', created: 1740000000 },
      ],
    });
    expect(ids(models)).toEqual(['deepseek/deepseek-v3.1']);
    expect(models[0]!.tagline).toBe('On Novita AI, on your key.');
  });

  it('MiniMax: its text models, never its speech or image models', () => {
    const models = parseLiveModels('minimax', {
      object: 'list',
      data: [
        { id: 'MiniMax-M2.5', object: 'model', created: 1770000000, owned_by: 'minimax' },
        { id: 'speech-02-hd', object: 'model', created: 1745000000, owned_by: 'minimax' },
        { id: 'image-01', object: 'model', created: 1740000000, owned_by: 'minimax' },
      ],
    });
    expect(ids(models)).toEqual(['MiniMax-M2.5']);
  });

  it('NVIDIA: chat models, no embedding, rerank, safety or reward model, and no 1993 date', () => {
    const stamp = 735790403;
    const models = parseLiveModels('nvidia', {
      object: 'list',
      data: [
        { id: 'meta/llama-3.3-70b-instruct', object: 'model', created: stamp, owned_by: 'meta' },
        { id: 'nvidia/nv-embedqa-e5-v5', object: 'model', created: stamp },
        { id: 'nvidia/llama-3.2-nv-rerankqa-1b-v2', object: 'model', created: stamp },
        { id: 'nvidia/llama-3.1-nemoguard-8b-content-safety', object: 'model', created: stamp },
        { id: 'nvidia/llama-3.1-nemotron-70b-reward', object: 'model', created: stamp },
        { id: 'deepseek-ai/deepseek-r1', object: 'model', created: stamp },
      ],
    });
    expect(ids(models)).toEqual(['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1']);
    // Every row stamped alike is no release date.
    for (const m of models) expect(m.released, m.id).toBeUndefined();
    expect(ids(pickLiveModels('nvidia', models))).toEqual(ids(models));
  });

  // A list stamped when it is asked (Mistral's may be) would date every model
  // today: a stamp every row shares is no release date and no order.
  it('a list that stamps every row alike is undated, so nothing reads as released today', () => {
    const now = 1_791_000_000;
    const card = (id: string) => ({
      id,
      object: 'model',
      created: now,
      type: 'base',
      capabilities: { completion_chat: true, function_calling: true },
    });
    const models = parseLiveModels('mistral', {
      data: [card('open-mistral-7b'), card('mistral-small-latest'), card('codestral-latest')],
    });
    for (const m of models) {
      expect(m.released, m.id).toBeUndefined();
      expect(m.created, m.id).toBeUndefined();
    }
    // The list's own order, not a tie broken by a shared stamp.
    expect(ids(pickLiveModels('mistral', models))).toEqual(ids(models));
    // One dated row is a date.
    const [one] = parseLiveModels('mistral', { data: [card('open-mistral-7b')] });
    expect(one!.released).toBe(new Date(now * 1000).toISOString().slice(0, 10));
  });

  it('a first set takes a model once even when only the later row names the other', () => {
    const models = parseLiveModels('mistral', {
      data: [
        {
          id: 'mistral-large-latest',
          type: 'base',
          created: 2_000_000_000,
          aliases: [],
          capabilities: { completion_chat: true, function_calling: true },
        },
        {
          id: 'mistral-large-2411',
          type: 'base',
          created: 1_900_000_000,
          aliases: ['mistral-large-latest'],
          capabilities: { completion_chat: true, function_calling: true },
        },
      ],
    });
    expect(ids(pickLiveModels('mistral', models))).toEqual(['mistral-large-latest']);
  });

  it('taglines name whose key it is, never a privacy or speed claim', () => {
    for (const p of PROVIDERS.filter((x) => x.more)) {
      const [m] = parseLiveModels(p.id, { data: [{ id: 'some-chat-model' }] });
      expect(m!.tagline, p.id).toMatch(/on your key\./);
      expect(m!.tagline, p.id).not.toMatch(/private|never|secure|fast|speed/i);
    }
  });

  it('an unreadable answer is no list', () => {
    expect(parseLiveModels('groq', undefined)).toEqual([]);
    expect(parseLiveModels('groq', { error: 'nope' })).toEqual([]);
    expect(parseLiveModels('groq', { data: [null, { id: '' }, { id: 7 }] })).toEqual([]);
  });
});

describe('a first connection picks a sensible set', () => {
  const live = (id: string, over: Record<string, unknown> = {}) => ({ id, ...over });

  it('tool-taking models first, then those the list says nothing about, newest first, capped', () => {
    const rows = [
      live('old-tools', { created: 1_700_000_000, supported_parameters: ['tools'] }),
      live('chat-only', { created: 1_790_000_000, supported_parameters: ['temperature'] }),
      live('unsaid', { created: 1_780_000_000 }),
      live('new-tools', { created: 1_760_000_000, supported_parameters: ['tools'] }),
    ];
    const models = parseLiveModels('together-like', { data: rows });
    expect(ids(pickLiveModels('groq', models))).toEqual([
      'new-tools',
      'old-tools',
      'unsaid',
      'chat-only',
    ]);
    const many = parseLiveModels('groq', {
      data: Array.from({ length: 40 }, (_, i) => live(`m${i}`, { created: 1_760_000_000 + i })),
    });
    const picks = pickLiveModels('groq', many);
    expect(picks).toHaveLength(LIVE_FIRST_PICKS_MAX);
    expect(picks[0]!.id).toBe('m39');
  });
});

describe('the key check', () => {
  it('reads 401 and 403 as rejected everywhere, and 400 only where the provider uses it', () => {
    expect(keyRejectedBy(providerInfo('groq')!, 401)).toBe(true);
    expect(keyRejectedBy(providerInfo('groq')!, 403)).toBe(true);
    expect(keyRejectedBy(providerInfo('groq')!, 400)).toBe(false);
    expect(keyRejectedBy(providerInfo('xai')!, 400)).toBe(true);
    expect(keyRejectedBy(providerInfo('xai')!, 500)).toBe(false);
    // Only xAI says so today.
    expect(PROVIDERS.filter((p) => p.rejectsWith?.length).map((p) => p.id)).toEqual(['xai']);
  });

  it('a bad xAI key is rejected, not saved as unverified', async () => {
    net.status = 400;
    expect(await validateProviderKey('xai', 'xai-bad')).toBe('invalid');
    expect(net.calls[0]).toMatchObject({
      url: 'https://api.x.ai/v1/models',
      headers: { authorization: 'Bearer xai-bad' },
    });
  });

  it('a 400 from any other provider stays unverified, and a 200 is a working key once a made-up one is turned down', async () => {
    net.status = 400;
    expect(await validateProviderKey('groq', 'k')).toBe('unverifiable');
    net.status = 401;
    expect(await validateProviderKey('mistral', 'k')).toBe('invalid');
    net.calls.length = 0;
    net.status = 200;
    net.controlStatus = 401;
    expect(await validateProviderKey('nvidia', 'nvapi-k')).toBe('valid');
    // The person's key, then the control: the same request, a made-up key.
    expect(net.calls.map((c) => [c.url, c.headers.authorization])).toEqual([
      ['https://integrate.api.nvidia.com/v1/models', 'Bearer nvapi-k'],
      ['https://integrate.api.nvidia.com/v1/models', `Bearer ${KEY_CHECK_CONTROL}`],
    ]);
    // xAI turns the made-up key down its own way.
    net.controlStatus = 400;
    expect(await validateProviderKey('xai', 'xai-k')).toBe('valid');
  });

  // A list some providers serve to anyone (NVIDIA's is reported to be) passes
  // any string, so its 200 is never read as a working key (2026-10-09).
  it('a list that answers anyone proves nothing: the key saves as unchecked, never valid', async () => {
    net.status = 200;
    for (const p of PROVIDERS.filter((x) => x.openaiBaseUrl)) {
      expect(await validateProviderKey(p.id, 'typo'), p.id).toBe('unchecked');
    }
    // A control the provider cannot answer leaves it unverified, not valid.
    net.controlStatus = 503;
    expect(await validateProviderKey('huggingface', 'hf_k')).toBe('unverifiable');
    // The control carries nothing of the person's.
    expect(KEY_CHECK_CONTROL).not.toMatch(/hf_k|typo/);
  });
});

// Everything that walks PROVIDERS, decided for the longer list (2026-10-09).
describe('what reads the provider list', () => {
  afterEach(() => {
    // The picks live on the shared list; put it back for the next test.
    for (const p of PROVIDERS.filter((x) => x.more)) applyLiveModels(p.id, []);
  });

  it('a named provider adds nothing to the store shelf until its models are picked', () => {
    const named = new Set(PROVIDERS.filter((p) => p.more).map((p) => p.id));
    expect(hostedModels().filter((m) => named.has(m.providerId))).toEqual([]);
    applyLiveModels('groq', [
      {
        id: 'openai/gpt-oss-120b',
        label: 'GPT OSS 120B',
        tagline: 'On Groq, on your key.',
        categories: ['writing'],
      },
    ]);
    const groq = hostedModels().filter((m) => m.providerId === 'groq');
    expect(groq.map((m) => [m.providerName, m.modelId])).toEqual([['Groq', 'openai/gpt-oss-120b']]);
    expect(groq[0]!.ref).toEqual({
      kind: 'cloud',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      label: 'GPT OSS 120B',
    });
    // The shelf holds models a provider serves for other makers, so its line
    // never says the makers host them.
    expect(HOSTED_SHELF.subtitle).not.toMatch(/maker/i);
  });

  it('a picked model that reads images joins the image readers after the familiar seven, named once', () => {
    const before = cloudImageReaders();
    applyLiveModels('mistral', [
      {
        id: 'pixtral-large-2411',
        label: 'pixtral-large-2411',
        tagline: 'On Mistral, on your key.',
        categories: ['coding', 'reasoning', 'vision'],
      },
    ]);
    applyLiveModels('xai', [
      { id: 'grok-4', label: 'grok-4', tagline: 'On xAI, on your key.', categories: ['writing'] },
    ]);
    const after = cloudImageReaders();
    expect(after.slice(0, before.length)).toEqual(before);
    // Only the one that reads images, after every familiar reader, its
    // provider's name before an id that does not carry it.
    expect(after.slice(before.length)).toEqual([
      { provider: 'mistral', model: 'pixtral-large-2411', label: 'Mistral pixtral-large-2411' },
    ]);
  });

  it('the release check skips every provider whose models load live, and keys only typed ones', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'verify-cloud-models.ts'), 'utf8');
    expect(script).toMatch(/if \(provider\.liveModels\) \{[\s\S]{0,200}continue;/);
    const keyed = [
      ...script
        .slice(script.indexOf('const KEY_ENV'), script.indexOf('};'))
        .matchAll(/^\s+(\w+): \[/gm),
    ].map((m) => m[1]!);
    expect(keyed).toEqual(['anthropic', 'openai', 'google', 'moonshot']);
    for (const id of keyed) expect(providerInfo(id)!.liveModels, id).toBeFalsy();
  });
});
