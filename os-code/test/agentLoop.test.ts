// The agent loop, end to end against the scripted provider: tool execution
// and observation feedback, the JSON-in-text bridge with repair, the
// permission rhythm, guardrails, and cloud escalation with confirm-first.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { toAnthropicMessages } from '../src/providers/anthropic.js';
import type { ChatMessage } from '../src/providers/types.js';
import type { ApprovalAnswer } from '../src/core/agent/types.js';
import { PermissionEngine, DEFAULT_PERMISSIONS } from '../src/core/permissions/index.js';
import { z } from 'zod';

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
        guardrails: { maxSteps: 1 }, // step 1 runs; the second call in the batch trips
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

describe('guardrail counters reset per task (P0-2)', () => {
  // The token and dollar rails say "in one task", so they must start from zero
  // on every run(). Before the fix they accumulated for the life of the session
  // and a long conversation could never start another task.
  it('a task that spent past maxTokens does not block the next task', async () => {
    const provider = new MockProvider('mock', [
      [
        { type: 'text', delta: 'first' },
        { type: 'usage', promptTokens: 900, completionTokens: 300 },
        { type: 'done', stopReason: 'end' },
      ],
      textTurn('second'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
        guardrails: { maxTokens: 1000 },
      },
    });
    await session.agent.run('one');
    await session.agent.run('two');
    expect(provider.requests).toHaveLength(2);
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('complete');
  });
});

describe('permission paths are normalized (ENG-3)', () => {
  const denySecrets = {
    stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
    permissions: {
      defaults: { write: 'ask', shell: 'ask' },
      rules: [{ tool: 'writeFile', decision: 'deny', pathGlob: 'secrets/**' }],
    },
  };

  it('a dotted spelling of a denied path is still denied, never asked', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: './secrets/k', content: 'x' }, 'c1'),
      toolTurn('writeFile', { path: 'src/../secrets/k', content: 'x' }, 'c2'),
      textTurn('ok'),
    ]);
    const session = makeTestSession(provider, { configOverrides: denySecrets });
    await session.agent.run('write the key');
    expect(session.approvals).toEqual([]);
    const denied = session.events.filter((e) => e.type === 'tool-denied');
    expect(denied).toHaveLength(2);
  });

  it('always allow in this project on a root file persists a rule that matches', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'README.md', content: 'x' }, 'c1'),
      textTurn('ok'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
        permissions: { defaults: { write: 'ask', shell: 'ask' } },
      },
      approve: () => ({ approve: true, alwaysInProject: true }),
    });
    await session.agent.run('write the readme');
    expect(session.persistedRules).toHaveLength(1);
    const rule = session.persistedRules[0]!;
    // A fresh engine loaded with exactly that rule allows the next root write.
    const engine = new PermissionEngine({
      ...DEFAULT_PERMISSIONS,
      defaults: { ...DEFAULT_PERMISSIONS.defaults, write: 'ask' },
      rules: [{ tool: rule.tool, decision: 'allow', pathGlob: rule.pathGlob }],
    });
    expect(
      engine.decide({ toolName: 'writeFile', risk: 'write', path: 'README.md' }).decision,
    ).toBe('allow');
    expect(
      engine.decide({ toolName: 'writeFile', risk: 'write', path: 'CHANGELOG.md' }).decision,
    ).toBe('allow');
  });
});

describe('a path that leaves the workspace is denied outright (ENG-3)', () => {
  it('never raises an approval for a jail violation', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: '../outside.txt', content: 'x' }, 'c1'),
      textTurn('ok'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
        permissions: { defaults: { write: 'ask', shell: 'ask' } },
      },
    });
    await session.agent.run('write outside');
    expect(session.approvals).toEqual([]);
    const denied = session.events.find((e) => e.type === 'tool-denied');
    expect(denied && denied.type === 'tool-denied' && denied.reason).toMatch(/workspace/i);
    expect(session.events.some((e) => e.type === 'tool-start')).toBe(false);
  });
});

describe('always allow in this project for shell (ENG-4)', () => {
  const askAll = {
    stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
    permissions: { defaults: { write: 'ask', shell: 'ask' } },
  };

  it('scopes the saved rule to the first word, so a different command still asks', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('runShell', { command: 'npm test' }, 'c1'),
      toolTurn('runShell', { command: 'npm run build' }, 'c2'),
      toolTurn('runShell', { command: 'rm -rf dist' }, 'c3'),
      textTurn('ok'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: askAll,
      // "Always in this project" on the first prompt only.
      approve: (r) => ({ approve: true, alwaysInProject: r.summary.includes('npm test') }),
    });
    await session.agent.run('build it');
    expect(session.persistedRules).toEqual([{ tool: 'runShell', commandPrefix: 'npm' }]);
    // npm test asked (and saved), npm run build flowed, rm asked again.
    expect(session.approvals.map((a) => a.summary)).toEqual(['Run: npm test', 'Run: rm -rf dist']);
    expect(session.events.filter((e) => e.type === 'tool-end')).toHaveLength(3);
  });

  it('refuses to save a rule for a shell wrapper and says so', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('runShell', { command: 'sudo npm test' }, 'c1'),
      textTurn('ok'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: askAll,
      approve: () => ({ approve: true, alwaysInProject: true }),
    });
    await session.agent.run('build it');
    expect(session.persistedRules).toEqual([]);
    const note = session.events.find((e) => e.type === 'note');
    expect(note && note.type === 'note' && note.message).toMatch(/shell wrapper/);
  });
});

