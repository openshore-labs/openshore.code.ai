// Claude Code parity in the engine: the four permission modes, plan mode as a
// real read-only investigation that ends in a proposal, the task list mirrored
// as an event, standing instructions in the system prompt, and the bounded
// retry on a busy upstream.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

const askWrites = { permissions: { defaults: { write: 'ask', shell: 'ask' } } };

describe('permission modes', () => {
  it('acceptEdits lets a file edit flow without a prompt, and still asks for shell', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'a.txt', content: 'hi\n' }, 'c1'),
      toolTurn('runShell', { command: 'echo ok' }, 'c2'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, { configOverrides: askWrites });
    session.agent.setMode('acceptEdits');
    await session.agent.run('write then run');
    expect(session.approvals.map((a) => a.toolName)).toEqual(['runShell']);
    expect(readFileSync(join(session.cwd, 'a.txt'), 'utf8')).toBe('hi\n');
  });

  it('bypassPermissions runs writes and shell without a prompt', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'b.txt', content: 'x' }, 'c1'),
      toolTurn('runShell', { command: 'echo ok' }, 'c2'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, { configOverrides: askWrites });
    session.agent.setMode('bypassPermissions');
    await session.agent.run('go');
    expect(session.approvals).toEqual([]);
  });

  it('default asks for a write', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'c.txt', content: 'x' }),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, { configOverrides: askWrites });
    await session.agent.run('go');
    expect(session.approvals.map((a) => a.toolName)).toEqual(['writeFile']);
  });

  it('announces a mode change as an event', () => {
    const session = makeTestSession(new MockProvider('mock', []));
    session.agent.setMode('plan');
    expect(session.events.at(-1)).toEqual({ type: 'mode', mode: 'plan' });
    expect(session.agent.permissionMode).toBe('plan');
  });
});

describe('plan mode', () => {
  it('hides mutating tools from the model, refuses one if tried, and raises the plan', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('readFile', { path: 'hello.txt' }, 'c1'),
      toolTurn('writeFile', { path: 'hello.txt', content: 'nope' }, 'c2'),
      textTurn('1. Edit hello.txt to say goodbye.\n2. Run the tests.'),
    ]);
    const session = makeTestSession(provider, { files: { 'hello.txt': 'hello' } });
    session.agent.setMode('plan');
    await session.agent.run('change the greeting');
    // The first request offered only read-side tools.
    const offered = provider.requests[0]!.tools!.map((t) => t.name);
    expect(offered).toContain('readFile');
    expect(offered).not.toContain('writeFile');
    expect(offered).not.toContain('runShell');
    // The write was refused, not run, and no approval was raised for it.
    expect(readFileSync(join(session.cwd, 'hello.txt'), 'utf8')).toBe('hello');
    expect(session.approvals).toEqual([]);
    const denied = session.events.find((e) => e.type === 'tool-denied');
    expect(denied && denied.type === 'tool-denied' && denied.reason).toMatch(/plan mode/i);
    // The final text is also the proposal.
    const plan = session.events.find((e) => e.type === 'plan-proposed');
    expect(plan && plan.type === 'plan-proposed' && plan.text).toContain('Edit hello.txt');
    // The system prompt carried the plan-mode instruction.
    const system = String(provider.requests[0]!.messages[0]!.content);
    expect(system).toContain('PLAN MODE');
  });
});

describe('task list', () => {
  it('mirrors every todoWrite call as a todos event, replacing the list', async () => {
    const items = [
      { content: 'Read the file', status: 'completed' },
      { content: 'Change it', status: 'in_progress' },
      { content: 'Verify', status: 'pending' },
    ];
    const provider = new MockProvider('mock', [toolTurn('todoWrite', { items }), textTurn('ok')]);
    const session = makeTestSession(provider);
    await session.agent.run('do the thing');
    const todos = session.events.find((e) => e.type === 'todos');
    expect(todos && todos.type === 'todos' && todos.items).toEqual(items);
    expect(session.agent.taskList).toEqual(items);
    expect(session.approvals).toEqual([]);
  });
});

describe('standing instructions', () => {
  it('carries the project instructions and the repo file into the system prompt', async () => {
    const provider = new MockProvider('mock', [textTurn('ok')]);
    const session = makeTestSession(provider);
    session.agent.setInstructions('Always answer in haiku.');
    await session.agent.run('hi');
    const system = String(provider.requests[0]!.messages[0]!.content);
    expect(system).toContain('Always answer in haiku.');
    expect(system).toContain('todoWrite');
  });
});

describe('transient provider failures', () => {
  it('retries a rate limit with a pause, then succeeds', async () => {
    const provider = new MockProvider('mock', [textTurn('after the wait')]);
    let failed = false;
    const original = provider.chat.bind(provider);
    provider.chat = async function* (req, signal) {
      if (!failed) {
        failed = true;
        throw new Error('429 rate limit exceeded');
      }
      yield* original(req, signal);
    } as typeof provider.chat;
    const session = makeTestSession(provider);
    await session.agent.run('hello');
    const status = session.events.find((e) => e.type === 'status');
    expect(status && status.type === 'status' && status.message).toMatch(/Retrying/);
    const final = session.events.find((e) => e.type === 'text-final');
    expect(final && final.type === 'text-final' && final.text).toBe('after the wait');
  }, 10_000);
});
