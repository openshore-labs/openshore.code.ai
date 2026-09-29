// The small model's true window (C1). The engine budgets against the window
// the server really serves, counts what the prompt really carries, keeps one
// observation inside that window, says when a server cut the prompt anyway,
// hands the text bridge the same short menu native tools get, and stops the
// loop's own retries from wasting turns: a verify retry re-arms tools, a
// memory note is not code to check, and a decline is not a struggle.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { z } from 'zod';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import { _setProbeResult } from '../src/providers/capabilities.js';
import {
  OLLAMA_DEFAULT_NUM_CTX,
  OLLAMA_OLD_DEFAULT_NUM_CTX,
  _resetMoreRoom,
  giveMoreRoom,
  kvBytesPerToken,
  ollamaDefaultNumCtx,
} from '../src/providers/servedWindow.js';
import {
  compactHistory,
  estimateMessages,
  estimateToolSpecs,
  looksTruncated,
  TRUNCATION_RATIO,
} from '../src/context/compaction.js';
import { ConfigSchema, type OpenAICompatibleEndpoint } from '../src/config/schema.js';
import { globalConfigPath } from '../src/config/load.js';
import { nextFailStreak } from '../src/core/agent/window.js';
import { platformAndShell, platformWord } from '../src/core/exec/shell.js';
import { MERGED_VAULT_TOOL } from '../src/core/agent/registry.js';
import { OBSERVATION_MAX_CHARS, observationCapChars } from '../src/harness/profile.js';
import { vaultTraceFields } from '../src/eval/v2.js';
import { costLine } from '../src/commands/eval.js';
import type { ChatEvent, ChatMessage, MoreRoom } from '../src/providers/types.js';
import type { AgentEvent } from '../src/core/agent/types.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  _resetMoreRoom();
});

async function collect(gen: AsyncGenerator<ChatEvent, void, void>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

// ---------------------------------------------------------------------------
// A fake Ollama: /api/show answers with the model's own window, an optional
// Modelfile parameters block and the numbers a token's memory is worked out
// from; /api/chat records every body it is sent.
// ---------------------------------------------------------------------------

let seq = 0;

function fakeOllama(
  options: {
    version?: string;
    native?: number;
    parameters?: string;
    flavor?: 'ollama' | 'vllm';
  } = {},
) {
  const flavor = options.flavor ?? 'ollama';
  const baseUrl = `http://window-${seq++}.test`;
  _setProbeResult(baseUrl, {
    flavor,
    grammar: true,
    nativeTools: true,
    label: flavor === 'ollama' ? 'Ollama' : 'vLLM',
    ...(options.version !== undefined ? { version: options.version } : {}),
  });
  const chats: Array<Record<string, any>> = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith('/api/show')) {
      return new Response(
        JSON.stringify({
          model_info: {
            'qwen2.context_length': options.native ?? 32768,
            'qwen2.block_count': 28,
            'qwen2.attention.head_count': 28,
            'qwen2.attention.head_count_kv': 4,
            'qwen2.embedding_length': 3584,
          },
          ...(options.parameters !== undefined ? { parameters: options.parameters } : {}),
          capabilities: ['completion', 'tools'],
        }),
        { status: 200 },
      );
    }
    chats.push(JSON.parse(String(init?.body)));
    if (flavor === 'ollama') {
      return new Response(JSON.stringify({ message: { content: 'ok' }, done: true }) + '\n', {
        status: 200,
      });
    }
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { baseUrl, chats };
}

function local(
  baseUrl: string,
  numCtx?: 'auto' | 'off',
  ramGB = 16,
  id = 'local',
): OpenAICompatibleProvider {
  const endpoint: OpenAICompatibleEndpoint = { kind: 'openai-compatible', baseUrl };
  if (numCtx) endpoint.numCtx = numCtx;
  return new OpenAICompatibleProvider(id, endpoint, {}, { ramGB: () => ramGB });
}

