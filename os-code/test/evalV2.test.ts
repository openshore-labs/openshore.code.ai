// Eval v2 regression guard: proves the benchmark runs the REAL agent loop
// against a fixture workspace and scores by behavior, with no model weights.
// A scripted mock provider stands in for the model, so this is the CI path the
// CTO asked for: the harness itself is exercised end to end (fixtures written,
// loop run, tools executed, edit applied to disk, checker discriminates).
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  defaultTasks,
  runEvalV2,
  vaultTraceFields,
  variantSuffix,
  type DriveContext,
  type DriveTask,
} from '../src/eval/v2.js';
import {
  EVAL_TASKS,
  EVAL_VAULT_TASKS,
  EVAL_HANDOFF_TASKS,
  EVAL_CHECK_FILE,
  HANDOFF_DECISION,
  HANDOFF_HISTORY,
  gradeConventionAnswer,
  verifyCommandFor,
} from '../src/eval/tasks.js';
import {
  buildVaultFixture,
  VAULT_CONVENTION,
  VAULT_DECISION,
  VAULT_FIXTURE_NOTE_COUNT,
  VAULT_FIXTURE_PATHS,
} from '../src/eval/vaultFixture.js';
import { costLine, deepDrive, describeVariant, traceFrom } from '../src/commands/eval.js';
import type { HandoffTurn } from '../src/harness/handoff.js';
import { ConfigSchema } from '../src/config/schema.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { VAULT_NOTES_FRAMING } from '../src/harness/vaultContext.js';
import { MockProvider, toolTurn, textTurn, type ScriptedTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { AgentEvent } from '../src/core/agent/types.js';

const task = (id: string) => [...EVAL_TASKS, ...EVAL_VAULT_TASKS].find((t) => t.id === id)!;

const MATH_FIXED = [
  'export function add(a, b) {',
  '  return a + b;',
  '}',
  '',
  'export function subtract(a, b) {',
  '  return a - b;',
  '}',
  '',
].join('\n');

function finalText(events: AgentEvent[]): string {
  const finals = events.filter((e) => e.type === 'text-final') as Array<{ text: string }>;
  return finals.length ? finals[finals.length - 1]!.text : '';
}

// Drive the real loop over the eval-provided workspace with a mock provider
// scripted for this run.
function driverFor(turns: ScriptedTurn[]): DriveTask {
  return async (cwd, prompt) => {
    const provider = new MockProvider('mock', turns);
    const session = makeTestSession(provider, { cwd });
    await session.agent.run(prompt);
    return finalText(session.events);
  };
}

describe('eval v2 runs the loop and scores by behavior', () => {
  it('scores a correct fix at 1 by actually applying and running the code', async () => {
    const drive = driverFor([
      toolTurn('writeFile', { path: 'math.mjs', content: MATH_FIXED }),
      textTurn('Fixed subtract so it returns a - b.'),
    ]);
    const report = await runEvalV2(drive, { tasks: [task('fix-bug')] });
    expect(report.scores[0]!.score).toBe(1);
    expect(report.average).toBe(1);
  });

  it('scores a no-op run at 0 because the bug is still there', async () => {
    const drive = driverFor([textTurn('Looks fine to me.')]);
    const report = await runEvalV2(drive, { tasks: [task('fix-bug')] });
    expect(report.scores[0]!.score).toBe(0);
  });

  it('scores an answer task on the final text', async () => {
    const right = await runEvalV2(driverFor([textTurn('42')]), {
      tasks: [task('answer-from-code')],
    });
    expect(right.scores[0]!.score).toBe(1);

    const wrong = await runEvalV2(driverFor([textTurn('the answer is seven')]), {
      tasks: [task('answer-from-code')],
    });
    expect(wrong.scores[0]!.score).toBe(0);
  });

  it('runs independent tries and reports one try next to best of k', async () => {
    // Three tries: miss, hit, miss. One try is the mean (1/3); best of 3 is 1.
    // Each try is a fresh workspace, so the hit cannot leak into the misses.
    let call = 0;
    const drive: DriveTask = async (cwd, prompt) => {
      call += 1;
      const turns =
        call === 2
          ? [toolTurn('writeFile', { path: 'math.mjs', content: MATH_FIXED }), textTurn('done')]
          : [textTurn('Looks fine to me.')];
      const provider = new MockProvider('mock', turns);
      const session = makeTestSession(provider, { cwd });
      await session.agent.run(prompt);
      return finalText(session.events);
    };
    const report = await runEvalV2(drive, { tasks: [task('fix-bug')], attempts: 3 });
    expect(report.attempts).toBe(3);
    expect(report.scores[0]!.attempts).toEqual([0, 1, 0]);
    expect(report.scores[0]!.score).toBeCloseTo(1 / 3);
    expect(report.scores[0]!.best).toBe(1);
    expect(report.average).toBeCloseTo(1 / 3);
    expect(report.bestAverage).toBe(1);
  });

  it('carries a per-task trace through when the drive supplies one', async () => {
    // A drive that returns an outcome-with-trace (as the CLI does) surfaces the
    // trace on the score, so a zero reads as a diagnosis.
    const drive: DriveTask = async () => ({
      finalText: '',
      trace: {
        turns: 1,
        toolCalls: ['editFile'],
        wrote: false,
        doneReason: 'error',
        message: 'the model kept producing tool calls that could not be parsed',
      },
    });
    const report = await runEvalV2(drive, { tasks: [task('fix-bug')] });
    expect(report.scores[0]!.score).toBe(0);
    expect(report.scores[0]!.trace).toMatchObject({
      turns: 1,
      toolCalls: ['editFile'],
      wrote: false,
      doneReason: 'error',
      message: 'the model kept producing tool calls that could not be parsed',
    });
  });

  it('defaults to one try, where best equals the score', async () => {
    const report = await runEvalV2(driverFor([textTurn('42')]), {
      tasks: [task('answer-from-code')],
    });
    expect(report.attempts).toBe(1);
    expect(report.scores[0]!.attempts).toEqual([1]);
    expect(report.bestAverage).toBe(report.average);
  });

  it("runs the task's own check in the loop: a wrong fix comes back, the next one passes", async () => {
    // Verify in the loop, wired the way the CLI wires it: the task's check
    // lands in the workspace and runs after a change; the failure (with the
    // check's own FAIL line) goes back to the model, which fixes it. The score
    // still comes from the independent checker.
    const wrong = MATH_FIXED.replace('return a - b;', 'return a * b;');
    let seen: AgentEvent[] = [];
    let retryPrompt = '';
    const drive: DriveTask = async (cwd, prompt, task) => {
      const provider = new MockProvider('mock', [
        toolTurn('writeFile', { path: 'math.mjs', content: wrong }, 'c1'),
        textTurn('Fixed.'),
        toolTurn('writeFile', { path: 'math.mjs', content: MATH_FIXED }, 'c2'),
        textTurn('Fixed for real.'),
      ]);
      const session = makeTestSession(provider, {
        cwd,
        configOverrides: { harness: { verify: { command: verifyCommandFor(task) } } },
      });
      await session.agent.run(prompt);
      seen = session.events;
      const retry = provider.requests[2]!.messages.find(
        (m) => m.role === 'user' && /\[verify result\]/.test(String(m.content)),
      );
      retryPrompt = String(retry?.content ?? '');
      return {
        finalText: finalText(session.events),
        trace: traceFrom(session.events, session.tools),
      };
    };
    const report = await runEvalV2(drive, { tasks: [task('fix-bug')] });
    expect(report.scores[0]!.score).toBe(1);
    expect(retryPrompt).toContain('FAIL: subtract(5, 3) returned 15, expected 2');
    const verifies = seen.filter((e) => e.type === 'verify') as Array<{ passed: boolean }>;
    expect(verifies.map((v) => v.passed)).toEqual([false, true]);
    expect(report.scores[0]!.trace?.verify).toEqual({ rounds: 2, passed: true });
  });

  it('every edit task carries a check; the answer task has none', () => {
    for (const id of ['fix-bug', 'add-function', 'rename-across-files']) {
      expect(verifyCommandFor(task(id))).toBe(`node ${EVAL_CHECK_FILE}`);
    }
    expect(verifyCommandFor(task('answer-from-code'))).toBeUndefined();
  });

  it('reports a per-category average across tasks', async () => {
    // One correct edit, one wrong answer: category averages reflect each.
    const drive: DriveTask = async (cwd, prompt) => {
      const turns = prompt.includes('math.mjs')
        ? [toolTurn('writeFile', { path: 'math.mjs', content: MATH_FIXED }), textTurn('done')]
        : [textTurn('no idea')];
      const provider = new MockProvider('mock', turns);
      const session = makeTestSession(provider, { cwd });
      await session.agent.run(prompt);
      return finalText(session.events);
    };
    const report = await runEvalV2(drive, { tasks: [task('fix-bug'), task('answer-from-code')] });
    expect(report.byCategory.edit).toBe(1);
    expect(report.byCategory.answer).toBe(0);
    expect(report.average).toBe(0.5);
  });
});

function markdownUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...markdownUnder(abs));
    else if (name.endsWith('.md')) out.push(abs);
  }
  return out;
}

