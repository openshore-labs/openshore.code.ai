// A plan's image step when nothing here can read images (founder,
// 2026-10-07): the step still runs, the Reasoning model working from the
// text, its working note says so, the play finishes, and the turn closes
// with the two-door offer once, however many image steps the play holds.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const h = vi.hoisted(() => ({ prompts: [] as string[] }));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async () => ({ remove: async () => {} }),
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async () => ({ started: true }),
  },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  // Only Perplexity is connected: its models read no images.
  secretGet: async (key: string) => (key.includes('perplexity') ? 'pplx-test' : null),
  storeGetJson: async () => null,
}));

const PLAN = JSON.stringify({
  clear: true,
  summary: 'Explain the chart',
  steps: [
    { id: 's1', title: 'Read the chart', category: 'vision', brief: '', dependsOn: [] },
    { id: 's2', title: 'Read the legend', category: 'vision', brief: '', dependsOn: [] },
    { id: 's3', title: 'Write it up', category: 'writing', brief: '', dependsOn: ['s1', 's2'] },
  ],
});

vi.mock('../src/drivers/providerClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/drivers/providerClient.js')>();
  return {
    ...actual,
    openAiCompatibleClient: () => ({
      async *stream(messages: Array<{ role: string; content: unknown }>) {
        const prompt = String(messages[messages.length - 1]?.content ?? '');
        h.prompts.push(prompt);
        const text = prompt.includes('You are the reasoning lead')
          ? PLAN
          : prompt.includes('re-checking a play')
            ? 'keep going'
            : prompt.includes('Compose the final answer')
              ? 'Here is the chart, explained.'
              : 'step done';
        yield { type: 'text' as const, text };
        yield { type: 'done' as const, text, toolCalls: [], assistant: {} };
      },
    }),
  };
});

const { StackDriver } = await import('../src/drivers/stackDriver.js');
import type { AppStack, StackModelRef } from '../src/lib/stack.js';

const sonar: StackModelRef = {
  kind: 'cloud',
  provider: 'perplexity',
  model: 'sonar',
  label: 'Sonar',
};
const sonarPro: StackModelRef = {
  kind: 'cloud',
  provider: 'perplexity',
  model: 'sonar-pro',
  label: 'Sonar Pro',
};
const stack: AppStack = {
  reasoning: sonar,
  active: [{ ref: sonarPro, placement: { category: 'writing' } }],
  saved: {},
};

const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  h.prompts.length = 0;
});

describe('a play whose image step finds no reader', () => {
  it('runs every step, finishes, and shows the offer once', async () => {
    const driver = new StackDriver(stack, 'offshore');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('Explain the chart in my last screenshot');
    await settle();

    const statuses = events.flatMap((e) => (e.type === 'status' ? [e.message] : []));
    expect(statuses).toContain(
      'Read the chart. Nothing here can read images yet, so Sonar, your Reasoning model, works from the text.',
    );
    expect(statuses).toContain(
      'Read the legend. Nothing here can read images yet, so Sonar, your Reasoning model, works from the text.',
    );
    // Both image steps ran, on the text, and the play reached its answer.
    expect(h.prompts.filter((p) => p.includes('Your step: Read the'))).toHaveLength(2);
    const final = events.findLast((e) => e.type === 'text-final') as { text: string };
    expect(final.text).toBe('Here is the chart, explained.');

    const offers = events.filter((e) => e.type === 'image-reader-offer');
    expect(offers).toEqual([{ type: 'image-reader-offer', from: 'play', cloud: 'none' }]);
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
    // The offer follows the answer, inside the turn.
    const at = (t: string) => events.findIndex((e) => e.type === t);
    expect(at('text-final')).toBeLessThan(at('image-reader-offer'));
    expect(at('image-reader-offer')).toBeLessThan(at('task-done'));
    driver.dispose();
  });
});
