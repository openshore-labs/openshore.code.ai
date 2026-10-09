// Any address (bring your own keys, Part 2, 2026-10-09): the Stack's Connect
// a model takes a name, an address, a format, an optional key and the mark for
// an address that passes requests on to a cloud provider, then reads the
// address's own model list (on a clock) and lets the person tick several. Each
// tick is its own connection, sharing an addressId; with no list, a typed
// model name is the way on. Plain http to an address outside your own network
// is refused before anything is sent. Mounted in a real DOM so the taps are a
// person's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const h = vi.hoisted(() => ({
  native: vi.fn(),
  secrets: new Map<string, string>(),
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => false,
  isPhone: () => true,
  dataUnlockState: async () => 'ok',
  openExternal: () => {},
  openInAppBrowser: () => {},
  storeGetJson: async () => undefined,
  storeSetJson: async () => {},
  storeGet: async () => null,
  storeSet: async () => {},
  storeDelete: async () => {},
  sealExistingKeys: async () => {},
  secretGet: async (k: string) => h.secrets.get(k) ?? null,
  secretSet: async (k: string, v: string) => void h.secrets.set(k, v),
  secretDelete: async (k: string) => void h.secrets.delete(k),
}));
vi.mock('../src/lib/nativeFetch.js', () => ({ nativeFetch: h.native }));
vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

const dom: TestDom = await mountDom();
const { useApp } = await import('../src/state/store.js');
const { StackManager } = await import('../src/components/StackManager.js');
const { byomListRequest, readByomModels, BYOM_LIST_TIMEOUT_MS } =
  await import('../src/lib/byomList.js');
const { byomConnectionsFor, byomSiblings } = await import('../src/state/byomOps.js');
const { BYOM_FORWARDS_NAME, byomRef, normalizeAnthropicBase, normalizeByomBase } =
  await import('../src/lib/byom.js');
const { VAULT_PRIVATE_OFF_MARKED } = await import('../src/lib/vaultCopy.js');
const { MODEL_CHECKLIST_SEARCH_FROM } = await import('../src/components/ModelChecklist.js');

const OPENAI_PLACEHOLDER = 'https://your-host/v1';
const ANTHROPIC_PLACEHOLDER = 'https://your-host';

/** A list answer. */
const answer = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  h.native.mockReset();
  h.secrets.clear();
  useApp.setState({
    view: 'stack',
    viewTrail: [],
    connectedProviders: {},
    connectivity: { homeReachable: false, online: true },
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
});
afterEach(async () => {
  await dom.render(null);
});

/** The ledger rows, by label. */
const rows = () =>
  [...dom.container.querySelectorAll<HTMLElement>('.settings-row')].map((el) => ({
    label: el.querySelector('.settings-row-label')?.textContent ?? '',
    sub: el.querySelector('.settings-row-sub')?.textContent ?? '',
    el,
  }));

