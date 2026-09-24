// Harbor Lite's driver runs the guide harness before every reply: a factual
// question the app facts do not cover is searched on the web (DuckDuckGo by
// default) and cited, a failed search is said plainly, an app question never
// leaves the phone, and a coding ask ends with the honest past-my-size note.
import { afterEach, describe, expect, it, vi } from 'vitest';

const { handlers, generated, searches, searchFails } = vi.hoisted(() => ({
  handlers: new Map<string, (data: unknown) => void>(),
  generated: [] as Array<{ requestId: string; system: string }>,
  searches: [] as string[],
  searchFails: { on: false },
}));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async (event: string, cb: (data: unknown) => void) => {
      handlers.set(event, cb);
      return { remove: async () => {} };
    },
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async (opts: { requestId: string; system: string }) => {
      generated.push(opts);
      return { started: true };
    },
  },
}));

vi.mock('../src/lib/webSearch.js', () => ({
  resolveSearchKey: async () => undefined,
  webSearch: async (query: string) => {
    searches.push(query);
    if (searchFails.on) throw new Error('offline');
    return [
      {
        title: 'Canberra',
        url: 'https://example.com/canberra',
        snippet: 'Canberra is the capital.',
      },
    ];
  },
  formatSearchResults: () => '',
}));

const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');
const { forgetDeviceModel } = await import('../src/drivers/deviceModel.js');
const { HARBOR_MINI_MODEL_ID, HARBOR_MINI_MODEL_NAME } = await import('../src/lib/harborMini.js');
const { STRETCH_NOTE } = await import('../src/lib/guideHarness.js');

const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

type Seen = { type: string; message?: string; citations?: unknown[] };

async function ask(text: string, reply = 'Here you go.') {
  const driver = new OnDeviceDriver(HARBOR_MINI_MODEL_ID, HARBOR_MINI_MODEL_NAME);
  const seen: Seen[] = [];
  driver.subscribe((e) => seen.push(e as Seen));
  await tick();
  driver.send(text);
  await tick();
  const req = generated.at(-1)!;
  handlers.get('token')!({ requestId: req.requestId, delta: reply });
  handlers.get('generationDone')!({ requestId: req.requestId, stopReason: 'end' });
  await tick();
  driver.dispose();
  return { seen, system: req.system };
}

afterEach(() => {
  generated.length = 0;
  searches.length = 0;
  searchFails.on = false;
  forgetDeviceModel();
});

describe('Harbor Lite through the guide harness', () => {
  it('searches the web for a factual question, says so, and cites the results', async () => {
    const { seen, system } = await ask('What is the capital of Australia?');
    expect(searches).toEqual(['What is the capital of Australia']);
    expect(seen.some((e) => e.type === 'status' && /Searching the web/.test(e.message ?? ''))).toBe(
      true,
    );
    expect(seen.find((e) => e.type === 'citations')?.citations).toHaveLength(1);
    expect(system).toContain('[1] Canberra');
  });

  it('says plainly when the search could not run', async () => {
    searchFails.on = true;
    const { system, seen } = await ask('What is the capital of Australia?');
    expect(system).toMatch(/could not reach/);
    expect(seen.find((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
  });

  it('never searches for a question about the app, and hands over the right facts', async () => {
    const { system } = await ask('How does Your stack work?');
    expect(searches).toEqual([]);
    expect(system).toContain('Reasoning LLM');
  });

  it('works out a setup from the equipment described', async () => {
    const { system } = await ask('I have a laptop with 16GB of RAM, what should I run?');
    expect(system).toContain('Qwen 2.5 Coder 7B');
  });

  it('ends a coding ask with the honest past-my-size note', async () => {
    const { seen } = await ask('Write a Python function that parses a CSV file');
    const note = seen.find((e) => e.type === 'note');
    expect(note?.message).toBe(STRETCH_NOTE);
  });
});
