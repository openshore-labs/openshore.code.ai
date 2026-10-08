// Where a model answers is judged by address, never by its kind (privacy
// review, 2026-10-08, findings egress-claims-6 and electron-daemon-1). Image
// reading's Local slot holds only a model that answers on this person's own
// network: a model connected at a public address, or an Ollama cloud tag on
// the computer's own Ollama (it answers on ollama.com), is a cloud model, in
// the chip, in the Stack's two slots, in which slot an image goes to first,
// and in what a seat may be sent (the vault pack, the app actions contract).
// Mounted in a real DOM (test/support/dom.ts) for the Stack's own rows.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';
import type { AppStack, StackModelRef } from '../src/lib/stack.js';

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

// The DOM comes first: React DOM decides whether it has one when it loads.
const dom: TestDom = await mountDom();
const { useApp } = await import('../src/state/store.js');
const { pickVisionRef, refStaysLocal, visionSlots } = await import('../src/lib/stack.js');
const { packSeatFor } = await import('../src/lib/vaultSeat.js');

/** Another provider's API, connected as the person's own model. */
const PUBLIC = {
  id: 'pub',
  label: 'Hosted reader',
  baseUrl: 'https://api.example.com/v1',
  model: 'vision-large',
};
/** A server on the home network. */
const HOME = {
  id: 'home',
  label: 'Home reader',
  baseUrl: 'http://192.168.1.20:11434/v1',
  model: 'llava:13b',
};
/** The computer's own Ollama, serving a cloud tag. */
const CLOUD_TAG = {
  id: 'tag',
  label: 'Kimi tag',
  baseUrl: 'http://localhost:11434/v1',
  model: 'kimi-k3:cloud',
};
const ref = (c: typeof PUBLIC): StackModelRef => ({ kind: 'byom', ...c });
const vision = (r: StackModelRef) => ({ ref: r, placement: { category: 'vision' as const } });
const stackOf = (...members: StackModelRef[]): AppStack => ({
  active: members.map(vision),
  saved: {},
});

describe('the judge: by address, and never an Ollama cloud tag', () => {
  it('a public address and a cloud tag read cloud; your own server reads local', () => {
    expect(refStaysLocal(ref(PUBLIC))).toBe(false);
    expect(refStaysLocal(ref(CLOUD_TAG))).toBe(false);
    expect(refStaysLocal(ref(HOME))).toBe(true);
    expect(refStaysLocal({ kind: 'device', modelId: 'm', modelName: 'M' })).toBe(true);
    // A tailnet server is local only on this device's own tailnet.
    const tail = ref({ ...HOME, id: 't', baseUrl: 'https://gpu.tail1234.ts.net/v1' });
    expect(refStaysLocal(tail)).toBe(false);
    expect(refStaysLocal(tail, 'tail1234.ts.net')).toBe(true);
  });

  it('visionSlots never puts a public address or a cloud tag in the Local slot', () => {
    expect(visionSlots(stackOf(ref(PUBLIC))).local).toBeUndefined();
    expect(visionSlots(stackOf(ref(PUBLIC))).cloud?.ref).toEqual(ref(PUBLIC));
    expect(visionSlots(stackOf(ref(CLOUD_TAG))).local).toBeUndefined();
    expect(visionSlots(stackOf(ref(HOME))).local?.ref).toEqual(ref(HOME));
  });

  it('pickVisionRef takes the one on your own network first, whatever the order', () => {
    const both = stackOf(ref(PUBLIC), ref(HOME));
    expect(pickVisionRef(both, () => true)?.ref).toEqual(ref(HOME));
  });

  it('a cloud tag on your own Ollama leaves, so a vault pack withholds local-only notes', () => {
    const seat = packSeatFor(ref(CLOUD_TAG), { ownTailnetSuffix: null });
    expect(seat?.leavesNetwork).toBe(true);
    expect(
      packSeatFor(ref({ ...CLOUD_TAG, model: 'qwen2.5-coder:7b' }), { ownTailnetSuffix: null })
        ?.leavesNetwork,
    ).toBe(false);
  });
});

/** The ledger rows on screen, by their label. */
function rows(): Array<{ label: string; sub: string; value: string; el: HTMLElement }> {
  return [...dom.container.querySelectorAll<HTMLElement>('.settings-row')].map((el) => ({
    label: el.querySelector('.settings-row-label')?.textContent ?? '',
    sub: el.querySelector('.settings-row-sub')?.textContent ?? '',
    value: el.querySelector('.settings-row-value')?.textContent ?? '',
    el,
  }));
}

async function tapRow(label: string): Promise<void> {
  const row = rows().find((r) => r.label === label);
  if (!row) throw new Error(`No "${label}" row in: ${rows().map((r) => r.label)}`);
  const { act } = await import('react');
  await act(async () => {
    row.el.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

/** The options the open slot sheet lists, by name, with their chip. */
const sheetOptions = () =>
  [
    ...dom.container.querySelectorAll<HTMLElement>('.sheet:not(.closing) .profile-option-title'),
  ].map((el) => el.textContent ?? '');

describe("the Stack's Image reading rows", () => {
  beforeEach(() => {
    useApp.setState({
      view: 'stack',
      viewTrail: [],
      connectedProviders: {},
      connectivity: { homeReachable: false, online: true },
      settings: {
        onboarded: true,
        claudeModel: 'x',
        deviceModels: {},
        byomModels: [PUBLIC, HOME, CLOUD_TAG],
      },
    });
  });
  afterEach(async () => {
    await dom.render(null);
  });

  const place = (...members: StackModelRef[]) =>
    useApp.setState({
      settings: {
        ...useApp.getState().settings,
        stacks: { offshore: { active: members.map(vision), saved: {} } },
      },
    });
  const row = (label: string) => rows().find((r) => r.label === label)!.sub;

  it('a model at a public address placed for images is the Cloud one, never Local', async () => {
    place(ref(PUBLIC));
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(row('Cloud')).toMatch(/^Hosted reader · .+ effort$/);
    expect(row('Local')).toMatch(/^None yet/);
  });

  it('a cloud tag on your own Ollama is a cloud model too', async () => {
    place(ref(CLOUD_TAG));
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(row('Cloud')).toMatch(/^Kimi tag · /);
    expect(row('Local')).toMatch(/^None yet/);
  });

  it('your own server is the Local one', async () => {
    place(ref(HOME));
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(row('Local')).toMatch(/^Home reader · /);
  });

  it('the Local sheet lists only your own server; the Cloud sheet lists the others, chipped Cloud', async () => {
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    await tapRow('Local');
    expect(sheetOptions()).toEqual(['Home readerYour server']);
    await dom.render(null);
    await dom.render(<StackManager />);
    await tapRow('Cloud');
    expect(sheetOptions()).toEqual(['Hosted readerCloud', 'Kimi tagCloud']);
  });
});