const syncWith = (n: number) =>
  [
    `export const MAX_RETRIES = ${n};`,
    '',
    'export function nextDelay(attempt) {',
    '  return 250 * 2 ** attempt;',
    '}',
    '',
  ].join('\n');

describe('eval v2 vault tasks (Vault M4, 4.8)', () => {
  it('the fixture is deterministic and about two hundred notes', () => {
    const a = buildVaultFixture();
    const b = buildVaultFixture();
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.keys(a)).toHaveLength(VAULT_FIXTURE_NOTE_COUNT);
    expect(VAULT_FIXTURE_NOTE_COUNT).toBe(200);
    for (const path of Object.values(VAULT_FIXTURE_PATHS)) expect(a[path]).toBeDefined();
    // Folders, tags, and links: a real haystack, not a flat list.
    const folders = new Set(Object.keys(a).map((p) => p.split('/')[0]));
    expect(folders.size).toBeGreaterThanOrEqual(6);
    const tagged = Object.values(a).filter((t) => /^tags: \[/m.test(t));
    expect(tagged.length).toBe(VAULT_FIXTURE_NOTE_COUNT);
  });

  it('every wikilink in the fixture resolves to a note by its name', () => {
    const notes = buildVaultFixture();
    const names = new Set(
      Object.keys(notes).map((p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '')),
    );
    let links = 0;
    for (const text of Object.values(notes)) {
      for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
        links += 1;
        expect(names.has(m[1]!)).toBe(true);
      }
    }
    expect(links).toBeGreaterThan(VAULT_FIXTURE_NOTE_COUNT);
  });

  it('the decision is reached by the hub link, and each answer lives in one note', () => {
    const notes = buildVaultFixture();
    const decisionName = 'Backoff ruling, March';
    expect(VAULT_FIXTURE_PATHS.decision).toContain(decisionName);
    expect(notes[VAULT_FIXTURE_PATHS.hub]).toContain(`[[${decisionName}]]`);
    // The task names the hub, not the decision, so the way there is the link.
    const followPrompt = task('vault-follow-link').prompt;
    for (const word of ['Backoff', 'ruling', 'March']) expect(followPrompt).not.toContain(word);
    const holding = (needle: string) =>
      Object.entries(notes)
        .filter(([, t]) => t.includes(needle))
        .map(([p]) => p);
    expect(holding(`MAX_RETRIES is ${VAULT_DECISION.right}`)).toEqual([
      VAULT_FIXTURE_PATHS.decision,
    ]);
    expect(holding(`MAX_RETRIES is ${VAULT_DECISION.stale}`)).toEqual([VAULT_FIXTURE_PATHS.stale]);
    expect(holding(VAULT_CONVENTION.right)).toEqual([VAULT_FIXTURE_PATHS.convention]);
    expect(holding(VAULT_CONVENTION.stale)).toEqual([VAULT_FIXTURE_PATHS.stale]);
    // The stale note is an agent's crew-run log, older than the decision.
    expect(notes[VAULT_FIXTURE_PATHS.stale]).toMatch(/^type: crew-run$/m);
  });

  it("lands the fixture in the eval's own vault folder, beside the workspace", async () => {
    let seen: { cwd: string; context: DriveContext } | undefined;
    let files: string[] = [];
    let workspace: string[] = ['(unread)'];
    const drive: DriveTask = async (cwd, _prompt, _task, context) => {
      seen = { cwd, context };
      workspace = readdirSync(cwd);
      files = markdownUnder(context.vaultDir!).map((f) => relative(context.vaultDir!, f));
      return 'rel-kestrel/';
    };
    await runEvalV2(drive, { tasks: [task('vault-recall-convention')] });
    expect(seen?.context.vaultDir).toBeDefined();
    expect(files.sort()).toEqual(Object.keys(buildVaultFixture()).sort());
    const rel = relative(seen!.cwd, seen!.context.vaultDir!);
    expect(rel.startsWith('..')).toBe(true);
    // The recall task's workspace is empty: the only place the answer lives
    // is the vault.
    expect(workspace).toEqual([]);
  });

  it('a code task gets no vault folder', async () => {
    let context: DriveContext | undefined;
    await runEvalV2(
      async (_c, _p, _t, ctx) => {
        context = ctx;
        return '42';
      },
      { tasks: [task('answer-from-code')] },
    );
    expect(context?.vaultDir).toBeUndefined();
  });

  it('recall grades the exact convention right and the stale one wrong, through the loop', async () => {
    const score = async (answer: string) =>
      (await runEvalV2(driverFor([textTurn(answer)]), { tasks: [task('vault-recall-convention')] }))
        .scores[0]!;
    expect((await score('rel-kestrel/')).score).toBe(1);
    expect((await score('`rel-kestrel/`')).score).toBe(1);
    expect((await score('Release branches start with rel-kestrel/')).score).toBe(0.5);
    const stale = await score('release/');
    expect(stale.score).toBe(0);
    expect(stale.detail).toContain('stale');
    // Hedging between the two scores nothing.
    expect((await score('rel-kestrel/ or release/')).score).toBe(0);
    expect((await score('feature/')).score).toBe(0);
    expect(gradeConventionAnswer('').score).toBe(0);
  });

  it('follow-link grades the decision right and the stale value wrong, through the loop', async () => {
    const run = async (turns: ScriptedTurn[]) =>
      (await runEvalV2(driverFor(turns), { tasks: [task('vault-follow-link')] })).scores[0]!;
    const right = await run([
      toolTurn('writeFile', { path: 'sync.mjs', content: syncWith(VAULT_DECISION.right) }),
      textTurn('Set MAX_RETRIES to the decided value.'),
    ]);
    expect(right.score).toBe(1);
    const stale = await run([
      toolTurn('writeFile', { path: 'sync.mjs', content: syncWith(VAULT_DECISION.stale) }),
      textTurn('Set it from the nightly log.'),
    ]);
    expect(stale.score).toBe(0);
    expect(stale.detail).toContain('stale');
    const untouched = await run([textTurn('Nothing to change.')]);
    expect(untouched.score).toBe(0);
    expect(untouched.detail).not.toContain('stale');
  });

  it("the follow-link check never prints the decision's value to the model", () => {
    const script = task('vault-follow-link').verifyScript!;
    expect(verifyCommandFor(task('vault-follow-link'))).toBe(`node ${EVAL_CHECK_FILE}`);
    expect(script).not.toMatch(new RegExp(`\\b${VAULT_DECISION.right}\\b`));
    expect(verifyCommandFor(task('vault-recall-convention'))).toBeUndefined();
  });
});