describe('idle work after an abort (ENG-7)', () => {
  it('compactNow after an aborted task still summarizes through the provider', async () => {
    const provider = new MockProvider('mock', [textTurn('first'), textTurn('a summary')]);
    // The scripted provider ignores signals; make it refuse like a real one.
    const original = provider.chat.bind(provider);
    provider.chat = async function* (req, signal) {
      if (signal?.aborted) throw new Error('This operation was aborted');
      yield* original(req, signal);
    } as typeof provider.chat;
    const session = makeTestSession(provider);
    await session.agent.run('hello');
    session.agent.abort(); // the task signal now stays aborted until the next run()
    session.agent.history = [
      ...session.agent.history,
      ...Array.from({ length: 12 }, (_, i): ChatMessage => ({
        role: i % 2 ? 'assistant' : 'user',
        content: `turn ${i} ${'x'.repeat(2000)}`,
      })),
    ];
    await session.agent.compactNow();
    expect(provider.requests).toHaveLength(2);
    const summary = session.agent.history.find(
      (m) => typeof m.content === 'string' && m.content.includes('summarized to fit'),
    );
    expect(summary && String(summary.content)).toContain('a summary');
    expect(summary && String(summary.content)).not.toContain('were dropped');
  });
});

describe('a rejected call in a native batch (ENG-11)', () => {
  it('tells the model which call was refused instead of dropping the problem', async () => {
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
        { type: 'tool-call', call: { id: 'c2', name: 'compile', argsText: '{}', args: {} } },
        { type: 'done', stopReason: 'tool-calls' },
      ],
      textTurn('ok'),
    ]);
    const session = makeTestSession(provider, { files: { 'a.txt': 'alpha' } });
    await session.agent.run('read and compile');
    // The valid call ran.
    expect(session.events.some((e) => e.type === 'tool-end')).toBe(true);
    // The refused call has its own observation naming the problem.
    const second = provider.requests[1]!;
    const refused = second.messages.find((m) => m.role === 'tool' && m.toolCallId === 'c2');
    expect(refused && String(refused.content)).toContain('no tool named "compile"');
    // And the transcript still pairs every tool_use with a tool_result.
    const { messages } = toAnthropicMessages(session.agent.history);
    expect(unpairedToolUses(messages)).toEqual([]);
  });
});

describe('the steps rail counts exactly (ENG-12)', () => {
  it('runs exactly maxSteps tools before stopping', async () => {
    const turns = Array.from({ length: 6 }, (_, i) => toolTurn('readFile', { path: `f${i}.txt` }));
    const provider = new MockProvider('mock', turns);
    const files = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.txt`, 'x']));
    const session = makeTestSession(provider, {
      files,
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
        guardrails: { maxSteps: 4 },
      },
    });
    await session.agent.run('read everything');
    expect(session.events.filter((e) => e.type === 'tool-end')).toHaveLength(4);
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('guardrail');
    expect(done && done.type === 'task-done' && done.message).toContain('4');
  });
});

describe('summaries are priced (ENG-14)', () => {
  it('compactNow on a cloud model notes the dollars and emits usage', async () => {
    const cloud = new MockProvider('anthropic', [textTurn('a summary')], { kind: 'cloud' });
    const session = makeTestSession(cloud, {
      configOverrides: {
        stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
      },
    });
    session.agent.history = Array.from({ length: 12 }, (_, i): ChatMessage => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `turn ${i} ${'x'.repeat(2000)}`,
    }));
    await session.agent.compactNow();
    expect(session.guardrails.spentDollars).toBeGreaterThan(0);
    expect(session.usage.session.dollars).toBeGreaterThan(0);
    const usage = session.events.find((e) => e.type === 'usage');
    expect(usage && usage.type === 'usage' && usage.dollars).toBeGreaterThan(0);
  });
});

describe('the task signal reaches tools (DAE-4)', () => {
  it('a tool can see the abort through its context and the run settles aborted', async () => {
    const provider = new MockProvider('mock', [toolTurn('slowTool', {}), textTurn('unreached')]);
    const session = makeTestSession(provider);
    let sawSignal: AbortSignal | undefined;
    session.tools.register({
      name: 'slowTool',
      description: 'waits until the task is aborted',
      schema: z.object({}),
      risk: 'read',
      async execute(_args, ctx) {
        sawSignal = ctx.signal;
        await new Promise<void>((resolve) => {
          if (!ctx.signal || ctx.signal.aborted) return resolve();
          ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { ok: true, content: 'stopped' };
      },
    });
    const runPromise = session.agent.run('wait');
    await waitUntil(() => session.events.some((e) => e.type === 'tool-start'));
    session.agent.abort();
    await runPromise;
    expect(sawSignal).toBeInstanceOf(AbortSignal);
    expect(sawSignal?.aborted).toBe(true);
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('aborted');
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