describe('the served window wins over the model own (C1)', () => {
  it('budgets against what Ollama serves by default, not the model window', async () => {
    const server = fakeOllama({ version: '0.12.3', native: 32768 });
    const caps = await local(server.baseUrl).capabilities('qwen2.5-coder:7b');
    expect(caps.contextTokens).toBe(OLLAMA_DEFAULT_NUM_CTX);
    expect(caps.contextTokens).toBe(4096);
    expect(caps.nativeContextTokens).toBe(32768);
  });

  it('reads the Modelfile num_ctx from the parameters block', async () => {
    const server = fakeOllama({
      version: '0.12.3',
      native: 32768,
      parameters:
        'stop                           "<|im_end|>"\nnum_ctx                        8192',
    });
    const caps = await local(server.baseUrl).capabilities('qwen2.5-coder:7b');
    expect(caps.contextTokens).toBe(8192);
  });

  it('never budgets more than the model has', async () => {
    const server = fakeOllama({ version: '0.12.3', native: 2048 });
    const caps = await local(server.baseUrl).capabilities('tinyllama:1.1b');
    expect(caps.contextTokens).toBe(2048);
  });

  it('assumes the smaller default for an older or unknown Ollama (CTO 5)', async () => {
    expect(ollamaDefaultNumCtx('0.6.6')).toBe(OLLAMA_OLD_DEFAULT_NUM_CTX);
    expect(ollamaDefaultNumCtx('0.5.13')).toBe(2048);
    expect(ollamaDefaultNumCtx('0.6.7')).toBe(4096);
    expect(ollamaDefaultNumCtx('0.12.3-rc1')).toBe(4096);
    expect(ollamaDefaultNumCtx('1.0.0')).toBe(4096);
    expect(ollamaDefaultNumCtx(undefined)).toBe(2048);
    expect(ollamaDefaultNumCtx('dev')).toBe(2048);
    const old = fakeOllama({ version: '0.5.7' });
    expect((await local(old.baseUrl).capabilities('qwen2.5-coder:7b')).contextTokens).toBe(2048);
  });

  it('sends no num_ctx while numCtx is unset: the request body is unchanged', async () => {
    const server = fakeOllama({ version: '0.12.3' });
    await collect(local(server.baseUrl).chat({ model: 'qwen2.5-coder:7b', messages: [] }));
    expect(JSON.stringify(server.chats[0])).not.toContain('num_ctx');
  });

  it('keeps the model own window on a server other than Ollama', async () => {
    const server = fakeOllama({ flavor: 'vllm' });
    const caps = await local(server.baseUrl).capabilities('qwen2.5-coder:7b');
    expect(caps.contextTokens).toBe(32768);
    expect(caps.nativeContextTokens).toBeUndefined();
  });
});

describe('the estimate counts what the prompt carries (C1)', () => {
  it('counts the native tool specs and their template', () => {
    const specs = [
      { name: 'readFile', description: 'Read a file.', parameters: { type: 'object' } },
    ];
    expect(estimateToolSpecs(undefined)).toBe(0);
    expect(estimateToolSpecs([])).toBe(0);
    expect(estimateToolSpecs(specs)).toBeGreaterThan(JSON.stringify(specs).length / 4);
  });

  it('holds the tool specs against the same budget as the history', async () => {
    // About 660 tokens of history fits 0.7 of a 1000-token window alone, and
    // not beside 200 tokens of tool specs.
    const messages: ChatMessage[] = [
      { role: 'tool', content: 'x'.repeat(2400), toolCallId: 'c1', name: 'readFile' },
      ...Array.from({ length: 6 }, (): ChatMessage => ({ role: 'assistant', content: 'ok' })),
    ];
    expect((await compactHistory(messages, 1000, async () => 's')).compacted).toBe(false);
    expect((await compactHistory(messages, 1000, async () => 's', 0.7, 200)).compacted).toBe(true);
  });

  it('the loop reports its estimate of each turn, tool specs included', async () => {
    const provider = new MockProvider('mock', [textTurn('hello')]);
    const session = makeTestSession(provider);
    await session.agent.run('say hello');
    const request = provider.requests[0]!;
    const usage = session.events.find((e) => e.type === 'usage') as Extract<
      AgentEvent,
      { type: 'usage' }
    >;
    const specs = estimateToolSpecs(request.tools);
    // The whole registry is about 3,600 tokens of schemas.
    expect(specs).toBeGreaterThan(3000);
    expect(usage.estimatedPromptTokens).toBe(estimateMessages(request.messages) + specs);
  });
});

