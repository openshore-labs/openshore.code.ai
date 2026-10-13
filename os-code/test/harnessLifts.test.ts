// The harness lifts for 3B and 7B seats (tech review 6): alternating-repeat detection
// (on), retrieval before turn one and union decoding (both off behind config
// and an eval switch), the lean prompt keyed on the served window, and the
// headless run that hands no work to another model. Each lift is proven
// through the real loop against a scripted provider, and union decoding once
// more against a fake Ollama, where the schema rides as `format`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { MockProvider, textTurn, toolTurn, type ScriptedTurn } from './helpers/mockProvider.js';
import { makeTestSession, type TestSessionOptions } from './helpers/session.js';
import { AlternatingRepeats } from '../src/harness/repeatCycle.js';
import {
  RETRIEVAL_MAX_TOKENS,
  formatRetrieval,
  retrievalBudgetTokens,
  taskTerms,
} from '../src/harness/retrieval.js';
import { SayStream } from '../src/harness/decoding.js';
import { vaultTraceFields, variantSuffix, runEvalV2 } from '../src/eval/v2.js';
import { EVAL_TASKS } from '../src/eval/tasks.js';
import { describeVariant, parseLiftFlags, withLifts, costLine } from '../src/commands/eval.js';
import { describeRun, floorPlan } from '../src/commands/evalFloor.js';
import { buildToolRegistry, networkToolsLeftOut } from '../src/core/agent/registry.js';
import { OFFLINE_DENIED } from '../src/core/agent/loop.js';
import { offlineLine } from '../src/routines/scheduler.js';
import { ConfigSchema } from '../src/config/schema.js';
import { applyProjectConfig } from '../src/config/projectPolicy.js';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import { _setProbeResult } from '../src/providers/capabilities.js';
import { ProviderError, type ChatEvent, type ChatRequest } from '../src/providers/types.js';
import type { AgentEvent } from '../src/core/agent/types.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

type Ev<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>;
const ofType = <T extends AgentEvent['type']>(events: AgentEvent[], type: T): Ev<T>[] =>
  events.filter((e): e is Ev<T> => e.type === type);

const systemOf = (req: ChatRequest): string => String(req.messages[0]!.content);
const userOf = (req: ChatRequest): string =>
  String(req.messages.find((m) => m.role === 'user')!.content);

/** A workspace with nested files (the session helper writes flat ones only). */
function workspace(files: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'osc-lifts-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, rel)), { recursive: true });
    writeFileSync(join(cwd, rel), content);
  }
  return cwd;
}

/** A request as text with this session's own folder names taken out, so two
 *  sessions' requests compare byte for byte. */
function sameShape(req: ChatRequest, cwd: string): string {
  return JSON.stringify({ ...req, messages: req.messages.map((m) => String(m.content)) })
    .replaceAll(cwd, 'CWD')
    .replaceAll(basename(cwd), 'DIR');
}

/** A text-bridge reply: the model wrote this JSON (or prose) as its text. */
function said(text: string): ScriptedTurn {
  return [
    { type: 'text', delta: text },
    { type: 'usage', promptTokens: 10, completionTokens: 10 },
    { type: 'done', stopReason: 'end' },
  ];
}

// ---------------------------------------------------------------------------
// 1. Alternating-repeat detection, on
// ---------------------------------------------------------------------------

