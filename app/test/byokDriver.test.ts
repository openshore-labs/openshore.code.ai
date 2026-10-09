// What a longer list of providers makes visible in a Stack chat (bring your
// own keys, 2026-10-09). A provider with no key is named by its name, never
// its id. And a DeepSeek reasoning turn that calls a tool carries its
// reasoning_content back when it replays the tool round (DeepSeek answers 400
// without it), while the reasoning never reaches the visible answer or the
// history a later turn sends.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { compileVaultPrivacy } from 'os-code/protocol';

type Reply =
  | string
  | {
      content: string;
      reasoning_content?: string;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };

const h = vi.hoisted(() => ({
  keys: {} as Record<string, string>,
  replies: [] as Reply[],
  bodies: [] as Array<{ model?: string; messages: Array<Record<string, unknown>> }>,
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  secretGet: async (key: string) => h.keys[key] ?? null,
  storeGetJson: async () => null,
}));
// Every request goes once through the native shim, whole (the iPhone's
// fallback), so each reply below is one JSON answer.
vi.mock('../src/lib/streamingFetch.js', () => ({
  streamingFetch: async () => {
    throw new TypeError('Load failed');
  },
}));
vi.mock('../src/lib/nativeFetch.js', () => ({
  nativeFetch: async (_url: string, init: { body: string }) => {
    h.bodies.push(JSON.parse(init.body));
    const reply = h.replies.shift() ?? '';
    const message = typeof reply === 'string' ? { content: reply } : reply;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message }] }) };
  },
}));
vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async () => ({ remove: async () => {} }),
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async () => ({ started: true }),
  },
}));

const { StackDriver } = await import('../src/drivers/stackDriver.js');
import type { PackSeat } from '../src/drivers/types.js';
import type { AppStack, StackModelRef } from '../src/lib/stack.js';

const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const seatOf = (): PackSeat => ({ modelClass: 'large', servedTokens: 128000, leavesNetwork: true });

const vaultTools = {
  privacy: async () => compileVaultPrivacy({}),
  search: async () => [],
  read: async () => ({ text: '# Plan\nShip on Friday.', version: 'v1' }),
  write: async () => ({ ok: false as const, conflict: 'exists' as const }),
};

function chat(reasoning: StackModelRef) {
  const stack: AppStack = { reasoning, active: [], saved: {} };
  const driver = new StackDriver(stack, 'offshore', {}, undefined, {
    packSeat: seatOf,
    vaultTools,
  });
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return { driver, events };
}

const said = (events: DriverEvent[]) => JSON.stringify(events);

beforeEach(() => {
  h.keys = {};
  h.replies.length = 0;
  h.bodies.length = 0;
});

describe('a provider with no key', () => {
  it('is named by its name, never its id', async () => {
    const { driver, events } = chat({
      kind: 'cloud',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      label: 'GPT OSS',
    });
    driver.send('hello');
    await settle();
    expect(said(events)).toContain('Connect Groq under Cloud Connections first.');
    expect(said(events)).not.toContain('Connect groq');
    expect(h.bodies).toHaveLength(0);
    driver.dispose();
  });

  it('Claude reads as Claude', async () => {
    const { driver, events } = chat({
      kind: 'cloud',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
    });
    driver.send('hello');
    await settle();
    expect(said(events)).toContain('Connect Claude under Cloud Connections first.');
    expect(said(events)).not.toContain('Connect anthropic');
    driver.dispose();
  });
});

describe('a DeepSeek reasoning turn with a tool round', () => {
  it('replays reasoning_content with the tool call, and keeps it out of the answer and history', async () => {
    h.keys['oscode.secret.deepseek'] = 'sk-test';
    const { driver, events } = chat({
      kind: 'cloud',
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
    });
    h.replies.push(
      {
        content: '',
        reasoning_content: 'The plan note will say when.',
        tool_calls: [
          { id: 'c1', function: { name: 'vaultRead', arguments: '{"path":"Plan.md"}' } },
        ],
      },
      { content: 'It ships on Friday.', reasoning_content: 'The note says Friday.' },
    );
    driver.send('when do we ship?');
    await settle(30);
    expect(h.bodies).toHaveLength(2);
    expect(JSON.stringify(h.bodies[0]!.tools ?? [])).toContain('vaultRead');
    // Round two carries the first round's reasoning back on its tool call.
    const replayed = h.bodies[1]!.messages.find((m) => m.role === 'assistant')!;
    expect(replayed).toMatchObject({
      role: 'assistant',
      reasoning_content: 'The plan note will say when.',
      tool_calls: [{ id: 'c1' }],
    });
    // The answer is the answer: no reasoning in the words the chat shows.
    const finals = events.filter((e) => e.type === 'text-final');
    expect(JSON.stringify(finals)).toContain('It ships on Friday.');
    expect(JSON.stringify(finals)).not.toContain('The note says Friday.');
    expect(JSON.stringify(finals)).not.toContain('The plan note will say when.');

    // The next turn's history holds the answer, never the reasoning.
    h.replies.push('Yes.');
    driver.send('sure?');
    await settle(30);
    const next = JSON.stringify(h.bodies[2]!.messages);
    expect(next).toContain('It ships on Friday.');
    expect(next).not.toContain('reasoning_content');
    expect(next).not.toContain('The plan note will say when.');
    expect(next).not.toContain('The note says Friday.');
    driver.dispose();
  });
});