// ---------------------------------------------------------------------------
// One observation stays inside the seat's window.
// ---------------------------------------------------------------------------

/** 600 numbered lines of about 50 characters: 30,000 characters in all. */
const BIG = Array.from(
  { length: 600 },
  (_, i) => `line ${i + 1}: the quick brown fox jumps over it`,
).join('\n');

function leanSession(model: string, contextTokens: number, turns: ChatEvent[][]) {
  const provider = new MockProvider('mock', turns, { caps: { contextTokens } });
  const session = makeTestSession(provider, {
    files: { 'big.txt': BIG },
    configOverrides: {
      stack: { orchestrator: { provider: 'mock', model } },
      harness: { profiles: { enabled: true } },
    },
  });
  return { provider, session };
}

function observationIn(request: { messages: ChatMessage[] }): string {
  const m = request.messages.find((x) => x.role === 'tool');
  return String(m?.content ?? '');
}

describe('an oversize read is cut per class, with a note on how to read on (C1)', () => {
  it('a small seat served 4096 tokens sees about 4,000 characters, whole lines', async () => {
    const { provider, session } = leanSession('qwen2.5-coder:7b', 4096, [
      toolTurn('readFile', { path: 'big.txt' }),
      textTurn('read it'),
    ]);
    await session.agent.run('read big.txt');
    const seen = observationIn(provider.requests[1]!);
    const cap = observationCapChars(0.25, 4096);
    expect(cap).toBe(4096);
    expect(seen.length).toBeLessThanOrEqual(cap);
    expect(seen.length).toBeGreaterThan(cap / 2);
    const last = /big\.txt \(lines 1-(\d+) of 600\)/.exec(seen);
    expect(last).not.toBeNull();
    const shown = Number(last![1]);
    expect(seen).toContain(`line ${shown}: the quick brown fox jumps over it`);
    expect(seen).toContain(`Read on with startLine ${shown + 1}`);
    expect(seen).toContain("Cut here to fit this model's window");
    // The person's transcript keeps what the tool returned.
    const end = session.events.find((e) => e.type === 'tool-end') as Extract<
      AgentEvent,
      { type: 'tool-end' }
    >;
    expect(end.result.content).toBe(seen);
  });

  it('a tiny seat sees less than a small one, and a seat with room the old cap', async () => {
    const lengths: number[] = [];
    for (const [model, window] of [
      ['qwen2.5-coder:1.5b', 4096],
      ['qwen2.5-coder:7b', 4096],
      ['qwen2.5-coder:32b', 131072],
    ] as const) {
      const { provider, session } = leanSession(model, window, [
        toolTurn('readFile', { path: 'big.txt' }),
        textTurn('read it'),
      ]);
      await session.agent.run('read big.txt');
      lengths.push(observationIn(provider.requests[1]!).length);
    }
    expect(lengths[0]).toBeLessThan(lengths[1]!);
    expect(lengths[1]).toBeLessThan(lengths[2]!);
    expect(lengths[2]).toBeLessThanOrEqual(OBSERVATION_MAX_CHARS);
    expect(lengths[2]).toBeGreaterThan(20_000);
  });

  it('any other tool output is cut to the cap by the loop, the transcript kept whole', async () => {
    const { provider, session } = leanSession('qwen2.5-coder:7b', 4096, [
      toolTurn('bigTool', {}),
      textTurn('done'),
    ]);
    session.tools.register({
      name: 'bigTool',
      description: 'Returns a lot.',
      schema: z.object({}),
      risk: 'read',
      execute: async () => ({ ok: true, content: 'y'.repeat(20_000) }),
    });
    await session.agent.run('run the big tool');
    const seen = observationIn(provider.requests[1]!);
    expect(seen.length).toBeLessThan(5_000);
    expect(seen).toContain('characters trimmed');
    const end = session.events.find((e) => e.type === 'tool-end') as Extract<
      AgentEvent,
      { type: 'tool-end' }
    >;
    expect(end.result.content).toHaveLength(20_000);
  });

  it('with harness profiles off, the old fixed cap holds', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('readFile', { path: 'big.txt' }),
      textTurn('read it'),
    ]);
    const session = makeTestSession(provider, { files: { 'big.txt': BIG } });
    await session.agent.run('read big.txt');
    const seen = observationIn(provider.requests[1]!);
    expect(seen.length).toBeGreaterThan(20_000);
    expect(seen.length).toBeLessThanOrEqual(OBSERVATION_MAX_CHARS);
  });
});

