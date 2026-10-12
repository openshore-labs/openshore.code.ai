// The search turn, done once (build 2026-09-29, A4; drivers/searchTurn.ts).
// Every driver that speaks the SEARCH: protocol (a pocket model in a Stack
// chat or its own, your own model server, the desktop's free chat) keeps the
// filter on for the answer pass too, so a second search line never prints; a
// declined search is never offered, so it costs one generation; the answer
// pass reads that its search is spent; the desktop is sent search: false for
// it; and once the answer is in, history keeps one line for the search, not
// the raw results.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { NO_SEARCH_NOTE, SEARCHED_NOTE, SEARCH_PROTOCOL_NOTE } from 'os-code/protocol';

const h = vi.hoisted(() => ({
  callbacks: {} as Record<string, (payload: any) => void>,
  generates: [] as Array<{ requestId: string; system: string; messages: unknown[] }>,
  search: vi.fn(),
  stream: vi.fn(),
  // The search service a search resolves to; undefined is DuckDuckGo.
  key: undefined as undefined | { backend: string; apiKey: string },
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
      h.generates.push(opts);
      return { started: true };
    },
  },
}));
vi.mock('../src/lib/webSearch.js', () => ({
  resolveSearchKey: async () => h.key,
  webSearch: h.search,
  formatSearchResults: (query: string) => `RESULTS for ${query}: page one, page two.`,
}));
vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  secretGet: async () => null,
  storeGetJson: async () => null,
}));
vi.mock('../src/lib/streamingFetch.js', () => ({ streamingFetch: h.stream }));

const { StackDriver } = await import('../src/drivers/stackDriver.js');
const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');
const { DesktopChatDriver } = await import('../src/drivers/desktopChatDriver.js');
const { SearchTurn, searchedLine } = await import('../src/drivers/searchTurn.js');
const { setSearchConsent } = await import('../src/lib/localSearch.js');
const { forgetDeviceModel } = await import('../src/drivers/deviceModel.js');
const { HARBOR_MINI_MODEL_ID, HARBOR_MINI_MODEL_NAME } = await import('../src/lib/harborMini.js');
import type { AppStack } from '../src/lib/stack.js';

const enc = new TextEncoder();
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await tick();
};

const pocket: AppStack = {
  reasoning: { kind: 'device', modelId: 'qwen-pocket', modelName: 'Pocket' },
  active: [],
  saved: {},
};
const box: AppStack = {
  reasoning: {
    kind: 'byom',
    id: 'box',
    label: 'Box',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.2:3b',
  },
  active: [],
  saved: {},
};

function collect(driver: { subscribe(s: (e: DriverEvent) => void): unknown }) {
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return events;
}
const shown = (events: DriverEvent[]) =>
  events
    .filter((e) => e.type === 'text-delta')
    .map((e) => (e as { text: string }).text)
    .join('');
const lastDone = (events: DriverEvent[]) => events.findLast((e) => e.type === 'task-done');

function reply(index: number, text: string) {
  const { requestId } = h.generates[index]!;
  h.callbacks.token!({ requestId, delta: text });
  h.callbacks.generationDone!({ requestId, stopReason: 'end' });
}

/** An OpenAI-style streamed reply. */
function oai(text: string): Response {
  const frames = [`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`];
  return sseBody(frames);
}
/** The desktop daemon's streamed reply. */
function desk(text: string): Response {
  return sseBody([`data: ${JSON.stringify({ type: 'text', delta: text })}\n\n`]);
}
function sseBody(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}
const bodyOf = (i: number) =>
  JSON.parse((h.stream.mock.calls[i]![1] as RequestInit).body as string) as {
    messages: Array<{ role: string; content: string }>;
    search?: boolean;
    context?: string;
  };

beforeEach(() => {
  h.generates.length = 0;
  h.search.mockReset();
  h.search.mockResolvedValue([{ title: 'T', url: 'https://u', snippet: 'S' }]);
  h.stream.mockReset();
  forgetDeviceModel();
  setSearchConsent(async () => true);
  h.key = undefined;
});
afterEach(() => {
  setSearchConsent(async () => true);
});

