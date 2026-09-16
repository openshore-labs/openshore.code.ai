// B7: the transcript reducer is replay-safe. A reopened chat replays its whole
// journal through the same reducer as a live run, so every card that has a
// "live" state must settle from the events alone: the task list clears when
// the next task starts, a plan card reads approved once the go-ahead line is
// the next input, /cost never prints a fabricated "$0.00" for a chat billed to
// the person's own provider account, and the working row names the wait.
import { describe, expect, it } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import {
  PLAN_APPROVAL_LINE,
  REACHING_COMPUTER,
  costSummary,
  reduceEvent,
  reduceEvents,
  snapshotThread,
  SNAPSHOT_ITEMS,
} from '../src/state/transcript.js';
import { emptyThread } from '../src/state/types.js';

function feed(events: DriverEvent[]) {
  return reduceEvents(
    emptyThread(),
    events.map((event) => ({ event })),
  );
}

describe('replay-safe cards (B7)', () => {
  it('clears the task list when the next task starts', () => {
    const mid = feed([
      { type: 'task-start', input: 'do it' },
      {
        type: 'todos',
        items: [
          { content: 'a', status: 'completed' },
          { content: 'b', status: 'in_progress' },
        ],
      },
      { type: 'task-done', reason: 'complete' },
    ]);
    expect(mid.todos).toHaveLength(2);
    const next = reduceEvent(mid, { type: 'task-start', input: 'and this' });
    expect(next.todos).toEqual([]);
  });

  it('marks a proposed plan approved when the next input is the approval line', () => {
    const state = feed([
      { type: 'task-start', input: 'plan it' },
      { type: 'text-delta', text: '1. Do this' },
      { type: 'plan-proposed', text: '1. Do this' },
      { type: 'task-done', reason: 'complete' },
      { type: 'task-start', input: PLAN_APPROVAL_LINE },
      { type: 'text-final', text: 'On it.' },
      { type: 'task-done', reason: 'complete' },
    ]);
    const plan = state.items.find((i) => i.kind === 'plan');
    expect(plan && plan.kind === 'plan' && plan.status).toBe('approved');
  });

  it('leaves a plan proposed when the next input is something else', () => {
    const state = feed([
      { type: 'task-start', input: 'plan it' },
      { type: 'plan-proposed', text: '1. Do this' },
      { type: 'task-done', reason: 'complete' },
      { type: 'task-start', input: 'change step one' },
    ]);
    const plan = state.items.find((i) => i.kind === 'plan');
    expect(plan && plan.kind === 'plan' && plan.status).toBe('proposed');
  });

  it('accumulates tokens across turns for the /cost line', () => {
    const state = feed([
      { type: 'usage', promptTokens: 100, completionTokens: 20, dollars: 0, contextPercent: 3 },
      { type: 'usage', promptTokens: 150, completionTokens: 30, dollars: 0, contextPercent: 5 },
    ]);
    expect(state.totalTokens).toEqual({ promptTokens: 250, completionTokens: 50 });
  });

  it('/cost on a cloud chat names the account and the tokens, never $0.00', () => {
    const thread = feed([
      { type: 'usage', promptTokens: 1200, completionTokens: 300, dollars: 0, contextPercent: 4 },
    ]);
    const line = costSummary(thread, { kind: 'cloud', provider: 'anthropic', model: 'claude-x' });
    expect(line).toContain('Billed to your Claude account.');
    expect(line).toContain('1,200 in, 300 out this chat.');
    expect(line).not.toContain('$0.00');
    const other = costSummary(thread, { kind: 'cloud', provider: 'openai', model: 'gpt' });
    expect(other).toMatch(/Billed to your OpenAI account/);
  });

  it('/cost on a local chat says it is free and never prints a dollar sign', () => {
    const thread = feed([
      { type: 'usage', promptTokens: 10, completionTokens: 5, dollars: 0, contextPercent: 2 },
    ]);
    const line = costSummary(thread, { kind: 'stack' });
    expect(line).not.toContain('$');
    expect(line).toMatch(/your own hardware/i);
    expect(line).toContain('Context 2% full');
  });

  it('/cost on a desktop chat with real spend still prints the dollars', () => {
    const thread = feed([
      { type: 'usage', promptTokens: 10, completionTokens: 5, dollars: 0.42, contextPercent: 2 },
    ]);
    expect(costSummary(thread, { kind: 'desktop' })).toContain('$0.42 this chat');
  });
});