// ---------------------------------------------------------------------------
// The truncation notice.
// ---------------------------------------------------------------------------

/** A turn whose server says it read `promptTokens` of the prompt. */
function turnReading(promptTokens: number, text = 'ok'): ChatEvent[] {
  return [
    { type: 'text', delta: text },
    { type: 'usage', promptTokens, completionTokens: 5 },
    { type: 'done', stopReason: 'end' },
  ];
}

function readTurn(promptTokens: number, id: string): ChatEvent[] {
  return [
    {
      type: 'tool-call',
      call: { id, name: 'readFile', argsText: '{"path":"a.txt"}', args: { path: 'a.txt' } },
    },
    { type: 'usage', promptTokens, completionTokens: 5 },
    { type: 'done', stopReason: 'tool-calls' },
  ];
}

class RoomyProvider extends MockProvider {
  asked = 0;
  constructor(
    turns: ChatEvent[][],
    private readonly room: MoreRoom | undefined,
  ) {
    super('mock', turns);
  }
  async moreRoom(): Promise<MoreRoom | undefined> {
    this.asked += 1;
    return this.room;
  }
}

const cuts = (events: AgentEvent[]) =>
  events.filter((e) => e.type === 'window-cut') as Array<
    Extract<AgentEvent, { type: 'window-cut' }>
  >;

