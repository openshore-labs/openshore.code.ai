// Eval v2 regression guard: proves the benchmark runs the REAL agent loop
// against a fixture workspace and scores by behavior, with no model weights.
// A scripted mock provider stands in for the model, so this is the CI path the
// CTO asked for: the harness itself is exercised end to end (fixtures written,
// loop run, tools executed, edit applied to disk, checker discriminates).
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  runEvalV2,
  vaultTraceFields,
  variantSuffix,
  type DriveContext,
  type DriveTask,
} from '../src/eval/v2.js';
import {
  EVAL_TASKS,
  EVAL_VAULT_TASKS,
  EVAL_CHECK_FILE,
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
import { traceFrom } from '../src/commands/eval.js';
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
