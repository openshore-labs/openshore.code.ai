// An image in a Stack chat (founder, 2026-09-25): "Ask first unless the stack
// has a model there that is dedicated to image reading, then it's just
// automatic." Any other reader, a connected cloud model filling the gap or an
// anchor that can see, waits on a card the person taps (tenet 4): nothing is
// sent before Approve, a No ends the turn plainly, a stop counts as a No.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest, DriverEvent } from 'os-code/protocol';

const h = vi.hoisted(() => ({ streams: 0, models: [] as string[], keys: true }));

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class Anthropic {
    static APIUserAbortError = class extends Error {};
    static AuthenticationError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    messages = {
      stream: (params: { model: string }) => {
        h.streams++;
        h.models.push(params.model);
        const handlers: Record<string, (delta: string) => void> = {};
        return {
          on: (event: string, cb: (delta: string) => void) => {
            handlers[event] = cb;
          },
          finalMessage: async () => {
            handlers.text?.('That is Jimi Hendrix.');
            return { content: [{ type: 'text', text: 'That is Jimi Hendrix.' }] };
          },
          abort: () => {},
        };
      },
    };
  }
  return { default: Anthropic };
});

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
  secretGet: async (key: string) => (h.keys && key.includes('anthropic') ? 'sk-test' : null),
  storeGetJson: async () => null,
}));

const { StackDriver, IMAGE_NOT_SENT, ASK_STOP_LINE } =
  await import('../src/drivers/stackDriver.js');
const { harborRef } = await import('../src/lib/stack.js');
import type { AppStack } from '../src/lib/stack.js';
import type { Attachment } from '../src/lib/attachments.js';

const photo: Attachment = {
  id: 'a1',
  name: 'jimi.jpg',
  mime: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,AAAA',
  isImage: true,
};

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
};

function chat(stack: AppStack) {
  const driver = new StackDriver(stack, 'offshore');
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return { driver, events };
}

const localOnly: AppStack = { reasoning: harborRef(), active: [], saved: {} };
const asked = (events: DriverEvent[]) =>
  events.find((e) => e.type === 'approval-request') as
    { type: 'approval-request'; request: ApprovalRequest } | undefined;

beforeEach(() => {
  h.streams = 0;
  h.models.length = 0;
  h.keys = true;
});

describe('an image when no local model can see', () => {
  it('asks with a cloud card and sends nothing until the tap', async () => {
    const { driver, events } = chat(localOnly);
    driver.send('Who is this?', [photo]);
    await settle();
    const ask = asked(events);
    // The card names the model the image would go to: the Claude model that
    // costs the person least, never the top of the lineup, the same name the
    // Stack's Image reading row shows (D13, founder 2026-10-07).
    expect(ask?.request).toMatchObject({
      kind: 'cloud-spend',
      risk: 'cloud-spend',
      summary: 'Read this image with Claude Haiku 4.5?',
    });
    expect(ask?.request.detail).toContain('Nothing in Stack is set for Image reading');
    // The turn waits on the tap with no timer, so the card says Stop skips it.
    expect(ask?.request.detail).toContain(ASK_STOP_LINE);
    expect(h.streams).toBe(0);
    expect(events.some((e) => e.type === 'task-done')).toBe(false);
    driver.dispose();
  });

  it('reads it with the cloud model once the person approves', async () => {
    const { driver, events } = chat(localOnly);
    driver.send('Who is this?', [photo]);
    await settle();
    driver.answerApproval(asked(events)!.request.id, { approve: true });
    await settle();
    expect(events.some((e) => e.type === 'approval-resolved' && e.approved)).toBe(true);
    expect(h.streams).toBe(1);
    expect(h.models).toEqual(['claude-haiku-4-5']);
    // Nothing is set for Image reading, so the line says so and names the
    // reader and the connection it runs on (founder, 2026-10-07).
    expect(
      events.some(
        (e) =>
          e.type === 'status' &&
          e.message ===
            'No image model is set in Stack, so Claude Haiku 4.5 reads this image on your Claude connection.',
      ),
    ).toBe(true);
    const final = events.findLast((e) => e.type === 'text-final') as { text: string };
    expect(final.text).toBe('That is Jimi Hendrix.');
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });

  it('ends the turn plainly on a No, with nothing sent', async () => {
    const { driver, events } = chat(localOnly);
    driver.send('Who is this?', [photo]);
    await settle();
    driver.answerApproval(asked(events)!.request.id, { approve: false });
    await settle();
    expect(h.streams).toBe(0);
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({
      reason: 'declined',
      message: IMAGE_NOT_SENT,
    });
    driver.dispose();
  });

  it('a stop while the card is up ends the turn without sending', async () => {
    const { driver, events } = chat(localOnly);
    driver.send('Who is this?', [photo]);
    await settle();
    driver.abort();
    await settle();
    expect(h.streams).toBe(0);
    expect(events.some((e) => e.type === 'approval-resolved' && !e.approved)).toBe(true);
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'aborted' });
    driver.dispose();
  });
});