describe('a second SEARCH: line never prints', () => {
  it('a pocket model in a Stack chat', async () => {
    const driver = new StackDriver(pocket, 'offshore');
    const events = collect(driver);
    driver.send('what is the tide?');
    await settle();
    reply(0, 'SEARCH: tide');
    await settle();
    reply(1, 'SEARCH: tide again\nMade-up results.');
    await settle();
    expect(shown(events)).toBe('');
    expect(h.search).toHaveBeenCalledTimes(1);
    expect(h.generates).toHaveLength(2);
    expect(lastDone(events)).toMatchObject({ reason: 'error' });
    driver.dispose();
  });

  it('your own model in a Stack chat', async () => {
    h.stream
      .mockResolvedValueOnce(oai('SEARCH: node 24'))
      .mockResolvedValueOnce(oai('SEARCH: node 24 again'));
    const driver = new StackDriver(box, 'offshore');
    const events = collect(driver);
    driver.send('when did node 24 ship?');
    await vi.waitFor(() => expect(lastDone(events)).toBeDefined());
    expect(shown(events)).toBe('');
    expect(h.stream).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).messages[0]!.content).toContain(SEARCHED_NOTE);
    expect(lastDone(events)).toMatchObject({ reason: 'error' });
    driver.dispose();
  });

  it('a pocket model in its own chat', async () => {
    const driver = new OnDeviceDriver('qwen-pocket', 'Pocket');
    const events = collect(driver);
    await tick();
    driver.send('what is new in swift 6?');
    await settle();
    reply(0, 'SEARCH: swift 6');
    await settle();
    expect(h.generates[1]!.system).toContain(SEARCHED_NOTE);
    expect(h.generates[1]!.system).not.toContain(SEARCH_PROTOCOL_NOTE);
    reply(1, 'SEARCH: swift 6 again');
    await settle();
    expect(shown(events)).toBe('');
    expect(h.generates).toHaveLength(2);
    expect(lastDone(events)).toMatchObject({ reason: 'error' });
    driver.dispose();
  });

  it("the desktop's free chat, which is sent search: false for the answer pass", async () => {
    h.stream
      .mockResolvedValueOnce(desk('SEARCH: jimi hendrix'))
      .mockResolvedValueOnce(desk('SEARCH: jimi hendrix again'));
    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const events = collect(driver);
    driver.send('who was jimi hendrix?');
    await vi.waitFor(() => expect(lastDone(events)).toBeDefined());
    expect(bodyOf(0).search).toBe(true);
    expect(bodyOf(1).search).toBe(false);
    expect(bodyOf(1).context).toContain(SEARCHED_NOTE);
    expect(shown(events)).toBe('');
    expect(h.search).toHaveBeenCalledTimes(1);
    expect(lastDone(events)).toMatchObject({ reason: 'error' });
    driver.dispose();
  });
});

describe('a declined search costs one generation', () => {
  beforeEach(() => {
    setSearchConsent(async () => false, { allowed: () => 'declined' });
  });

  it('a pocket model is told it has no web, and answers in one pass', async () => {
    const driver = new StackDriver(pocket, 'offshore');
    const events = collect(driver);
    driver.send('what is the tide?');
    await settle();
    expect(h.generates[0]!.system).toContain(NO_SEARCH_NOTE);
    expect(h.generates[0]!.system).not.toContain(SEARCH_PROTOCOL_NOTE);
    reply(0, 'I cannot look that up, but tides run twice a day.');
    await settle();
    expect(h.generates).toHaveLength(1);
    expect(lastDone(events)).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });

  it('a model that asks anyway is never shown the line and never run twice', async () => {
    const driver = new OnDeviceDriver('qwen-pocket', 'Pocket');
    const events = collect(driver);
    await tick();
    driver.send('what is the tide?');
    await settle();
    expect(h.generates[0]!.system).toContain(NO_SEARCH_NOTE);
    reply(0, 'SEARCH: tide');
    await settle();
    expect(h.generates).toHaveLength(1);
    expect(h.search).not.toHaveBeenCalled();
    expect(shown(events)).toBe('');
    driver.dispose();
  });

  it("the desktop's free chat is sent search: false", async () => {
    h.stream.mockResolvedValueOnce(desk('Tides run twice a day.'));
    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const events = collect(driver);
    driver.send('what is the tide?');
    await vi.waitFor(() => expect(lastDone(events)).toBeDefined());
    expect(h.stream).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).search).toBe(false);
    expect(bodyOf(0).context).toContain(NO_SEARCH_NOTE);
    driver.dispose();
  });

  it("Harbor Lite's guide harness gets the real reach, and does not search offline", async () => {
    setSearchConsent(async () => true, { online: () => false });
    const driver = new OnDeviceDriver(HARBOR_MINI_MODEL_ID, HARBOR_MINI_MODEL_NAME);
    collect(driver);
    await tick();
    driver.send('Who won the 2022 World Cup?');
    await settle();
    expect(h.search).not.toHaveBeenCalled();
    expect(h.generates).toHaveLength(1);
    driver.dispose();
  });
});

