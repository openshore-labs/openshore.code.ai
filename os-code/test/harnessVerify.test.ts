import { describe, it, expect } from 'vitest';
import { runVerify, verifyRetryPrompt } from '../src/harness/verify.js';
import { MockProvider, toolTurn, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { AgentEvent } from '../src/core/agent/types.js';

describe('runVerify', () => {
  it('reports not-run when no command is configured', () => {
    const r = runVerify('/tmp', undefined);
    expect(r.ran).toBe(false);
    expect(r.passed).toBe(false);
  });
  it('passes when the command exits zero', () => {
    const r = runVerify(process.cwd(), { command: 'node -e "process.exit(0)"' });
    expect(r.ran).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.summary).toContain('Verified');
  });
  it('fails, without throwing, when the command exits non-zero', () => {
    const r = runVerify(process.cwd(), { command: 'node -e "process.exit(1)"' });
    expect(r.ran).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.summary).toContain('Not verified');
  });
  it('hands the failure back as the exact output plus one plain ask', () => {
    const r = runVerify(process.cwd(), {
      command: 'node -e "console.error(\'expected 3, got 2\'); process.exit(1)"',
    });
    const prompt = verifyRetryPrompt(r, 1, 2);
    expect(prompt).toContain('[verify result]');
    expect(prompt).toContain('expected 3, got 2');
    expect(prompt).toContain('retry 1 of 2');
    expect(prompt).toContain('do not claim the check passes');
  });
});

type VerifyEvent = {
  passed: boolean;
  summary: string;
  round?: number;
  willRetry?: boolean;
};
const verifyEvents = (events: AgentEvent[]) =>
  events.filter((e) => e.type === 'verify') as VerifyEvent[];
const doneReasons = (events: AgentEvent[]) =>
  (events.filter((e) => e.type === 'task-done') as Array<{ reason: string }>).map((e) => e.reason);

/** A check that passes only once the model has written ok.txt in the workspace. */
const PASSES_WHEN_OK_EXISTS = `node -e "process.exit(require('fs').existsSync('ok.txt') ? 0 : 1)"`;

describe('the loop verifies after a task that changed files', () => {
  it('emits a passing verify event after a write', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'note.txt', content: 'hello' }),
      textTurn('Wrote the note.'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: { harness: { verify: { command: 'node -e "process.exit(0)"' } } },
    });
    await session.agent.run('write a note');
    const verifies = verifyEvents(session.events);
    expect(verifies).toHaveLength(1);
    expect(verifies[0]!.passed).toBe(true);
  });

  it('emits a failing verify event when the check does not pass', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'note.txt', content: 'hello' }),
      textTurn('Wrote the note.'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: {
        harness: { verify: { command: 'node -e "process.exit(1)"', maxRetries: 0 } },
      },
    });
    await session.agent.run('write a note');
    const verifies = verifyEvents(session.events);
    expect(verifies).toHaveLength(1);
    expect(verifies[0]!.passed).toBe(false);
    expect(verifies[0]!.willRetry).toBe(false);
    expect(doneReasons(session.events)).toEqual(['complete']);
  });

  it('does not verify a task that changed no files', async () => {
    const provider = new MockProvider('mock', [textTurn('Here is the answer, no edits needed.')]);
    const session = makeTestSession(provider, {
      configOverrides: { harness: { verify: { command: 'node -e "process.exit(0)"' } } },
    });
    await session.agent.run('just answer');
    expect(verifyEvents(session.events)).toHaveLength(0);
  });

  it('does not auto-verify on a profile where shell cannot auto-run', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'note.txt', content: 'hello' }),
      textTurn('Wrote the note.'),
    ]);
    const session = makeTestSession(provider, {
      profile: 'headless',
      configOverrides: {
        harness: { verify: { command: 'node -e "process.exit(0)"' } },
        permissions: { defaults: { write: 'allow' } },
      },
    });
    await session.agent.run('write a note');
    expect(verifyEvents(session.events)).toHaveLength(0);
  });
});

describe('verify in the loop: a failing check goes back to the model', () => {
  it('hands the failure back, lets the model fix it, and verifies again', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'note.txt', content: 'hello' }),
      textTurn('Wrote the note.'),
      // The retry turn: the model reads the failure and makes the fix.
      toolTurn('writeFile', { path: 'ok.txt', content: 'fixed' }, 'call_2'),
      textTurn('Added ok.txt so the check passes.'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: { harness: { verify: { command: PASSES_WHEN_OK_EXISTS, maxRetries: 2 } } },
    });
    await session.agent.run('write a note');

    const verifies = verifyEvents(session.events);
    expect(verifies.map((v) => [v.passed, v.round, v.willRetry])).toEqual([
      [false, 1, true],
      [true, 2, false],
    ]);
    expect(doneReasons(session.events)).toEqual(['complete']);
    // The model saw the failure as an observation before its retry turn.
    const retryRequest = provider.requests[2]!;
    const handedBack = retryRequest.messages.find(
      (m) => m.role === 'user' && String(m.content).includes('[verify result]'),
    );
    expect(handedBack).toBeDefined();
    expect(String(handedBack!.content)).toContain('retry 1 of 2');
  });

  it('is bounded by maxRetries and then reports not verified, still complete', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'note.txt', content: 'hello' }),
      textTurn('Wrote the note.'),
      textTurn('I looked again; it should be fine.'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: {
        harness: { verify: { command: 'node -e "process.exit(1)"', maxRetries: 1 } },
      },
    });
    await session.agent.run('write a note');
    const verifies = verifyEvents(session.events);
    expect(verifies.map((v) => [v.passed, v.round, v.willRetry])).toEqual([
      [false, 1, true],
      [false, 2, false],
    ]);
    expect(doneReasons(session.events)).toEqual(['complete']);
    // Exactly one retry turn was asked of the model: 2 turns + 1 retry.
    expect(provider.requests).toHaveLength(3);
  });

  it('retries twice by default', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'note.txt', content: 'hello' }),
      textTurn('Wrote the note.'),
      textTurn('Still fine.'),
      textTurn('Really.'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: { harness: { verify: { command: 'node -e "process.exit(1)"' } } },
    });
    await session.agent.run('write a note');
    expect(verifyEvents(session.events)).toHaveLength(3);
    expect(verifyEvents(session.events).at(-1)!.willRetry).toBe(false);
  });

  it('never retries a passing check', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'ok.txt', content: 'hello' }),
      textTurn('Done.'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: { harness: { verify: { command: PASSES_WHEN_OK_EXISTS, maxRetries: 3 } } },
    });
    await session.agent.run('write ok');
    expect(verifyEvents(session.events)).toHaveLength(1);
    expect(provider.requests).toHaveLength(2);
  });
});
