import { describe, it, expect } from 'vitest';
import { runVerify } from '../src/harness/verify.js';
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
});

const verifyEvents = (events: AgentEvent[]) =>
  events.filter((e) => e.type === 'verify') as Array<{ passed: boolean; summary: string }>;

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
      configOverrides: { harness: { verify: { command: 'node -e "process.exit(1)"' } } },
    });
    await session.agent.run('write a note');
    const verifies = verifyEvents(session.events);
    expect(verifies).toHaveLength(1);
    expect(verifies[0]!.passed).toBe(false);
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
