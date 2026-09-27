// The vault pack reaches every plain app driver (Vault M5, CTO J1 to J6).
// What these rows hold: which seat gets a pack and at what size (J2, J4); the
// privacy rules a device runs on, which fail closed (J3); the pack itself,
// prepared once per send inside the cold budget, rendered per seat, never
// from the team vault, with the card shown once per change (J1); and each
// driver kind carrying it as its last system part within its seat's budget,
// with Memory off (no pack passed) leaving it out, and desktop chat sending no
// note text at all (J5, J6).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  claudeCalls: [] as Array<Record<string, unknown>>,
  oaiCalls: [] as Array<{ url: string; body: Record<string, unknown> }>,
  llama: new Map<string, (data: unknown) => void>(),
  generates: [] as Array<{ system: string; messages: unknown[] }>,
  store: new Map<string, unknown>(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class FakeAnthropic {
    static APIUserAbortError = class extends APIError {};
    static AuthenticationError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    messages = {
      stream: (params: Record<string, unknown>) => {
        h.claudeCalls.push(params);
        const on: Record<string, (d: string) => void> = {};
        return {
          on(ev: string, cb: (d: string) => void) {
            on[ev] = cb;
          },
          abort() {},
          async finalMessage() {
            on.text?.('Hi.');
            return {
              content: [{ type: 'text', text: 'Hi.' }],
              usage: { input_tokens: 10, output_tokens: 2 },
              stop_reason: 'end_turn',
            };
          },
        };
      },
    };
  }
  return { default: FakeAnthropic };
});

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => false,
  storeGetJson: async (k: string) => h.store.get(k),
  storeSetJson: async (k: string, v: unknown) => {
    h.store.set(k, v);
  },
}));

vi.mock('../src/lib/nativeFetch.js', () => ({
  nativeFetch: vi.fn(async (url: string, init: { body?: string }) => {
    h.oaiCalls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Hi from GPT.' } }] }),
      text: async () => '',
    };
  }),
}));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async (event: string, cb: (data: unknown) => void) => {
      h.llama.set(event, cb);
      return { remove: async () => {} };
    },
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async (req: { requestId: string; system: string; messages: unknown[] }) => {
      h.generates.push({ system: req.system, messages: req.messages });
      setTimeout(() => {
        h.llama.get('token')?.({ requestId: req.requestId, delta: 'Hello.' });
        h.llama.get('generationDone')?.({ requestId: req.requestId, stopReason: 'end' });
      }, 0);
      return { started: true };
    },
  },
}));

import {
  VaultIndex,
  buildContextPack,
  buildPathIndex,
  compileVaultPrivacy,
  normalizeNotePath,
  packBudgetTokens,
  readFrontmatter,
  resolveMarkdownLink,
  resolveWikilink,
  scanNote,
  LOCAL_ONLY_STUB,
  type DriverEvent,
  type VaultIndexCore,
  type VaultPrivacy,
} from 'os-code/protocol';
import type { AppVaultPack, PackSeat } from '../src/drivers/types.js';
import type { VaultIndexHost } from '../src/lib/vaultIndexHost.js';
import {
  CURRENT_STATE_CACHE_MS,
  classProfile,
  clearCurrentStateCache,
  createAppVaultPack,
  type AppVaultPackDeps,
} from '../src/lib/vaultPackSource.js';
import { appVaultPrivacy, hubPrivacyCache, readPrivacyConfig } from '../src/lib/vaultPrivacy.js';
import {
  CLOUD_DEFAULT_CONTEXT_TOKENS,
  hubTailnetSuffix,
  packSeatFor,
} from '../src/lib/vaultSeat.js';
import { DEVICE_CONTEXT_TOKENS } from '../src/drivers/deviceModel.js';
import { contextWindowFor, CloudClaudeDriver } from '../src/drivers/cloudClaudeDriver.js';
import { CloudOpenAiDriver } from '../src/drivers/cloudOpenAiDriver.js';
import { OnDeviceDriver } from '../src/drivers/onDeviceDriver.js';
import { DesktopChatDriver, readPackCard } from '../src/drivers/desktopChatDriver.js';
import { VAULT_PRIVACY_DEFAULTS, emptyThread, seedFromTranscript } from '../src/state/types.js';
import { reduceEvent } from '../src/state/transcript.js';
import { isLocalOnlyFinal } from '../src/drivers/types.js';
import { currentBenchId } from '../src/lib/currents.js';

