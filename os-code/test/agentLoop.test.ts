// The agent loop, end to end against the scripted provider: tool execution
// and observation feedback, the JSON-in-text bridge with repair, the
// permission rhythm, guardrails, and cloud escalation with confirm-first.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { toAnthropicMessages } from '../src/providers/anthropic.js';
import type { ApprovalAnswer } from '../src/core/agent/types.js';

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe('agent loop with native tool calls', () => {
  it('runs a tool, feeds the observation back, and finishes with text', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('readFile', { path: 'hello.txt' }),
      textTurn('The file says hello.'),
    ]);
    const session = makeTestSession(provider, { files: { 'hello.txt': 'hello there' } });
    await session.agent.run('what is in hello.txt?');

    const toolEnd = session.events.find((e) => e.type === 'tool-end');
    expect(toolEnd && toolEnd.type === 'tool-end' && toolEnd.result.ok).toBe(true);

    // The observation went back to the model as a tool message.
    const second = provider.requests[1]!;
    const toolMessage = second.messages.find((m) => m.role === 'tool');
    expect(toolMessage && String(toolMessage.content)).toContain('hello there');

    const done = session.events.at(-1);
    expect(done?.type).toBe('task-done');
    expect(done && done.type === 'task-done' && done.reason).toBe('complete');
    const final = session.events.find((e) => e.type === 'text-final');
    expect(final && final.type === 'text-final' && final.text).toContain('The file says hello.');
  });

  it('writes a file through the edit pipeline and reports the diff', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'out.txt', content: 'fresh\n' }),
      textTurn('Wrote it.'),
    ]);
    const session = makeTestSession(provider);
    await session.agent.run('create out.txt');
    expect(readFileSync(join(session.cwd, 'out.txt'), 'utf8')).toBe('fresh\n');
  });
});

describe('the JSON-in-text bridge', () => {
  it('extracts calls from plain text when the model has no native tools', async () => {
    const provider = new MockProvider(
      'mock',
      [textTurn('{"tool": "readFile", "args": {"path": "hello.txt"}}'), textTurn('It says hi.')],
      { caps: { supportsTools: false } },
    );
    const session = makeTestSession(provider, { files: { 'hello.txt': 'hi' } });
    await session.agent.run('read it');
    const toolEnd = session.events.find((e) => e.type === 'tool-end');
    expect(toolEnd).toBeTruthy();
    // In text mode the observation goes back as a user message.
    const second = provider.requests[1]!;
    const obs = second.messages.filter((m) => m.role === 'user').map((m) => String(m.content));
    expect(obs.some((o) => o.includes('[readFile result]'))).toBe(true);
  });

  it('sends a repair prompt after malformed JSON, then succeeds', async () => {
    const provider = new MockProvider(
      'mock',
      [
        textTurn('{"tool": "compile", "args": {}}'), // unknown tool
        textTurn('{"tool": "readFile", "args": {"path": "hello.txt"}}'),
        textTurn('Fixed and read.'),
      ],
      { caps: { supportsTools: false } },
    );
    const session = makeTestSession(provider, { files: { 'hello.txt': 'hi' } });
    await session.agent.run('read it');
    // The second request carries the corrective message.
    const repair = provider.requests[1]!.messages.at(-1);
    expect(String(repair?.content)).toContain('could not be used');
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('complete');
  });
});

describe('the permission rhythm', () => {
  it('asks before shell and honors a decline without ending the task', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('runShell', { command: 'rm -rf /tmp/x' }),
      textTurn('Understood, skipping that.'),
    ]);
    const session = makeTestSession(provider, {
      approve: () => ({ approve: false }),
    });
    await session.agent.run('clean up');
    expect(session.approvals).toHaveLength(1);
    expect(session.approvals[0]!.summary).toContain('rm -rf /tmp/x');
    const denied = session.events.find((e) => e.type === 'tool-denied');
    expect(denied).toBeTruthy();
    // The model was told, and the task still completed.
    const observation = provider.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(String(observation?.content)).toContain('declined');
  });

  it('denies by policy without asking when the rule says deny', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('runShell', { command: 'ls' }),
      textTurn('ok'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
        permissions: { defaults: { shell: 'deny', write: 'allow' } },
      },
    });
    await session.agent.run('list files');
    expect(session.approvals).toHaveLength(0);
    const denied = session.events.find((e) => e.type === 'tool-denied');
    expect(denied).toBeTruthy();
  });
});

