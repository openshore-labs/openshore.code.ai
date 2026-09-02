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

  it('keeps a shell command full output as readable detail, not just the first line', () => {
    const state = feed([
      { type: 'task-start', input: 'run the tests' },
      {
        type: 'tool-start',
        call: { id: 's1', name: 'runShell', args: { command: 'npm test' } },
      },
      {
        type: 'tool-end',
        call: { id: 's1', name: 'runShell', args: { command: 'npm test' } },
        // A line starting with '-' is data here, not a diff deletion.
        result: { ok: true, content: 'PASS suite one\n- 12 assertions\nPASS suite two' },
        durationMs: 4200,
      },
      { type: 'task-done', reason: 'complete' },
    ]);
    const tool = state.items.find((i) => i.kind === 'tool');
    // The card names the step the way Claude Code does (the command itself),
    // never the first line of whatever it printed.
    expect(tool?.kind === 'tool' && tool.summary).toBe('$ npm test');
    // The full output survives so the phone can actually read it, tagged as
    // plain output so the diff colorizer never touches the '- 12 assertions'.
    expect(tool?.kind === 'tool' && tool.detail).toBe(
      'PASS suite one\n- 12 assertions\nPASS suite two',
    );
    expect(tool?.kind === 'tool' && tool.detailKind).toBe('output');
  });

  it('keeps an edit tool diff tagged for the diff renderer', () => {
    const state = feed([
      { type: 'task-start', input: 'edit it' },
      {
        type: 'tool-start',
        call: { id: 'e1', name: 'editFile', args: { path: 'a.ts' } },
      },
      {
        type: 'tool-end',
        call: { id: 'e1', name: 'editFile', args: { path: 'a.ts' } },
        result: { ok: true, content: 'edited a.ts', diffText: '+ added\n- removed' },
        durationMs: 12,
      },
    ]);
    const tool = state.items.find((i) => i.kind === 'tool');
    expect(tool?.kind === 'tool' && tool.detail).toBe('+ added\n- removed');
    expect(tool?.kind === 'tool' && tool.detailKind).toBe('diff');
  });

  it('renders a user command card: start, streamed output, exit badge', () => {
    const state = feed([
      { type: 'task-start', input: 'help me' },
      { type: 'command-start', runId: 'r1', command: 'ls -a', cwd: '/repo', source: 'user' },
      { type: 'command-output', runId: 'r1', chunk: '.\n', stream: 'stdout' },
      { type: 'command-output', runId: 'r1', chunk: '..\nREADME.md\n', stream: 'stdout' },
      { type: 'command-end', runId: 'r1', exitCode: 0, durationMs: 120, truncated: false },
    ]);
    const cmd = state.items.find((i) => i.kind === 'command');
    expect(cmd?.kind === 'command' && cmd.command).toBe('ls -a');
    expect(cmd?.kind === 'command' && cmd.output).toBe('.\n..\nREADME.md\n');
    expect(cmd?.kind === 'command' && cmd.state).toBe('done');
    expect(cmd?.kind === 'command' && cmd.exitCode).toBe(0);
  });

  it('marks a killed command (null exit) as stopped', () => {
    const state = feed([
      { type: 'task-start', input: 'go' },
      { type: 'command-start', runId: 'r2', command: 'sleep 99', cwd: '/repo', source: 'user' },
      { type: 'command-end', runId: 'r2', exitCode: null, durationMs: 50, truncated: false },
    ]);
    const cmd = state.items.find((i) => i.kind === 'command');
    expect(cmd?.kind === 'command' && cmd.state).toBe('killed');
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

  // ---- Claude Code parity ----

  it('names each step the way Claude Code does and counts an edit', () => {
    const state = feed([
      { type: 'task-start', input: 'fix it' },
      {
        type: 'tool-start',
        call: { id: 'r', name: 'readFile', args: { path: 'src/a.ts', startLine: 1, endLine: 40 } },
      },
      {
        type: 'tool-end',
        call: { id: 'r', name: 'readFile', args: { path: 'src/a.ts', startLine: 1, endLine: 40 } },
        result: { ok: true, content: 'src/a.ts (lines 1-40 of 120)\n...' },
        durationMs: 10,
      },
      { type: 'tool-start', call: { id: 'e', name: 'editFile', args: { path: 'src/a.ts' } } },
      {
        type: 'tool-end',
        call: { id: 'e', name: 'editFile', args: { path: 'src/a.ts' } },
        result: {
          ok: true,
          content: 'Edited src/a.ts (+3 -1)',
          diffText: '--- a\n+++ b\n@@ -1,2 +1,4 @@\n-x\n+y\n+z\n+w\n',
        },
        durationMs: 20,
      },
      { type: 'task-done', reason: 'complete' },
    ]);
    const [, read, edit, changed] = state.items;
    expect(read?.kind === 'tool' && read.summary).toBe('Read src/a.ts (lines 1-40 of 120)');
    expect(edit?.kind === 'tool' && edit.summary).toBe('Edit src/a.ts (+3 -1)');
    expect(edit?.kind === 'tool' && edit.stats).toEqual({ added: 3, removed: 1 });
    // The task's changed files fold into one card at the end.
    expect(changed?.kind).toBe('changed');
    expect(changed?.kind === 'changed' && changed.files).toEqual([
      { path: 'src/a.ts', added: 3, removed: 1, toolItemId: 'tool_e' },
    ]);
    expect(state.changedFiles).toEqual([]);
  });

  it('folds reasoning into a thinking block and closes it when text starts', () => {
    const state = feed([
      { type: 'task-start', input: 'why' },
      { type: 'thinking-delta', text: 'Let me ' },
      { type: 'thinking-delta', text: 'check.' },
      { type: 'text-delta', text: 'Because.' },
      { type: 'task-done', reason: 'complete' },
    ]);
    const kinds = state.items.map((i) => i.kind);
    expect(kinds).toEqual(['user', 'thinking', 'assistant']);
    const think = state.items[1];
    expect(think?.kind === 'thinking' && think.text).toBe('Let me check.');
    expect(think?.kind === 'thinking' && think.streaming).toBe(false);
    expect(think?.kind === 'thinking' && typeof think.endedAt).toBe('number');
  });

  it('carries the task list, the mode, the repo, and the title', () => {
    const state = feed([
      { type: 'task-start', input: 'plan it' },
      { type: 'repo-info', cwd: '/w/app', branch: 'main', dirty: true },
      { type: 'mode', mode: 'plan' },
      {
        type: 'todos',
        items: [
          { content: 'Read the code', status: 'completed' },
          { content: 'Write the fix', status: 'in_progress' },
        ],
      },
      { type: 'title', title: 'Fix the login bug' },
    ]);
    expect(state.repo).toEqual({ cwd: '/w/app', branch: 'main', dirty: true });
    expect(state.mode).toBe('plan');
    expect(state.todos.map((t) => t.status)).toEqual(['completed', 'in_progress']);
    expect(titleFrom(state)).toBe('Fix the login bug');
  });

  it('turns the final text of a plan turn into the plan card, not a duplicate', () => {
    const state = feed([
      { type: 'task-start', input: 'plan it' },
      { type: 'text-delta', text: '1. Do this\n2. Then that' },
      { type: 'text-final', text: '1. Do this\n2. Then that' },
      { type: 'plan-proposed', text: '1. Do this\n2. Then that' },
      { type: 'task-done', reason: 'complete' },
    ]);
    const kinds = state.items.map((i) => i.kind);
    expect(kinds).toEqual(['user', 'plan']);
    const plan = state.items[1];
    expect(plan?.kind === 'plan' && plan.status).toBe('proposed');
  });

  it('tracks the working state for the busy row', () => {
    let state = feed([{ type: 'task-start', input: 'go' }]);
    expect(state.busy).toBe(true);
    expect(typeof state.busySince).toBe('number');
    expect(state.stepNote).toBe('Thinking');
    state = reduceEvent(state, {
      type: 'tool-start',
      call: { id: 'g', name: 'grep', args: { pattern: 'foo', glob: 'src/**' } },
    });
    expect(state.stepNote).toBe('Search /foo/ in src/**');
    state = reduceEvent(state, { type: 'task-done', reason: 'complete' });
    expect(state.busy).toBe(false);
    expect(state.busySince).toBeUndefined();
    expect(state.stepNote).toBeUndefined();
  });
});