const CORE: VaultIndexCore = {
  scanNote,
  readFrontmatter,
  buildPathIndex,
  resolveWikilink,
  resolveMarkdownLink,
  normalizeNotePath,
};

const CURRENT_STATE = {
  path: 'OpenShore Project Demo MDs/Current State.md',
  text: '# Current State\n\nThe login screen ships Friday. The API is frozen.\n',
};

/** A fake index host holding the given notes, warm. */
function fakeHost(notes: Record<string, string>, opts: { openMs?: number } = {}): VaultIndexHost {
  const index = new VaultIndex(CORE);
  for (const [path, text] of Object.entries(notes)) {
    index.applyWrite({ path, updatedAt: '2026-09-20T00:00:00.000Z', size: text.length }, text);
  }
  return {
    index,
    state: 'ready',
    open: () =>
      opts.openMs ? new Promise<void>((r) => setTimeout(r, opts.openMs)) : Promise.resolve(),
  } as unknown as VaultIndexHost;
}

const d5 = (): Promise<VaultPrivacy> =>
  Promise.resolve(
    compileVaultPrivacy({
      exclude: ['Secret/**'],
      localOnly: { paths: ['Private/**'], tags: ['private'] },
    }),
  );

function packDeps(over: Partial<AppVaultPackDeps> = {}): AppVaultPackDeps {
  return {
    setting: 'auto',
    index: () => undefined,
    read: async () => undefined,
    privacy: d5,
    currentState: async () => CURRENT_STATE,
    ...over,
  };
}

const deviceSeat: PackSeat = {
  modelClass: 'small',
  servedTokens: DEVICE_CONTEXT_TOKENS,
  leavesNetwork: false,
};
const cloudSeat: PackSeat = { modelClass: 'large', servedTokens: 200_000, leavesNetwork: true };

beforeEach(() => {
  clearCurrentStateCache();
  h.claudeCalls.length = 0;
  h.oaiCalls.length = 0;
  h.generates.length = 0;
  h.store.clear();
});

// ---------------------------------------------------------------------------
// J2, J4: the seat

