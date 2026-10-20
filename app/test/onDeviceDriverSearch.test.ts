// Harbor's web-search loop: a SEARCH: line is a control message, not a real
// reply, and it must never leak into the visible transcript; the search runs
// at most once per user turn even if the model keeps asking.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callbacks, generateCalls, searchMock, resolveSearchKeyMock } = vi.hoisted(() => ({
  callbacks: {} as Record<string, (payload: any) => void>,
  generateCalls: [] as Array<{ requestId: string; system: string }>,
  searchMock: vi.fn(),
  resolveSearchKeyMock: vi.fn(),
}));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async (event: string, cb: (payload: any) => void) => {
      callbacks[event] = cb;
      return { remove: async () => {} };
    },
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async (opts: { requestId: string; system: string }) => {
      generateCalls.push(opts);
    },
  },
}));

vi.mock('../src/lib/webSearch.js', () => ({
  resolveSearchKey: resolveSearchKeyMock,
  webSearch: searchMock,
  formatSearchResults: (query: string, results: unknown[]) =>
    `RESULTS for ${query}: ${results.length}`,
}));

const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');
const { HARBOR_MODEL_ID } = await import('../src/lib/harbor.js');
const { SEARCHED_NOTE } = await import('os-code/protocol');

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('OnDeviceDriver web search loop (Harbor)', () => {
  beforeEach(() => {
    generateCalls.length = 0;
    searchMock.mockReset();
    resolveSearchKeyMock.mockReset();
    resolveSearchKeyMock.mockResolvedValue(undefined);
  });

  it('detects a SEARCH: line, searches, and continues with the real answer', async () => {
    searchMock.mockResolvedValue([{ title: 'T', url: 'https://u', snippet: 'S' }]);
    const events: any[] = [];
    const driver = new OnDeviceDriver(HARBOR_MODEL_ID, 'Harbor');
    driver.subscribe((e) => events.push(e));
    await tick();

    // A request, not a question, so the model decides whether to search.
    driver.send('Tell me the latest on X');
    await tick();
    expect(generateCalls).toHaveLength(1);

    callbacks.token!({ requestId: generateCalls[0]!.requestId, delta: 'SEARCH: latest on X' });
    callbacks.generationDone!({ requestId: generateCalls[0]!.requestId, stopReason: 'end' });
    await tick();
    await tick();

    expect(searchMock).toHaveBeenCalledWith('latest on X', undefined);
    expect(generateCalls).toHaveLength(2);
    expect(events.some((e) => e.type === 'citations')).toBe(true);
    expect(events.some((e) => e.type === 'text-final' && e.text.includes('SEARCH:'))).toBe(false);

    callbacks.token!({ requestId: generateCalls[1]!.requestId, delta: 'X is doing well.' });
    callbacks.generationDone!({ requestId: generateCalls[1]!.requestId, stopReason: 'end' });
    await tick();
    await tick();

    const final = events.find((e) => e.type === 'text-final');
    expect(final?.text).toBe('X is doing well.');
    expect(events.some((e) => e.type === 'task-done' && e.reason === 'complete')).toBe(true);
  });

  it('never searches twice in the same turn even if the model asks again', async () => {
    searchMock.mockResolvedValue([]);
    const driver = new OnDeviceDriver(HARBOR_MODEL_ID, 'Harbor');
    driver.subscribe(() => {});
    await tick();

    driver.send('question');
    await tick();
    callbacks.token!({ requestId: generateCalls[0]!.requestId, delta: 'SEARCH: first' });
    callbacks.generationDone!({ requestId: generateCalls[0]!.requestId, stopReason: 'end' });
    await tick();
    await tick();

    callbacks.token!({ requestId: generateCalls[1]!.requestId, delta: 'SEARCH: second' });
    callbacks.generationDone!({ requestId: generateCalls[1]!.requestId, stopReason: 'end' });
    await tick();
    await tick();

    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(generateCalls).toHaveLength(2);
  });

  it('never takes a SEARCH: line from Harbor Lite (its guide harness searches for it)', async () => {
    const { HARBOR_MINI_MODEL_ID } = await import('../src/lib/harborMini.js');
    const events: any[] = [];
    const driver = new OnDeviceDriver(HARBOR_MINI_MODEL_ID, 'Harbor Lite');
    driver.subscribe((e) => events.push(e));
    await tick();

    driver.send('question');
    await tick();
    callbacks.token!({ requestId: generateCalls[0]!.requestId, delta: 'SEARCH: anything' });
    callbacks.generationDone!({ requestId: generateCalls[0]!.requestId, stopReason: 'end' });
    await tick();
    await tick();

    expect(searchMock).not.toHaveBeenCalled();
    expect(generateCalls).toHaveLength(1);
    const final = events.find((e) => e.type === 'text-final');
    expect(final?.text).toBe('SEARCH: anything');
  });
});

