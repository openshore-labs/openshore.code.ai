// Maintainer, 2026-10-01: Harbor's download includes the warm-up, so the first
// message answers without a "Warming up" wait, and a downloaded Harbor becomes
// the phone's model in every status until the person places another in Stack.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StackModelRef } from '../src/lib/stack.js';

const mem = new Map<string, string>();
const h = vi.hoisted(() => ({ calls: [] as string[], loads: [] as unknown[] }));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async () => ({ remove: async () => {} }),
    downloadModel: async ({ id }: { id: string }) => {
      h.calls.push(`download:${id}`);
    },
    ensureLocal: async () => ({ ready: true }),
    load: async (options: { id: string }) => {
      h.calls.push(`load:${options.id}`);
      h.loads.push(options);
      return { ok: true };
    },
    cancelDownload: async () => {},
    requestNoticePermission: async () => ({ status: 'denied' }),
  },
  DEVICE_INFERENCE_UNAVAILABLE: 'unavailable',
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => false,
  isPhone: () => true,
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
  secretGet: async () => null,
  secretSet: async () => {},
  secretDelete: async () => {},
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
const { harborRef } = await import('../src/lib/stack.js');
const { HARBOR_CONTEXT_TOKENS, HARBOR_MODEL_ID, HARBOR_VISION_MODEL_ID } =
  await import('../src/lib/harbor.js');
const { forgetDeviceModel, loadedDeviceModel } = await import('../src/drivers/deviceModel.js');

const CLOUD: StackModelRef = {
  kind: 'cloud',
  provider: 'anthropic',
  model: 'claude-x',
  label: 'Claude',
};

function seed(busy = false) {
  const stack = (reasoning: StackModelRef) => ({ reasoning, active: [], saved: {} });
  useApp.setState({
    conversations: busy ? ({ c1: { thread: { busy: true, items: [], queued: [] } } } as never) : {},
    harborDownload: undefined,
    settings: {
      ...useApp.getState().settings,
      harborReady: false,
      harborMiniReady: true,
      // Docked on Harbor Lite, offshore on a model the person placed, and
      // offline never set up.
      stacks: { docked: stack(harborRef()), offshore: stack(CLOUD) },
    },
  });
}

describe('Harbor download, warm-up, and the phone model', () => {
  beforeEach(() => {
    h.calls = [];
    h.loads = [];
    mem.clear();
    forgetDeviceModel();
  });

  it('warms Harbor into the slot before it is called ready', async () => {
    seed();
    const seen: string[] = [];
    const unsub = useApp.subscribe((s, prev) => {
      if (s.harborDownload?.label !== prev.harborDownload?.label && s.harborDownload) {
        seen.push(s.harborDownload.label);
      }
      if (s.settings.harborReady && !prev.settings.harborReady) {
        seen.push(`ready after ${h.calls.join(',')}`);
      }
    });
    expect(await useApp.getState().ensureHarbor()).toBe(true);
    unsub();
    // The weights and the vision file, side by side, then one warm load.
    const fetched = [`download:${HARBOR_MODEL_ID}`, `download:${HARBOR_VISION_MODEL_ID}`];
    expect(h.calls).toEqual([...fetched, `load:${HARBOR_MODEL_ID}`]);
    expect(h.loads).toEqual([
      { id: HARBOR_MODEL_ID, contextSize: HARBOR_CONTEXT_TOKENS, visionId: HARBOR_VISION_MODEL_ID },
    ]);
    expect(seen).toContain('Warming up');
    expect(seen).toContain(`ready after ${fetched.join(',')},load:${HARBOR_MODEL_ID}`);
    expect(useApp.getState().settings.harborVisionReady).toBe(true);
    expect(loadedDeviceModel()).toBe(HARBOR_MODEL_ID);
    expect(useApp.getState().harborDownload).toBeUndefined();
  });

  it('becomes the phone model in every status, never over a model placed in Stack', async () => {
    seed();
    await useApp.getState().ensureHarbor();
    const stacks = useApp.getState().settings.stacks!;
    expect(stacks.docked?.reasoning).toMatchObject({ kind: 'device', modelId: HARBOR_MODEL_ID });
    expect(stacks.offline?.reasoning).toMatchObject({ kind: 'device', modelId: HARBOR_MODEL_ID });
    expect(stacks.offshore?.reasoning).toEqual(CLOUD);
  });

  it('skips the warm-up while a chat is writing, since a load would end that reply', async () => {
    seed(true);
    expect(await useApp.getState().ensureHarbor()).toBe(true);
    expect(h.calls).toEqual([`download:${HARBOR_MODEL_ID}`, `download:${HARBOR_VISION_MODEL_ID}`]);
    expect(useApp.getState().settings.harborReady).toBe(true);
  });
});
