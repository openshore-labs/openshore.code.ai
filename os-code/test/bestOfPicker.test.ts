// Best-of-N judged by the project's own check, in its minimal checkpoint
// form. Unlocked by a number, not a belief: `osc eval --deep --attempts 2`
// on the reference box showed the small class gains about 13 points from a
// second independent try (38% to 50%). So when verify retries are spent and
// the check still fails, every file the attempt touched is put back to how
// it was, the history is wiped to the original ask, and the task goes again
// as an independent try, the way the eval measured it; the first attempt
// that verifies wins. Allowance per class (two for small and tiny, one for
// mid and large), the step rails keep counting across attempts, and a full
// seat never starts over.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { AgentEvent } from '../src/core/agent/types.js';

const ORIGINAL = 'export const x = 1;\n';
// Passes only when x is 2.
const CHECK = {
  command: 'node -e "import(\'./a.mjs\').then(m => process.exit(m.x === 2 ? 0 : 1))"',
};
// Small class, no verify retries on either side (the config default of two
// would win over a class override of zero, since config only ever raises
// it), so the first failed check starts the next attempt straight away.
const LEAN = {
  harness: {
    profiles: { enabled: true, overrides: { small: { verifyRetries: 0 } } },
    verify: { ...CHECK, maxRetries: 0 },
  },
};

const attempts = (events: AgentEvent[]) =>
  events.filter((e) => e.type === 'attempt') as Array<{ number: number; of: number }>;
const verifies = (events: AgentEvent[]) =>
  (events.filter((e) => e.type === 'verify') as Array<{ passed: boolean }>).map((v) => v.passed);
const doneReasons = (events: AgentEvent[]) =>
  (events.filter((e) => e.type === 'task-done') as Array<{ reason: string }>).map((e) => e.reason);

describe('best-of-N in the loop', () => {
  it('starts a fresh attempt when the check fails, and the attempt that verifies wins', async () => {
    const provider = new MockProvider('mock', [
      // Attempt 1: wrong.
      toolTurn('writeFile', { path: 'a.mjs', content: 'export const x = 3;\n' }, 'c1'),
      textTurn('Done.'),
      // Attempt 2: right.
      toolTurn('writeFile', { path: 'a.mjs', content: 'export const x = 2;\n' }, 'c2'),
      textTurn('Done for real.'),
    ]);
    const session = makeTestSession(provider, {
      files: { 'a.mjs': ORIGINAL },
      configOverrides: LEAN,
    });
    await session.agent.run('make x equal 2 in a.mjs');

    expect(verifies(session.events)).toEqual([false, true]);
    expect(attempts(session.events)).toEqual([{ type: 'attempt', number: 2, of: 2 }]);
    expect(doneReasons(session.events)).toEqual(['complete']);
    expect(readFileSync(join(session.cwd, 'a.mjs'), 'utf8')).toBe('export const x = 2;\n');
    // The second attempt started from a clean history: the system prompt and
    // the original ask, none of attempt one's turns.
    const third = provider.requests[2]!;
    const roles = third.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user']);
    expect(String(third.messages[1]!.content)).toBe('make x equal 2 in a.mjs');
  });

  it('restores every touched file for the fresh attempt: edits undone, created files removed', async () => {
    const provider = new MockProvider('mock', [
      // Attempt 1: edits a.mjs wrongly and creates b.mjs, then claims done.
      toolTurn('writeFile', { path: 'a.mjs', content: 'export const x = 3;\n' }, 'c1'),
      toolTurn('writeFile', { path: 'b.mjs', content: 'export const y = 1;\n' }, 'c2'),
      textTurn('Done.'),
      // Attempt 2: reads a.mjs and gives up without writing, so the run ends
      // with the restored workspace on disk.
      toolTurn('readFile', { path: 'a.mjs' }, 'c3'),
      textTurn('Could not.'),
    ]);
    const session = makeTestSession(provider, {
      files: { 'a.mjs': ORIGINAL },
      configOverrides: LEAN,
    });
    await session.agent.run('make x equal 2');

    expect(attempts(session.events)).toHaveLength(1);
    expect(readFileSync(join(session.cwd, 'a.mjs'), 'utf8')).toBe(ORIGINAL);
    expect(existsSync(join(session.cwd, 'b.mjs'))).toBe(false);
    // What attempt two read was the original, not attempt one's leftovers.
    const read = (
      session.events.filter((e) => e.type === 'tool-end') as unknown as Array<{
        call: { name: string };
        result: { content: string };
      }>
    ).find((e) => e.call.name === 'readFile')!;
    expect(read.result.content).toContain('export const x = 1;');
  });

  it('stops at the allowance: a second failing attempt is the verdict', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'a.mjs', content: 'export const x = 3;\n' }, 'c1'),
      textTurn('Done.'),
      toolTurn('writeFile', { path: 'a.mjs', content: 'export const x = 4;\n' }, 'c2'),
      textTurn('Done.'),
    ]);
    const session = makeTestSession(provider, {
      files: { 'a.mjs': ORIGINAL },
      configOverrides: LEAN,
    });
    await session.agent.run('make x equal 2');
    expect(verifies(session.events)).toEqual([false, false]);
    expect(attempts(session.events)).toHaveLength(1);
    expect(doneReasons(session.events)).toEqual(['complete']);
    // Only two attempts were made: the provider was asked four times, not six.
    expect(provider.requests).toHaveLength(4);
  });

  it('a full seat never starts over', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'a.mjs', content: 'export const x = 3;\n' }, 'c1'),
      textTurn('Done.'),
      textTurn('Still done.'),
      textTurn('Still done.'),
    ]);
    const session = makeTestSession(provider, {
      files: { 'a.mjs': ORIGINAL },
      configOverrides: {
        harness: { profiles: { enabled: false }, verify: { ...CHECK, maxRetries: 0 } },
      },
    });
    await session.agent.run('make x equal 2');
    expect(verifies(session.events)).toEqual([false]);
    expect(attempts(session.events)).toHaveLength(0);
    expect(provider.requests).toHaveLength(2);
  });

  it('is a per-class override like the rest of the policy', async () => {
    const { deriveProfile } = await import('../src/harness/profile.js');
    expect(deriveProfile({ model: 'x:3b', kind: 'local' }).bestOfAttempts).toBe(2);
    expect(deriveProfile({ model: 'x:14b', kind: 'local' }).bestOfAttempts).toBe(1);
    expect(
      deriveProfile({ model: 'x:3b', kind: 'local' }, { small: { bestOfAttempts: 3 } })
        .bestOfAttempts,
    ).toBe(3);
  });
});
