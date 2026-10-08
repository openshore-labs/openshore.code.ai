// Desktop Offline (founder, 2026-10-07), the store against a fake desktop
// bridge: every connection refresh reports the person's choice to main (which
// sets this computer's engine flag), main's own read of the network counts
// beside the window's, choosing Offline in the Status sheet reaches the engine
// at once, and a cloud chat's send while offline ends with one plain line,
// never a request that cannot leave.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const mem = new Map<string, string>();
const secrets = new Map<string, string>();

const desk = vi.hoisted(() => ({
  on: true,
  mainOnline: true,
  reports: [] as boolean[],
  sent: [] as string[],
  // What a model pull answers (Desktop Offline follow-up, 2026-10-08).
  pull: { ok: true, detail: 'pulled' } as { ok: boolean; detail: string; reason?: string },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => (desk.on ? 'electron' : 'web'),
  isDesktop: () => desk.on,
  isPhone: () => false,
  openExternal: () => {},
  dataUnlockState: async () => 'ok',
  storeGetJson: async (k: string) => {
    const v = mem.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    mem.set(k, JSON.stringify(v));
  },
  storeGet: async (k: string) => mem.get(k) ?? null,
  storeSet: async (k: string, v: string) => {
    mem.set(k, v);
  },
  storeDelete: async (k: string) => {
    mem.delete(k);
  },
  sealExistingKeys: async () => {},
  secretGet: async (k: string) => secrets.get(k) ?? null,
  secretSet: async (k: string, v: string) => {
    secrets.set(k, v);
  },
  secretDelete: async (k: string) => {
    secrets.delete(k);
  },
}));

vi.mock('../src/lib/electronBridge.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/electronBridge.js')>()),
  bridge: () =>
    desk.on
      ? {
          setOffline: async (chosen: boolean) => {
            desk.reports.push(chosen);
            return {
              online: desk.mainOnline,
              offline: !desk.mainOnline || chosen,
            };
          },
          status: async () => ({
            ollama: { up: true, detail: 'running', models: [] },
            hardwareSummary: 'no dedicated GPU detected, 16 GB system RAM',
            stack: { configured: false, description: 'not set up yet', specialists: [] },
            connections: { anthropic: false, openai: false, github: false },
          }),
          onInstallProgress: () => () => {},
          installModel: async () => desk.pull,
          setOrchestrator: async () => ({ ok: true, detail: 'seated' }),
        }
      : undefined,
}));

// A cloud chat's driver that records what would have been sent.
class FakeCloud {
  readonly kind = 'cloud' as const;
  private sinks = new Set<(event: DriverEvent, seq: number) => void>();
  subscribe(sink: (event: DriverEvent, seq: number) => void) {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }
  send(text: string) {
    desk.sent.push(text);
  }
  abort() {}
  answerApproval() {}
  dispose() {}
}
vi.mock('../src/drivers/cloudClaudeDriver.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/drivers/cloudClaudeDriver.js')>()),
  CloudClaudeDriver: FakeCloud,
}));

vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

const { useApp } = await import('../src/state/store.js');
const { cloudWaitLine } = await import('../src/state/offlineOps.js');
const { claudeModelLabel } = await import('../src/lib/claudeModels.js');
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  mem.clear();
  secrets.clear();
  desk.on = true;
  desk.mainOnline = true;
  desk.pull = { ok: true, detail: 'pulled' };
  desk.reports.length = 0;
  desk.sent.length = 0;
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true, userAgent: 'test' },
    configurable: true,
  });
  useApp.setState({
    conversations: {},
    order: [],
    activeId: undefined,
    toast: undefined,
    connectivity: { homeReachable: false, online: true },
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
    harborMasterDownload: undefined,
  });
});

