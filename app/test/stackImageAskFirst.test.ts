// An image in a Stack chat (founder, 2026-09-25): "Ask first unless the stack
// has a model there that is dedicated to image reading, then it's just
// automatic." Any other reader, a connected cloud model filling the gap or an
// anchor that can see, waits on a card the person taps (tenet 4): nothing is
// sent before Approve, a No ends the turn plainly, a stop counts as a No.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest, DriverEvent } from 'os-code/protocol';

const h = vi.hoisted(() => ({ streams: 0 }));

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class Anthropic {
    static APIUserAbortError = class extends Error {};
    static AuthenticationError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    messages = {
      stream: () => {
        h.streams++;
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
  secretGet: async (key: string) => (key.includes('anthropic') ? 'sk-test' : null),
  storeGetJson: async () => null,
}));

const { StackDriver, IMAGE_NOT_SENT } = await import('../src/drivers/stackDriver.js');
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
});

describe('an image when no local model can see', () => {
  it('asks with a cloud card and sends nothing until the tap', async () => {
    const { driver, events } = chat(localOnly);
    driver.send('Who is this?', [photo]);
    await settle();
    const ask = asked(events);
    expect(ask?.request).toMatchObject({
      kind: 'cloud-spend',
      risk: 'cloud-spend',
      summary: 'Read this image with Claude?',
    });
    expect(ask?.request.detail).toContain('Nothing in Stack is set for Image reading');
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
    expect(
      events.some((e) => e.type === 'status' && /Reading this image with Claude/.test(e.message)),
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
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
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
