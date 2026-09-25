// Claude's newer models (Opus 4.7 and up, Sonnet 5, Fable) answer a request
// carrying a custom temperature with a 400, and the engine's sampling default
// sends one on every agent turn (0.2) and summary (0.1). The provider sends it
// only to the models known to accept it, and nothing to any other.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider, claudeAcceptsTemperature } from '../src/providers/anthropic.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const ACCEPTS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-1-20250805',
  'claude-opus-4-20250514',
  'claude-haiku-4-5',
  'claude-3-7-sonnet-latest',
];
const REJECTS = [
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-fable-5-1',
];

async function sentTemperature(model: string): Promise<unknown> {
  let body: Record<string, unknown> = {};
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      'data: ' +
        JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) +
        '\n',
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const provider = new AnthropicProvider(
    'anthropic',
    { kind: 'anthropic', baseUrl: 'https://api.anthropic.test', auth: 'api-key', model },
    () => 'sk-test',
  );
  for await (const _ of provider.chat({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.2,
  })) {
    // drain
  }
  return body.temperature;
}

describe('Claude temperature', () => {
  it('knows which models take a temperature', () => {
    for (const m of ACCEPTS) expect(claudeAcceptsTemperature(m), m).toBe(true);
    for (const m of REJECTS) expect(claudeAcceptsTemperature(m), m).toBe(false);
  });

  it('a model newer than the list gets none (leaving it out is always valid)', () => {
    expect(claudeAcceptsTemperature('claude-opus-6')).toBe(false);
    expect(claudeAcceptsTemperature('claude-sonnet-5-5')).toBe(false);
  });

  it('sends it to a model that takes it', async () => {
    expect(await sentTemperature('claude-sonnet-4-6')).toBe(0.2);
  });

  it('leaves it out for a model that would reject it, including the default seat', async () => {
    for (const m of ['claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5-1']) {
      expect(await sentTemperature(m), m).toBeUndefined();
    }
  });
});