describe('the results turn does not persist', () => {
  it('a Stack seat: the next request carries one line for the search, not the results', async () => {
    h.stream
      .mockResolvedValueOnce(oai('SEARCH: node 24'))
      .mockResolvedValueOnce(oai('Node 24 shipped in May.'))
      .mockResolvedValueOnce(oai('You are welcome.'));
    const driver = new StackDriver(box, 'offshore');
    const events = collect(driver);
    driver.send('when did node 24 ship?');
    await vi.waitFor(() => expect(lastDone(events)).toMatchObject({ reason: 'complete' }));
    // The answer pass read the results.
    expect(JSON.stringify(bodyOf(1).messages)).toContain('RESULTS for node 24');
    driver.send('thanks');
    await vi.waitFor(() => expect(h.stream).toHaveBeenCalledTimes(3));
    const next = JSON.stringify(bodyOf(2).messages);
    expect(next).not.toContain('RESULTS for node 24');
    expect(next).toContain(JSON.stringify(searchedLine('node 24')).slice(1, -1));
    expect(next).toContain('Node 24 shipped in May.');
    driver.dispose();
  });

  it('a pocket model: history keeps the line, not the results', async () => {
    const driver = new StackDriver(pocket, 'offshore');
    collect(driver);
    driver.send('what is the tide?');
    await settle();
    reply(0, 'SEARCH: tide');
    await settle();
    reply(1, 'High tide is at noon.');
    await settle();
    driver.send('and low tide?');
    await settle();
    const next = JSON.stringify(h.generates[2]!.messages);
    expect(next).not.toContain('RESULTS for tide');
    expect(next).toContain('searched the web for');
    expect(next).toContain('High tide is at noon.');
    driver.dispose();
  });

  it("the desktop's free chat re-sends the line, not the results", async () => {
    h.stream
      .mockResolvedValueOnce(desk('SEARCH: jimi hendrix'))
      .mockResolvedValueOnce(desk('A guitarist.'))
      .mockResolvedValueOnce(desk('Sure.'));
    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const events = collect(driver);
    driver.send('who was jimi hendrix?');
    await vi.waitFor(() => expect(lastDone(events)).toMatchObject({ reason: 'complete' }));
    driver.send('thanks');
    await vi.waitFor(() => expect(h.stream).toHaveBeenCalledTimes(3));
    const next = JSON.stringify(bodyOf(2).messages);
    expect(next).not.toContain('RESULTS for jimi hendrix');
    expect(next).toContain('searched the web for');
    driver.dispose();
  });
});

describe('SearchTurn', () => {
  it('offers, spends, and refuses by the rules', () => {
    const turn = new SearchTurn();
    turn.begin();
    expect(turn.note(true)).toBe(SEARCH_PROTOCOL_NOTE);
    expect(turn.note(false)).toBe(NO_SEARCH_NOTE);
    turn.startPass();
    expect(turn.push('SEARCH: x')).toBe('');
    expect(turn.decide(false)).toEqual({ kind: 'refused' });
    turn.startPass();
    turn.push('Sure.');
    expect(turn.decide(true)).toEqual({ kind: 'answer', flush: '' });
  });

  it('replaces only the results this message pushed', async () => {
    const turn = new SearchTurn();
    turn.begin();
    const results = await turn.run('q', false, () => undefined);
    expect(turn.searched).toBe(true);
    expect(turn.note(true)).toBe(SEARCHED_NOTE);
    expect(turn.mayAsk(true)).toBe(false);
    const history = [
      { role: 'user' as const, content: results },
      { role: 'user' as const, content: 'q' },
      { role: 'user' as const, content: results },
    ];
    turn.settle(history);
    expect(history.map((m) => m.content)).toEqual([results, 'q', searchedLine('q')]);
  });
});