// Once a chat on a model that stays on this network holds a private note's
// text (UX and copy review, 2026-10-08, H), every search that model writes asks
// first, every time, on a card with the exact words and why; Perplexity, a
// model off this network, is refused before any ask; a clean chat and Harbor
// Lite's search of the person's own question keep today's ask.
describe('a search after a private read', () => {
  type Ask = { query: string; ask?: Record<string, unknown> };
  let asks: Ask[];
  let answer: boolean;

  beforeEach(async () => {
    generateCalls.length = 0;
    searchMock.mockReset();
    searchMock.mockResolvedValue([{ title: 'T', url: 'https://u', snippet: 'S' }]);
    resolveSearchKeyMock.mockReset();
    resolveSearchKeyMock.mockResolvedValue(undefined);
    asks = [];
    answer = true;
    const { setSearchConsent } = await import('../src/lib/localSearch.js');
    setSearchConsent(async (query, ask) => {
      asks.push({ query, ...(ask ? { ask: ask as unknown as Record<string, unknown> } : {}) });
      return answer;
    });
  });

  const privatePack = (pinOnly = false) => ({
    prepare: async () => {},
    render: () => ({
      text: 'VAULT NOTES. <note path="Private/Diary.md">x</note>',
      localOnly: true as const,
      ...(pinOnly ? { pinOnly: true as const } : {}),
    }),
  });

  async function ask(driver: InstanceType<typeof OnDeviceDriver>, query: string, at: number) {
    driver.send(`tell me about ${query}`);
    await tick();
    await tick();
    callbacks.token!({ requestId: generateCalls[at]!.requestId, delta: `SEARCH: ${query}` });
    callbacks.generationDone!({ requestId: generateCalls[at]!.requestId, stopReason: 'end' });
    for (let i = 0; i < 6; i++) await tick();
  }
  function answerWith(at: number, text: string) {
    callbacks.token!({ requestId: generateCalls[at]!.requestId, delta: text });
    callbacks.generationDone!({ requestId: generateCalls[at]!.requestId, stopReason: 'end' });
  }
  const sentTo = (at: number) =>
    JSON.stringify((generateCalls[at] as unknown as { messages: unknown[] }).messages);

  it('asks on a card with the exact words and why, every time', async () => {
    const driver = new OnDeviceDriver(
      HARBOR_MODEL_ID,
      'Harbor',
      undefined,
      false,
      undefined,
      'c1',
      {
        vaultPack: privatePack(),
      },
    );
    driver.subscribe(() => {});
    await tick();
    await ask(driver, 'tide times', 0);
    expect(asks).toEqual([
      {
        query: 'tide times',
        ask: {
          afterPrivate: true,
          cause: 'read',
          service: 'DuckDuckGo',
          card: {
            summary: 'Search DuckDuckGo for "tide times"',
            detail:
              'This chat has read a private note. These words go to DuckDuckGo as written, so check that they carry nothing from it. Nothing is sent without this approval.',
          },
        },
      },
    ]);
    expect(searchMock).toHaveBeenCalledTimes(1);
    answerWith(1, 'High tide is at noon.');
    for (let i = 0; i < 4; i++) await tick();
    // The next search asks again: a yes was for that search only.
    await ask(driver, 'moon phase', 2);
    expect(asks.map((a) => a.query)).toEqual(['tide times', 'moon phase']);
    expect(asks[1]!.ask).toMatchObject({ afterPrivate: true, cause: 'read' });
    driver.dispose();
  });

  it("names the project's pin when that is all the chat holds", async () => {
    const driver = new OnDeviceDriver(
      HARBOR_MODEL_ID,
      'Harbor',
      undefined,
      false,
      undefined,
      'c2',
      {
        vaultPack: privatePack(true),
      },
    );
    driver.subscribe(() => {});
    await tick();
    await ask(driver, 'tide times', 0);
    expect(asks[0]!.ask).toMatchObject({
      cause: 'pin',
      card: {
        detail:
          'A private note is pinned to this project. These words go to DuckDuckGo as written, so check that they carry nothing from it. Nothing is sent without this approval.',
      },
    });
    driver.dispose();
  });

  it('sends nothing on a no, and tells the model it was kept off the web', async () => {
    answer = false;
    const driver = new OnDeviceDriver(HARBOR_MODEL_ID, 'Harbor', [
      { role: 'user', text: 'what does my diary say?' },
      { role: 'assistant', text: 'It says the secret is teal.', localOnly: true },
    ]);
    driver.subscribe(() => {});
    await tick();
    await ask(driver, 'teal', 0);
    expect(asks).toHaveLength(1);
    expect(searchMock).not.toHaveBeenCalled();
    expect(sentTo(1)).toContain(
      'Not run: the person kept this off the web. Answer from what you have.',
    );
    driver.dispose();
  });

  it('refuses a search bound for Perplexity before any ask', async () => {
    resolveSearchKeyMock.mockResolvedValue({ backend: 'perplexity', apiKey: 'pplx' });
    const events: any[] = [];
    const driver = new OnDeviceDriver(HARBOR_MODEL_ID, 'Harbor', undefined, true, undefined, 'c3', {
      vaultPack: privatePack(),
    });
    driver.subscribe((e) => events.push(e));
    await tick();
    await ask(driver, 'tide times', 0);
    expect(asks).toEqual([]);
    expect(searchMock).not.toHaveBeenCalled();
    const line = 'This chat has read a private note, so this step is not handed to a cloud model.';
    expect(events.some((e) => e.type === 'status' && e.message === line)).toBe(true);
    expect(sentTo(1)).toContain(`Not run: ${line} Answer from what you have.`);
    driver.dispose();
  });

  it("keeps today's ask in a clean chat", async () => {
    const driver = new OnDeviceDriver(HARBOR_MODEL_ID, 'Harbor');
    driver.subscribe(() => {});
    await tick();
    await ask(driver, 'tide times', 0);
    expect(asks).toEqual([{ query: 'tide times' }]);
    expect(searchMock).toHaveBeenCalledTimes(1);
    driver.dispose();
  });

  it("leaves Harbor Lite's search of the person's own question as it was", async () => {
    const { HARBOR_MINI_MODEL_ID } = await import('../src/lib/harborMini.js');
    const driver = new OnDeviceDriver(HARBOR_MINI_MODEL_ID, 'Harbor Lite', [
      { role: 'user', text: 'what does my diary say?' },
      { role: 'assistant', text: 'It says the secret is teal.', localOnly: true },
    ]);
    driver.subscribe(() => {});
    await tick();
    driver.send('Who won the 2022 World Cup?');
    for (let i = 0; i < 6; i++) await tick();
    expect(asks.length).toBeGreaterThan(0);
    expect(asks.every((a) => a.ask === undefined)).toBe(true);
    driver.dispose();
  });

  it('searches a question about the world before Harbor writes a word', async () => {
    searchMock.mockResolvedValue([{ title: 'FIFA', url: 'https://fifa.com', snippet: 'Spain won.' }]);
    const events: any[] = [];
    const driver = new OnDeviceDriver(HARBOR_MODEL_ID, 'Harbor');
    driver.subscribe((e) => events.push(e));
    await tick();

    driver.send('Who won the 2026 FIFA World Cup?');
    await tick();
    await tick();

    expect(searchMock).toHaveBeenCalledWith('Who won the 2026 FIFA World Cup?', undefined);
    // One pass, told it already searched: no SEARCH: round trip.
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]!.system).toContain(SEARCHED_NOTE);
    expect(events.some((e) => e.type === 'citations')).toBe(true);

    callbacks.token!({ requestId: generateCalls[0]!.requestId, delta: 'Spain won.' });
    callbacks.generationDone!({ requestId: generateCalls[0]!.requestId, stopReason: 'end' });
    await tick();
    expect(events.find((e) => e.type === 'text-final')?.text).toBe('Spain won.');
  });

  it('answers a how-to, a coding request and an app question without searching first', async () => {
    for (const ask of [
      'How do I check which version of Git is installed?',
      'Write a JavaScript function that reverses a string.',
      'What does the Vault do?',
    ]) {
      generateCalls.length = 0;
      searchMock.mockReset();
      const driver = new OnDeviceDriver(HARBOR_MODEL_ID, 'Harbor');
      driver.subscribe(() => {});
      await tick();
      driver.send(ask);
      await tick();
      await tick();
      expect(searchMock, ask).not.toHaveBeenCalled();
      expect(generateCalls, ask).toHaveLength(1);
    }
  });
});