describe('eval v2 variants and trace fields (Vault M4, CTO I14)', () => {
  it('records the pack and served-window variant on the report, every trace, and the drive', async () => {
    const contexts: DriveContext[] = [];
    const drive: DriveTask = async (_cwd, _prompt, t, context) => {
      contexts.push(context);
      return {
        finalText: t.id === 'vault-recall-convention' ? 'rel-kestrel/' : '',
        trace: { turns: 2, toolCalls: [], wrote: false, promptTokens: 900 },
      };
    };
    const report = await runEvalV2(drive, { vaultPack: 'on', numCtx: 'auto' });
    // --vault-pack selects the vault suite by default.
    expect(report.scores.map((s) => s.task)).toEqual(EVAL_VAULT_TASKS.map((t) => t.id));
    expect(report.variant).toEqual({ vaultPack: 'on', numCtx: 'auto' });
    for (const s of report.scores) {
      expect(s.trace?.variant).toEqual({ vaultPack: 'on', numCtx: 'auto' });
      expect(s.trace?.promptTokens).toBe(900);
      expect(typeof s.trace?.wallMs).toBe('number');
      expect(s.trace!.wallMs!).toBeGreaterThanOrEqual(0);
    }
    for (const c of contexts) {
      expect(c.vaultPack).toBe('on');
      expect(c.numCtx).toBe('auto');
    }

    const off = await runEvalV2(drive, { vaultPack: 'off' });
    expect(off.variant).toEqual({ vaultPack: 'off' });
    expect(off.scores[0]!.trace?.variant).toEqual({ vaultPack: 'off' });
  });

  it('a run with no variant keeps the code suite and records none', async () => {
    const report = await runEvalV2(async () => ({
      finalText: '42',
      trace: { turns: 1, toolCalls: [], wrote: false },
    }));
    expect(report.scores.map((s) => s.task)).toEqual(EVAL_TASKS.map((t) => t.id));
    expect(report.variant).toEqual({});
    expect(report.scores[0]!.trace?.variant).toBeUndefined();
  });

  it('with and without runs get separate report names', () => {
    expect(variantSuffix({})).toBe('');
    expect(variantSuffix({ vaultPack: 'on' })).toBe('-pack-on');
    expect(variantSuffix({ vaultPack: 'off', numCtx: 'auto' })).toBe('-pack-off-numctx-auto');
  });

  it('reads input tokens, pack tokens, and pack notes off the events', () => {
    const events: AgentEvent[] = [
      { type: 'usage', promptTokens: 1200, completionTokens: 40, dollars: 0, contextPercent: 5 },
      {
        type: 'context-pack',
        seat: 'local',
        mode: 'full',
        tokens: 300,
        budgetTokens: 2600,
        sources: [
          { layer: 'search', path: VAULT_FIXTURE_PATHS.convention, title: 'Branch names' },
          { layer: 'link', path: VAULT_FIXTURE_PATHS.hub, title: 'Atlas hub' },
        ],
        withheld: 0,
        cold: false,
      },
      { type: 'usage', promptTokens: 1500, completionTokens: 10, dollars: 0, contextPercent: 6 },
      {
        type: 'context-pack',
        seat: 'local',
        mode: 'full',
        tokens: 280,
        budgetTokens: 2600,
        sources: [{ layer: 'search', path: VAULT_FIXTURE_PATHS.convention, title: 'Branch names' }],
        withheld: 0,
        cold: false,
      },
    ];
    expect(vaultTraceFields(events)).toEqual({
      promptTokens: 2700,
      packTokens: 580,
      packNotes: [VAULT_FIXTURE_PATHS.convention, VAULT_FIXTURE_PATHS.hub],
    });
    // No pack event: no pack fields, so "pack off" and "pack empty" differ.
    expect(vaultTraceFields(events.filter((e) => e.type === 'usage'))).toEqual({
      promptTokens: 2700,
    });
    expect(vaultTraceFields([])).toEqual({});
  });
});