// Once a chat on a seat that stays on this network holds a private note's
// text (UX and copy review, 2026-10-08, H), a search the model writes asks every time,
// with the exact words; one bound for Perplexity does not run; a seat that
// leaves, never sent the note, keeps today's ask.
describe('a search after a private read, on every driver that searches', () => {
  type Ask = { query: string; ask?: { afterPrivate?: true; cause?: string; service?: string } };
  let asks: Ask[];
  beforeEach(() => {
    asks = [];
    setSearchConsent(async (query, ask) => {
      asks.push({ query, ...(ask ? { ask } : {}) });
      return true;
    });
  });
  const marked = [
    { role: 'user' as const, text: 'what does my diary say?' },
    { role: 'assistant' as const, text: 'The secret is teal.', localOnly: true as const },
  ];

  it('a pocket model in a Stack chat that read a private turn', async () => {
    const driver = new StackDriver(pocket, 'offshore', {}, marked);
    collect(driver);
    driver.send('what is the tide?');
    await settle();
    reply(0, 'SEARCH: tide');
    await settle();
    expect(asks).toEqual([
      { query: 'tide', ask: expect.objectContaining({ afterPrivate: true, cause: 'read' }) },
    ]);
    expect(asks[0]!.ask!.service).toBe('DuckDuckGo');
    expect(h.search).toHaveBeenCalledTimes(1);
    reply(1, 'High tide is at noon.');
    await settle();
    driver.send('and tomorrow?');
    await settle();
    reply(2, 'SEARCH: tide tomorrow');
    await settle();
    expect(asks.map((a) => a.ask?.afterPrivate)).toEqual([true, true]);
    driver.dispose();
  });

  it('your own model in a Stack chat that stays here, and not one that leaves', async () => {
    h.stream.mockResolvedValueOnce(oai('SEARCH: node 24')).mockResolvedValueOnce(oai('Soon.'));
    const stays = new StackDriver(box, 'offshore', {}, marked, {
      packSeat: () => ({ modelClass: 'small', servedTokens: 8192, leavesNetwork: false }),
    });
    const events = collect(stays);
    stays.send('when did node 24 ship?');
    await vi.waitFor(() => expect(lastDone(events)).toBeDefined());
    expect(asks).toEqual([
      { query: 'node 24', ask: expect.objectContaining({ afterPrivate: true, cause: 'read' }) },
    ]);
    stays.dispose();

    asks = [];
    h.stream.mockResolvedValueOnce(oai('SEARCH: node 24')).mockResolvedValueOnce(oai('Soon.'));
    const leaves = new StackDriver(box, 'offshore', {}, marked, {
      packSeat: () => ({ modelClass: 'small', servedTokens: 8192, leavesNetwork: true }),
    });
    const left = collect(leaves);
    leaves.send('when did node 24 ship?');
    await vi.waitFor(() => expect(lastDone(left)).toBeDefined());
    expect(asks).toEqual([{ query: 'node 24' }]);
    leaves.dispose();
  });

  it('a Stack seat refuses a search bound for Perplexity, before any ask', async () => {
    h.key = { backend: 'perplexity', apiKey: 'pplx' };
    const driver = new StackDriver(pocket, 'offshore', { researchOn: true }, marked);
    const events = collect(driver);
    driver.send('what is the tide?');
    await settle();
    reply(0, 'SEARCH: tide');
    await settle();
    expect(asks).toEqual([]);
    expect(h.search).not.toHaveBeenCalled();
    const line = 'This chat has read a private note, so this step is not handed to a cloud model.';
    expect(events.some((e) => e.type === 'status' && e.message === line)).toBe(true);
    expect(JSON.stringify(h.generates[1]!.messages)).toContain(
      `Not run: ${line} Answer from what you have.`,
    );
    driver.dispose();
  });

  it("the desktop's free chat, by the card its computer sent", async () => {
    const card = (pinOnly: boolean) =>
      `data: ${JSON.stringify({
        type: 'context-pack',
        seat: 'local',
        mode: 'full',
        tokens: 10,
        budgetTokens: 100,
        sources: [
          { layer: 'pin', path: 'Private/Plan.md', title: 'Plan', project: true, localOnly: true },
          ...(pinOnly
            ? []
            : [{ layer: 'search', path: 'Journal/Day.md', title: 'Day', localOnly: true }]),
        ],
        withheld: 0,
        cold: false,
        localOnly: true,
      })}\n\n`;
    const search = `data: ${JSON.stringify({ type: 'text', delta: 'SEARCH: jimi hendrix' })}\n\n`;
    h.stream
      .mockResolvedValueOnce(sseBody([card(true), search]))
      .mockResolvedValueOnce(desk('A guitarist.'));
    const pinned = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const events = collect(pinned);
    pinned.send('who was jimi hendrix?');
    await vi.waitFor(() => expect(lastDone(events)).toBeDefined());
    expect(asks).toEqual([
      { query: 'jimi hendrix', ask: expect.objectContaining({ afterPrivate: true, cause: 'pin' }) },
    ]);
    pinned.dispose();

    asks = [];
    h.stream
      .mockResolvedValueOnce(sseBody([card(false), search]))
      .mockResolvedValueOnce(desk('A guitarist.'));
    const read = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const readEvents = collect(read);
    read.send('who was jimi hendrix?');
    await vi.waitFor(() => expect(lastDone(readEvents)).toBeDefined());
    expect(asks[0]!.ask).toMatchObject({ afterPrivate: true, cause: 'read' });
    read.dispose();
  });

  it("the desktop's free chat keeps today's ask in a clean chat", async () => {
    h.stream
      .mockResolvedValueOnce(desk('SEARCH: jimi hendrix'))
      .mockResolvedValueOnce(desk('A guitarist.'));
    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const events = collect(driver);
    driver.send('who was jimi hendrix?');
    await vi.waitFor(() => expect(lastDone(events)).toBeDefined());
    expect(asks).toEqual([{ query: 'jimi hendrix' }]);
    driver.dispose();
  });
});