describe('alternating repeats (tech review 6)', () => {
  it('the watch sees A, B, A, B and counts each call that keeps it going', () => {
    const watch = new AlternatingRepeats();
    expect(['a', 'b', 'a'].map((k) => watch.note(k))).toEqual([0, 0, 0]);
    expect(watch.note('b')).toBe(1);
    expect(watch.note('a')).toBe(2);
    // A call that breaks the pattern clears the count.
    expect(watch.note('c')).toBe(0);
    expect(watch.note('a')).toBe(0);
    // The same call over and over is the exact check's, not a cycle.
    const same = new AlternatingRepeats();
    expect(['x', 'x', 'x', 'x'].map((k) => same.note(k))).toEqual([0, 0, 0, 0]);
    watch.clear();
    expect(['a', 'b', 'a'].map((k) => watch.note(k))).toEqual([0, 0, 0]);
  });

  it('breaks a period-2 cycle the exact check misses, and records it', async () => {
    // A write that succeeds between two reads makes each read look fresh to
    // the exact check; the cycle watch sees the pair taking turns.
    const write = { path: 'a.txt', content: 'x' };
    const read = { path: 'a.txt' };
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', write, 'c1'),
      toolTurn('readFile', read, 'c2'),
      toolTurn('writeFile', write, 'c3'),
      toolTurn('readFile', read, 'c4'),
      toolTurn('writeFile', write, 'c5'),
      textTurn('Done.'),
    ]);
    const session = makeTestSession(provider);
    await session.agent.run('write a.txt');

    const ends = ofType(session.events, 'tool-end');
    expect(ends).toHaveLength(5);
    expect(ends.slice(0, 3).every((e) => e.result.ok && e.repeat === undefined)).toBe(true);
    // The fourth call is answered from the record, the fifth too, and the
    // next turn is answer-only: no tools offered.
    expect(ends[3]!.repeat).toBe('alternating');
    expect(ends[3]!.result.content).toMatch(/back and forth/);
    expect(ends[4]!.repeat).toBe('alternating');
    expect(provider.requests).toHaveLength(6);
    expect(provider.requests[5]!.tools).toBeUndefined();
    expect(
      ofType(session.events, 'status').some((s) =>
        /back and forth between the same two/.test(s.message),
      ),
    ).toBe(true);
    expect(session.events.at(-1)).toMatchObject({ type: 'task-done', reason: 'complete' });
    // The eval's trace counts both breaks.
    expect(vaultTraceFields(session.events).repeatBreaks).toEqual({ exact: 0, alternating: 2 });
  });

  it('a call that breaks the pattern clears it, so nothing is answered from the record', async () => {
    const write = { path: 'a.txt', content: 'x' };
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', write, 'c1'),
      toolTurn('readFile', { path: 'a.txt' }, 'c2'),
      toolTurn('writeFile', write, 'c3'),
      toolTurn('readFile', { path: 'b.txt' }, 'c4'),
      toolTurn('writeFile', write, 'c5'),
      toolTurn('readFile', { path: 'a.txt' }, 'c6'),
      textTurn('Done.'),
    ]);
    const session = makeTestSession(provider, { files: { 'b.txt': 'b' } });
    await session.agent.run('write a.txt');
    const ends = ofType(session.events, 'tool-end');
    expect(ends).toHaveLength(6);
    expect(ends.every((e) => e.repeat === undefined && e.result.ok)).toBe(true);
    expect(vaultTraceFields(session.events).repeatBreaks).toBeUndefined();
  });

  it('a verify retry clears it: the calls before the failure are no longer a cycle', async () => {
    const write = { path: 'a.txt', content: 'x' };
    const read = { path: 'a.txt' };
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', write, 'c1'),
      toolTurn('readFile', read, 'c2'),
      toolTurn('writeFile', write, 'c3'),
      textTurn('Done.'),
      // The check failed and went back to the model: it reads, then fixes.
      toolTurn('readFile', read, 'c4'),
      toolTurn('writeFile', { path: 'ok.txt', content: 'ok' }, 'c5'),
      textTurn('Fixed.'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: {
        harness: {
          verify: {
            command: `node -e "process.exit(require('fs').existsSync('ok.txt') ? 0 : 1)"`,
          },
        },
      },
    });
    await session.agent.run('write a.txt');
    const verifies = ofType(session.events, 'verify');
    expect(verifies.map((v) => v.passed)).toEqual([false, true]);
    const ends = ofType(session.events, 'tool-end');
    expect(ends).toHaveLength(5);
    // Without the clear, the read after the retry closes A, B, A, B.
    expect(ends[3]!.repeat).toBeUndefined();
    expect(ends[3]!.result.ok).toBe(true);
  });
});

