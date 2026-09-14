// Eval v2 regression guard: proves the benchmark runs the REAL agent loop
// against a fixture workspace and scores by behavior, with no model weights.
// A scripted mock provider stands in for the model, so this is the CI path the
// CTO asked for: the harness itself is exercised end to end (fixtures written,
// loop run, tools executed, edit applied to disk, checker discriminates).
import { describe, it, expect } from 'vitest';
import { runEvalV2, type DriveTask } from '../src/eval/v2.js';
import { EVAL_TASKS } from '../src/eval/tasks.js';
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