// B3: the first turn is visible at once. A send to a paired computer paints the
// user bubble locally before the hub echoes it, so the hub's own task-start
// for the same text must fold into that bubble, not stack a second one.
describe('the working row names the wait (B3)', () => {
  it('folds the hub echo of an optimistic task-start into the existing bubble', () => {
    const local = {
      ...reduceEvent(emptyThread(), { type: 'task-start', input: 'hello' }),
      stepNote: REACHING_COMPUTER,
    };
    const echoed = reduceEvent(local, { type: 'task-start', input: 'hello' }, 7);
    expect(echoed.items.filter((i) => i.kind === 'user')).toHaveLength(1);
    expect(echoed.busy).toBe(true);
    expect(echoed.stepNote).toBe('Thinking');
    expect(echoed.lastSeq).toBe(7);
  });

  it('a repeated message after the task ends is a new bubble', () => {
    const done = feed([
      { type: 'task-start', input: 'hello' },
      { type: 'task-done', reason: 'complete' },
      { type: 'task-start', input: 'hello' },
    ]);
    expect(done.items.filter((i) => i.kind === 'user')).toHaveLength(2);
  });

  it('a status while waiting on the first token becomes the working note', () => {
    const state = feed([
      { type: 'task-start', input: 'hi' },
      { type: 'status', message: 'Warming up Harbor on this device.' },
    ]);
    expect(state.stepNote).toBe('Warming up Harbor on this device');
    // The line still lands in the transcript as the durable record.
    expect(state.items.at(-1)).toMatchObject({ kind: 'status' });
  });

  it('a status never overrides Writing or a running tool', () => {
    const writing = feed([
      { type: 'task-start', input: 'hi' },
      { type: 'text-delta', text: 'a' },
      { type: 'status', message: 'Searching the web for "x".' },
    ]);
    expect(writing.stepNote).toBe('Writing');
    const tool = feed([
      { type: 'task-start', input: 'hi' },
      { type: 'tool-start', call: { id: 't', name: 'readFile', args: { path: 'a.ts' } } },
      { type: 'status', message: 'Something.' },
    ]);
    expect(tool.stepNote).toBe('Read a.ts');
  });
});

// B4: a desktop chat keeps a bounded, read-only tail of its transcript on the
// phone, so reopening it with the computer off still shows what was said.
describe('desktop snapshot (B4)', () => {
  it('keeps the last SNAPSHOT_ITEMS items, settled, with nothing live', () => {
    const events: DriverEvent[] = [{ type: 'task-start', input: 'go' }];
    for (let i = 0; i < 80; i++) events.push({ type: 'status', message: `s${i}` });
    events.push({
      type: 'tool-start',
      call: { id: 'k', name: 'runShell', args: { command: 'npm test' } },
    });
    events.push({ type: 'text-delta', text: 'partial' });
    events.push({
      type: 'approval-request',
      request: { id: 'a1', kind: 'tool', toolName: 'editFile', risk: 'write', summary: 'x' },
    });
    const live = feed(events);
    expect(live.busy).toBe(true);
    const snap = snapshotThread(live);
    expect(snap.items.length).toBe(SNAPSHOT_ITEMS);
    expect(snap.busy).toBe(false);
    expect(snap.pendingApprovals).toEqual([]);
    expect(snap.todos).toEqual([]);
    expect(snap.stepNote).toBeUndefined();
    const last = snap.items.at(-1);
    expect(last?.kind === 'assistant' && last.streaming).toBe(false);
    const tool = snap.items.find((i) => i.kind === 'tool');
    // A tool that was mid-flight at the snapshot has no live counter to run.
    expect(tool && tool.kind === 'tool' && tool.startedAt).toBeUndefined();
    expect(snap.lastSeq).toBe(0);
  });
});