// Wave 2: the CLI's own drive (commands/eval.ts deepDrive), the path
// `osc eval --deep --vault-pack on|off` runs, through a mock provider. The
// task's vault is the session's vault for the pack and the tools; on puts the
// convention note into the prompt, off keeps every note out.
describe('the deep drive and the vault-pack variant', () => {
  const systemText = (provider: MockProvider): string => {
    const sys = provider.requests[0]?.messages.find((m) => m.role === 'system');
    return typeof sys?.content === 'string' ? sys.content : JSON.stringify(sys?.content ?? '');
  };

  async function runVariant(vaultPack: 'on' | 'off') {
    const provider = new MockProvider('mock', [textTurn('rel-kestrel/')]);
    const config = ConfigSchema.parse({
      stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
    });
    const drive = deepDrive({
      config,
      providers: (() => {
        const r = new ProviderRegistry(config, () => undefined);
        r.register('mock', provider);
        return r;
      })(),
      providerId: 'mock',
      cloudApproved: () => false,
    });
    const report = await runEvalV2(drive, {
      tasks: [task('vault-recall-convention')],
      vaultPack,
    });
    return { provider, report };
  }

  it('on: the pack, framed as quoted notes, carries the convention note', async () => {
    const { provider, report } = await runVariant('on');
    const system = systemText(provider);
    expect(system).toContain(VAULT_NOTES_FRAMING);
    expect(system).toContain(`path="${VAULT_FIXTURE_PATHS.convention}"`);
    const trace = report.scores[0]!.trace!;
    expect(trace.variant).toEqual({ vaultPack: 'on' });
    expect(trace.packTokens).toBeGreaterThan(0);
    expect(trace.packNotes).toContain(VAULT_FIXTURE_PATHS.convention);
    expect(trace.wallMs).toBeGreaterThanOrEqual(0);
    expect(report.scores[0]!.score).toBe(1);
  });

  it('off: no pack and no note text in the prompt', async () => {
    const { provider, report } = await runVariant('off');
    const system = systemText(provider);
    expect(system).not.toContain(VAULT_NOTES_FRAMING);
    expect(system).not.toContain(VAULT_FIXTURE_PATHS.convention);
    const trace = report.scores[0]!.trace!;
    expect(trace.variant).toEqual({ vaultPack: 'off' });
    expect(trace.packTokens).toBeUndefined();
  });

  it('num-ctx sets the endpoint on one fresh registry per value', async () => {
    const seen: Array<string | undefined> = [];
    const config = ConfigSchema.parse({
      stack: { orchestrator: { provider: 'ollama', model: 'mock-model' } },
    });
    const base = new ProviderRegistry(config, () => undefined);
    base.register('ollama', new MockProvider('ollama', [textTurn('unused')]));
    const drive = deepDrive({
      config,
      providers: base,
      providerId: 'ollama',
      cloudApproved: () => false,
      makeProviders: (cfg) => {
        const endpoint = cfg.providers.ollama;
        seen.push(endpoint?.kind === 'openai-compatible' ? endpoint.numCtx : 'wrong kind');
        const r = new ProviderRegistry(cfg, () => undefined);
        r.register('ollama', new MockProvider('ollama', [textTurn('42'), textTurn('42')]));
        return r;
      },
    });
    const report = await runEvalV2(drive, {
      tasks: [task('answer-from-code')],
      numCtx: 'auto',
      attempts: 2,
    });
    expect(seen).toEqual(['auto']);
    expect(report.variant).toEqual({ numCtx: 'auto' });
  });

  it('the cost line names input tokens, the pack, and wall time', () => {
    expect(
      costLine({
        turns: 1,
        toolCalls: [],
        wrote: false,
        promptTokens: 900,
        packTokens: 120,
        packNotes: ['a.md', 'b.md'],
        wallMs: 2500,
      }),
    ).toBe('900 input tokens, pack 120 tokens, 2 notes, 2.5s');
    expect(costLine({ turns: 1, toolCalls: [], wrote: false })).toBe('');
  });
});