async function tapRow(label: string): Promise<void> {
  const row = rows().find((r) => r.label === label);
  if (!row) throw new Error(`No "${label}" row in: ${rows().map((r) => r.label)}`);
  const { act } = await import('react');
  await act(async () => {
    row.el.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

/** Tap a button found by its role and name. */
async function tap(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('nothing to tap');
  const { act } = await import('react');
  await act(async () => {
    el.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

/** Tick a model in the list by its id, the way a finger does. */
async function tick(id: string): Promise<void> {
  const row = [...dom.container.querySelectorAll<HTMLElement>('.live-model-row')].find((r) =>
    r.querySelector('.sub')?.textContent?.startsWith(id),
  );
  const box = row?.querySelector('input') as HTMLInputElement | null;
  if (!box) throw new Error(`No "${id}" in the list`);
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'checked')?.set;
  const { act } = await import('react');
  await act(async () => {
    if (set) set.call(box, !box.checked);
    else box.checked = !box.checked;
    box.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

const primary = () =>
  dom.container.querySelector('.sheet:not(.closing) .btn.primary') as HTMLButtonElement;
const listed = () =>
  [...dom.container.querySelectorAll('.live-model-row .sub')].map((e) => e.textContent ?? '');

async function openConnect(): Promise<void> {
  await dom.render(<StackManager />);
  await tapRow('Connect a model');
}

describe('reading the list an address offers', () => {
  it('asks an OpenAI-format address for /models with a Bearer key', () => {
    expect(byomListRequest('https://host/v1/', 'openai', ' sk-1 ')).toEqual({
      url: 'https://host/v1/models',
      headers: { authorization: 'Bearer sk-1' },
    });
    expect(byomListRequest('http://192.168.1.20:11434/v1', 'openai')).toEqual({
      url: 'http://192.168.1.20:11434/v1/models',
      headers: {},
    });
  });

  it('asks an Anthropic-format address for /v1/models with x-api-key and its version', () => {
    for (const pasted of [
      'https://gw.example.com',
      'https://gw.example.com/',
      'https://gw.example.com/v1',
      'https://gw.example.com/v1/messages',
    ]) {
      expect(byomListRequest(pasted, 'anthropic', 'sk-ant')).toEqual({
        url: 'https://gw.example.com/v1/models?limit=1000',
        headers: { 'anthropic-version': '2023-06-01', 'x-api-key': 'sk-ant' },
      });
    }
    expect(byomListRequest('https://gw.example.com', 'anthropic').headers).toEqual({
      'anthropic-version': '2023-06-01',
    });
    expect(normalizeAnthropicBase(' https://gw.example.com/v1/messages/ ')).toBe(
      'https://gw.example.com',
    );
    expect(normalizeByomBase('https://host/v1/chat/completions', 'openai')).toBe('https://host/v1');
    expect(normalizeByomBase('https://host/v1', 'anthropic')).toBe('https://host');
  });

  it('reads either shape with the shared reader, on a clock', async () => {
    h.native.mockResolvedValueOnce(
      answer({
        data: [
          { type: 'model', id: 'claude-on-bedrock', display_name: 'Claude on Bedrock' },
          { type: 'model', id: 'gpt-on-azure', display_name: 'GPT on Azure' },
        ],
        has_more: false,
      }),
    );
    const models = await readByomModels('https://gw.example.com/v1', 'anthropic', 'sk');
    expect(models?.map((m) => [m.id, m.label])).toEqual([
      ['claude-on-bedrock', 'Claude on Bedrock'],
      ['gpt-on-azure', 'GPT on Azure'],
    ]);
    expect(h.native).toHaveBeenCalledWith('https://gw.example.com/v1/models?limit=1000', {
      method: 'GET',
      headers: { 'anthropic-version': '2023-06-01', 'x-api-key': 'sk' },
      responseType: 'json',
      timeoutMs: BYOM_LIST_TIMEOUT_MS,
    });
    // A plain OpenAI list, an embedding model left out.
    h.native.mockResolvedValueOnce(
      answer({ object: 'list', data: [{ id: 'qwen3:8b' }, { id: 'nomic-embed-text' }] }),
    );
    expect((await readByomModels('http://localhost:11434/v1', 'openai'))?.map((m) => m.id)).toEqual(
      ['qwen3:8b'],
    );
  });

  it('says a refusal as one, and has no list on a failure, a timeout or an empty answer', async () => {
    // A wrong or missing key is the key to fix, not a list that is missing.
    h.native.mockResolvedValueOnce(answer({ error: 'no' }, 401));
    expect(await readByomModels('https://host/v1', 'openai')).toBe('refused');
    h.native.mockResolvedValueOnce(answer({ error: 'no' }, 403));
    expect(await readByomModels('https://host/v1', 'openai', 'sk')).toBe('refused');
    h.native.mockResolvedValueOnce(answer({ error: 'no' }, 404));
    expect(await readByomModels('https://host/v1', 'openai')).toBeUndefined();
    h.native.mockRejectedValueOnce(new Error('timed out'));
    expect(await readByomModels('https://host/v1', 'openai')).toBeUndefined();
    h.native.mockResolvedValueOnce(answer({ data: [] }));
    expect(await readByomModels('https://host/v1', 'openai')).toBeUndefined();
  });
});

describe('the connections one go makes', () => {
  let n = 0;
  const ids = (prefix: string) => `${prefix}${++n}`;

  it('one per model, each once, sharing an addressId', () => {
    n = 0;
    const conns = byomConnectionsFor(
      {
        label: ' Home ',
        baseUrl: 'http://192.168.1.20:11434/v1',
        models: [{ id: 'qwen3:8b' }, { id: ' qwen3:8b ' }, { id: '' }, { id: 'llama3.2:3b' }],
      },
      ids,
    );
    expect(conns).toEqual([
      {
        id: 'byom_2',
        label: 'Home · qwen3:8b',
        baseUrl: 'http://192.168.1.20:11434/v1',
        model: 'qwen3:8b',
        addressId: 'addr_1',
      },
      {
        id: 'byom_3',
        label: 'Home · llama3.2:3b',
        baseUrl: 'http://192.168.1.20:11434/v1',
        model: 'llama3.2:3b',
        addressId: 'addr_1',
      },
    ]);
    expect(
      byomSiblings([...conns, { ...conns[0]!, id: 'x', addressId: 'other' }], conns[1]!),
    ).toEqual(conns);
    expect(byomSiblings(conns, { ...conns[0]!, addressId: undefined })).toHaveLength(1);
  });

  it('one model keeps the typed name, and nothing is made from no model', () => {
    const [only] = byomConnectionsFor({
      label: 'House',
      baseUrl: 'https://h/v1',
      models: [{ id: 'm' }],
    });
    expect(only!.label).toBe('House');
    expect(byomConnectionsFor({ label: 'House', baseUrl: 'https://h/v1', models: [] })).toEqual([]);
  });

  it("this device's own tailnet is your network: its listed window is not kept", () => {
    const pick = [{ id: 'm', contextTokens: 131_072 }];
    const base = 'https://gpu.tail1234.ts.net/v1';
    expect(
      byomConnectionsFor({
        label: 'G',
        baseUrl: base,
        models: pick,
        ownTailnetSuffix: 'tail1234.ts.net',
      })[0]!.contextTokens,
    ).toBeUndefined();
    // Another tailnet's server is someone else's: it serves what it lists.
    expect(
      byomConnectionsFor({ label: 'G', baseUrl: base, models: pick, ownTailnetSuffix: null })[0]!
        .contextTokens,
    ).toBe(131_072);
  });
});

describe('Connect a model, in the Stack', () => {
  it('says any address and either format, on the row and in the sheet', async () => {
    await dom.render(<StackManager />);
    expect(rows().find((r) => r.label === 'Connect a model')!.sub).toBe(
      "Any address, in the OpenAI or the Anthropic format: your own server, a gateway, or another provider's API.",
    );
    await tapRow('Connect a model');
    expect(dom.text()).toContain('Any address you run or hold a key for, in either format');
    const formats = [...dom.container.querySelectorAll('[role="radio"]')].map((b) => [
      b.textContent,
      b.getAttribute('aria-checked'),
    ]);
    expect(formats).toEqual([
      ['OpenAI-compatible', 'true'],
      ['Anthropic-compatible', 'false'],
    ]);
    // Nothing to load until there is an address.
    expect(primary().textContent).toBe('Load models');
    expect(primary().disabled).toBe(true);
    // A name that stands on its own in a sentence (review, 2026-10-09).
    expect(BYOM_FORWARDS_NAME).toBe('Passes requests to a cloud provider');
    expect(dom.container.querySelector('[role="switch"]')?.getAttribute('aria-label')).toBe(
      BYOM_FORWARDS_NAME,
    );
  });

  it('loads the list, takes several ticks, and connects each with its own key copy', async () => {
    await openConnect();
    await dom.type('e.g. Our house model', 'Gateway');
    await dom.type(OPENAI_PLACEHOLDER, 'http://192.168.1.30:4000/v1');
    await dom.type('Leave blank for a keyless local server', 'sk-master');
    await tap(dom.container.querySelector('[role="switch"]'));
    h.native.mockResolvedValueOnce(
      answer({
        data: [
          { id: 'bedrock-claude', context_length: 200_000 },
          { id: 'azure-gpt' },
          { id: 'vertex-gemini' },
        ],
      }),
    );
    await dom.click('Load models');
    await dom.settle();
    expect(h.native.mock.calls[0]![0]).toBe('http://192.168.1.30:4000/v1/models');
    expect(h.native.mock.calls[0]![1]).toMatchObject({
      headers: { authorization: 'Bearer sk-master' },
      timeoutMs: BYOM_LIST_TIMEOUT_MS,
    });
    expect(listed()).toEqual(['bedrock-claude', 'azure-gpt', 'vertex-gemini']);
    // A short list is read at a glance: no search over three rows.
    expect(dom.text()).not.toContain('Search 3 models');
    // Nothing ticked yet: nothing to connect, and the button says no number.
    expect(primary().disabled).toBe(true);
    expect(primary().textContent).toBe('Connect');
    await tick('bedrock-claude');
    await tick('vertex-gemini');
    expect(primary().textContent).toBe('Connect 2 models');
    await dom.click('Connect 2 models');
    await dom.settle();
    const conns = useApp.getState().settings.byomModels ?? [];
    expect(conns.map((c) => c.model)).toEqual(['bedrock-claude', 'vertex-gemini']);
    for (const c of conns) {
      expect(c).toMatchObject({ forwardsToCloud: true, baseUrl: 'http://192.168.1.30:4000/v1' });
      expect(c.addressId).toBe(conns[0]!.addressId);
      expect(h.secrets.get(`oscode.secret.byom.${c.id}`)).toBe('sk-master');
    }
    // Marked as passing requests on: the window the list gives is the one served.
    expect(conns[0]!.contextTokens).toBe(200_000);
    // On the bench, amber.
    const bench = rows().filter((r) => r.label.startsWith('Gateway · '));
    expect(bench.map((r) => r.label)).toEqual([
      'Gateway · bedrock-claude',
      'Gateway · vertex-gemini',
    ]);
    for (const r of bench) expect(r.el.querySelector('.kind-chip')?.textContent).toBe('Cloud');
  });

  it('the Anthropic format asks /v1/models with its headers and saves the root address', async () => {
    await openConnect();
    await dom.type('e.g. Our house model', 'Claude-style');
    await tap(
      [...dom.container.querySelectorAll('[role="radio"]')].find(
        (b) => b.textContent === 'Anthropic-compatible',
      ),
    );
    await dom.type(ANTHROPIC_PLACEHOLDER, 'https://gw.example.com/v1/messages');
    await dom.type('Leave blank for a keyless local server', 'sk-gw');
    h.native.mockResolvedValueOnce(
      answer({ data: [{ type: 'model', id: 'house-claude', display_name: 'House Claude' }] }),
    );
    await dom.click('Load models');
    await dom.settle();
    expect(h.native.mock.calls[0]![0]).toBe('https://gw.example.com/v1/models?limit=1000');
    expect(h.native.mock.calls[0]![1].headers).toEqual({
      'anthropic-version': '2023-06-01',
      'x-api-key': 'sk-gw',
    });
    // One model in the list starts ticked.
    expect(primary().textContent).toBe('Connect');
    await dom.click('Connect');
    await dom.settle();
    const [conn] = useApp.getState().settings.byomModels ?? [];
    expect(conn).toMatchObject({
      label: 'Claude-style',
      baseUrl: 'https://gw.example.com',
      model: 'house-claude',
      wire: 'anthropic',
    });
    expect(conn!.forwardsToCloud).toBeUndefined();
  });

  it('a longer list gets a search', async () => {
    await openConnect();
    await dom.type(OPENAI_PLACEHOLDER, 'http://192.168.1.30:4000/v1');
    const n = MODEL_CHECKLIST_SEARCH_FROM + 1;
    h.native.mockResolvedValueOnce(
      answer({ data: Array.from({ length: n }, (_, i) => ({ id: `m${i}` })) }),
    );
    await dom.click('Load models');
    await dom.settle();
    expect(dom.text()).toContain(`Search ${n} models`);
  });

  it('a refused key is said as one, and the list stays to load again', async () => {
    await openConnect();
    await dom.type('e.g. Our house model', 'Gateway');
    await dom.type(OPENAI_PLACEHOLDER, 'http://192.168.1.30:4000/v1');
    await dom.type('Leave blank for a keyless local server', 'sk-wrong');
    h.native.mockResolvedValueOnce(answer({ error: 'no' }, 401));
    await dom.click('Load models');
    await dom.settle();
    expect(useApp.getState().toast).toContain('That address refused the key.');
    // No typed name on a key just turned down: Load models again.
    expect(primary().textContent).toBe('Load models');
    expect(dom.container.querySelector('#byom-model-id')).toBeNull();
    // With no key at all, it says one is asked for.
    await dom.type('Leave blank for a keyless local server', '');
    h.native.mockResolvedValueOnce(answer({ error: 'no' }, 403));
    await dom.click('Load models');
    await dom.settle();
    expect(useApp.getState().toast).toContain('That address asks for an API key.');
  });

  it('with no list, a typed model name is the way on', async () => {
    await openConnect();
    await dom.type('e.g. Our house model', 'Box');
    await dom.type(OPENAI_PLACEHOLDER, 'http://10.0.0.5:8000/v1');
    h.native.mockRejectedValueOnce(new Error('timed out'));
    await dom.click('Load models');
    await dom.settle();
    expect(listed()).toEqual([]);
    expect(primary().textContent).toBe('Connect');
    expect(primary().disabled).toBe(true);
    await dom.type('e.g. llama-3.1-70b-instruct', 'my-model');
    expect(primary().disabled).toBe(false);
    await dom.click('Connect');
    await dom.settle();
    const [conn] = useApp.getState().settings.byomModels ?? [];
    expect(conn).toMatchObject({ label: 'Box', model: 'my-model' });
    // Keyless: no secret written.
    expect(h.secrets.size).toBe(0);
  });

  it('refuses plain http to an address outside your network before anything is sent', async () => {
    await openConnect();
    await dom.type('e.g. Our house model', 'Somewhere');
    await dom.type(OPENAI_PLACEHOLDER, 'http://api.example.com/v1');
    await dom.type('Leave blank for a keyless local server', 'sk-secret');
    await dom.click('Load models');
    await dom.settle();
    expect(h.native).not.toHaveBeenCalled();
    expect(useApp.getState().toast).toContain(
      'Use an https address for a server outside your own network',
    );
  });

  it('a new address sets the old list aside', async () => {
    await openConnect();
    await dom.type(OPENAI_PLACEHOLDER, 'http://192.168.1.30:4000/v1');
    h.native.mockResolvedValueOnce(answer({ data: [{ id: 'a' }, { id: 'b' }] }));
    await dom.click('Load models');
    await dom.settle();
    expect(listed()).toEqual(['a', 'b']);
    await dom.type(OPENAI_PLACEHOLDER, 'http://192.168.1.31:4000/v1');
    expect(listed()).toEqual([]);
    expect(primary().textContent).toBe('Load models');
  });

  it('a late list for an address since changed is dropped', async () => {
    await openConnect();
    await dom.type(OPENAI_PLACEHOLDER, 'http://192.168.1.30:4000/v1');
    let release: (v: unknown) => void = () => undefined;
    h.native.mockReturnValueOnce(new Promise((r) => (release = r)));
    await dom.click('Load models');
    expect(primary().textContent).toBe('Loading models...');
    await dom.type(OPENAI_PLACEHOLDER, 'http://192.168.1.31:4000/v1');
    release(answer({ data: [{ id: 'stale' }] }));
    await dom.settle();
    expect(listed()).toEqual([]);
    expect(primary().textContent).toBe('Load models');
  });

  it('the forwarding line says when an address already counts as cloud', async () => {
    await openConnect();
    const line = () =>
      dom.container.querySelector('[role="switch"]')?.parentElement?.querySelector('.sub')
        ?.textContent;
    expect(line()).toBe(
      `Turn on for a gateway such as LiteLLM, and it counts as cloud. ${VAULT_PRIVATE_OFF_MARKED}`,
    );
    await dom.type(OPENAI_PLACEHOLDER, 'https://api.example.com/v1');
    expect(line()).toBe('This address is outside your own network, so it already counts as cloud.');
  });
});

describe('How connecting works', () => {
  it('says any address, either format, what the mark does, and opens the gateway guide', async () => {
    const startGuideChat = vi.fn(async () => undefined);
    useApp.setState({ startGuideChat });
    await dom.render(<StackManager />);
    await tapRow('How connecting works');
    const text = dom.text().replace(/\s+/g, ' ');
    expect(text).toContain('Any address works, in either format');
    expect(text).toContain(
      `turn on ${BYOM_FORWARDS_NAME} and it counts as cloud. ${VAULT_PRIVATE_OFF_MARKED}`,
    );
    expect(text).toContain(
      'The API key is stored only on this device and sent only to that address',
    );
    await dom.click('Use Bedrock, Azure, or Vertex');
    expect(startGuideChat).toHaveBeenCalledWith('connect-own-gateway');
  });
});

describe('disconnecting the models from one address', () => {
  it('offers all of them together once there are several', async () => {
    const [a, b] = byomConnectionsFor({
      label: 'Home',
      baseUrl: 'http://192.168.1.20:11434/v1',
      models: [{ id: 'qwen3:8b' }, { id: 'llama3.2:3b' }],
    });
    useApp.setState({
      settings: { ...useApp.getState().settings, byomModels: [a!, b!] },
    });
    h.secrets.set(`oscode.secret.byom.${a!.id}`, 'k');
    h.secrets.set(`oscode.secret.byom.${b!.id}`, 'k');
    await dom.render(<StackManager />);
    await tap(dom.container.querySelector(`[aria-label="Options for ${a!.label}"]`));
    expect(dom.buttons()).toContain('Disconnect all 2 at 192.168.1.20:11434');
    await dom.click('Disconnect all 2 at 192.168.1.20:11434');
    await new Promise((r) => setTimeout(r, 400));
    await dom.settle();
    expect(dom.text()).toContain('Disconnect all 2 at 192.168.1.20:11434?');
    const confirm = [...dom.container.querySelectorAll('.btn.danger')].at(-1);
    await tap(confirm);
    await dom.settle();
    expect(useApp.getState().settings.byomModels ?? []).toEqual([]);
    expect(h.secrets.size).toBe(0);
  });

  it('one of several says only its own copy of the key goes', async () => {
    const [a, b, c] = byomConnectionsFor({
      label: 'Home',
      baseUrl: 'http://192.168.1.20:11434/v1',
      models: [{ id: 'qwen3:8b' }, { id: 'llama3.2:3b' }, { id: 'gemma3:4b' }],
    });
    useApp.setState({
      settings: { ...useApp.getState().settings, byomModels: [a!, b!, c!] },
    });
    for (const x of [a!, b!, c!]) h.secrets.set(`oscode.secret.byom.${x.id}`, 'k');
    await dom.render(<StackManager />);
    await tap(dom.container.querySelector(`[aria-label="Options for ${a!.label}"]`));
    await dom.click('Disconnect');
    await new Promise((r) => setTimeout(r, 400));
    await dom.settle();
    expect(dom.text().replace(/\s+/g, ' ')).toContain(
      'its copy of any API key is removed from this device. The other 2 models from 192.168.1.20:11434 keep theirs; Disconnect all 3 at 192.168.1.20:11434 removes every copy.',
    );
    await tap([...dom.container.querySelectorAll('.btn.danger')].at(-1));
    await dom.settle();
    expect((useApp.getState().settings.byomModels ?? []).map((x) => x.id)).toEqual([b!.id, c!.id]);
    expect([...h.secrets.keys()].sort()).toEqual(
      [`oscode.secret.byom.${b!.id}`, `oscode.secret.byom.${c!.id}`].sort(),
    );
  });
});

// The mark after connecting (review, 2026-10-09): a gateway connected before
// the mark existed, or without it, can be marked from its options, for every
// model from its address, and the refs already placed follow, so the chip and
// the Image reading slots (which read the ref) agree with the pack seat
// (which reads the connection too).
describe('marking a connected address as passing requests on', () => {
  it('sets it for every model from the address, placed refs included, and clears it', async () => {
    const [a, b] = byomConnectionsFor({
      label: 'Gateway',
      baseUrl: 'http://192.168.1.30:4000/v1',
      models: [{ id: 'bedrock-claude' }, { id: 'azure-gpt' }],
    });
    const other = { id: 'solo', label: 'Solo', baseUrl: 'http://10.0.0.9:8000/v1', model: 'x' };
    const placed = byomRef(a!);
    useApp.setState({
      settings: {
        ...useApp.getState().settings,
        byomModels: [a!, b!, other],
        stacks: {
          offshore: {
            reasoning: placed,
            active: [{ ref: byomRef(b!), placement: { category: 'coding' } }],
            saved: {},
          },
        },
      },
    });
    // Both models are placed, so neither sits on the bench to open: the
    // switch is the store's setByomForwards (the next test taps it).
    const mark = async (on: boolean) => {
      const { act } = await import('react');
      await act(async () => {
        await useApp.getState().setByomForwards(a!.id, on);
      });
    };
    await mark(true);
    let st = useApp.getState().settings;
    expect(st.byomModels!.map((c) => c.forwardsToCloud)).toEqual([true, true, undefined]);
    const stack = st.stacks!.offshore!;
    expect(stack.reasoning).toMatchObject({ id: a!.id, forwardsToCloud: true });
    expect(stack.active[0]!.ref).toMatchObject({ id: b!.id, forwardsToCloud: true });
    await mark(false);
    st = useApp.getState().settings;
    expect(st.byomModels!.map((c) => c.forwardsToCloud)).toEqual([undefined, undefined, undefined]);
    expect(st.stacks!.offshore!.reasoning).not.toHaveProperty('forwardsToCloud');
  });

  it("is a switch in a benched model's options, and its line says it covers the address", async () => {
    const [a, b] = byomConnectionsFor({
      label: 'Gateway',
      baseUrl: 'http://192.168.1.30:4000/v1',
      models: [{ id: 'bedrock-claude' }, { id: 'azure-gpt' }],
    });
    useApp.setState({ settings: { ...useApp.getState().settings, byomModels: [a!, b!] } });
    await dom.render(<StackManager />);
    const chip = (label: string) =>
      rows()
        .find((r) => r.label === label)
        ?.el.querySelector('.kind-chip')?.textContent;
    expect(chip(a!.label)).toBe('Your server');
    await tap(dom.container.querySelector(`[aria-label="Options for ${a!.label}"]`));
    const sw = dom.container.querySelector(
      `.sheet:not(.closing) [role="switch"][aria-label="${BYOM_FORWARDS_NAME}"]`,
    );
    expect(sw?.getAttribute('aria-checked')).toBe('false');
    expect(dom.text()).toContain('It is set for all 2 models from 192.168.1.30:4000.');
    await tap(sw);
    await dom.settle();
    expect(sw?.getAttribute('aria-checked')).toBe('true');
    // Both models from the address now read Cloud on the bench.
    expect(chip(a!.label)).toBe('Cloud');
    expect(chip(b!.label)).toBe('Cloud');
  });
});