describe('packSeatFor (J2, J4)', () => {
  it('a device seat is local, served the 4,096 window, a 327-token budget', () => {
    const seat = packSeatFor(
      { kind: 'device', modelId: 'qwen2.5-1.5b-instruct', modelName: 'Qwen 1.5B' },
      { ownTailnetSuffix: null },
    )!;
    expect(seat).toEqual({ modelClass: 'tiny', servedTokens: 4096, leavesNetwork: false });
    expect(packBudgetTokens(classProfile(seat.modelClass), seat.servedTokens)).toBe(327);
  });

  it('a cloud seat leaves, class large; Claude is served its own window', () => {
    const claude = packSeatFor(
      { kind: 'cloud', provider: 'anthropic', model: 'claude-opus-5', label: 'Opus' },
      { ownTailnetSuffix: null },
    )!;
    expect(claude.leavesNetwork).toBe(true);
    expect(claude.modelClass).toBe('large');
    expect(claude.servedTokens).toBe(contextWindowFor('claude-opus-5'));
  });

  it('an OpenAI-compatible seat takes its listed window, else 128k', () => {
    const ref = { kind: 'cloud' as const, provider: 'openai', model: 'gpt-5', label: 'GPT-5' };
    expect(
      packSeatFor(ref, { ownTailnetSuffix: null, cloudContextTokens: () => 400_000 })!.servedTokens,
    ).toBe(400_000);
    expect(packSeatFor(ref, { ownTailnetSuffix: null })!.servedTokens).toBe(
      CLOUD_DEFAULT_CONTEXT_TOKENS,
    );
  });

  it('a BYOM seat is local by address only, on this tailnet only', () => {
    const ref = (baseUrl: string) => ({
      kind: 'byom' as const,
      id: 'b1',
      label: 'Box',
      baseUrl,
      model: 'qwen2.5-coder:7b',
    });
    const own = hubTailnetSuffix('https://mac.tail1234.ts.net:7443');
    expect(own).toBe('tail1234.ts.net');
    const home = packSeatFor(ref('http://192.168.1.20:11434/v1'), { ownTailnetSuffix: null })!;
    expect(home).toEqual({ modelClass: 'small', servedTokens: 8192, leavesNetwork: false });
    expect(
      packSeatFor(ref('https://gpu.tail1234.ts.net/v1'), { ownTailnetSuffix: own })!.leavesNetwork,
    ).toBe(false);
    // Another tailnet's Funnel host is cloud.
    expect(
      packSeatFor(ref('https://gpu.tail9999.ts.net/v1'), { ownTailnetSuffix: own })!.leavesNetwork,
    ).toBe(true);
    expect(
      packSeatFor(ref('https://api.together.xyz/v1'), { ownTailnetSuffix: own })!.leavesNetwork,
    ).toBe(true);
    // The connection's own window, when it names one.
    expect(
      packSeatFor(ref('http://10.0.0.2/v1'), {
        ownTailnetSuffix: null,
        byomContextTokens: () => 32_768,
      })!.servedTokens,
    ).toBe(32_768);
  });

  it('an Agentic Current bench seat gets no pack', () => {
    expect(
      packSeatFor(
        {
          kind: 'byom',
          id: currentBenchId('hermes'),
          label: 'Hermes',
          baseUrl: 'http://localhost:8642/v1',
          model: 'hermes',
        },
        { ownTailnetSuffix: null },
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// J3: privacy

describe('appVaultPrivacy (J3)', () => {
  const machine = {
    exclude: ['Clients/**'],
    localOnly: { paths: ['Health/**'], tags: ['secret'] },
  };

  it('the desktop reads the machine through the bridge', async () => {
    const p = await appVaultPrivacy({ bridge: { vaultPrivacy: async () => machine } });
    expect(p.visibility({ path: 'Clients/acme.md' })).toBe('hidden');
    expect(p.visibility({ path: 'Health/log.md' })).toBe('local-only');
    expect(p.visibility({ path: 'Notes/a.md' })).toBe('open');
  });

  it('a bridge that fails, or answers nonsense, means the D5 defaults', async () => {
    for (const bridge of [
      { vaultPrivacy: async () => Promise.reject(new Error('no main')) },
      { vaultPrivacy: async () => ({ exclude: 'all' }) as never },
    ]) {
      const p = await appVaultPrivacy({ bridge });
      expect(p.visibility({ path: 'Private/diary.md' })).toBe('local-only');
      expect(p.visibility({ path: 'Journal/2026.md' })).toBe('local-only');
      expect(p.visibility({ path: 'Notes/a.md', tags: ['private'] })).toBe('local-only');
    }
  });

  it('a paired phone uses the hub, and keeps its last answer sealed', async () => {
    const cache = hubPrivacyCache('https://mac.tail1234.ts.net');
    const p = await appVaultPrivacy({ hub: { fetchPrivacy: async () => machine }, cache });
    expect(p.visibility({ path: 'Clients/x.md' })).toBe('hidden');
    expect(await cache.load()).toEqual(machine);
    // Another hub never reads this one's rules.
    expect(await hubPrivacyCache('https://other.example').load()).toBeUndefined();
  });

  it('a hub out of reach uses the last answer with D5 on top', async () => {
    const cache = hubPrivacyCache('https://mac.tail1234.ts.net');
    await cache.save(machine);
    const down = { fetchPrivacy: async () => Promise.reject(new Error('off')) };
    const p = await appVaultPrivacy({ hub: down, cache });
    expect(p.visibility({ path: 'Clients/x.md' })).toBe('hidden');
    expect(p.visibility({ path: 'Private/x.md' })).toBe('local-only');
    // No cached answer at all: D5 alone, never none.
    const cold = await appVaultPrivacy({ hub: down });
    expect(cold.visibility({ path: 'Journal/x.md' })).toBe('local-only');
  });

  it('unpaired, the device runs D5, and its setting can only narrow', async () => {
    expect((await appVaultPrivacy()).visibility({ path: 'Private/x.md' })).toBe('local-only');
    // A device setting that lists nothing cannot lift D5.
    const empty = { exclude: [], localOnly: { paths: [], tags: [] } };
    const p = await appVaultPrivacy({ device: empty });
    expect(p.visibility({ path: 'Private/x.md' })).toBe('local-only');
    // One that adds a rule narrows on top of the source.
    const more = await appVaultPrivacy({
      bridge: { vaultPrivacy: async () => machine },
      device: { exclude: ['Drafts/**'], localOnly: { paths: [], tags: [] } },
    });
    expect(more.visibility({ path: 'Drafts/a.md' })).toBe('hidden');
    expect(more.visibility({ path: 'Clients/a.md' })).toBe('hidden');
  });

  it('reads a privacy config strictly', () => {
    expect(readPrivacyConfig(VAULT_PRIVACY_DEFAULTS)).toEqual(VAULT_PRIVACY_DEFAULTS);
    expect(readPrivacyConfig({ exclude: [], localOnly: { paths: [1], tags: [] } })).toBeNull();
    expect(readPrivacyConfig(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// J1: the pack

describe('createAppVaultPack (J1)', () => {
  it('carries Current State to a device seat within its budget, with a card', async () => {
    const pack = createAppVaultPack(packDeps());
    await pack.prepare('what ships friday');
    const out = pack.render(deviceSeat);
    expect(out.text).toContain('The login screen ships Friday.');
    expect(out.event).toMatchObject({ type: 'context-pack', seat: 'local', mode: 'current-state' });
    const ev = out.event as Extract<DriverEvent, { type: 'context-pack' }>;
    expect(ev.budgetTokens).toBe(327);
    expect(ev.tokens).toBeLessThanOrEqual(ev.budgetTokens);
  });

  it('renders the same bytes for the same seat and shows the card once', async () => {
    const pack = createAppVaultPack(packDeps());
    await pack.prepare('task');
    const a = pack.render(deviceSeat);
    const b = pack.render(deviceSeat);
    expect(b.text).toBe(a.text);
    expect(b.event).toBeUndefined();
    // A seat whose card differs (it leaves the network) shows it again.
    expect(pack.render(cloudSeat).event).toMatchObject({ seat: 'cloud' });
    // A new send shows it again.
    await pack.prepare('another');
    expect(pack.render(deviceSeat).event).toBeDefined();
  });

  it('carries nothing with the setting off, and reads nothing', async () => {
    const currentState = vi.fn(async () => CURRENT_STATE);
    const read = vi.fn(async () => 'x');
    const pack = createAppVaultPack(packDeps({ setting: 'off', currentState, read }));
    await pack.prepare('task');
    expect(pack.render(deviceSeat)).toEqual({});
    expect(currentState).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('waits no longer than the cold budget; a late Current State serves the next send', async () => {
    let calls = 0;
    const currentState = () => {
      calls += 1;
      return new Promise<typeof CURRENT_STATE>((r) => setTimeout(() => r(CURRENT_STATE), 80));
    };
    const pack = createAppVaultPack(packDeps({ currentState, coldMs: 20, projectKey: 'p1' }));
    const t0 = Date.now();
    await pack.prepare('task');
    expect(Date.now() - t0).toBeLessThan(75);
    expect(pack.render(deviceSeat)).toEqual({});
    await new Promise((r) => setTimeout(r, 100));
    await pack.prepare('task');
    expect(pack.render(deviceSeat).text).toContain('ships Friday');
    // Cached per project for ten minutes: one read served both.
    expect(calls).toBe(1);
  });

  it('caches Current State per project for ten minutes', async () => {
    let now = 1_000;
    const currentState = vi.fn(async () => CURRENT_STATE);
    const deps = packDeps({ currentState, projectKey: 'p2', now: () => now });
    await createAppVaultPack(deps).prepare('a');
    await createAppVaultPack(deps).prepare('b');
    expect(currentState).toHaveBeenCalledTimes(1);
    now += CURRENT_STATE_CACHE_MS + 1;
    await createAppVaultPack(deps).prepare('c');
    expect(currentState).toHaveBeenCalledTimes(2);
  });

  it('drops a Current State over 256 KB, like the engine', async () => {
    const big = { path: CURRENT_STATE.path, text: 'x'.repeat(256 * 1024 + 1) };
    const pack = createAppVaultPack(packDeps({ currentState: async () => big }));
    await pack.prepare('task');
    expect(pack.render(deviceSeat)).toEqual({});
  });

  it('never reads the team vault: no index on offer, no note read', async () => {
    const read = vi.fn(async () => 'body');
    const pack = createAppVaultPack(
      packDeps({ index: () => undefined, read, projectPins: () => ['Team/plan.md'] }),
    );
    await pack.prepare('plan');
    pack.render(deviceSeat);
    expect(read).not.toHaveBeenCalled();
  });

  it('never reads a hidden note, even a pinned one', async () => {
    const host = fakeHost({ 'Secret/keys.md': 'the keys', 'Notes/plan.md': 'the plan' });
    const read = vi.fn(async (path: string) => (path === 'Notes/plan.md' ? 'the plan' : 'keys'));
    const pack = createAppVaultPack(
      packDeps({
        index: () => host,
        read,
        projectPins: () => ['Secret/keys.md', 'Notes/plan.md'],
      }),
    );
    await pack.prepare('plan');
    expect(read.mock.calls.map((c) => c[0])).toEqual(['Notes/plan.md']);
  });

  it('asks for a handoff on the first send only', async () => {
    const handoff = vi.fn(() => 'HANDOFF from X');
    const pack = createAppVaultPack(packDeps({ handoff }));
    await pack.prepare('one');
    await pack.prepare('two');
    expect(handoff).toHaveBeenCalledTimes(1);
  });

  it('a local-only pinned note never reaches a cloud seat', async () => {
    const body = 'Blood pressure log. '.repeat(20);
    const host = fakeHost({ 'Private/health.md': body });
    const pack = createAppVaultPack(
      packDeps({
        index: () => host,
        read: async () => body,
        projectPins: () => ['Private/health.md'],
      }),
    );
    await pack.prepare('health');
    expect(pack.render(cloudSeat).text ?? '').not.toContain('Blood pressure');
  });

  it('a local-only pinned note reaches a device seat', async () => {
    const body = 'Blood pressure log. '.repeat(20);
    const host = fakeHost({ 'Private/health.md': body });
    const pack = createAppVaultPack(
      packDeps({
        index: () => host,
        read: async () => body,
        projectPins: () => ['Private/health.md'],
      }),
    );
    await pack.prepare('health');
    const onDevice = pack.render(deviceSeat);
    expect(onDevice.text).toContain('Blood pressure');
    // The reply it grounds is marked, so a later leaving seat gets the stub.
    expect(onDevice.localOnly).toBe(true);
    const onCloud = pack.render(cloudSeat);
    expect(onCloud.event).toMatchObject({ withheld: 1 });
    expect(onCloud.localOnly).toBeUndefined();
  });

  it('a slow index is cold, never waited on past the budget', async () => {
    const host = fakeHost({ 'Notes/a.md': 'a' }, { openMs: 200 });
    const read = vi.fn(async () => 'a');
    const pack = createAppVaultPack(
      packDeps({ index: () => host, read, projectPins: () => ['Notes/a.md'], coldMs: 10 }),
    );
    const t0 = Date.now();
    await pack.prepare('a');
    expect(Date.now() - t0).toBeLessThan(150);
    expect(read).not.toHaveBeenCalled();
    // Current State still rides.
    expect(pack.render(deviceSeat).text).toContain('ships Friday');
  });
});

// ---------------------------------------------------------------------------
// J5, J6: every plain driver

/** A pack that records the seats it rendered for and returns a fixed text. */
function recordingPack(text = 'VAULT NOTES. <note path="a.md">Pack body</note>') {
  const seats: PackSeat[] = [];
  const prepared: string[] = [];
  const pack: AppVaultPack = {
    prepare: async (task) => {
      prepared.push(task);
    },
    render: (seat) => {
      seats.push(seat);
      return {
        text,
        event: {
          type: 'context-pack',
          seat: seat.leavesNetwork ? 'cloud' : 'local',
          mode: 'current-state',
          tokens: 10,
          budgetTokens: 327,
          sources: [],
          withheld: 0,
          cold: false,
        },
      };
    },
  };
  return { pack, seats, prepared, text };
}

function collect(driver: { subscribe(s: (e: DriverEvent) => void): () => void }): DriverEvent[] {
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return events;
}

const done = (events: DriverEvent[]) =>
  vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));

/** The card sits right after the turn's start, before any text. */
function expectCardAfterTurnStart(events: DriverEvent[]): void {
  const types = events.map((e) => e.type);
  const turn = types.indexOf('turn-start');
  const card = types.indexOf('context-pack');
  expect(card).toBeGreaterThan(turn);
  const firstText = types.indexOf('text-delta');
  if (firstText !== -1) expect(card).toBeLessThan(firstText);
}

describe('cloud Claude carries the pack (J5)', () => {
  it('renders for its cloud seat and places the pack in the last system block', async () => {
    const rec = recordingPack();
    const driver = new CloudClaudeDriver(
      'k',
      'claude-opus-5',
      undefined,
      undefined,
      'Project: Demo',
      {
        vaultPack: rec.pack,
      },
    );
    const events = collect(driver);
    driver.send('what ships');
    await done(events);
    expect(rec.prepared).toEqual(['what ships']);
    expect(rec.seats).toEqual([
      { modelClass: 'large', servedTokens: contextWindowFor('claude-opus-5'), leavesNetwork: true },
    ]);
    expectCardAfterTurnStart(events);
    const system = h.claudeCalls[0]!.system as Array<{ text: string }>;
    expect(system.at(-1)!.text.endsWith(rec.text)).toBe(true);
    expect(system[0]!.text).toContain('Project: Demo');
  });

  it('with Memory off (no pack) carries none', async () => {
    const driver = new CloudClaudeDriver('k', 'claude-opus-5');
    const events = collect(driver);
    driver.send('hi');
    await done(events);
    expect(events.some((e) => e.type === 'context-pack')).toBe(false);
    expect(JSON.stringify(h.claudeCalls[0]!.system)).not.toContain('VAULT NOTES');
  });
});

describe('OpenAI-compatible carries the pack (J5)', () => {
  it('renders for its listed window and puts the pack last', async () => {
    const rec = recordingPack();
    const driver = new CloudOpenAiDriver(
      'https://api.openai.com/v1',
      'sk',
      'gpt-5',
      'OpenAI',
      undefined,
      undefined,
      400_000,
      { vaultPack: rec.pack },
    );
    const events = collect(driver);
    driver.send('hi');
    await done(events);
    expect(rec.seats[0]).toEqual({
      modelClass: 'large',
      servedTokens: 400_000,
      leavesNetwork: true,
    });
    expectCardAfterTurnStart(events);
    const messages = h.oaiCalls[0]!.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content.endsWith(rec.text)).toBe(true);
  });

  it('an unlisted model is sized at 128k', async () => {
    const rec = recordingPack();
    const driver = new CloudOpenAiDriver(
      'https://x/v1',
      'sk',
      'm',
      'X',
      undefined,
      undefined,
      undefined,
      { vaultPack: rec.pack },
    );
    const events = collect(driver);
    driver.send('hi');
    await done(events);
    expect(rec.seats[0]!.servedTokens).toBe(128_000);
  });

  it('with Memory off carries none', async () => {
    const driver = new CloudOpenAiDriver('https://x/v1', 'sk', 'm', 'X');
    const events = collect(driver);
    driver.send('hi');
    await done(events);
    expect(events.some((e) => e.type === 'context-pack')).toBe(false);
  });
});

describe('on-device carries the pack (J5)', () => {
  it('a real pack reaches the pocket seat within its 327-token budget, last in the prompt', async () => {
    const pack = createAppVaultPack(packDeps());
    const driver = new OnDeviceDriver(
      'qwen2.5-1.5b-instruct',
      'Qwen',
      undefined,
      false,
      () => 'Project: Demo',
      'c1',
      { vaultPack: pack },
    );
    const events = collect(driver);
    driver.send('what ships');
    await done(events);
    const card = events.find((e) => e.type === 'context-pack') as Extract<
      DriverEvent,
      { type: 'context-pack' }
    >;
    expect(card).toMatchObject({ seat: 'local', budgetTokens: 327 });
    expect(card.tokens).toBeLessThanOrEqual(327);
    expectCardAfterTurnStart(events);
    const system = h.generates[0]!.system;
    expect(system).toContain('Project: Demo');
    // The pack is the prompt's last part.
    const packText = pack.render(deviceSeat).text!;
    expect(system.endsWith(packText)).toBe(true);
    driver.dispose();
  });

  it('with Memory off carries none', async () => {
    const driver = new OnDeviceDriver('qwen2.5-1.5b-instruct', 'Qwen', undefined, false, 'x', 'c2');
    const events = collect(driver);
    driver.send('hi');
    await done(events);
    expect(events.some((e) => e.type === 'context-pack')).toBe(false);
    expect(h.generates[0]!.system).not.toContain('VAULT NOTES');
    driver.dispose();
  });
});

describe('desktop chat asks the computer for the pack (J6)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function sse(frames: object[]): Response {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
        c.close();
      },
    });
    return { ok: true, status: 200, body } as unknown as Response;
  }

  const card = {
    type: 'context-pack',
    seat: 'local',
    mode: 'current-state',
    tokens: 120,
    budgetTokens: 655,
    sources: [{ layer: 'current-state', path: 'Current State.md', title: 'Current State' }],
    withheld: 0,
    cold: false,
  };

  it('sends the project, never a note, and shows the streamed card once', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return sse([card, { type: 'text', delta: 'Hi.' }, { type: 'done' }]);
    }) as unknown as typeof fetch;
    const driver = new DesktopChatDriver(
      { baseUrl: 'http://desk', token: 't' },
      undefined,
      undefined,
      undefined,
      false,
      { vaultPack: { cwd: '/Users/me/OSCode/demo', projectName: 'Demo' } },
    );
    const events = collect(driver);
    driver.send('what ships');
    await done(events);
    expect(bodies[0]!.vaultPack).toEqual({ cwd: '/Users/me/OSCode/demo', projectName: 'Demo' });
    expect(bodies[0]!.memory).toBeUndefined();
    expect(JSON.stringify(bodies[0])).not.toContain('VAULT NOTES');
    expect(events.filter((e) => e.type === 'context-pack')).toHaveLength(1);
    expectCardAfterTurnStart(events);
  });

  it('with Memory off says so, and sends no pack request', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return sse([{ type: 'text', delta: 'Hi.' }, { type: 'done' }]);
    }) as unknown as typeof fetch;
    const driver = new DesktopChatDriver(
      { baseUrl: 'http://desk', token: 't' },
      undefined,
      undefined,
      undefined,
      false,
      { memory: false, vaultPack: { projectName: 'Demo' } },
    );
    const events = collect(driver);
    driver.send('hi');
    await done(events);
    expect(bodies[0]!.memory).toBe(false);
    expect(bodies[0]!.vaultPack).toBeUndefined();
  });

  it('drops a malformed card line', () => {
    expect(readPackCard({ type: 'context-pack', seat: 'moon' })).toBeUndefined();
    expect(readPackCard(card)).toEqual(card);
  });
});

