// A plan's image step when nothing is set for Image reading. A plan never
// carries a picture, so the step runs on the Reasoning model from the text
// whatever would read a picture in the chat (UX and copy review, 2026-10-08, E,
// taking off a maintainer's 2026-10-07 exception): no second provider gets
// the chat. When nothing here can read images (2026-10-07) the step
// still runs that way, its working note says so, the play finishes, and the
// turn closes with the two-door offer once, however many image steps the
// play holds.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const h = vi.hoisted(() => ({
  prompts: [] as string[],
  // Every OpenAI-compatible request: where it went, for which model, and the
  // prompt it carried; and every request that went to Claude.
  calls: [] as Array<{ baseUrl: string; model: string; prompt: string }>,
  anthropic: [] as string[],
  // The providers with a stored key.
  keys: ['perplexity'] as string[],
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

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  // By default only Perplexity is connected: its models read no images.
  secretGet: async (key: string) => (h.keys.some((k) => key.includes(k)) ? 'key-test' : null),
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
    openAiCompatibleClient: (seat: { baseUrl: string; model: string }) => ({
      async *stream(messages: Array<{ role: string; content: unknown }>) {
        const prompt = String(messages[messages.length - 1]?.content ?? '');
        h.prompts.push(prompt);
        h.calls.push({ baseUrl: seat.baseUrl, model: seat.model, prompt });
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
    // A request to Claude is recorded, never sent.
    anthropicClient: () => ({
      async *stream(messages: Array<{ role: string; content: unknown }>) {
        h.anthropic.push(String(messages[messages.length - 1]?.content ?? ''));
        yield { type: 'text' as const, text: 'step done' };
        yield { type: 'done' as const, text: 'step done', toolCalls: [], assistant: {} };
      },
    }),
  };
});

const { StackDriver } = await import('../src/drivers/stackDriver.js');
const { harborRef } = await import('../src/lib/stack.js');
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
  h.calls.length = 0;
  h.anthropic.length = 0;
  h.keys = ['perplexity'];
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

  it('names a model set for Image reading that cannot take the step, and who covers it', async () => {
    // Harbor Lite placed under Image reading, Local: a model on the phone
    // reads no images yet, so the Reasoning model covers the step, and the
    // note says so rather than "Handing to Harbor Lite".
    const placed: AppStack = {
      ...stack,
      active: [...stack.active, { ref: harborRef(), placement: { category: 'vision' } }],
    };
    const driver = new StackDriver(placed, 'offshore');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('Explain the chart in my last screenshot');
    await settle();

    const statuses = events.flatMap((e) => (e.type === 'status' ? [e.message] : []));
    expect(statuses).toContain(
      'Read the chart. Harbor Lite cannot read images yet, so Sonar, your Reasoning model, works from the text.',
    );
    expect(statuses.some((m) => /Handing to Harbor Lite/.test(m))).toBe(false);
    // The task list names the model that runs each image step, the one the
    // note names, never Harbor Lite (stepRunner, one rule for both).
    const lists = events.flatMap((e) => (e.type === 'todos' ? [e.items] : []));
    expect(lists.length).toBeGreaterThan(0);
    for (const items of lists) {
      const owners = items.filter((t) => t.content.startsWith('Read the')).map((t) => t.owner);
      expect(owners).toEqual(['Sonar (reasoning)', 'Sonar (reasoning)']);
    }
    expect(events.filter((e) => e.type === 'image-reader-offer')).toEqual([
      {
        type: 'image-reader-offer',
        from: 'play',
        cloud: 'none',
        placed: { model: 'Harbor Lite', why: 'device' },
      },
    ]);
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });
});

// A maintainer's 2026-10-07 exception comes off (UX and copy review, 2026-10-08, E):
// with nothing set for Image reading, a plan's image step never goes to the
// cloud reader a picture in the chat would go to. A plan carries no picture,
// so that reader would add no image reading, only a second provider.
describe("a plan's image step with nothing set for Image reading", () => {
  const read = (events: DriverEvent[]) =>
    events.flatMap((e) => (e.type === 'status' ? [e.message] : []));

  it('runs on a cloud Reasoning model that cannot see, never on Claude', async () => {
    // Claude is connected too, so a picture in the chat would go to it.
    h.keys = ['perplexity', 'anthropic'];
    const driver = new StackDriver(stack, 'offshore');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('Explain the chart in my last screenshot');
    await settle();

    // Nothing reached Claude: every request went to the anchor's provider.
    expect(h.anthropic).toEqual([]);
    expect(h.calls.length).toBeGreaterThan(0);
    expect(h.calls.every((c) => new URL(c.baseUrl).hostname === 'api.perplexity.ai')).toBe(true);
    // Each image step went to the Reasoning model itself.
    const steps = h.calls.filter((c) => c.prompt.includes('Your step: Read the'));
    expect(steps.map((c) => c.model)).toEqual(['sonar', 'sonar']);
    expect(read(events)).toContain(
      'Read the chart. No image model is set in Stack, and a plan carries no picture, so Sonar, your Reasoning model, works from the text.',
    );
    expect(read(events).some((m) => /Claude/.test(m))).toBe(false);
    // Something here reads images (Claude), so no offer of a way to add one.
    expect(events.filter((e) => e.type === 'image-reader-offer')).toEqual([]);
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
    // The task list names the Reasoning model for each image step.
    const lists = events.flatMap((e) => (e.type === 'todos' ? [e.items] : []));
    for (const items of lists) {
      const owners = items.filter((t) => t.content.startsWith('Read the')).map((t) => t.owner);
      expect(owners).toEqual(['Sonar (reasoning)', 'Sonar (reasoning)']);
    }
    driver.dispose();
  });

  it('keeps a Reasoning model that stays on this network local, with a Claude key stored', async () => {
    h.keys = ['anthropic'];
    const box: StackModelRef = {
      kind: 'byom',
      id: 'box',
      label: 'Home Qwen',
      baseUrl: 'http://192.168.1.20:11434/v1',
      model: 'qwen3:14b',
    };
    const writer: StackModelRef = { ...box, id: 'box-writer', label: 'Home Writer' };
    const home: AppStack = {
      reasoning: box,
      active: [{ ref: writer, placement: { category: 'writing' } }],
      saved: {},
    };
    const driver = new StackDriver(home, 'offshore', {}, undefined, {
      packSeat: (ref) => ({
        modelClass: 'large',
        servedTokens: 32_000,
        leavesNetwork: ref.kind === 'cloud',
      }),
    });
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('Explain the chart in my last screenshot');
    await settle();

    expect(h.anthropic).toEqual([]);
    expect(h.calls.length).toBeGreaterThan(0);
    expect(h.calls.every((c) => new URL(c.baseUrl).hostname === '192.168.1.20')).toBe(true);
    const turns = events.flatMap((e) => (e.type === 'turn-start' ? [e.providerKind] : []));
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((k) => k === 'local')).toBe(true);
    expect(read(events)).toContain(
      'Read the chart. No image model is set in Stack, and a plan carries no picture, so Home Qwen, your Reasoning model, works from the text.',
    );
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });
});
