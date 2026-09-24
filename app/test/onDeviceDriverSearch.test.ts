// Harbor's web-search loop: a SEARCH: line is a control message, not a real
// reply, and it must never leak into the visible transcript; the search runs
// at most once per user turn even if the model keeps asking.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callbacks, generateCalls, searchMock, resolveSearchKeyMock } = vi.hoisted(() => ({
  callbacks: {} as Record<string, (payload: any) => void>,
  generateCalls: [] as Array<{ requestId: string }>,
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
    generate: async (opts: { requestId: string }) => {
      generateCalls.push(opts);
    },
  },
}));

vi.mock('../src/lib/webSearch.js', () => ({
  resolveSearchKey: resolveSearchKeyMock,
  webSearch: searchMock,
  formatSearchResults: (query: string, results: unknown[]) =>
    `RESULTS for ${query}: ${results.length}`,
  searchServiceLabel: (backend?: string) => (backend === 'brave' ? 'Brave Search' : 'DuckDuckGo'),
  SEARCH_DECLINED_NOTE: 'DECLINED: no search happened.',
}));

const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');
const { HARBOR_MODEL_ID } = await import('../src/lib/harbor.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
const askOff = () => false;
const askOn = () => true;

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
    const driver = new OnDeviceDriver(
      HARBOR_MODEL_ID,
      'Harbor',
      undefined,
      false,
      undefined,
      askOff,
    );
    driver.subscribe((e) => events.push(e));
    await tick();

    driver.send('what is the latest on X?');
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
    const driver = new OnDeviceDriver(
      HARBOR_MODEL_ID,
      'Harbor',
      undefined,
      false,
      undefined,
      askOff,
    );
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

  it('never triggers search for Harbor Lite, only Harbor', async () => {
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

  // Ask first (advisory org, 2026-09-24): with "Ask before searching the web"
  // on, the query and the service are shown on a card, and nothing leaves the
  // phone until Search.
  describe('with Ask before searching the web on', () => {
    const askSearch = async (events: any[]) => {
      const driver = new OnDeviceDriver(
        HARBOR_MODEL_ID,
        'Harbor',
        undefined,
        false,
        undefined,
        askOn,
      );
      driver.subscribe((e) => events.push(e));
      await tick();
      driver.send('what is new in vite?');
      await tick();
      callbacks.token!({ requestId: generateCalls[0]!.requestId, delta: 'SEARCH: vite 7 news' });
      callbacks.generationDone!({ requestId: generateCalls[0]!.requestId, stopReason: 'end' });
      await tick();
      await tick();
      return driver;
    };

    it('shows the query and the service on a card before anything leaves', async () => {
      const events: any[] = [];
      await askSearch(events);
      const ask = events.find((e) => e.type === 'approval-request');
      expect(ask?.request).toMatchObject({
        toolName: 'webSearch',
        risk: 'network',
        summary: 'Search the web for: vite 7 news',
      });
      expect(ask.request.detail).toContain('DuckDuckGo');
      expect(ask.request.grant).toBeUndefined();
      expect(searchMock).not.toHaveBeenCalled();
      expect(generateCalls).toHaveLength(1);
    });

    it('searches only on Search', async () => {
      searchMock.mockResolvedValue([{ title: 'T', url: 'https://u', snippet: 'S' }]);
      const events: any[] = [];
      const driver = await askSearch(events);
      const ask = events.find((e) => e.type === 'approval-request');
      driver.answerApproval(ask.request.id, { approve: true });
      await tick();
      await tick();
      expect(searchMock).toHaveBeenCalledWith('vite 7 news', undefined);
      expect(events.some((e) => e.type === 'approval-resolved' && e.approved)).toBe(true);
      expect(generateCalls).toHaveLength(2);
    });

    it('Not now continues the turn, telling the model no search happened', async () => {
      const events: any[] = [];
      const driver = await askSearch(events);
      const ask = events.find((e) => e.type === 'approval-request');
      driver.answerApproval(ask.request.id, { approve: false });
      await tick();
      await tick();
      expect(searchMock).not.toHaveBeenCalled();
      expect(generateCalls).toHaveLength(2);
      const second = generateCalls[1] as unknown as { messages: Array<{ content: string }> };
      expect(second.messages.at(-1)?.content).toBe('DECLINED: no search happened.');
      expect(events.some((e) => e.type === 'approval-resolved' && !e.approved)).toBe(true);
    });

    it('a stop while the card is up ends the turn without searching', async () => {
      const events: any[] = [];
      const driver = await askSearch(events);
      driver.abort();
      await tick();
      expect(searchMock).not.toHaveBeenCalled();
      expect(events.some((e) => e.type === 'task-done' && e.reason === 'aborted')).toBe(true);
    });

    it('names the configured service', async () => {
      resolveSearchKeyMock.mockResolvedValue({ backend: 'brave', apiKey: 'k' });
      const events: any[] = [];
      await askSearch(events);
      const ask = events.find((e) => e.type === 'approval-request');
      expect(ask.request.detail).toContain('Brave Search');
    });
  });
});