// ---------------------------------------------------------------------------
// I5 in the transcript: a reply after a local-only read keeps its mark

describe('a reply after a local-only read, then a switch (I5, J10)', () => {
  const SECRET = 'The diary says the launch slips a week.';

  /** A device seat's pack that carried a local-only note, then a reply. */
  async function localOnlyReply(): Promise<DriverEvent[]> {
    const pack: AppVaultPack = {
      prepare: async () => {},
      render: () => ({
        text: 'VAULT NOTES. <note path="Private/Diary.md">x</note>',
        localOnly: true,
      }),
    };
    const driver = new OnDeviceDriver(
      'qwen2.5-1.5b-instruct',
      'Qwen',
      undefined,
      false,
      undefined,
      'c-lo',
      { vaultPack: pack },
    );
    const events = collect(driver);
    driver.send('what does my diary say');
    await done(events);
    driver.dispose();
    return events;
  }

  it('the device marks the reply, and the transcript keeps the mark', async () => {
    const events = await localOnlyReply();
    const final = events.find((e) => e.type === 'text-final')!;
    expect(isLocalOnlyFinal(final)).toBe(true);
    let thread = emptyThread();
    for (const e of events) thread = reduceEvent(thread, e);
    const reply = thread.items.find((i) => i.kind === 'assistant');
    expect(reply).toMatchObject({ kind: 'assistant', localOnly: true });
    expect(seedFromTranscript(thread.items).find((t) => t.role === 'assistant')).toMatchObject({
      localOnly: true,
    });
  });

  it('a switch to a cloud seat gives the stub, never the text', async () => {
    let thread = emptyThread();
    thread = reduceEvent(thread, { type: 'task-start', input: 'what does my diary say' });
    thread = reduceEvent(thread, {
      type: 'text-final',
      text: SECRET,
      localOnly: true,
    } as DriverEvent);
    const seed = seedFromTranscript(thread.items);
    expect(seed.at(-1)).toMatchObject({ role: 'assistant', localOnly: true });

    const claude = new CloudClaudeDriver('k', 'claude-opus-5', seed);
    const cEvents = collect(claude);
    claude.send('and then?');
    await done(cEvents);
    const sent = JSON.stringify(h.claudeCalls.at(-1)!.messages);
    expect(sent).toContain(LOCAL_ONLY_STUB);
    expect(sent).not.toContain(SECRET);

    const gpt = new CloudOpenAiDriver('https://x/v1', 'sk', 'm', 'X', seed);
    const gEvents = collect(gpt);
    gpt.send('and then?');
    await done(gEvents);
    const body = JSON.stringify(h.oaiCalls.at(-1)!.body.messages);
    expect(body).toContain(LOCAL_ONLY_STUB);
    expect(body).not.toContain(SECRET);
  });

  it('a reply with no local-only read carries no mark', async () => {
    let thread = emptyThread();
    thread = reduceEvent(thread, { type: 'task-start', input: 'hi' });
    thread = reduceEvent(thread, { type: 'text-final', text: 'Hello.' });
    expect(thread.items.find((i) => i.kind === 'assistant')).not.toHaveProperty('localOnly');
  });
});
