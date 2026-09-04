// Harbor's web-search loop: a SEARCH: line is a control message, not a real
// reply, and it must never leak into the visible transcript; the search runs
// at most once per user turn even if the model keeps asking.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callbacks, generateCalls, searchMock, loadSearchKeyMock } = vi.hoisted(() => ({
  callbacks: {} as Record<string, (payload: any) => void>,
  generateCalls: [] as Array<{ requestId: string }>,
  searchMock: vi.fn(),
  loadSearchKeyMock: vi.fn(),
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
  loadSearchKey: loadSearchKeyMock,
  webSearch: searchMock,
  formatSearchResults: (query: string, results: unknown[]) =>
    `RESULTS for ${query}: ${results.length}`,
}));

const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');
const { HARBOR_MODEL_ID } = await import('../src/lib/harbor.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('OnDeviceDriver web search loop (Harbor)', () => {
  beforeEach(() => {
    generateCalls.length = 0;
    searchMock.mockReset();
    loadSearchKeyMock.mockReset();
    loadSearchKeyMock.mockResolvedValue(undefined);
  });

  it('detects a SEARCH: line, searches, and continues with the real answer', async () => {
    searchMock.mockResolvedValue([{ title: 'T', url: 'https://u', snippet: 'S' }]);
    const events: any[] = [];
    const driver = new OnDeviceDriver(HARBOR_MODEL_ID, 'Harbor');
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

  it('never triggers search for Harbor Light, only Harbor', async () => {
    const { HARBOR_MINI_MODEL_ID } = await import('../src/lib/harborMini.js');
    const events: any[] = [];
    const driver = new OnDeviceDriver(HARBOR_MINI_MODEL_ID, 'Harbor Light');
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
