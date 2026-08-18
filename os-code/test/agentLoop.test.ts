// The agent loop, end to end against the scripted provider: tool execution
// and observation feedback, the JSON-in-text bridge with repair, the
// permission rhythm, guardrails, and cloud escalation with confirm-first.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

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