// Vault M5 (CTO J13, J17, J19): the handoff task, the prompt cache and handoff
// variants, and the cache fields on the trace.
describe('eval v2 handoff task (Vault M5)', () => {
  const handoffTask = task('vault-continue-handoff');
  const right = String(HANDOFF_DECISION.right);

  it('joins the vault suite and is the handoff suite', () => {
    expect(EVAL_VAULT_TASKS.map((t) => t.id)).toEqual([
      'vault-recall-convention',
      'vault-follow-link',
      'vault-continue-handoff',
    ]);
    expect(EVAL_HANDOFF_TASKS.map((t) => t.id)).toEqual(['vault-continue-handoff']);
  });

  it('the decision lives only in the earlier chat, never where the run can see it', () => {
    expect(handoffTask.prompt).not.toContain(right);
    expect(handoffTask.verifyScript).not.toContain(right);
    for (const text of Object.values(handoffTask.files)) expect(text).not.toContain(right);
    expect(handoffTask.vault).toEqual({});
    // The chat carries it on a decision line and on its closing line, where a
    // handoff extracts from; the passed-over option only in a line that is
    // neither.
    const last = HANDOFF_HISTORY[HANDOFF_HISTORY.length - 1]!;
    const lines = last.text.split('\n');
    expect(lines[0]).toMatch(/^Decided: .*5400/);
    expect(lines[lines.length - 1]).toContain(right);
    const other = String(HANDOFF_DECISION.other);
    const holding = HANDOFF_HISTORY.filter((t) => t.text.includes(other));
    expect(holding).toHaveLength(1);
    expect(holding[0]!.text).not.toMatch(/decided|going with|chose|we will/i);
    expect(handoffTask.handoff?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('grades the settled value right and the passed-over option wrong, through the loop', async () => {
    const run = async (value: number) =>
      (
        await runEvalV2(
          driverFor([
            toolTurn('writeFile', {
              path: 'cache.mjs',
              content: [
                `export const CACHE_TTL_SECONDS = ${value};`,
                '',
                'export function expiresAt(now) {',
                '  return now + CACHE_TTL_SECONDS * 1000;',
                '}',
                '',
              ].join('\n'),
            }),
            textTurn('Done.'),
          ]),
          { tasks: [handoffTask] },
        )
      ).scores[0]!;
    expect((await run(HANDOFF_DECISION.right)).score).toBe(1);
    const other = await run(HANDOFF_DECISION.other);
    expect(other.score).toBe(0);
    expect(other.detail).toContain('passed over');
    expect((await run(HANDOFF_DECISION.start)).score).toBe(0);
  });
});

describe('eval v2 prompt cache and handoff variants (Vault M5)', () => {
  it('each variant picks its suite and gets its own report name', () => {
    expect(defaultTasks({})).toBe(EVAL_TASKS);
    expect(defaultTasks({ promptCache: 'on' })).toBe(EVAL_TASKS);
    expect(defaultTasks({ handoff: 'off' })).toBe(EVAL_HANDOFF_TASKS);
    expect(defaultTasks({ vaultPack: 'on', handoff: 'on' })).toBe(EVAL_VAULT_TASKS);
    expect(variantSuffix({ promptCache: 'on' })).toBe('-cache-on');
    expect(variantSuffix({ handoff: 'off' })).toBe('-handoff-off');
    expect(variantSuffix({ numCtx: 'auto', promptCache: 'off', handoff: 'on' })).toBe(
      '-numctx-auto-cache-off-handoff-on',
    );
    expect(describeVariant({ promptCache: 'on', handoff: 'off' })).toBe(
      'prompt cache on, handoff off',
    );
  });

  it('records the variant on the report, every trace, and the drive', async () => {
    const contexts: DriveContext[] = [];
    const drive: DriveTask = async (_cwd, _prompt, _t, context) => {
      contexts.push(context);
      return { finalText: '', trace: { turns: 1, toolCalls: [], wrote: false } };
    };
    const report = await runEvalV2(drive, { handoff: 'on', promptCache: 'on' });
    expect(report.scores.map((s) => s.task)).toEqual(['vault-continue-handoff']);
    expect(report.variant).toEqual({ promptCache: 'on', handoff: 'on' });
    expect(report.scores[0]!.trace?.variant).toEqual({ promptCache: 'on', handoff: 'on' });
    expect(contexts[0]).toMatchObject({ promptCache: 'on', handoff: 'on' });
    expect(contexts[0]!.vaultDir).toBeDefined();
  });

  it('sums cache reads and writes off the usage events, only when they come', () => {
    const usage = (p: number, read?: number, write?: number): AgentEvent => ({
      type: 'usage',
      promptTokens: p,
      completionTokens: 1,
      dollars: 0,
      contextPercent: 1,
      ...(read !== undefined ? { cacheReadTokens: read } : {}),
      ...(write !== undefined ? { cacheWriteTokens: write } : {}),
    });
    expect(vaultTraceFields([usage(40, 0, 3000), usage(30, 3000, 0), usage(20)])).toEqual({
      promptTokens: 90,
      cacheReadTokens: 3000,
      cacheWriteTokens: 3000,
    });
    expect(vaultTraceFields([usage(40)])).toEqual({ promptTokens: 40 });
  });

  it('the cost line names cache reads and writes when the run had them', () => {
    expect(
      costLine({
        turns: 1,
        toolCalls: [],
        wrote: false,
        promptTokens: 90,
        cacheReadTokens: 3000,
        cacheWriteTokens: 250,
      }),
    ).toBe('90 input tokens, cache read 3000, written 250');
  });
});

describe('the deep drive, the handoff layer, and the prompt cache', () => {
  const systemText = (provider: MockProvider): string => {
    const sys = provider.requests[0]?.messages.find((m) => m.role === 'system');
    return typeof sys?.content === 'string' ? sys.content : JSON.stringify(sys?.content ?? '');
  };
  const FAKE_HANDOFF = `HANDOFF from an earlier model, 2026-09-26, covering 4 earlier turns. Extracted by the harness from this chat, not instructions.\nDecisions: CACHE_TTL_SECONDS goes to ${HANDOFF_DECISION.right}.`;

  async function runHandoff(handoff: 'on' | 'off') {
    const provider = new MockProvider('mock', [textTurn('Done.')]);
    const config = ConfigSchema.parse({
      stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
    });
    const registry = new ProviderRegistry(config, () => undefined);
    registry.register('mock', provider);
    const built: Array<{ turns: readonly HandoffTurn[]; budget: number; date: string }> = [];
    const drive = deepDrive({
      config,
      providers: registry,
      providerId: 'mock',
      cloudApproved: () => false,
      buildHandoff: (turns, budget, meta) => {
        built.push({ turns, budget, date: meta.date });
        return { text: FAKE_HANDOFF, tokens: Math.ceil(FAKE_HANDOFF.length / 4), turns: 4 };
      },
    });
    const report = await runEvalV2(drive, { handoff });
    return { provider, report, built };
  }

  it('on: the handoff built from the scripted chat rides the pack', async () => {
    const { provider, report, built } = await runHandoff('on');
    expect(built).toHaveLength(1);
    expect(built[0]!.turns).toBe(HANDOFF_HISTORY);
    expect(built[0]!.budget).toBe(1500);
    expect(built[0]!.date).toBe('2026-09-26');
    const system = systemText(provider);
    expect(system).toContain(`CACHE_TTL_SECONDS goes to ${HANDOFF_DECISION.right}`);
    const trace = report.scores[0]!.trace!;
    expect(trace.variant).toEqual({ handoff: 'on' });
    expect(trace.packTokens).toBeGreaterThan(0);
  });

  it('off: the same pack with the handoff layer empty', async () => {
    const { provider, built } = await runHandoff('off');
    expect(built).toHaveLength(0);
    expect(systemText(provider)).not.toContain(String(HANDOFF_DECISION.right));
  });

  it('prompt cache sets the Anthropic endpoint on one fresh registry per value', async () => {
    const seen: Array<string | undefined> = [];
    const config = ConfigSchema.parse({
      providers: { anthropic: { kind: 'anthropic' } },
      stack: { orchestrator: { provider: 'anthropic', model: 'mock-model' } },
    });
    const base = new ProviderRegistry(config, () => undefined);
    base.register('anthropic', new MockProvider('anthropic', [textTurn('unused')]));
    const drive = deepDrive({
      config,
      providers: base,
      providerId: 'anthropic',
      cloudApproved: () => false,
      makeProviders: (cfg) => {
        const endpoint = cfg.providers.anthropic;
        seen.push(endpoint?.kind === 'anthropic' ? endpoint.promptCache : 'wrong kind');
        const r = new ProviderRegistry(cfg, () => undefined);
        r.register('anthropic', new MockProvider('anthropic', [textTurn('42'), textTurn('42')]));
        return r;
      },
    });
    const report = await runEvalV2(drive, {
      tasks: [task('answer-from-code')],
      promptCache: 'on',
      attempts: 2,
    });
    expect(seen).toEqual(['auto']);
    expect(report.variant).toEqual({ promptCache: 'on' });
  });
});