describe('the truncation notice (C1, CTO 5, CX 6)', () => {
  it('reads a served prompt far under the estimate as a cut, and nothing else', () => {
    expect(TRUNCATION_RATIO).toBe(0.6);
    expect(looksTruncated(4096, 7000)).toBe(true);
    expect(looksTruncated(5000, 7000)).toBe(false);
    // A server that reports nothing says nothing; a short prompt is never cut.
    expect(looksTruncated(0, 7000)).toBe(false);
    expect(looksTruncated(100, 900)).toBe(false);
  });

  it('fires once per chat per model when the server reads far less than was sent', async () => {
    const provider = new RoomyProvider(
      [readTurn(900, 'c1'), readTurn(900, 'c2'), turnReading(900, 'done')],
      { room: 'more', window: 16384, gb: 0.7 },
    );
    const session = makeTestSession(provider, { files: { 'a.txt': 'hello' } });
    await session.agent.run('read a.txt twice');
    await session.agent.run('and once more');
    const seen = cuts(session.events);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'window-cut',
      model: 'mock-model',
      provider: 'mock',
      read: 900,
      room: 'more',
      gb: 0.7,
    });
    expect(seen[0]!.estimated).toBeGreaterThan(900 / TRUNCATION_RATIO);
    expect(provider.asked).toBe(1);
  });

  it('counts cache reads and writes as read, so a cached prompt is not a cut', async () => {
    const provider = new MockProvider('mock', [
      [
        { type: 'text', delta: 'ok' },
        {
          type: 'usage',
          promptTokens: 20,
          completionTokens: 5,
          cacheReadTokens: 100_000,
          cacheWriteTokens: 0,
        },
        { type: 'done', stopReason: 'end' },
      ],
    ]);
    const session = makeTestSession(provider);
    await session.agent.run('hello');
    expect(cuts(session.events)).toHaveLength(0);
  });

  it('stays quiet when the server read the prompt whole', async () => {
    const provider = new MockProvider('mock', [turnReading(100_000)]);
    const session = makeTestSession(provider);
    await session.agent.run('hello');
    expect(cuts(session.events)).toHaveLength(0);
  });

  it('says full when this computer has no memory to spare, nothing when not ours to set', async () => {
    const full = new RoomyProvider([turnReading(900)], { room: 'full' });
    const a = makeTestSession(full);
    await a.agent.run('hello');
    expect(cuts(a.events)[0]!.room).toBe('full');
    const elsewhere = new MockProvider('mock', [turnReading(900)]);
    const b = makeTestSession(elsewhere);
    await b.agent.run('hello');
    expect(cuts(b.events)[0]!.room).toBeUndefined();
  });

  it('the eval trace records each turn read against its estimate', async () => {
    const provider = new MockProvider('mock', [readTurn(900, 'c1'), turnReading(100_000)]);
    const session = makeTestSession(provider, { files: { 'a.txt': 'hello' } });
    await session.agent.run('read a.txt');
    const fields = vaultTraceFields(session.events);
    expect(fields.promptWindow).toHaveLength(2);
    expect(fields.promptWindow![0]!.read).toBe(900);
    expect(fields.promptWindow![0]!.estimated).toBeGreaterThan(1500);
    expect(fields.promptWindow![1]!.read).toBe(100_000);
    expect(
      costLine({ turns: 2, toolCalls: [], wrote: false, promptWindow: fields.promptWindow }),
    ).toContain('1 of 2 turns cut by the server');
  });
});

describe('giving a model more room (CTO 5)', () => {
  it('offers the larger window with its memory cost, or says the memory is full', async () => {
    const server = fakeOllama({ version: '0.12.3', native: 32768 });
    const room = await local(server.baseUrl, undefined, 16).moreRoom('qwen2.5-coder:7b');
    // 4096 served, 16384 for a small seat on 16 GB: 12,288 more tokens at
    // 28 layers x 4 kv heads x 256 x 2 bytes, about 0.66 GB.
    expect(room).toEqual({ room: 'more', window: 16384, gb: 0.7 });
    expect(kvBytesPerToken({ 'x.block_count': 28, 'x.attention.head_count_kv': 4 })).toBe(
      undefined,
    );
    const tight = fakeOllama({ version: '0.12.3', native: 32768 });
    expect(await local(tight.baseUrl, undefined, 8).moreRoom('llama3.3:70b')).toEqual({
      room: 'full',
    });
    const vllm = fakeOllama({ flavor: 'vllm' });
    expect(await local(vllm.baseUrl).moreRoom('qwen2.5-coder:7b')).toBeUndefined();
  });

  it('writes numCtx auto to machine config and switches live providers from the next request', async () => {
    const server = fakeOllama({ version: '0.12.3', native: 32768 });
    const provider = local(server.baseUrl, undefined, 16, 'ollama');
    expect((await provider.capabilities('qwen2.5-coder:7b')).contextTokens).toBe(4096);
    await collect(provider.chat({ model: 'qwen2.5-coder:7b', messages: [] }));
    expect(server.chats[0]!.options).toBeUndefined();

    const config = ConfigSchema.parse({
      providers: { ollama: { kind: 'openai-compatible', baseUrl: server.baseUrl } },
    });
    const path = globalConfigPath();
    try {
      expect(giveMoreRoom(config, 'ollama')).toEqual({ ok: true, provider: 'ollama' });
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      expect(saved.providers.ollama).toMatchObject({
        kind: 'openai-compatible',
        baseUrl: server.baseUrl,
        numCtx: 'auto',
      });
      // The same provider object, with no restart.
      await collect(provider.chat({ model: 'qwen2.5-coder:7b', messages: [] }));
      expect(server.chats[1]!.options.num_ctx).toBe(16384);
      expect((await provider.capabilities('qwen2.5-coder:7b')).contextTokens).toBe(16384);
      expect(giveMoreRoom(config, 'nope')).toHaveProperty('error');
    } finally {
      if (existsSync(path)) rmSync(path);
    }
  });
});

