// Every local model searches the web (founder, 2026-09-25): a pocket model in a
// Stack chat, your own model server (BYOM), and the desktop's free chat all ask
// with one SEARCH: line and get results from the Settings provider. The line
// never reaches the screen, the search runs once per message, and on the
// Offline profile the model is told plainly it has no web access.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { NO_SEARCH_NOTE, SEARCH_PROTOCOL_NOTE } from 'os-code/protocol';

const h = vi.hoisted(() => ({
  callbacks: {} as Record<string, (payload: any) => void>,
  generateCalls: [] as Array<{ requestId: string; system: string; messages: unknown[] }>,
  searchMock: vi.fn(),
  nativeReplies: [] as string[],
  nativeBodies: [] as Array<{ messages: Array<{ role: string; content: unknown }> }>,
}));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async (event: string, cb: (payload: any) => void) => {
      h.callbacks[event] = cb;
      return { remove: async () => {} };
    },
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async (opts: { requestId: string; system: string; messages: unknown[] }) => {
      h.generateCalls.push(opts);
      return { started: true };
    },
  },
}));

vi.mock('../src/lib/webSearch.js', () => ({
  resolveSearchKey: async () => undefined,
  webSearch: h.searchMock,
  formatSearchResults: (query: string, results: unknown[]) =>
    `RESULTS for ${query}: ${results.length}`,
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  secretGet: async () => null,
  storeGetJson: async () => null,
}));

vi.mock('../src/lib/nativeFetch.js', () => ({
  nativeFetch: async (_url: string, init: { body: string }) => {
    h.nativeBodies.push(JSON.parse(init.body));
    const content = h.nativeReplies.shift() ?? '';
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  },
}));

const { StackDriver } = await import('../src/drivers/stackDriver.js');
const { DesktopChatDriver } = await import('../src/drivers/desktopChatDriver.js');
const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');
const { HARBOR_MINI_MODEL_ID, HARBOR_MINI_MODEL_NAME } = await import('../src/lib/harborMini.js');
import type { AppStack } from '../src/lib/stack.js';
import type { ProfileId } from '../src/lib/profiles.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
};

const pocket: AppStack = {
  reasoning: { kind: 'device', modelId: 'qwen-pocket', modelName: 'Pocket' },
  active: [],
  saved: {},
};

function stackChat(stack: AppStack, profile: ProfileId) {
  const driver = new StackDriver(stack, profile);
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return { driver, events };
}

function reply(index: number, text: string, stopReason = 'end') {
  const { requestId } = h.generateCalls[index]!;
  h.callbacks.token!({ requestId, delta: text });
  h.callbacks.generationDone!({ requestId, stopReason });
}

const shownText = (events: DriverEvent[]) =>
  events
    .filter((e) => e.type === 'text-delta')
    .map((e) => (e as { text: string }).text)
    .join('');

beforeEach(() => {
  h.generateCalls.length = 0;
  h.nativeReplies.length = 0;
  h.nativeBodies.length = 0;
  h.searchMock.mockReset();
  h.searchMock.mockResolvedValue([{ title: 'T', url: 'https://u', snippet: 'S' }]);
});

describe('a pocket model in a Stack chat', () => {
  it('asks with a SEARCH: line, gets results, and answers for real', async () => {
    const { driver, events } = stackChat(pocket, 'offshore');
    driver.send('what is the tide at noon today?');
    await settle();
    expect(h.generateCalls).toHaveLength(1);
    expect(h.generateCalls[0]!.system).toContain(SEARCH_PROTOCOL_NOTE);

    reply(0, 'SEARCH: tide at noon today');
    await settle();
    expect(h.searchMock).toHaveBeenCalledWith('tide at noon today', undefined);
    expect(events.some((e) => e.type === 'citations')).toBe(true);
    expect(h.generateCalls).toHaveLength(2);
    expect(JSON.stringify(h.generateCalls[1]!.messages)).toContain(
      'RESULTS for tide at noon today',
    );

    reply(1, 'High tide is at noon.');
    await settle();
    expect(shownText(events)).not.toContain('SEARCH');
    const final = events.findLast((e) => e.type === 'text-final') as { text: string };
    expect(final.text).toBe('High tide is at noon.');
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });

  it('searches once per message, even when the model asks again', async () => {
    const { driver, events } = stackChat(pocket, 'offshore');
    driver.send('question');
    await settle();
    reply(0, 'SEARCH: first');
    await settle();
    reply(1, 'SEARCH: second');
    await settle();
    expect(h.searchMock).toHaveBeenCalledTimes(1);
    expect(h.generateCalls).toHaveLength(2);
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });

  it('a normal reply streams untouched and never searches', async () => {
    const { driver, events } = stackChat(pocket, 'offshore');
    driver.send('hello');
    await settle();
    reply(0, 'Sure, happy to help.');
    await settle();
    expect(h.searchMock).not.toHaveBeenCalled();
    expect(shownText(events)).toBe('Sure, happy to help.');
    driver.dispose();
  });

  it('is told plainly it has no web access on the Offline profile', async () => {
    const { driver } = stackChat(pocket, 'offline');
    driver.send('what is the tide at noon today?');
    await settle();
    expect(h.generateCalls[0]!.system).toContain(NO_SEARCH_NOTE);
    expect(h.generateCalls[0]!.system).not.toContain(SEARCH_PROTOCOL_NOTE);
    reply(0, 'SEARCH: tide');
    await settle();
    expect(h.searchMock).not.toHaveBeenCalled();
    driver.dispose();
  });
});

