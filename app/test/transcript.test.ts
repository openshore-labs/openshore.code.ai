// The transcript reducer: the one path every conversation renders through.
import { describe, expect, it } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { reduceEvent, reduceEvents, titleFrom } from '../src/state/transcript.js';
import { emptyThread } from '../src/state/types.js';

function feed(events: DriverEvent[]) {
  return reduceEvents(
    emptyThread(),
    events.map((event) => ({ event })),
  );
}

describe('transcript reducer', () => {
  it('renders a full happy-path task', () => {
    const state = feed([
      { type: 'task-start', input: 'fix the bug' },
      { type: 'turn-start', turn: 1, model: 'qwen', providerKind: 'local' },
      { type: 'text-delta', text: 'Looking ' },
      { type: 'text-delta', text: 'now.' },
      { type: 'text-final', text: 'Looking now.' },
      {
        type: 'tool-start',
        call: { id: 'a', name: 'readFile', args: { path: 'src/x.ts' } },
      },
      {
        type: 'tool-end',
        call: { id: 'a', name: 'readFile', args: { path: 'src/x.ts' } },
        result: { ok: true, content: 'src/x.ts (lines 1-20 of 20)' },
        durationMs: 300,
      },
      { type: 'text-delta', text: 'Fixed.' },
      { type: 'task-done', reason: 'complete' },
    ]);

    expect(state.busy).toBe(false);
    expect(state.model).toEqual({ name: 'qwen', kind: 'local' });
    const kinds = state.items.map((i) => i.kind);
    expect(kinds).toEqual(['user', 'assistant', 'tool', 'assistant']);
    const tool = state.items[2];
    expect(tool.kind === 'tool' && tool.state).toBe('ok');
    const tail = state.items[3];
    expect(tail.kind === 'assistant' && tail.streaming).toBe(false);
    expect(tail.kind === 'assistant' && tail.text).toBe('Fixed.');
  });

  it('streams into one bubble and replaces it with the cleaned final text', () => {
    const mid = feed([
      { type: 'task-start', input: 'go' },
      { type: 'text-delta', text: '{"tool": "readFile"' },
    ]);
    const bubble = mid.items[1];
    expect(bubble.kind === 'assistant' && bubble.streaming).toBe(true);

    const done = reduceEvent(mid, { type: 'text-final', text: '' });
    // Raw tool-call JSON cleaned to nothing: the bubble disappears entirely.
    expect(done.items).toHaveLength(1);
  });

  it('tracks approvals in and out without touching the transcript', () => {
    const asked = feed([
      { type: 'task-start', input: 'edit it' },
      {
        type: 'approval-request',
        request: {
          id: 'ap1',
          kind: 'tool',
          toolName: 'editFile',
          risk: 'write',
          summary: 'Edit src/x.ts (+1 -1)',
          detail: '--- diff ---',
        },
      },
    ]);
    expect(asked.pendingApprovals).toHaveLength(1);
    const resolved = reduceEvent(asked, { type: 'approval-resolved', id: 'ap1', approved: true });
    expect(resolved.pendingApprovals).toHaveLength(0);
  });

  it('marks a denied tool and shows guardrail stops', () => {
    const state = feed([
      { type: 'task-start', input: 'run stuff' },
      {
        type: 'tool-denied',
        call: { id: 'z', name: 'runShell', args: { command: 'rm -rf /' } },
        reason: 'You declined this step.',
      },
      { type: 'task-done', reason: 'guardrail', message: 'Stopped after 40 steps.' },
    ]);
    const tool = state.items.find((i) => i.kind === 'tool');
    expect(tool && tool.kind === 'tool' && tool.state).toBe('denied');
    const stop = state.items.at(-1);
    expect(stop?.kind).toBe('stopped');
  });

  it('accumulates cost, dedupes citations, and titles from the first message', () => {
    const state = feed([
      { type: 'task-start', input: 'research the topic thoroughly please' },
      { type: 'usage', promptTokens: 10, completionTokens: 10, dollars: 0.01, contextPercent: 12 },
      { type: 'usage', promptTokens: 10, completionTokens: 10, dollars: 0.02, contextPercent: 15 },
      {
        type: 'citations',
        citations: [
          { title: 'A', url: 'https://a.io' },
          { title: 'A again', url: 'https://a.io' },
          { title: 'B', url: 'https://b.io' },
        ],
      },
    ]);
    expect(state.dollars).toBeCloseTo(0.03);
    expect(state.contextPercent).toBe(15);
    expect(state.citations).toHaveLength(2);
    expect(titleFrom(state)).toBe('research the topic thoroughly please');
  });

  it('keeps the highest sequence number for SSE resume', () => {
    const state = reduceEvents(emptyThread(), [
      { event: { type: 'task-start', input: 'x' }, seq: 4 },
      { event: { type: 'text-delta', text: 'hi' }, seq: 9 },
    ]);
    expect(state.lastSeq).toBe(9);
  });
});