// ---------------------------------------------------------------------------
// The text bridge menu.
// ---------------------------------------------------------------------------

describe('the text bridge offers a lean seat its lean menu (C1)', () => {
  /** One turn on a seat with no native tools; the system prompt it was sent
   *  and the tools listed under the text protocol. */
  async function bridge(model: string) {
    const provider = new MockProvider('mock', [textTurn('ok')], {
      caps: { supportsTools: false },
    });
    const session = makeTestSession(provider, {
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model } },
        harness: { profiles: { enabled: true } },
      },
    });
    await session.agent.run('hello');
    const system = String(provider.requests[0]!.messages[0]!.content);
    const menu = system.slice(system.indexOf('Available tools:\n'));
    const listed = menu.split('\n').filter((l) => /^- \w+: /.test(l));
    return { session, system, listed };
  }

  it('a small seat is sent its ten tools, tersely, not the whole registry', async () => {
    const { session, system, listed } = await bridge('qwen2.5-coder:7b');
    expect(listed).toHaveLength(10);
    expect(session.tools.specs().length).toBeGreaterThan(10);
    expect(system).not.toContain('args schema:');
    expect(system).toMatch(
      /- readFile: Read a file from the workspace\.\n {2}args: path \(string\)/,
    );
    expect(system).toContain('startLine? (integer)');
  });

  it('a full seat keeps every tool and its schema', async () => {
    const { session, system, listed } = await bridge('qwen2.5-coder:32b');
    // Every tool, less the merged vault read a full seat never sees (it gets
    // the separate reads), the same menu native tools carry.
    const names = listed.map((l) => /^- (\w+): /.exec(l)![1]);
    expect(names).toEqual(
      session.tools
        .specs()
        .map((spec) => spec.name)
        .filter((name) => name !== MERGED_VAULT_TOOL),
    );
    expect(system).toContain('args schema:');
  });
});

// ---------------------------------------------------------------------------
// The loop's retries.
// ---------------------------------------------------------------------------

/** A check that passes only once the model has written ok.txt. */
const PASSES_WHEN_OK_EXISTS = `node -e "process.exit(require('fs').existsSync('ok.txt') ? 0 : 1)"`;

describe('a verify retry re-arms tools (C1)', () => {
  it('an answer-only turn before the check does not starve the retry of tools', async () => {
    const read = { path: 'a.txt' };
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'a.txt', content: 'x' }, 'c1'),
      toolTurn('readFile', read, 'c2'),
      toolTurn('readFile', read, 'c3'),
      toolTurn('readFile', read, 'c4'),
      // The answer-only turn: no tools offered, its text is the answer.
      textTurn('Done.'),
      // The check failed; the retry fixes the cause with a tool.
      toolTurn('writeFile', { path: 'ok.txt', content: 'fixed' }, 'c5'),
      textTurn('Fixed.'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: { harness: { verify: { command: PASSES_WHEN_OK_EXISTS, maxRetries: 2 } } },
    });
    await session.agent.run('write a.txt');
    expect(provider.requests[4]!.tools).toBeUndefined();
    expect(provider.requests[5]!.tools?.length).toBeGreaterThan(0);
    expect(existsSync(`${session.cwd}/ok.txt`)).toBe(true);
    const verifies = session.events.filter((e) => e.type === 'verify') as Array<{
      passed: boolean;
    }>;
    expect(verifies.map((v) => v.passed)).toEqual([false, true]);
  });
});

