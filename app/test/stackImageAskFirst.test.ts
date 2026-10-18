// An image in a Stack chat (2026-09-25): "Ask first unless the stack
// has a model there that is dedicated to image reading, then it's just
// automatic." Any other reader, a connected cloud model filling the gap or an
// anchor that can see, waits on a card the person taps (tenet 4): nothing is
// sent before Approve, a No ends the turn plainly, a stop counts as a No.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest, DriverEvent } from 'os-code/protocol';

const h = vi.hoisted(() => ({
  streams: 0,
  models: [] as string[],
  keys: true,
  // A model you run or connect, by its model name: how its reply goes
  // ('fail' errors before a word, 'partial' writes then errors, 'hang' waits
  // for a stop), and every request it was sent.
  local: {} as Record<string, 'fail' | 'partial' | 'hang' | 'ok'>,
  openai: [] as string[],
}));

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

vi.mock('../src/drivers/providerClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/drivers/providerClient.js')>();
  return {
    ...actual,
    openAiCompatibleClient: (seat: { model: string }) => ({
      async *stream(_messages: unknown[], _tools: unknown[], signal?: AbortSignal) {
        h.openai.push(seat.model);
        const mode = h.local[seat.model] ?? 'ok';
        if (mode === 'fail') {
          throw new actual.ProviderUnavailable('The server could not read that image.', 500);
        }
        if (mode === 'partial') {
          yield { type: 'text' as const, text: 'I can see a ' };
          throw new actual.ProviderUnavailable('The connection dropped.', 500);
        }
        if (mode === 'hang') {
          await new Promise((_, reject) =>
            signal?.addEventListener('abort', () => reject(actual.abortError())),
          );
        }
        yield { type: 'text' as const, text: 'A guitar on a stage.' };
        yield {
          type: 'done' as const,
          text: 'A guitar on a stage.',
          toolCalls: [],
          replay: {},
        };
      },
    }),
  };
});

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  secretGet: async (key: string) => (h.keys && key.includes('anthropic') ? 'sk-test' : null),
  storeGetJson: async () => null,
}));

const {
  StackDriver,
  IMAGE_NOT_SENT,
  IMAGE_NOT_SENT_FALLBACK,
  IMAGES_NOT_SENT_FALLBACK,
  ASK_STOP_LINE,
} = await import('../src/drivers/stackDriver.js');
const { harborRef } = await import('../src/lib/stack.js');
const { heldImageModel, imageAskDetail } = await import('../src/lib/imageNote.js');
const { thisDeviceNoun } = await import('../src/lib/deviceNoun.js');
import type { AppStack, StackModelRef } from '../src/lib/stack.js';
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
  h.local = {};
  h.openai.length = 0;
});