describe("the desktop's connection reaches this computer's engine", () => {
  it('each refresh reports the choice, and main reading no network is offline', async () => {
    await useApp.getState().refreshConnectivity();
    expect(desk.reports).toEqual([false]);
    expect(useApp.getState().connectivity.online).toBe(true);

    desk.mainOnline = false;
    await useApp.getState().refreshConnectivity();
    expect(useApp.getState().connectivity.online).toBe(false);

    desk.mainOnline = true;
    await useApp.getState().refreshConnectivity();
    expect(useApp.getState().connectivity.online).toBe(true);
  });

  it('choosing Offline reaches the engine at once, and following the connection undoes it', async () => {
    await useApp.getState().setProfileOverride('offline');
    expect(desk.reports.at(-1)).toBe(true);
    await useApp.getState().setProfileOverride(undefined);
    expect(desk.reports.at(-1)).toBe(false);
  });

  it('a phone reports nothing to an engine it does not host', async () => {
    desk.on = false;
    await useApp.getState().refreshConnectivity();
    await useApp.getState().setProfileOverride('offline');
    expect(desk.reports).toEqual([]);
  });
});

describe('a cloud chat waits while offline', () => {
  const source = { kind: 'cloud' as const, provider: 'anthropic', model: 'claude-opus-5' };

  async function openCloudChat(): Promise<string> {
    secrets.set('oscode.secret.anthropic', 'sk-ant-test');
    const id = await useApp.getState().newConversation(source);
    await settle();
    return id;
  }

  it('the send ends with one plain line naming the model, and nothing is sent', async () => {
    const id = await openCloudChat();
    useApp.setState({ connectivity: { homeReachable: false, online: false } });
    useApp.getState().send('hello');
    await settle();
    expect(desk.sent).toEqual([]);
    const items = useApp.getState().conversations[id]!.thread.items;
    expect(items[0]).toMatchObject({ kind: 'user', text: 'hello' });
    expect(items.at(-1)).toMatchObject({
      kind: 'stopped',
      message: cloudWaitLine(claudeModelLabel(source.model), false, 'this computer'),
    });
    expect(useApp.getState().conversations[id]!.thread.busy).toBe(false);
  });

  it('a chosen Offline holds it too, in its own words; online it goes', async () => {
    const id = await openCloudChat();
    useApp.setState((s) => ({ settings: { ...s.settings, profileOverride: 'offline' } }));
    useApp.getState().send('one');
    await settle();
    expect(desk.sent).toEqual([]);
    const last = useApp.getState().conversations[id]!.thread.items.at(-1);
    expect(last && last.kind === 'stopped' && last.message).toMatch(/^Offline is chosen/);

    useApp.setState((s) => ({ settings: { ...s.settings, profileOverride: undefined } }));
    useApp.getState().send('two');
    await settle();
    expect(desk.sent).toEqual(['two']);
  });
});

describe('a DeepBlue download that fails with the network up (Desktop Offline follow-up)', () => {
  it('says what failed and the way on, by name, never the model server error', async () => {
    desk.pull = {
      ok: false,
      detail: 'The download of qwen2.5-coder:7b stopped partway. Try again.',
      reason: 'stopped',
    };
    expect(await useApp.getState().ensureHarborMaster({ seat: false })).toBe(false);
    expect(useApp.getState().harborMasterDownload).toMatchObject({
      label: 'The download of DeepBlue stopped partway. Try again.',
      failed: true,
    });

    desk.pull = {
      ok: false,
      detail:
        'Not enough disk space on your computer for qwen2.5-coder:7b. Free some space, then try again.',
      reason: 'disk',
    };
    await useApp.getState().ensureHarborMaster({ seat: false });
    expect(useApp.getState().harborMasterDownload?.label).toBe(
      'Not enough disk space on your computer for DeepBlue. Free some space, then try again.',
    );
  });

  it('with no network the line keeps its own words', async () => {
    desk.pull = { ok: false, detail: 'Offline. Models download...', reason: 'offline' };
    useApp.setState({ connectivity: { homeReachable: false, online: false } });
    await useApp.getState().ensureHarborMaster({ seat: false });
    expect(useApp.getState().harborMasterDownload?.label).toBe(
      'Offline. DeepBlue downloads once you are back online.',
    );
  });
});