describe('a memory-only task runs no check (C1)', () => {
  it('a projectMemoryWrite is a note, not code: no verify, no nudge', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('projectMemoryWrite', {
        file: 'Progress',
        content: '- noted the plan',
        mode: 'append',
      }),
      textTurn('Noted in Progress.'),
    ]);
    const session = makeTestSession(provider, {
      projectName: 'Demo',
      configOverrides: { harness: { verify: { command: 'node -e "process.exit(1)"' } } },
    });
    await session.agent.run('note the plan in progress');
    const end = session.events.find((e) => e.type === 'tool-end') as Extract<
      AgentEvent,
      { type: 'tool-end' }
    >;
    expect(end.result.ok).toBe(true);
    expect(session.events.filter((e) => e.type === 'verify')).toHaveLength(0);
    expect(provider.requests).toHaveLength(2);
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('complete');
  });

  it('a code write in the same kind of task still runs the check', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'code.js', content: 'x' }),
      textTurn('Wrote it.'),
    ]);
    const session = makeTestSession(provider, {
      projectName: 'Demo',
      configOverrides: {
        harness: { verify: { command: 'node -e "process.exit(0)"' } },
      },
    });
    await session.agent.run('write code.js');
    expect(session.events.filter((e) => e.type === 'verify')).toHaveLength(1);
  });
});

describe('only struggling counts toward the cloud offer (C1)', () => {
  function escalating(turns: ChatEvent[][], approve: (toolName: string) => boolean) {
    const localProvider = new MockProvider('mock', turns);
    const cloud = new MockProvider('anthropic', [textTurn('Cloud did it.')], { kind: 'cloud' });
    const session = makeTestSession(localProvider, {
      escalation: cloud,
      files: { 'a.txt': 'hello' },
      approve: (request) => ({ approve: approve(request.toolName) }),
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
        providers: { anthropic: { kind: 'anthropic' } },
        routing: { escalation: { enabled: true, afterToolFailures: 1 } },
      },
    });
    return session;
  }

  it('a person declining a step is not the model struggling', async () => {
    const session = escalating(
      [toolTurn('runShell', { command: 'ls' }), textTurn('Understood, I will not run it.')],
      (tool) => tool !== 'runShell' && tool !== 'cloud',
    );
    await session.agent.run('list the files');
    expect(session.approvals.some((a) => a.kind === 'cloud-spend')).toBe(false);
    expect(session.approvals.some((a) => a.toolName === 'runShell')).toBe(true);
  });

  it('a call that runs and fails still counts', async () => {
    const session = escalating(
      [toolTurn('readFile', { path: 'missing.txt' }), textTurn('It is not there.')],
      (tool) => tool !== 'cloud',
    );
    await session.agent.run('read missing.txt');
    expect(session.approvals.some((a) => a.kind === 'cloud-spend')).toBe(true);
  });

  it('the streak rises on a failure or a parse problem, holds on refusals, clears on a clean turn', () => {
    expect(nextFailStreak(0, ['failed'], 0)).toBe(1);
    expect(nextFailStreak(1, ['ok'], 1)).toBe(2);
    expect(nextFailStreak(2, ['refused'], 0)).toBe(2);
    expect(nextFailStreak(2, ['refused', 'ok'], 0)).toBe(0);
    expect(nextFailStreak(2, [], 0)).toBe(2);
  });
});

describe('the platform word (C1, CTO 10)', () => {
  it('names the operating system the engine runs on', async () => {
    expect(platformWord('darwin')).toBe('macOS');
    expect(platformWord('win32')).toBe('Windows');
    expect(platformWord('linux')).toBe('linux');
    const provider = new MockProvider('mock', [textTurn('ok')]);
    const session = makeTestSession(provider);
    await session.agent.run('hello');
    const system = String(provider.requests[0]!.messages[0]!.content);
    // The shell rides beside the platform word (CTO 10, the security package).
    expect(system).toContain(`(platform: ${platformAndShell()})`);
    expect(system).toContain(`(platform: ${platformWord(process.platform)}, `);
    if (process.platform !== 'linux') expect(system).not.toContain('(platform: linux');
  });
});