describe('Harbor Lite in a Stack chat', () => {
  it('gets a web question searched for it before it writes a word', async () => {
    const stack: AppStack = {
      reasoning: {
        kind: 'device',
        modelId: HARBOR_MINI_MODEL_ID,
        modelName: HARBOR_MINI_MODEL_NAME,
      },
      active: [],
      saved: {},
    };
    const { driver, events } = stackChat(stack, 'offshore');
    driver.send('Who won the 2022 World Cup?');
    await settle();
    expect(h.searchMock).toHaveBeenCalledTimes(1);
    expect(h.searchMock.mock.calls[0]![2]).toBe(3);
    expect(events.some((e) => e.type === 'citations')).toBe(true);
    expect(h.generateCalls).toHaveLength(1);
    driver.dispose();
  });
});

describe('your own model (BYOM) in a Stack chat', () => {
  const byom: AppStack = {
    reasoning: {
      kind: 'byom',
      id: 'byom-ollama',
      label: 'Ollama',
      baseUrl: 'http://box:11434/v1',
      model: 'llama3.1',
    },
    active: [],
    saved: {},
  };

  it('searches on a SEARCH: line and answers from the results', async () => {
    h.nativeReplies.push('', 'SEARCH: node 24 release date', 'Node 24 shipped in May.');
    const { driver, events } = stackChat(byom, 'offshore');
    driver.send('when did node 24 ship?');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
    expect(h.searchMock).toHaveBeenCalledWith('node 24 release date', undefined);
    const answerPass = h.nativeBodies.at(-1)!;
    expect(String(answerPass.messages[0]!.content)).toContain(SEARCH_PROTOCOL_NOTE);
    expect(String(answerPass.messages.at(-1)!.content)).toContain('RESULTS for node 24');
    expect(shownText(events)).not.toContain('SEARCH');
    const final = events.findLast((e) => e.type === 'text-final') as { text: string };
    expect(final.text).toBe('Node 24 shipped in May.');
    driver.dispose();
  });
});

describe("the desktop's free chat", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function sse(frames: string[]): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const f of frames) controller.enqueue(enc.encode(`data: ${f}\n\n`));
        controller.close();
      },
    });
    return { ok: true, status: 200, body } as unknown as Response;
  }
  const text = (delta: string) => JSON.stringify({ type: 'text', delta });

  it('asks the daemon for the instruction, searches from the phone, and answers', async () => {
    const replies = [
      sse([text('SEAR'), text('CH: jimi hendrix'), JSON.stringify({ type: 'done' })]),
      sse([text('Jimi Hendrix was a guitarist.'), JSON.stringify({ type: 'done' })]),
    ];
    const spy = vi.fn(async () => replies.shift()!);
    globalThis.fetch = spy as unknown as typeof fetch;
    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('who was jimi hendrix?');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));

    expect(h.searchMock).toHaveBeenCalledWith('jimi hendrix', undefined);
    expect(spy).toHaveBeenCalledTimes(2);
    const first = JSON.parse(
      (spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(first.search).toBe(true);
    const second = JSON.parse(
      (spy.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(second.messages.at(-1).content).toContain('RESULTS for jimi hendrix');
    expect(shownText(events)).toBe('Jimi Hendrix was a guitarist.');
    expect(events.find((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
  });
});

describe('a pocket model in its own chat', () => {
  it('searches too, not only Harbor', async () => {
    const driver = new OnDeviceDriver('qwen-pocket', 'Pocket');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    await tick();
    driver.send('what is new in swift 6?');
    await settle();
    expect(h.generateCalls[0]!.system).toContain(SEARCH_PROTOCOL_NOTE);
    reply(0, 'SEARCH: swift 6 new features');
    await settle();
    expect(h.searchMock).toHaveBeenCalledWith('swift 6 new features', undefined);
    expect(h.generateCalls).toHaveLength(2);
    expect(shownText(events)).not.toContain('SEARCH');
    driver.dispose();
  });
});
