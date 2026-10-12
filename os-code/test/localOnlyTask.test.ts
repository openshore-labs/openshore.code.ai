// A private plan's file-editing step, run on the computer (UX and copy review,
// 2026-10-08, J). The app sends it marked local-only (POST /input
// `localOnly`); the engine holds the whole task to its D5 rules: the reply
// comes back marked, a handoff to a cloud specialist is refused, and a
// struggling seat never escalates to one that leaves. The mark is journaled
// on the task-start, so a revived session seeds it again.
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { deniedReasons } from './helpers/privateNotes.js';
import { HANDOFF_LOCAL_ONLY_DENIED } from '../src/core/agent/loop.js';
import { seedHistoryFromEvents } from '../src/core/agent/seed.js';
import { LocalDriver } from '../src/daemon/session.js';
import type { AgentSession } from '../src/core/agent/loop.js';
import type { DriverEvent } from '../src/core/agent/types.js';

const STEP = 'Add the budget line from my plan: PLAN-SECRET-2290.';

describe('a task sent marked local-only (J)', () => {
  it('is marked from its first word, and its reply comes back marked', async () => {
    const local = new MockProvider('mock', [textTurn('Added it.')]);
    const session = makeTestSession(local);
    await session.agent.run(STEP, undefined, undefined, { localOnly: true });
    const start = session.events.find((e) => e.type === 'task-start');
    expect(start).toEqual({ type: 'task-start', input: STEP, localOnly: true });
    const user = session.agent.history.find((m) => m.role === 'user');
    expect(user).toMatchObject({ content: STEP, localOnly: true });
    const reply = session.agent.history.filter((m) => m.role === 'assistant').at(-1);
    expect(reply).toMatchObject({ content: 'Added it.', localOnly: true });
    expect(session.agent.heldLocalOnly()).toBe(true);
  });

  it('an unmarked task is not marked', async () => {
    const local = new MockProvider('mock', [textTurn('Added it.')]);
    const session = makeTestSession(local);
    await session.agent.run('Add a line.');
    expect(session.events.find((e) => e.type === 'task-start')).toEqual({
      type: 'task-start',
      input: 'Add a line.',
    });
    expect(session.agent.history.some((m) => m.localOnly)).toBe(false);
    expect(session.agent.heldLocalOnly()).toBe(false);
  });

  it('refuses a delegate to a cloud specialist', async () => {
    const cloud = new MockProvider('anthropic', [textTurn('From the cloud.')], { kind: 'cloud' });
    const local = new MockProvider('mock', [
      toolTurn('delegate', { role: 'writing', task: STEP }, 'd1'),
      textTurn('Did it here.'),
    ]);
    const session = makeTestSession(local, {
      providers: [cloud],
      specialists: true,
      configOverrides: {
        stack: {
          orchestrator: { provider: 'mock', model: 'mock-model' },
          specialists: { writing: { provider: 'anthropic', model: 'claude-sonnet-5' } },
        },
      },
    });
    await session.agent.run(STEP, undefined, undefined, { localOnly: true });
    expect(cloud.requests).toHaveLength(0);
    expect(deniedReasons(session.events)).toEqual([HANDOFF_LOCAL_ONLY_DENIED]);
    expect(session.approvals).toEqual([]);
  });

  it('never shows the escalation card, with a cloud escalation ready', async () => {
    const cloud = new MockProvider('anthropic', [textTurn('Cloud finished.')], { kind: 'cloud' });
    const local = new MockProvider('mock', [
      toolTurn('readFile', { path: 'missing-1.txt' }, 'c1'),
      toolTurn('readFile', { path: 'missing-2.txt' }, 'c2'),
      toolTurn('readFile', { path: 'missing-3.txt' }, 'c3'),
    ]);
    const session = makeTestSession(local, {
      escalation: cloud,
      configOverrides: {
        providers: { anthropic: { kind: 'anthropic' } },
        routing: { escalation: { enabled: true, afterToolFailures: 2 } },
      },
    });
    await session.agent.run(STEP, undefined, undefined, { localOnly: true });
    expect(session.approvals.filter((a) => a.kind === 'cloud-spend')).toEqual([]);
    expect(session.events.some((e) => e.type === 'model-switch')).toBe(false);
    expect(cloud.requests).toHaveLength(0);
    // The same struggle in an unmarked task escalates, with the card.
    const cloud2 = new MockProvider('anthropic', [textTurn('Cloud finished.')], { kind: 'cloud' });
    const local2 = new MockProvider('mock', [
      toolTurn('readFile', { path: 'missing-1.txt' }, 'c1'),
      toolTurn('readFile', { path: 'missing-2.txt' }, 'c2'),
    ]);
    const clean = makeTestSession(local2, {
      escalation: cloud2,
      configOverrides: {
        providers: { anthropic: { kind: 'anthropic' } },
        routing: { escalation: { enabled: true, afterToolFailures: 2 } },
      },
    });
    await clean.agent.run('Add a line.');
    expect(clean.approvals.filter((a) => a.kind === 'cloud-spend')).toHaveLength(1);
  });

  it('the driver passes the mark to the task, and a replay seeds it again', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'osc-localonly-'));
    const driver = new LocalDriver(cwd, { persist: false });
    const calls: Array<{ input: string; options: unknown }> = [];
    driver.attachAgent({
      async run(input: string, _images?: unknown, _preamble?: string, options?: unknown) {
        calls.push({ input, options });
      },
      generateTitle: async () => undefined,
      flushHandoff: () => undefined,
      heldLocalOnly: () => true,
    } as unknown as AgentSession);
    driver.send(STEP, undefined, { localOnly: true });
    driver.send('An ordinary one.');
    for (let i = 0; i < 50 && !driver.idle; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toEqual([
      { input: STEP, options: { localOnly: true } },
      { input: 'An ordinary one.', options: {} },
    ]);
    expect(driver.heldLocalOnly()).toBe(true);
    driver.dispose();

    const journal: DriverEvent[] = [
      { type: 'task-start', input: STEP, localOnly: true },
      { type: 'turn-start', turn: 1, model: 'qwen', providerKind: 'local' },
      { type: 'text-final', text: 'Added it.' },
      { type: 'task-start', input: 'Thanks.' },
      { type: 'turn-start', turn: 1, model: 'qwen', providerKind: 'local' },
      { type: 'text-final', text: 'You are welcome.' },
    ];
    const seeded = seedHistoryFromEvents(journal);
    expect(seeded).toEqual([
      { role: 'user', content: STEP, localOnly: true },
      { role: 'assistant', content: 'Added it.', localOnly: true },
      { role: 'user', content: 'Thanks.' },
      // The chat still holds the step's text, and a seat on this network
      // replied, so its reply is marked too (the loop's own rule).
      { role: 'assistant', content: 'You are welcome.', localOnly: true },
    ]);
  });
});
