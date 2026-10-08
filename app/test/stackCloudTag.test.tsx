// The desktop Stack's picker lists an Ollama cloud tag as the cloud model it
// is (privacy review, 2026-10-08, finding electron-daemon-1). Ollama lists a
// pulled cloud tag (kimi-k3:cloud) beside the models on this computer, but it
// answers on ollama.com under the person's Ollama account, so the picker sets
// it apart, chipped Cloud and saying where its words go, never under "Models
// installed on this computer", and the Runs the show row wears the kind the
// engine's status gives it. Mounted in a real (small) DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const app = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  const reset = () => {
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, {
      settings: { deviceModels: {}, pinnedModels: [] },
      connectivity: { homeReachable: false, online: true },
      connectedProviders: {},
      setView: () => {},
      viewTrail: [],
      goBack: () => {},
      harborMasterDownload: undefined,
      ensureHarborMaster: async () => false,
      showToast: () => {},
      startGuideChat: async () => {},
      setProfileOverride: async () => {},
    });
  };
  reset();
  return { state, reset };
});
vi.mock('../src/state/store.js', () => ({
  useApp: Object.assign(
    <T,>(select?: (s: typeof app.state) => T) => (select ? select(app.state) : app.state),
    { getState: () => app.state },
  ),
  stackAdmin: () => true,
  agenticView: () => ({}),
  harnessView: () => ({}),
}));

const machine = vi.hoisted(() => ({ status: undefined as unknown }));
vi.mock('../src/lib/electronBridge.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/electronBridge.js')>()),
  bridge: () => ({ status: async () => machine.status }),
}));
vi.mock('../src/lib/platform.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/platform.js')>()),
  platform: () => 'electron',
  isDesktop: () => true,
  isPhone: () => false,
}));
vi.mock('../src/lib/catalog.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/catalog.js')>()),
  loadAppCatalog: async () => ({ catalog: undefined }),
}));

/** This computer's status as the engine reports it: a cloud tag placed as the
 *  Reasoning model on this computer's own Ollama, which the engine judges
 *  cloud (seatLeaves). */
function status(models: string[]) {
  return {
    ollama: { up: true, detail: 'running', models },
    offlineSeat: { model: 'qwen2.5-coder:7b', provider: 'ollama' },
    hardwareSummary: 'no dedicated GPU detected, 16 GB system RAM',
    stack: {
      configured: true,
      description: 'kimi-k3:cloud, solo',
      orchestrator: { model: 'kimi-k3:cloud', provider: 'ollama', kind: 'cloud' as const },
      specialists: [],
    },
    connections: { anthropic: false, openai: false, github: false },
  };
}

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
  app.reset();
  machine.status = status(['qwen2.5-coder:7b', 'kimi-k3:cloud', 'gpt-oss:120b-cloud']);
  Object.assign(window.HTMLElement.prototype, { scrollTo() {}, scrollIntoView() {} });
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(async () => {
  await dom.render(null);
});

