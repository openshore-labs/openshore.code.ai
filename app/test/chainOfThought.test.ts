// Chain of Thought (Settings, Reasoning; founder 2026-09-25): off by default.
// On, a model's reasoning streams into the thinking block above its answer and
// folds when the answer starts; off, no model is asked to think out loud and
// any reasoning it sends stays out of the chat. The routing rules themselves
// are proven in os-code (test/chainOfThought.test.ts); this pins the app side:
// the live value, one driver end to end both ways, and the wiring.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import {
  chainOfThoughtLine,
  chainOfThoughtOn,
  claudeRequestThinking,
  reasoningOf,
  setChainOfThought,
} from '../src/lib/chainOfThought.js';

const calls: Array<{ body: { messages: Array<{ role: string; content: string }> } }> = [];
let nextMessage: Record<string, unknown> = {};

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => false,
}));

vi.mock('../src/lib/nativeFetch.js', () => ({
  nativeFetch: vi.fn(async (_url: string, init: { body: string }) => {
    calls.push({ body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: nextMessage }] }),
      text: async () => '',
    };
  }),
}));

const { CloudOpenAiDriver } = await import('../src/drivers/cloudOpenAiDriver.js');

async function runTurn(model: string): Promise<DriverEvent[]> {
  const driver = new CloudOpenAiDriver('https://api.test/v1', 'sk', model, 'Test');
  const events: DriverEvent[] = [];
  await new Promise<void>((resolve) => {
    driver.subscribe((e) => {
      events.push(e);
      if (e.type === 'task-done') resolve();
    });
    driver.send('why is the sky blue');
  });
  return events;
}

const thinking = (events: DriverEvent[]) =>
  events
    .filter((e) => e.type === 'thinking-delta')
    .map((e) => (e as { text: string }).text)
    .join('');
const final = (events: DriverEvent[]) =>
  (events.find((e) => e.type === 'text-final') as { text: string } | undefined)?.text;
const system = () => calls[0]!.body.messages.find((m) => m.role === 'system')!.content;

beforeEach(() => {
  calls.length = 0;
  setChainOfThought(false);
});

describe('the live value', () => {
  it('is off until the store says otherwise', () => {
    expect(chainOfThoughtOn()).toBe(false);
    setChainOfThought(true);
    expect(chainOfThoughtOn()).toBe(true);
  });

  it('prompts only a model that does not reason natively, and only while on', () => {
    expect(chainOfThoughtLine('gpt-4o', false)).toBeUndefined();
    expect(chainOfThoughtLine('gpt-4o', true)).toContain('<think>');
    expect(chainOfThoughtLine('deepseek-r1', true)).toBeUndefined();
    expect(chainOfThoughtLine('claude-opus-4-8', true)).toBeUndefined();
  });

  it('asks Claude to think only while on', () => {
    expect(claudeRequestThinking('claude-opus-4-8', 2048, false)).toEqual({ max_tokens: 2048 });
    const on = claudeRequestThinking('claude-opus-4-8', 2048, true);
    expect(on.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(on.max_tokens).toBeGreaterThanOrEqual(16000);
  });

  it('reads both reasoning field spellings', () => {
    expect(reasoningOf({ reasoning_content: 'a' })).toBe('a');
    expect(reasoningOf({ reasoning: 'b' })).toBe('b');
    expect(reasoningOf({ content: 'c' })).toBeUndefined();
  });
});

describe('an OpenAI-compatible chat, end to end', () => {
  it('on: the prompt asks for tags, and the thought lands in the thinking block', async () => {
    setChainOfThought(true);
    nextMessage = { content: '<think>Rayleigh scattering.</think>\n\nShort answer: scattering.' };
    const events = await runTurn('gpt-4o');
    expect(system()).toContain('Chain of thought is on');
    expect(thinking(events)).toBe('Rayleigh scattering.');
    expect(final(events)).toBe('Short answer: scattering.');
  });

  it('on: a server reasoning field is shown too', async () => {
    setChainOfThought(true);
    nextMessage = { reasoning_content: 'Native thought.', content: 'Answer.' };
    const events = await runTurn('deepseek-reasoner');
    expect(system()).not.toContain('Chain of thought is on');
    expect(thinking(events)).toBe('Native thought.');
    expect(final(events)).toBe('Answer.');
  });

  it('off (the default): no prompt, no thinking shown, and tags never leak', async () => {
    nextMessage = { reasoning_content: 'hidden', content: '<think>hidden too</think>Answer.' };
    const events = await runTurn('gpt-4o');
    expect(system()).not.toContain('Chain of thought is on');
    expect(events.some((e) => e.type === 'thinking-delta')).toBe(false);
    expect(final(events)).toBe('Answer.');
  });
});

describe('wiring', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('Settings carries the switch, reading unset as off', () => {
    const screen = read('../src/screens/SettingsScreen.tsx');
    expect(screen).toContain('label="Chain of Thought"');
    expect(screen).toContain('settings.chainOfThought === true');
  });

  it('the store mirrors the setting, sends it to engine sessions, and filters while off', () => {
    const store = read('../src/state/store.ts');
    expect(store.match(/setChainOfThought\(settings\.chainOfThought === true\)/g)).toHaveLength(2);
    expect(store).toContain('chainOfThought: settings.chainOfThought === true');
    expect(store).toContain('chainOfThought: sessionOpts.chainOfThought');
    expect(store).toContain("event.type === 'thinking-delta' && !chainOfThoughtOn()");
  });

  it('every chat driver reads the setting', () => {
    for (const d of [
      'stackDriver',
      'cloudClaudeDriver',
      'cloudOpenAiDriver',
      'desktopChatDriver',
      'onDeviceDriver',
    ]) {
      expect(read(`../src/drivers/${d}.ts`), d).toMatch(/chainOfThought/);
    }
  });

  it('the thinking block opens while live and folds when the answer starts', () => {
    const block = read('../src/components/ThinkingBlock.tsx');
    expect(block).toMatch(/streaming && !wasStreaming\.current/);
    expect(block).toMatch(/!streaming && wasStreaming\.current/);
  });
});