const claude = {
  kind: 'cloud' as const,
  provider: 'anthropic',
  model: 'claude-opus',
  label: 'Claude',
};

describe('an image when a model is placed for Image reading', () => {
  it('goes to it automatically, no card', async () => {
    const { driver, events } = chat({
      reasoning: harborRef(),
      active: [{ ref: claude, placement: { category: 'vision' } }],
      saved: {},
    });
    driver.send('Who is this?', [photo]);
    await settle();
    expect(asked(events)).toBeUndefined();
    expect(h.streams).toBe(1);
    // A placed model keeps the plain line.
    expect(
      events.some((e) => e.type === 'status' && e.message === 'Reading this image with Claude.'),
    ).toBe(true);
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });
});

describe('an image when nothing here can read it (founder, 2026-10-07)', () => {
  it('answers with the two-door offer, never an error, and sends nothing', async () => {
    h.keys = false;
    const { driver, events } = chat(localOnly);
    driver.send('Who is this?', [photo]);
    await settle();
    expect(asked(events)).toBeUndefined();
    expect(h.streams).toBe(0);
    const offers = events.filter((e) => e.type === 'image-reader-offer');
    expect(offers).toEqual([{ type: 'image-reader-offer', from: 'image', cloud: 'none' }]);
    const done = events.findLast((e) => e.type === 'task-done');
    expect(done).toMatchObject({ reason: 'complete' });
    expect(events.some((e) => e.type === 'task-done' && e.reason === 'error')).toBe(false);
    // The offer lands inside the turn, after its (empty) final text.
    const at = (t: string) => events.findIndex((e) => e.type === t);
    expect(at('text-final')).toBeLessThan(at('image-reader-offer'));
    expect(at('image-reader-offer')).toBeLessThan(at('task-done'));
    driver.dispose();
  });

  it('says a connected cloud reader is out of reach while Offline, rather than missing', async () => {
    const driver = new StackDriver(localOnly, 'offline');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('Who is this?', [photo]);
    await settle();
    expect(events.find((e) => e.type === 'image-reader-offer')).toEqual({
      type: 'image-reader-offer',
      from: 'image',
      cloud: 'out-of-reach',
      status: 'Offline',
    });
    driver.dispose();
  });

  it('names a model set for Image reading that cannot read here', async () => {
    h.keys = false;
    const { driver, events } = chat({
      reasoning: harborRef(),
      active: [{ ref: harborRef(), placement: { category: 'vision' } }],
      saved: {},
    });
    driver.send('Who is this?', [photo]);
    await settle();
    expect(events.find((e) => e.type === 'image-reader-offer')).toMatchObject({
      placed: { model: 'Harbor Lite', why: 'device' },
      cloud: 'none',
    });
    driver.dispose();
  });
});

describe('an image when only a model not dedicated to Image reading can see', () => {
  it('asks even when the anchor itself can see', async () => {
    const { driver, events } = chat({ reasoning: claude, active: [], saved: {} });
    driver.send('Who is this?', [photo]);
    await settle();
    expect(asked(events)?.request).toMatchObject({
      kind: 'cloud-spend',
      summary: 'Read this image with Claude?',
    });
    expect(h.streams).toBe(0);
    driver.dispose();
  });

  it('names the Reasoning model by its role once the person approves', async () => {
    const { driver, events } = chat({ reasoning: claude, active: [], saved: {} });
    driver.send('Who is this?', [photo]);
    await settle();
    driver.answerApproval(asked(events)!.request.id, { approve: true });
    await settle();
    expect(
      events.some(
        (e) =>
          e.type === 'status' &&
          e.message ===
            'No image model is set in Stack, so Claude, your Reasoning model, reads this image.',
      ),
    ).toBe(true);
    driver.dispose();
  });

  it('asks with a plain card, not a spend card, for your own model', async () => {
    const { driver, events } = chat({
      reasoning: {
        kind: 'byom',
        id: 'byom-ollama',
        label: 'Ollama',
        baseUrl: 'http://box:11434/v1',
        model: 'llava',
      },
      active: [],
      saved: {},
    });
    driver.send('Who is this?', [photo]);
    await settle();
    expect(asked(events)?.request).toMatchObject({
      kind: 'tool',
      toolName: 'analyzeImage',
      summary: 'Read this image with Ollama?',
    });
    expect(asked(events)?.request.detail).not.toContain('API key');
    driver.dispose();
  });
});