describe('an image when no local model can see', () => {
  it('asks with a cloud card and sends nothing until the tap', async () => {
    const { driver, events } = chat(localOnly);
    driver.send('Who is this?', [photo]);
    await settle();
    const ask = asked(events);
    // The card names the model the image would go to: the Claude model that
    // costs the person least, never the top of the lineup, the same name the
    // Stack's Image reading row shows (D13, 2026-10-07).
    expect(ask?.request).toMatchObject({
      kind: 'cloud-spend',
      risk: 'cloud-spend',
      summary: 'Read this image with Claude Haiku 5.5?',
    });
    expect(ask?.request.detail).toContain('Nothing in Stack is set for Image reading');
    // The turn waits on the tap with no timer, so the card says Stop skips it,
    // in the same paragraph: a line break would set the card's words as a
    // code block, cut at the sheet's edge on a phone.
    expect(ask?.request.detail).toContain(ASK_STOP_LINE);
    expect(ask?.request.detail).not.toContain('\n');
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
    expect(h.models).toEqual(['claude-haiku-5-5']);
    // Nothing is set for Image reading, so the line says so and names the
    // reader and the connection it runs on (2026-10-07).
    expect(
      events.some(
        (e) =>
          e.type === 'status' &&
          e.message ===
            'No image model is set in Stack, so Claude Haiku 5.5 reads this image on your Claude connection.',
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

describe('an image when nothing here can read it (2026-10-07)', () => {
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

  it('names Offline as what holds reading back, even with nothing set up', async () => {
    h.keys = false;
    const driver = new StackDriver(localOnly, 'offline');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('Who is this?', [photo]);
    await settle();
    expect(events.find((e) => e.type === 'image-reader-offer')).toEqual({
      type: 'image-reader-offer',
      from: 'image',
      cloud: 'none',
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

// A model set for Image reading that is not reading this picture (follow-up,
// 2026-10-08). The card shows with a model set there only when that model
// cannot take the picture: a model on this device (none reads images on this
// build), or one that does not read images. Out of reach cannot ask here,
// since every reader leaves the device and reach is the status's alone, so
// nothing can read and the offer answers instead. The card names the model
// and why, never "Nothing in Stack is set for Image reading".
describe('an image when a model set for Image reading cannot read it', () => {
  const sonar: StackModelRef = {
    kind: 'cloud',
    provider: 'perplexity',
    model: 'sonar',
    label: 'Sonar',
  };

  it('names a model on this device and why it is not reading', async () => {
    const { driver, events } = chat({
      reasoning: harborRef(),
      active: [{ ref: harborRef(), placement: { category: 'vision' } }],
      saved: {},
    });
    driver.send('Who is this?', [photo]);
    await settle();
    const detail = asked(events)?.request.detail ?? '';
    expect(detail).toBe(
      `Harbor Lite is set for Image reading, but it cannot read images on ${thisDeviceNoun()}, so this image would go to Claude Haiku 5.5 on your own API key. Nothing is sent until you approve. Set a model that reads images for Image reading in Stack and images go to it without asking. ${ASK_STOP_LINE}`,
    );
    expect(detail).not.toContain('Nothing in Stack is set');
    expect(h.streams).toBe(0);
    driver.dispose();
  });

  it('names a cloud model that does not read images', async () => {
    const { driver, events } = chat({
      reasoning: harborRef(),
      active: [{ ref: sonar, placement: { category: 'vision' } }],
      saved: {},
    });
    driver.send('Who is this?', [photo]);
    await settle();
    expect(asked(events)?.request.detail).toMatch(
      /^Sonar is set for Image reading, but it does not read images, so this image would go to Claude Haiku 5\.5 on your own API key\./,
    );
    driver.dispose();
  });

  it('reads the slots in order and skips one that can read', () => {
    const all = () => true;
    expect(heldImageModel({ reasoning: harborRef(), active: [], saved: {} }, all)).toBeUndefined();
    const both: AppStack = {
      reasoning: harborRef(),
      active: [
        { ref: sonar, placement: { category: 'vision' } },
        { ref: harborRef(), placement: { category: 'vision' } },
      ],
      saved: {},
    };
    // Local leads: the model on this device is named first.
    expect(heldImageModel(both, all)).toEqual({ model: 'Harbor Lite', why: 'device' });
    const llava: StackModelRef = {
      kind: 'byom',
      id: 'byom-llava',
      label: 'LLaVA 7B',
      baseUrl: 'http://box:11434/v1',
      model: 'llava:7b',
    };
    const own: AppStack = {
      reasoning: harborRef(),
      active: [{ ref: llava, placement: { category: 'vision' } }],
      saved: {},
    };
    expect(heldImageModel(own, all)).toBeUndefined();
    expect(heldImageModel(own, () => false)).toEqual({ model: 'LLaVA 7B', why: 'out-of-reach' });
  });

  it('says when a model out of reach takes pictures again, never to set another', () => {
    const haiku: StackModelRef = {
      kind: 'cloud',
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      label: 'Claude Haiku 5.5',
    };
    expect(imageAskDetail(haiku, 2, { model: 'LLaVA 7B', why: 'out-of-reach' }, 'Offline')).toBe(
      'LLaVA 7B is set for Image reading, but it is out of reach while Offline, so these 2 images would go to Claude Haiku 5.5 on your own API key. Nothing is sent until you approve. Once LLaVA 7B is in reach, images go to it without asking.',
    );
    // Nothing set keeps its words.
    expect(imageAskDetail(haiku, 1)).toBe(
      'Nothing in Stack is set for Image reading, so this image would go to Claude Haiku 5.5 on your own API key. Nothing is sent until you approve. Set a model for Image reading in Stack and images go to it without asking.',
    );
  });
});

// Image reading falls back once (UX and copy review, 2026-10-08, K): when the Local
// model errors on a picture before writing anything and the Cloud slot holds
// a model that reads images and is in reach, a card (amber for a cloud
// model) asks before the picture goes to it. A no sends nothing; a stop, a
// Local model that wrote something, or no Cloud slot shows no card.
describe('an image the Local model fails on', () => {
  const llava: StackModelRef = {
    kind: 'byom',
    id: 'byom-llava',
    label: 'Home LLaVA',
    baseUrl: 'http://192.168.1.20:11434/v1',
    model: 'llava:13b',
  };
  const sonnet: StackModelRef = {
    kind: 'cloud',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    label: 'Sonnet 5',
  };
  const both: AppStack = {
    reasoning: harborRef(),
    active: [
      { ref: llava, placement: { category: 'vision' } },
      { ref: sonnet, placement: { category: 'vision' } },
    ],
    saved: {},
  };
  const done = (events: DriverEvent[]) =>
    events.findLast((e) => e.type === 'task-done') as
      { type: 'task-done'; reason: string; message?: string } | undefined;

  it('asks before the picture goes to the Cloud model, and reads it there on a yes', async () => {
    h.local = { 'llava:13b': 'fail' };
    const { driver, events } = chat(both);
    driver.send('Who is this?', [photo]);
    await settle();
    // The Local model was asked first, and nothing has gone to Claude.
    expect(h.openai).toEqual(['llava:13b']);
    expect(h.streams).toBe(0);
    const ask = asked(events);
    expect(ask?.request).toMatchObject({
      kind: 'cloud-spend',
      toolName: 'analyzeImage',
      risk: 'cloud-spend',
      summary: 'Read this image with Sonnet 5?',
    });
    expect(ask?.request.detail).toBe(
      `Home LLaVA could not read it. Sonnet 5, your Cloud model for Image reading, reads it on your Claude connection. Nothing is sent without this approval. ${ASK_STOP_LINE}`,
    );
    expect(events.some((e) => e.type === 'task-done')).toBe(false);

    driver.answerApproval(ask!.request.id, { approve: true });
    await settle();
    expect(h.models).toEqual(['claude-sonnet-5']);
    expect(
      events.some((e) => e.type === 'status' && e.message === 'Reading this image with Sonnet 5.'),
    ).toBe(true);
    expect(events.findLast((e) => e.type === 'turn-start')).toMatchObject({
      model: 'Sonnet 5',
      providerKind: 'cloud',
    });
    const final = events.findLast((e) => e.type === 'text-final') as { text: string };
    expect(final.text).toBe('That is Jimi Hendrix.');
    expect(done(events)).toMatchObject({ reason: 'complete' });
    // Once per picture: one card, no second fallback.
    expect(events.filter((e) => e.type === 'approval-request')).toHaveLength(1);
    driver.dispose();
  });

  it('says "these images" and "them" for several', async () => {
    h.local = { 'llava:13b': 'fail' };
    const { driver, events } = chat(both);
    driver.send('Who are these?', [photo, { ...photo, id: 'a2' }]);
    await settle();
    expect(asked(events)?.request.summary).toBe('Read these 2 images with Sonnet 5?');
    expect(asked(events)?.request.detail).toBe(
      `Home LLaVA could not read them. Sonnet 5, your Cloud model for Image reading, reads them on your Claude connection. Nothing is sent without this approval. ${ASK_STOP_LINE}`,
    );
    driver.answerApproval(asked(events)!.request.id, { approve: true });
    await settle();
    expect(
      events.some(
        (e) => e.type === 'status' && e.message === 'Reading these 2 images with Sonnet 5.',
      ),
    ).toBe(true);
    driver.dispose();
  });

  it('sends nothing on a no', async () => {
    h.local = { 'llava:13b': 'fail' };
    const { driver, events } = chat(both);
    driver.send('Who is this?', [photo]);
    await settle();
    driver.answerApproval(asked(events)!.request.id, { approve: false });
    await settle();
    expect(h.streams).toBe(0);
    expect(done(events)).toEqual({
      type: 'task-done',
      reason: 'declined',
      message: IMAGE_NOT_SENT_FALLBACK,
    });
    // Both slots are set, so the line never tells the person to set one.
    expect(IMAGE_NOT_SENT_FALLBACK).toBe('You declined, so the image was not sent.');
    expect(IMAGE_NOT_SENT.startsWith(IMAGE_NOT_SENT_FALLBACK)).toBe(true);
    driver.dispose();
  });

  it('says the images were not sent, for several, on a no', async () => {
    h.local = { 'llava:13b': 'fail' };
    const { driver, events } = chat(both);
    driver.send('Who are these?', [photo, { ...photo, id: 'a2' }]);
    await settle();
    driver.answerApproval(asked(events)!.request.id, { approve: false });
    await settle();
    expect(h.streams).toBe(0);
    expect(done(events)).toMatchObject({ reason: 'declined', message: IMAGES_NOT_SENT_FALLBACK });
    expect(IMAGES_NOT_SENT_FALLBACK).toBe('You declined, so the images were not sent.');
    driver.dispose();
  });

  it('a stop while the card is up ends the turn without sending', async () => {
    h.local = { 'llava:13b': 'fail' };
    const { driver, events } = chat(both);
    driver.send('Who is this?', [photo]);
    await settle();
    expect(asked(events)).toBeDefined();
    driver.abort();
    await settle();
    expect(h.streams).toBe(0);
    expect(done(events)).toMatchObject({ reason: 'aborted' });
    driver.dispose();
  });

  it('never calls the Cloud model when the Local model reads it', async () => {
    const { driver, events } = chat(both);
    driver.send('Who is this?', [photo]);
    await settle();
    expect(h.openai).toEqual(['llava:13b']);
    expect(h.streams).toBe(0);
    expect(asked(events)).toBeUndefined();
    const final = events.findLast((e) => e.type === 'text-final') as { text: string };
    expect(final.text).toBe('A guitar on a stage.');
    expect(done(events)).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });

  it('shows no card for a stop while the Local model reads', async () => {
    h.local = { 'llava:13b': 'hang' };
    const { driver, events } = chat(both);
    driver.send('Who is this?', [photo]);
    await settle();
    driver.abort();
    await settle();
    expect(asked(events)).toBeUndefined();
    expect(h.streams).toBe(0);
    expect(done(events)).toMatchObject({ reason: 'aborted' });
    driver.dispose();
  });

  it('shows no card when the Local model failed after it wrote something', async () => {
    h.local = { 'llava:13b': 'partial' };
    const { driver, events } = chat(both);
    driver.send('Who is this?', [photo]);
    await settle();
    expect(asked(events)).toBeUndefined();
    expect(h.streams).toBe(0);
    expect(done(events)).toMatchObject({ reason: 'error' });
    const final = events.findLast((e) => e.type === 'text-final') as { text: string };
    expect(final.text).toBe('I can see a');
    driver.dispose();
  });

  it("keeps the Local model's own error with no Cloud slot", async () => {
    h.local = { 'llava:13b': 'fail' };
    const { driver, events } = chat({ ...both, active: [both.active[0]!] });
    driver.send('Who is this?', [photo]);
    await settle();
    expect(asked(events)).toBeUndefined();
    expect(h.streams).toBe(0);
    expect(done(events)).toMatchObject({ reason: 'error' });
    expect(done(events)?.message).toContain('could not read that image');
    driver.dispose();
  });

  it('asks with a plain card for a model you connected in the Cloud slot', async () => {
    const remote: StackModelRef = {
      kind: 'byom',
      id: 'byom-remote',
      label: 'Remote VL',
      baseUrl: 'https://models.example.com/v1',
      model: 'remote-vl',
    };
    h.local = { 'llava:13b': 'fail' };
    const { driver, events } = chat({
      ...both,
      active: [both.active[0]!, { ref: remote, placement: { category: 'vision' } }],
    });
    driver.send('Who is this?', [photo]);
    await settle();
    expect(asked(events)?.request).toMatchObject({
      kind: 'tool',
      toolName: 'analyzeImage',
      risk: 'network',
      summary: 'Read this image with Remote VL?',
    });
    expect(asked(events)?.request.detail).toBe(
      `Home LLaVA could not read it. Remote VL, the model you connected for Image reading, reads it. Nothing is sent without this approval. ${ASK_STOP_LINE}`,
    );
    driver.answerApproval(asked(events)!.request.id, { approve: true });
    await settle();
    expect(h.openai).toEqual(['llava:13b', 'remote-vl']);
    expect(done(events)).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });

  it("ends with the Cloud model's own error when it fails too, with no second card", async () => {
    const remote: StackModelRef = {
      kind: 'byom',
      id: 'byom-remote',
      label: 'Remote VL',
      baseUrl: 'https://models.example.com/v1',
      model: 'remote-vl',
    };
    h.local = { 'llava:13b': 'fail', 'remote-vl': 'fail' };
    const { driver, events } = chat({
      ...both,
      active: [both.active[0]!, { ref: remote, placement: { category: 'vision' } }],
    });
    driver.send('Who is this?', [photo]);
    await settle();
    driver.answerApproval(asked(events)!.request.id, { approve: true });
    await settle();
    expect(events.filter((e) => e.type === 'approval-request')).toHaveLength(1);
    expect(done(events)).toMatchObject({ reason: 'error' });
    driver.dispose();
  });
});