describe('guardrails', () => {
  it('stops a loop of identical calls with a real stop', async () => {
    const same = () => toolTurn('readFile', { path: 'hello.txt' });
    const provider = new MockProvider('mock', [same(), same(), same(), same(), same(), same()]);
    const session = makeTestSession(provider, {
      files: { 'hello.txt': 'hi' },
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
        guardrails: { maxRepeats: 2 },
      },
    });
    await session.agent.run('read forever');
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('guardrail');
    expect(done && done.type === 'task-done' && done.message).toContain('looping');
  });

  it('stops at the step cap and hands control back', async () => {
    const turns = Array.from({ length: 10 }, (_, i) => toolTurn('readFile', { path: `f${i}.txt` }));
    const provider = new MockProvider('mock', turns);
    const files = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.txt`, 'x']));
    const session = makeTestSession(provider, {
      files,
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
        guardrails: { maxSteps: 3 },
      },
    });
    await session.agent.run('read everything');
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('guardrail');
  });
});

describe('abort correctness (C1, C2, C3)', () => {
  // C1 (loop half): abort while a tool approval is pending must settle the run
  // as 'aborted' and never execute the tool. Before the fix the loop awaited a
  // never-resolving approver and run() hung forever.
  it('abort during a pending approval resolves aborted and never runs the tool', async () => {
    let resolveApproval: (a: ApprovalAnswer) => void = () => {};
    const approvalPending = new Promise<ApprovalAnswer>((res) => {
      resolveApproval = res;
    });
    const provider = new MockProvider('mock', [
      toolTurn('runShell', { command: 'echo should-not-run' }),
      textTurn('unreached'),
    ]);
    const session = makeTestSession(provider, {
      approve: () => approvalPending, // never resolves on its own
    });

    const runPromise = session.agent.run('run it');
    await waitUntil(() => session.approvals.length === 1);
    session.agent.abort();
    await runPromise; // must resolve because executeCall races the abort signal

    const done = session.events.at(-1);
    expect(done?.type).toBe('task-done');
    expect(done && done.type === 'task-done' && done.reason).toBe('aborted');
    // The tool never started.
    expect(session.events.some((e) => e.type === 'tool-start')).toBe(false);

    // A late approval must not execute the tool after the abort.
    resolveApproval({ approve: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(session.events.some((e) => e.type === 'tool-start')).toBe(false);
    expect(provider.requests).toHaveLength(1); // no second turn was ever sent

    // C2: the pending call still gets a synthetic tool_result so the transcript
    // pairs cleanly for the next Anthropic turn.
    const { messages } = toAnthropicMessages(session.agent.history);
    expect(unpairedToolUses(messages)).toEqual([]);
  });

  // C2: a guardrail trip mid tool-batch must leave a tool_result for EVERY
  // recorded tool_use, or the next cloud turn 400s on a dangling block.
  it('a guardrail trip mid-batch pairs every tool_use with a tool_result', async () => {
    const provider = new MockProvider('mock', [
      [
        {
          type: 'tool-call',
          call: {
            id: 'c1',
            name: 'readFile',
            argsText: '{"path":"a.txt"}',
            args: { path: 'a.txt' },
          },
        },
        {
          type: 'tool-call',
          call: {
            id: 'c2',
            name: 'readFile',
            argsText: '{"path":"b.txt"}',
            args: { path: 'b.txt' },
          },
        },
        { type: 'done', stopReason: 'tool-calls' },
      ],
    ]);
    const session = makeTestSession(provider, {
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
        guardrails: { maxSteps: 1 }, // trips on the first call in the batch
      },
    });
    await session.agent.run('read two files');

    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('guardrail');

    // Both call ids got a tool observation in the transcript.
    const toolIds = session.agent.history.filter((m) => m.role === 'tool').map((m) => m.toolCallId);
    expect(toolIds).toContain('c1');
    expect(toolIds).toContain('c2');

    // And the Anthropic view pairs every tool_use with a tool_result.
    const { messages } = toAnthropicMessages(session.agent.history);
    expect(unpairedToolUses(messages)).toEqual([]);
  });
});

// Every tool_use block whose id has no matching tool_result block. Empty means
// the transcript is well-formed for the Anthropic Messages API.
function unpairedToolUses(messages: Array<Record<string, unknown>>): string[] {
  const uses = new Set<string>();
  const results = new Set<string>();
  for (const m of messages) {
    const content = m.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === 'tool_use' && typeof block.id === 'string') uses.add(block.id);
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string')
        results.add(block.tool_use_id);
    }
  }
  return [...uses].filter((id) => !results.has(id));
}

describe('usage accounting (P2-1)', () => {
  // Providers report a running snapshot, not per-chunk increments. The loop
  // must take last-seen-wins per field, not sum, or a message_start count plus
  // a cumulative message_delta count double-counts output tokens.
  it('takes last-seen-wins per field instead of summing usage events', async () => {
    const provider = new MockProvider('mock', [
      [
        { type: 'text', delta: 'done' },
        { type: 'usage', promptTokens: 100, completionTokens: 2 }, // message_start-like
        { type: 'usage', promptTokens: 0, completionTokens: 50 }, // cumulative message_delta
        { type: 'done', stopReason: 'end' },
      ],
    ]);
    const session = makeTestSession(provider);
    await session.agent.run('hi');

    const usage = session.events.find((e) => e.type === 'usage');
    expect(usage && usage.type === 'usage' && usage.promptTokens).toBe(100);
    // Summing would give 52; last-seen-wins keeps the cumulative 50.
    expect(usage && usage.type === 'usage' && usage.completionTokens).toBe(50);
  });
});

describe('cloud escalation', () => {
  it('asks before spending, switches models, and finishes on the cloud', async () => {
    const local = new MockProvider(
      'mock',
      [
        textTurn('{"tool": "nope", "args": {}}'),
        textTurn('{"tool": "nope", "args": {}}'),
        textTurn('{"tool": "nope", "args": {}}'),
      ],
      { caps: { supportsTools: false } },
    );
    const cloud = new MockProvider('anthropic', [textTurn('Cloud got it done.')], {
      kind: 'cloud',
    });
    const session = makeTestSession(local, {
      escalation: cloud,
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
        providers: { anthropic: { kind: 'anthropic' } },
        routing: { escalation: { enabled: true, afterToolFailures: 2 } },
      },
    });
    await session.agent.run('do the hard thing');

    const spendAsk = session.approvals.find((a) => a.kind === 'cloud-spend');
    expect(spendAsk).toBeTruthy();
    const switched = session.events.find((e) => e.type === 'model-switch');
    expect(switched).toBeTruthy();
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('complete');
    expect(cloud.requests.length).toBeGreaterThan(0);
  });
});