/** Open the picker for Runs the show, as a tap on its row does. */
async function openPicker(): Promise<HTMLElement> {
  const { StackScreen } = await import('../src/screens/StackScreen.js');
  await dom.render(<StackScreen />);
  await dom.settle();
  const row = dom.container.querySelector<HTMLElement>('.settings-row')!;
  const { act } = await import('react');
  await act(async () => {
    row.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
  return document.body.querySelector<HTMLElement>('.sheet:not(.closing)')!;
}

/** Each option group in the sheet: the line above it and the names it lists,
 *  with whether each wears the cloud chip. */
function groups(sheet: HTMLElement): Array<{ sub: string; options: string[] }> {
  return [...sheet.querySelectorAll<HTMLElement>('.sheet-sub')].map((sub) => {
    const actions = sub.nextElementSibling as HTMLElement | null;
    const options = [...(actions?.querySelectorAll<HTMLElement>('.profile-option') ?? [])].map(
      (b) => {
        const title = b.querySelector('.profile-option-title')!;
        const chip = title.querySelector('.kind-chip.cloud') ? ' [Cloud]' : '';
        return `${title.firstChild?.textContent ?? ''}${chip}`;
      },
    );
    return { sub: sub.textContent ?? '', options };
  });
}

describe("the desktop Stack's picker", () => {
  it('lists a cloud tag apart, chipped Cloud, never as installed on this computer', async () => {
    const sheet = await openPicker();
    const [here, cloud] = groups(sheet);
    expect(here!.sub).toBe('Models installed on this computer. Ollama, a free app, runs them.');
    expect(here!.options).toEqual(['qwen2.5-coder:7b']);
    // One name for the place, the one the install card uses (Ollama's cloud),
    // and the cloud card's own nouns, ending where they go (CX and CMO,
    // 2026-10-08, C).
    expect(cloud!.sub).toBe(
      "Cloud models your Ollama lists. They run on Ollama's cloud, under your Ollama account, so your messages and the files the agent reads go to ollama.com.",
    );
    // The current one first, as the local list orders it.
    expect(cloud!.options).toEqual(['kimi-k3:cloud [Cloud]', 'gpt-oss:120b-cloud [Cloud]']);
  });

  // CX and CMO, 2026-10-08 (B): the install card is a local door, so its
  // examples are models that run here and it offers no cloud tag to copy; its
  // warning says what a cloud tag is in the engine judge's own rule, so a
  // local tag such as "mycloud" is not misnamed.
  it("the install card names no cloud tag, and warns in the judge's own rule", async () => {
    const sheet = await openPicker();
    const hint = sheet.querySelector('.install-by-name .hint')?.textContent ?? '';
    expect(hint).toBe(
      "Type any name from the Ollama library and install it on this computer, even brand new models. For example qwen3-coder:30b, deepseek-r1:14b, gemma3:12b. A name whose tag (after the colon) is cloud or ends in -cloud runs on Ollama's cloud, not on this computer.",
    );
    const { isOllamaCloudTag } = await import('os-code/protocol');
    const names = hint.match(/[\w.-]+:\w[\w.-]*\w/g) ?? [];
    expect(names).toEqual(['qwen3-coder:30b', 'deepseek-r1:14b', 'gemma3:12b']);
    expect(names.filter(isOllamaCloudTag)).toEqual([]);
    // The rule the sentence states is the judge's: a tag of cloud or one
    // ending in -cloud, and not a tag that merely ends in the letters.
    expect(isOllamaCloudTag('kimi-k3:cloud')).toBe(true);
    expect(isOllamaCloudTag('gpt-oss:120b-cloud')).toBe(true);
    expect(isOllamaCloudTag('qwen3:mycloud')).toBe(false);
  });

  it('with only cloud tags pulled, there is no model on this computer yet', async () => {
    machine.status = status(['kimi-k3:cloud']);
    const sheet = await openPicker();
    expect(sheet.textContent).toContain('No local models yet.');
    expect(groups(sheet).at(-1)!.options).toEqual(['kimi-k3:cloud [Cloud]']);
  });

  it('Runs the show wears the cloud chip the engine gives a cloud tag', async () => {
    const { StackScreen } = await import('../src/screens/StackScreen.js');
    await dom.render(<StackScreen />);
    await dom.settle();
    const chip = dom.container.querySelector('.settings-row .kind-chip');
    expect(chip?.className).toBe('kind-chip cloud');
    expect(chip?.textContent).toBe('Cloud');
  });
});

// CX and CMO, 2026-10-08 (B): Runs the show and every Specialists row wear a
// chip by where the seat answers, in words that hold for a server on the LAN:
// Cloud when it leaves (the engine's seatLeaves, a cloud tag included), On
// this computer only when its server is this computer itself
// (onThisComputer, the engine's hostIsLoopback), and On your network for any
// other server that stays. A specialist the engine gives no kind wears none.
describe('the desktop Stack says where each seat answers', () => {
  type Seat = { kind?: 'local' | 'cloud'; onThisComputer?: true };
  function withStack(
    orchestrator: Seat & { model: string; provider?: string },
    specialists: Array<Seat & { role: string; model: string }>,
  ) {
    const base = status(['qwen2.5-coder:7b']);
    machine.status = {
      ...base,
      stack: {
        ...base.stack,
        orchestrator: { provider: 'ollama', kind: 'local', ...orchestrator },
        specialists,
      },
    };
  }

  /** Each ledger row: its label, its value's words, and its chip. */
  async function ledger(): Promise<
    Record<string, { value: string; chip?: { cls: string; text: string } }>
  > {
    const { StackScreen } = await import('../src/screens/StackScreen.js');
    await dom.render(<StackScreen />);
    await dom.settle();
    const out: Record<string, { value: string; chip?: { cls: string; text: string } }> = {};
    for (const row of dom.container.querySelectorAll<HTMLElement>('.settings-row')) {
      const label = row.querySelector('.settings-row-label')?.textContent ?? '';
      const value = row.querySelector('.settings-row-value');
      const chip = value?.querySelector('.kind-chip');
      out[label] = {
        value: value?.textContent ?? '',
        ...(chip ? { chip: { cls: chip.className, text: chip.textContent ?? '' } } : {}),
      };
    }
    return out;
  }

  it('a cloud-tag specialist wears Cloud beside its name', async () => {
    withStack({ model: 'qwen3:32b', onThisComputer: true }, [
      { role: 'coding', model: 'kimi-k3:cloud', kind: 'cloud' },
    ]);
    const rows = await ledger();
    expect(rows.Coding).toEqual({
      value: 'kimi-k3:cloudCloud',
      chip: { cls: 'kind-chip cloud', text: 'Cloud' },
    });
  });

  it('a LAN orchestrator and a LAN specialist read On your network', async () => {
    withStack({ model: 'qwen3:32b', provider: 'lan' }, [
      { role: 'analysis', model: 'qwen3:14b', kind: 'local' },
    ]);
    const rows = await ledger();
    expect(rows['qwen3:32b']!.chip).toEqual({ cls: 'kind-chip local', text: 'On your network' });
    expect(rows.Analysis!.chip).toEqual({ cls: 'kind-chip local', text: 'On your network' });
  });

  it('a loopback orchestrator and specialist read On this computer', async () => {
    withStack({ model: 'qwen3:32b', onThisComputer: true }, [
      { role: 'writing', model: 'gemma3:12b', kind: 'local', onThisComputer: true },
    ]);
    const rows = await ledger();
    expect(rows['qwen3:32b']!.chip).toEqual({ cls: 'kind-chip local', text: 'On this computer' });
    expect(rows.Writing).toEqual({
      value: 'gemma3:12bOn this computer',
      chip: { cls: 'kind-chip local', text: 'On this computer' },
    });
  });

  it('a specialist with no kind (an older engine) wears no chip; an empty role reads Off', async () => {
    withStack({ model: 'qwen3:32b', onThisComputer: true }, [{ role: 'fast', model: 'qwen3:4b' }]);
    const rows = await ledger();
    expect(rows.Fast).toEqual({ value: 'qwen3:4b' });
    expect(rows.Coding).toEqual({ value: 'Off' });
  });
});
