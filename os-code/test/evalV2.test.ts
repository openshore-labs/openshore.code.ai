// Eval v2 regression guard: proves the benchmark runs the REAL agent loop
// against a fixture workspace and scores by behavior, with no model weights.
// A scripted mock provider stands in for the model, so this is the CI path the
// CTO asked for: the harness itself is exercised end to end (fixtures written,
// loop run, tools executed, edit applied to disk, checker discriminates).
import { describe, it, expect } from 'vitest';
import { runEvalV2, type DriveTask } from '../src/eval/v2.js';
import { EVAL_TASKS, EVAL_CHECK_FILE, verifyCommandFor } from '../src/eval/tasks.js';
import { traceFrom } from '../src/commands/eval.js';
import { MockProvider, toolTurn, textTurn, type ScriptedTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { AgentEvent } from '../src/core/agent/types.js';

const task = (id: string) => EVAL_TASKS.find((t) => t.id === id)!;

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
    expect(report.scores[0]!.trace).toEqual({
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