describe('a program that keeps printing is never a stale repeat', () => {
  /** A stand-in for the processes package's readProcess: each read shows the
   *  output so far, which grows until `stopAt` reads, then holds. */
  function withReadProcess(provider: MockProvider, stopAt = Infinity) {
    const session = makeTestSession(provider);
    let reads = 0;
    session.tools.register({
      name: 'readProcess',
      description: 'Read the latest output of a program you started.',
      schema: z.object({ runId: z.string() }),
      risk: 'read',
      async execute() {
        reads += 1;
        const lines = Math.min(reads, stopAt);
        return {
          ok: true,
          content: Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n'),
        };
      },
    });
    return session;
  }

  it('the same read again runs every time: its output moves', async () => {
    // Five identical reads: neither the loop's record nor the guardrails'
    // identical-arguments rail (maxRepeats) counts a volatile read.
    const read = { runId: 'r1' };
    const provider = new MockProvider('mock', [
      toolTurn('readProcess', read, 'c1'),
      toolTurn('readProcess', read, 'c2'),
      toolTurn('readProcess', read, 'c3'),
      toolTurn('readProcess', read, 'c4'),
      toolTurn('readProcess', read, 'c5'),
      textTurn('It is up.'),
    ]);
    const session = withReadProcess(provider);
    await session.agent.run('start the app and tell me when it is up');
    const ends = ofType(session.events, 'tool-end');
    expect(ends).toHaveLength(5);
    expect(ends.every((e) => e.result.ok && e.repeat === undefined)).toBe(true);
    expect(ofType(session.events, 'task-done').some((e) => e.reason === 'guardrail')).toBe(false);
    // Never pushed to an answer-only turn either.
    expect(provider.requests[5]!.tools).toBeDefined();
    expect(ends[4]!.result.content).toBe('line 1\nline 2\nline 3\nline 4\nline 5');
  });

  it('a cycle through it stands while the output moves', async () => {
    const read = { runId: 'r1' };
    const write = { path: 'a.txt', content: 'x' };
    const provider = new MockProvider('mock', [
      toolTurn('readProcess', read, 'c1'),
      toolTurn('writeFile', write, 'c2'),
      toolTurn('readProcess', read, 'c3'),
      toolTurn('writeFile', write, 'c4'),
      toolTurn('readProcess', read, 'c5'),
      toolTurn('writeFile', write, 'c6'),
      textTurn('Done.'),
    ]);
    const session = withReadProcess(provider);
    await session.agent.run('watch it');
    const ends = ofType(session.events, 'tool-end');
    expect(ends).toHaveLength(6);
    expect(ends.every((e) => e.repeat === undefined)).toBe(true);
  });

  it('and breaks once the output stops moving, never answering the read itself', async () => {
    const read = { runId: 'r1' };
    const write = { path: 'a.txt', content: 'x' };
    const provider = new MockProvider('mock', [
      toolTurn('readProcess', read, 'c1'),
      toolTurn('writeFile', write, 'c2'),
      toolTurn('readProcess', read, 'c3'),
      toolTurn('writeFile', write, 'c4'),
      textTurn('Done.'),
    ]);
    // The output holds from the first read on.
    const session = withReadProcess(provider, 1);
    await session.agent.run('watch it');
    const ends = ofType(session.events, 'tool-end');
    expect(ends.map((e) => [e.call.name, e.repeat])).toEqual([
      ['readProcess', undefined],
      ['writeFile', undefined],
      ['readProcess', undefined],
      ['writeFile', 'alternating'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Retrieval before turn one, off by default
// ---------------------------------------------------------------------------

const RETRIEVAL_FILES: Record<string, string> = {
  'src/magic.mjs':
    '// The magic number the app shows.\nexport function magicNumber() {\n  return 42;\n}\n',
  'src/other.mjs': 'export const unrelated = 1;\n',
  '.env': 'MAGIC_NUMBER=abcdefghijkl\n',
  'config/.env.production.json': '{ "magicNumber": 7 }\n',
  'keys.mjs': 'export const magicNumberKey = "sk-abcdefghijklmnopqrstuvwxyz123456";\n',
  'Private/magic.md': '# magicNumber\n\nmagicNumber is 99 in the private notes.\n',
  'notes/plan.md': '---\noscode: local-only\n---\nmagicNumber plans, kept on this computer.\n',
};
const TASK = 'What does magicNumber return?';

function retrievalSession(
  turns: ScriptedTurn[],
  firstTurn: 'on' | 'off' | undefined,
  options: {
    kind?: 'local' | 'cloud';
    contextTokens?: number;
    files?: Record<string, string>;
  } = {},
) {
  const provider = new MockProvider('mock', turns, {
    kind: options.kind,
    caps: options.contextTokens ? { contextTokens: options.contextTokens } : {},
  });
  const session = makeTestSession(provider, {
    cwd: workspace(options.files ?? RETRIEVAL_FILES),
    ...(firstTurn ? { configOverrides: { harness: { retrieval: { firstTurn } } } } : {}),
  });
  return { provider, session };
}

describe('retrieval before turn one (tech review 6)', () => {
  it('is off by default: the prompt is byte for byte what it was', async () => {
    const unset = retrievalSession([textTurn('42')], undefined);
    await unset.session.agent.run(TASK);
    const off = retrievalSession([textTurn('42')], 'off');
    await off.session.agent.run(TASK);
    expect(userOf(unset.provider.requests[0]!)).toBe(TASK);
    // Only the workspace folder differs between the two sessions.
    expect(sameShape(off.provider.requests[0]!, off.session.cwd)).toBe(
      sameShape(unset.provider.requests[0]!, unset.session.cwd),
    );
    expect(ofType(unset.session.events, 'retrieval')).toEqual([]);
    expect(ofType(off.session.events, 'retrieval')).toEqual([]);
  });

  it('on a local seat, heads the task with excerpts by file and line, and shows a card', async () => {
    const { provider, session } = retrievalSession([textTurn('42')], 'on');
    await session.agent.run(TASK);
    const user = userOf(provider.requests[0]!);
    expect(user).toContain('src/magic.mjs:1-4');
    expect(user).toContain('return 42;');
    expect(user.endsWith(TASK)).toBe(true);
    const cards = ofType(session.events, 'retrieval');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.sources[0]).toEqual({ path: 'src/magic.mjs', line: 1 });
    expect(cards[0]!.budgetTokens).toBe(RETRIEVAL_MAX_TOKENS);
    expect(cards[0]!.tokens).toBeLessThanOrEqual(cards[0]!.budgetTokens);
    // The card lands after the person's own words.
    const kinds = session.events.map((e) => e.type);
    expect(kinds.indexOf('task-start')).toBeLessThan(kinds.indexOf('retrieval'));
  });

  it('skips a .env, a secret-shaped file, and local-only paths', async () => {
    const { provider, session } = retrievalSession([textTurn('42')], 'on');
    await session.agent.run(TASK);
    const user = userOf(provider.requests[0]!);
    for (const kept of ['.env', 'keys.mjs', 'sk-abc', 'Private/', 'notes/plan.md', '99']) {
      expect(user).not.toContain(kept);
    }
    const paths = ofType(session.events, 'retrieval')[0]!.sources.map((s) => s.path);
    expect(paths).toEqual(['src/magic.mjs']);
  });

  it('skips a path the permission policy denies to readFile', async () => {
    const provider = new MockProvider('mock', [textTurn('42')]);
    const session = makeTestSession(provider, {
      cwd: workspace(RETRIEVAL_FILES),
      configOverrides: {
        harness: { retrieval: { firstTurn: 'on' } },
        permissions: {
          defaults: { write: 'allow', shell: 'ask' },
          rules: [{ tool: 'readFile', decision: 'deny', pathGlob: 'src/**' }],
        },
      },
    });
    await session.agent.run(TASK);
    expect(userOf(provider.requests[0]!)).toBe(TASK);
    expect(ofType(session.events, 'retrieval')).toEqual([]);
  });

  it('holds to the lesser of 1,500 tokens and a tenth of the served window', async () => {
    const long = `const magicNumber = '${'m'.repeat(180)}'; // return it`;
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) files[`src/big${i}.mjs`] = `${Array(20).fill(long).join('\n')}\n`;
    const { provider, session } = retrievalSession([textTurn('ok')], 'on', {
      contextTokens: 4096,
      files,
    });
    await session.agent.run(TASK);
    const card = ofType(session.events, 'retrieval')[0]!;
    expect(card.budgetTokens).toBe(409);
    expect(card.tokens).toBeLessThanOrEqual(409);
    const user = userOf(provider.requests[0]!);
    const block = user.slice(0, user.length - TASK.length);
    expect(Math.ceil(block.trim().length / 4)).toBeLessThanOrEqual(409);
    expect(retrievalBudgetTokens(32768)).toBe(1500);
    expect(retrievalBudgetTokens(8192)).toBe(819);
    expect(retrievalBudgetTokens(0)).toBe(0);
  });

  it('never runs for a cloud seat, or a server off this network, judged by address', async () => {
    const cloud = retrievalSession([textTurn('42')], 'on', { kind: 'cloud' });
    await cloud.session.agent.run(TASK);
    expect(userOf(cloud.provider.requests[0]!)).toBe(TASK);
    expect(ofType(cloud.session.events, 'retrieval')).toEqual([]);

    // A "local" server whose address is off this network leaves it too.
    const remote = retrievalSession([textTurn('42')], 'on');
    (remote.provider as unknown as { remote: boolean }).remote = true;
    await remote.session.agent.run(TASK);
    expect(userOf(remote.provider.requests[0]!)).toBe(TASK);
    expect(ofType(remote.session.events, 'retrieval')).toEqual([]);
  });

  it('takes the task words, not the glue, and formats nothing when nothing fits', () => {
    expect(taskTerms('Please fix the resolveStack function in src/router.ts')).toEqual([
      'resolvestack',
      'function',
      'router',
    ]);
    expect(formatRetrieval([{ path: 'a.ts', startLine: 1, lines: ['x'] }], 0)).toBeUndefined();
    expect(formatRetrieval([], 500)).toBeUndefined();
  });

  it('a project may turn it off from any folder, and on only once trusted', () => {
    const base = ConfigSchema.parse({});
    const on = { harness: { retrieval: { firstTurn: 'on' }, decoding: { union: 'on' } } };
    const untrusted = applyProjectConfig(base, on, false);
    const harness = untrusted.config.harness as typeof base.harness;
    expect(harness.retrieval.firstTurn).toBeUndefined();
    expect(harness.decoding.union).toBeUndefined();
    expect(untrusted.setAside.map((s) => s.path).sort()).toEqual([
      'harness.decoding.union',
      'harness.retrieval.firstTurn',
    ]);
    const trusted = applyProjectConfig(base, on, true).config.harness as typeof base.harness;
    expect(trusted.retrieval.firstTurn).toBe('on');
    expect(trusted.decoding.union).toBe('on');
    const off = applyProjectConfig(
      { ...base, harness: { ...base.harness, retrieval: { firstTurn: 'on' } } },
      { harness: { retrieval: { firstTurn: 'off' } } },
      false,
    ).config.harness as typeof base.harness;
    expect(off.retrieval.firstTurn).toBe('off');
  });
});

// ---------------------------------------------------------------------------
// 3. Union decoding, off by default
// ---------------------------------------------------------------------------

/** A tiny seat on the JSON text bridge whose server can hold a schema. */
function unionSession(
  turns: ScriptedTurn[],
  union: 'on' | 'off' | undefined,
  extra: TestSessionOptions = {},
  provider = new MockProvider('mock', turns, {
    caps: { supportsTools: false, supportsGrammar: true },
  }),
) {
  const session = makeTestSession(provider, {
    ...extra,
    configOverrides: {
      stack: { orchestrator: { provider: 'mock', model: 'qwen2.5-coder:1.5b' } },
      harness: {
        profiles: { enabled: true },
        ...(union ? { decoding: { union } } : {}),
      },
    },
  });
  return { provider, session };
}

describe('union decoding (tech review 6)', () => {
  it('is off by default: the request is byte for byte what it was', async () => {
    const unset = unionSession([said('All done.')], undefined);
    await unset.session.agent.run('say hi');
    const off = unionSession([said('All done.')], 'off');
    await off.session.agent.run('say hi');
    expect(sameShape(off.provider.requests[0]!, off.session.cwd)).toBe(
      sameShape(unset.provider.requests[0]!, unset.session.cwd),
    );
    expect(unset.provider.requests[0]!.jsonSchema).toBeUndefined();
    expect(ofType(unset.session.events, 'turn-start')[0]!.decoding).toBeUndefined();
    expect(systemOf(unset.provider.requests[0]!)).not.toContain('{"say"');
  });

  it('on, holds the tiny seat to the union schema and streams the answer', async () => {
    // Long pieces, so the ethics screen releases each as it clears (it holds
    // text back in batches of a few hundred characters).
    const first = 'Hello, '.repeat(70);
    const second = '\\"there\\" '.repeat(50);
    const provider = new MockProvider(
      'mock',
      [
        [
          { type: 'text', delta: `{"say": "${first}` },
          { type: 'text', delta: second },
          { type: 'text', delta: '."}' },
          { type: 'done', stopReason: 'end' },
        ],
      ],
      { caps: { supportsTools: false, supportsGrammar: true } },
    );
    const answer = `${first}${'"there" '.repeat(50)}.`;
    const { session } = unionSession([], 'on', {}, provider);
    await session.agent.run('say hi');
    const schema = provider.requests[0]!.jsonSchema as { oneOf: Array<Record<string, any>> };
    expect(schema.oneOf.some((b) => b.properties?.say)).toBe(true);
    expect(schema.oneOf.some((b) => b.properties?.tool?.const === 'readFile')).toBe(true);
    expect(systemOf(provider.requests[0]!)).toContain('{"say": "<your answer as plain text>"}');
    // The answer streams in more than one piece, in its own words: no JSON.
    const deltas = ofType(session.events, 'text-delta').map((e) => e.text);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas[0]!.startsWith('Hello, ')).toBe(true);
    expect(deltas.join('')).toBe(answer);
    expect(ofType(session.events, 'text-final').at(-1)!.text).toBe(answer.trim());
    expect(ofType(session.events, 'turn-start')[0]!.decoding).toBe('union');
    // The kept history holds the answer in plain words.
    const last = session.agent.history.at(-1)!;
    expect(last).toMatchObject({ role: 'assistant', content: answer });
    expect(vaultTraceFields(session.events).unionTurns).toBe(1);
  });

  it('a tool branch runs the call, and its JSON never streams as text', async () => {
    const { provider, session } = unionSession(
      [said('{"tool": "readFile", "args": {"path": "a.txt"}}'), said('{"say": "It says hi."}')],
      'on',
      { files: { 'a.txt': 'hi' } },
    );
    await session.agent.run('read a.txt');
    const ends = ofType(session.events, 'tool-end');
    expect(ends.map((e) => [e.call.name, e.result.ok])).toEqual([['readFile', true]]);
    expect(
      ofType(session.events, 'text-delta')
        .map((e) => e.text)
        .join(''),
    ).toBe('It says hi.');
    expect(provider.requests).toHaveLength(2);
  });

  it('the class calls per turn hold on this path: a tiny seat runs one', async () => {
    const two =
      '{"tool": "readFile", "args": {"path": "a.txt"}}\n{"tool": "readFile", "args": {"path": "b.txt"}}';
    const { provider, session } = unionSession([said(two), said('{"say": "Read both."}')], 'on', {
      files: { 'a.txt': 'a', 'b.txt': 'b' },
    });
    await session.agent.run('read both');
    expect(ofType(session.events, 'tool-end')).toHaveLength(1);
    const told = provider.requests[1]!.messages.map((m) => String(m.content)).join('\n');
    expect(told).toMatch(/readFile was not run: this seat runs 1 call per reply/);
  });

  it('a server that refuses the schema answers without it from then on', async () => {
    class Refuses extends MockProvider {
      override async *chat(request: ChatRequest): AsyncGenerator<ChatEvent, void, void> {
        if (request.jsonSchema) {
          this.requests.push(request);
          throw new ProviderError('mock', 'Ollama answered 400: invalid format');
        }
        yield* super.chat(request);
      }
    }
    const provider = new Refuses('mock', [said('Plain answer.')], {
      caps: { supportsTools: false, supportsGrammar: true },
    });
    const { session } = unionSession([], 'on', {}, provider);
    await session.agent.run('say hi');
    expect(provider.requests.map((r) => Boolean(r.jsonSchema))).toEqual([true, false]);
    expect(ofType(session.events, 'text-final').at(-1)!.text).toBe('Plain answer.');
    expect(session.events.at(-1)).toMatchObject({ type: 'task-done', reason: 'complete' });
  });

  it('never reaches a seat on native tools, or a mid seat', async () => {
    const native = unionSession(
      [textTurn('hi')],
      'on',
      {},
      new MockProvider('mock', [textTurn('hi')], { caps: { supportsGrammar: true } }),
    );
    await native.session.agent.run('say hi');
    expect(native.provider.requests[0]!.jsonSchema).toBeUndefined();

    const provider = new MockProvider('mock', [said('hi')], {
      caps: { supportsTools: false, supportsGrammar: true },
    });
    const session = makeTestSession(provider, {
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'qwen2.5-coder:14b' } },
        harness: { profiles: { enabled: true }, decoding: { union: 'on' } },
      },
    });
    await session.agent.run('say hi');
    expect(provider.requests[0]!.jsonSchema).toBeUndefined();
  });

  it('the say stream holds a split escape and a split surrogate pair', () => {
    const stream = new SayStream();
    const parts = ['  {\n "say" : "a\\', 'nb\\u00', 'e9 \\ud83d', '\\ude00 z"}'].map((c) =>
      stream.push(c),
    );
    expect(parts.join('')).toBe('a\nbé \u{1f600} z');
    const tool = new SayStream();
    expect(tool.push('{"tool": "readFile", "args": {"path": "x"}}')).toBe('');
  });

  it('constrainForSmallModels keeps its repair meaning: false sends the retry unconstrained', async () => {
    const turns = () => [said('{"tool": "readFile", "args": {}}'), said('Gave up.')];
    const on = new MockProvider('mock', turns(), {
      caps: { supportsTools: false, supportsGrammar: true },
    });
    await makeTestSession(on).agent.run('read it');
    expect(on.requests[1]!.jsonSchema).toBeDefined();
    const off = new MockProvider('mock', turns(), {
      caps: { supportsTools: false, supportsGrammar: true },
    });
    await makeTestSession(off, {
      configOverrides: { harness: { decoding: { constrainForSmallModels: false } } },
    }).agent.run('read it');
    expect(off.requests[1]!.jsonSchema).toBeUndefined();
  });
});

describe('union decoding against Ollama', () => {
  it('sends the schema as `format` to a tiny seat and streams the say text', async () => {
    const baseUrl = 'http://union-ollama.test';
    _setProbeResult(baseUrl, {
      flavor: 'ollama',
      grammar: true,
      nativeTools: true,
      label: 'Ollama',
      version: '0.12.3',
    });
    const chats: Array<Record<string, any>> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith('/api/show')) {
        // No 'tools' capability: the seat runs the JSON text bridge.
        return new Response(
          JSON.stringify({
            model_info: { 'qwen2.context_length': 32768 },
            capabilities: ['completion'],
          }),
          { status: 200 },
        );
      }
      chats.push(JSON.parse(String(init?.body)));
      const lines = [`{"say": "${'Hi '.repeat(150)}`, `${'from '.repeat(90)}`, 'Ollama."}'].map(
        (content) => JSON.stringify({ message: { content }, done: false }),
      );
      lines.push(JSON.stringify({ done: true, prompt_eval_count: 900, eval_count: 9 }));
      return new Response(`${lines.join('\n')}\n`, { status: 200 });
    }) as unknown as typeof fetch;
    const ollama = new OpenAICompatibleProvider(
      'local',
      { kind: 'openai-compatible', baseUrl },
      {},
      { ramGB: () => 16 },
    );
    const session = makeTestSession(ollama as unknown as MockProvider, {
      configOverrides: {
        stack: { orchestrator: { provider: 'local', model: 'qwen2.5-coder:1.5b' } },
        harness: { profiles: { enabled: true }, decoding: { union: 'on' } },
      },
    });
    await session.agent.run('say hi');
    expect(chats).toHaveLength(1);
    expect(chats[0]!.tools).toBeUndefined();
    const format = chats[0]!.format as { oneOf: Array<Record<string, any>> };
    expect(format.oneOf.at(-1)).toMatchObject({ required: ['say'] });
    const deltas = ofType(session.events, 'text-delta').map((e) => e.text);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe(`${'Hi '.repeat(150)}${'from '.repeat(90)}Ollama.`);
    expect(deltas.some((d) => d.includes('{') || d.includes('"say"'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. The lean prompt keyed on the served window
// ---------------------------------------------------------------------------

function seat(model: string, contextTokens: number) {
  const provider = new MockProvider('mock', [textTurn('done'), textTurn('again')], {
    caps: { contextTokens },
  });
  const session = makeTestSession(provider, {
    configOverrides: {
      stack: { orchestrator: { provider: 'mock', model } },
      harness: { profiles: { enabled: true } },
    },
  });
  return { provider, session };
}

describe('the lean prompt keyed on the served window', () => {
  it('a mid seat served 4096 gets the lean prompt and the lean tool menu', async () => {
    const { provider, session } = seat('qwen2.5-coder:14b', 4096);
    await session.agent.run('do the thing');
    const system = systemOf(provider.requests[0]!);
    expect(system).toContain('Never ask for permission');
    expect(system).not.toContain('blast radius');
    expect(system).not.toContain("Hick's law");
    const tools = provider.requests[0]!.tools!.map((t) => t.name);
    expect(tools.length).toBeLessThanOrEqual(10);
    expect(tools).toContain('readFile');
    expect(tools).toContain('editFile');
    expect(
      ofType(session.events, 'note').some((n) =>
        /^This model has little room on this computer, so OpenShore gives it a shorter brief/.test(
          n.message,
        ),
      ),
    ).toBe(true);
  });

  it('the same seat served a large window keeps the full prompt and every tool', async () => {
    const { provider } = await (async () => {
      const s = seat('qwen2.5-coder:14b', 65536);
      await s.session.agent.run('do the thing');
      return s;
    })();
    const system = systemOf(provider.requests[0]!);
    expect(system).toContain('blast radius');
    expect(provider.requests[0]!.tools!.length).toBeGreaterThan(10);
  });

  it('says once per chat when even the lean prompt leaves little room', async () => {
    const tight = seat('qwen2.5-coder:3b', 2048);
    await tight.session.agent.run('do the thing');
    await tight.session.agent.run('and again');
    const notices = ofType(tight.session.events, 'window-tight');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      model: 'qwen2.5-coder:3b',
      provider: 'mock',
      windowTokens: 2048,
    });
    expect(notices[0]!.fixedTokens).toBeGreaterThan(1024);

    const roomy = seat('qwen2.5-coder:3b', 32768);
    await roomy.session.agent.run('do the thing');
    expect(ofType(roomy.session.events, 'window-tight')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. The eval switches
// ---------------------------------------------------------------------------

describe('the eval switches for the lifts', () => {
  it('parse on and off, and refuse anything else', () => {
    expect(parseLiftFlags({ retrieval: 'on', unionDecoding: 'OFF' })).toEqual({
      retrieval: 'on',
      unionDecoding: 'off',
    });
    expect(parseLiftFlags({})).toEqual({});
    expect(parseLiftFlags({ retrieval: 'maybe' })).toEqual({
      error: '--retrieval takes on or off, not "maybe".',
    });
    expect(parseLiftFlags({ unionDecoding: 'yes' })).toMatchObject({
      error: expect.stringContaining('--union-decoding'),
    });
  });

  it('land in the variant suffix and the words', () => {
    expect(variantSuffix({ retrieval: 'on', unionDecoding: 'off' })).toBe(
      '-retrieval-on-union-off',
    );
    expect(variantSuffix({ numCtx: 'off', retrieval: 'off' })).toBe('-numctx-off-retrieval-off');
    expect(describeVariant({ retrieval: 'on', unionDecoding: 'on' })).toBe(
      'retrieval on, union decoding on',
    );
  });

  it('set the config keys for the run, and nothing when unnamed', () => {
    const config = ConfigSchema.parse({});
    expect(withLifts(config, {})).toBe(config);
    const lifted = withLifts(config, { retrieval: 'on', unionDecoding: 'on' });
    expect(lifted.harness.retrieval.firstTurn).toBe('on');
    expect(lifted.harness.decoding.union).toBe('on');
    expect(lifted.harness.decoding.constrainForSmallModels).toBe(true);
  });

  it('reach the drive and the report', async () => {
    const seen: unknown[] = [];
    const report = await runEvalV2(
      async (_cwd, _prompt, _task, context) => {
        seen.push(context);
        return { finalText: '', trace: { turns: 1, toolCalls: [], wrote: false } };
      },
      { tasks: [EVAL_TASKS[0]!], retrieval: 'on', unionDecoding: 'off' },
    );
    expect(seen[0]).toMatchObject({ retrieval: 'on', unionDecoding: 'off' });
    expect(report.variant).toEqual({ retrieval: 'on', unionDecoding: 'off' });
    expect(report.scores[0]!.trace!.variant).toEqual({ retrieval: 'on', unionDecoding: 'off' });
  });

  it('go on the floor run: every engine run, with the baseline left to the plain run', () => {
    const plain = floorPlan(['m'], true);
    expect(plain.some((r) => r.driver === 'claude-code')).toBe(true);
    const lifted = floorPlan(['m'], true, { retrieval: 'on' });
    expect(lifted.every((r) => r.driver === 'engine' && r.retrieval === 'on')).toBe(true);
    expect(describeRun(lifted[0]!)).toBe('code, OpenShore, num_ctx off, retrieval on');
    expect(describeRun({ ...lifted[0]!, unionDecoding: 'on' })).toMatch(/union decoding on$/);
  });

  it('the trace line names the lifts', () => {
    expect(
      costLine({
        turns: 3,
        toolCalls: [],
        wrote: false,
        retrievalTokens: 420,
        unionTurns: 3,
        repeatBreaks: { exact: 1, alternating: 2 },
      }),
    ).toBe('retrieval 420 tokens, 3 union turns, 3 repeats broken (2 back and forth)');
  });
});

// ---------------------------------------------------------------------------
// 6. Headless runs hand no work to another model (security package note)
// ---------------------------------------------------------------------------

describe('a headless run hands no work to another model', () => {
  const stack = { stackHasVision: true, stackHasImageGen: true, stackHasSpecialists: true };

  it('leaves the specialist, vision and image tools out, and names them', () => {
    const online = buildToolRegistry(stack).names();
    const offline = buildToolRegistry({ ...stack, offline: true }).names();
    for (const name of ['delegate', 'analyzeImage', 'generateImage']) {
      expect(online).toContain(name);
      expect(offline).not.toContain(name);
    }
    expect(networkToolsLeftOut({ ...stack, offline: true })).toEqual(
      expect.arrayContaining(['delegate', 'analyzeImage', 'generateImage']),
    );
    expect(networkToolsLeftOut({ ...stack, offline: false })).toEqual([]);
    expect(offlineLine(['delegate', 'analyzeImage'])).toBe(
      'It ran offline, so it could not hand work to another model or look at images with another model.',
    );
  });

  it('refuses a delegate call by name, never asks', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('delegate', { role: 'coding', task: 'write it' }, 'c1'),
      textTurn('Did it here.'),
    ]);
    const session = makeTestSession(provider, {
      profile: 'headless',
      offline: true,
      specialists: true,
    });
    expect(session.tools.names()).not.toContain('delegate');
    await session.agent.run('write it');
    expect(session.approvals).toEqual([]);
    const denied = ofType(session.events, 'tool-denied');
    expect(denied.map((d) => [d.call.name, d.reason])).toEqual([['delegate', OFFLINE_DENIED]]);
  });
});
