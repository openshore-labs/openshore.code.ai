// Harbor Lite on the desktop (founder, 2026-10-19): the desktop's first open is
// the phone's. The guide's weights ship inside the desktop app and run in the
// main process on llama.cpp (electron/harborLite.ts); the renderer reaches it
// through the phone plugin's own contract (LlamaDesktop in lib/llamaPlugin.ts),
// so the guide's driver and walk are one code path. The walk keeps the phone's
// four steps in their desktop form, and the old "Try it on a sample page" row
// is gone for good.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HARBOR_LITE_ID,
  HARBOR_LITE_MISSING,
  HarborLiteHost,
  harborLitePath,
  nodeLlamaEngine,
  type HarborLiteEngine,
  type HarborLiteEvent,
} from '../electron/harborLite.js';
import { LlamaDesktop } from '../src/lib/llamaPlugin.js';
import type { HarborLiteEvent as BridgeEvent, OscodeBridge } from '../src/lib/electronBridge.js';

// llama.cpp as node-llama-cpp shows it: one context with ONE sequence, which
// a reply holds until its chat lets go of it.
const llamaCpp = vi.hoisted(() => ({ live: 0, opened: 0 }));
vi.mock('node-llama-cpp', () => ({
  getLlama: async () => ({
    loadModel: async () => ({
      dispose: async () => {},
      createContext: async () => ({
        dispose: async () => {},
        getSequence: () => {
          if (llamaCpp.live) throw new Error('No sequences left');
          llamaCpp.live++;
          llamaCpp.opened++;
          return { release: () => llamaCpp.live-- };
        },
      }),
    }),
  }),
  LlamaChat: class {
    constructor(private readonly o: { contextSequence: { release(): void } }) {}
    async generateResponse(
      _history: unknown[],
      opts: { onTextChunk(t: string): void; signal: AbortSignal },
    ) {
      opts.onTextChunk('Hi');
      await new Promise((r) => setTimeout(r, 5));
      if (!opts.signal.aborted) await new Promise((r) => setTimeout(r, 30));
    }
    dispose() {
      // Lets go of the sequence as it disposes, as llama.cpp does.
      this.o.contextSequence.release();
    }
  },
}));

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeEngine(opts: { text?: string[]; hang?: boolean; fail?: string } = {}) {
  const calls: string[] = [];
  const engine: HarborLiteEngine = {
    async load(path, size) {
      calls.push(`load ${path} ${size}`);
    },
    async unload() {
      calls.push('unload');
    },
    async generate(req, onText, signal) {
      calls.push(`generate ${req.messages.length}`);
      if (opts.fail) throw new Error(opts.fail);
      for (const t of opts.text ?? ['Hi', ' there']) onText(t);
      if (opts.hang) {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      }
    },
  };
  return { engine, calls };
}

function host(opts: Parameters<typeof fakeEngine>[0] & { present?: boolean } = {}) {
  const events: HarborLiteEvent[] = [];
  const { engine, calls } = fakeEngine(opts);
  const h = new HarborLiteHost(
    '/res/models/harbor-mini.gguf',
    (e) => events.push(e),
    engine,
    () => opts.present ?? true,
  );
  return { h, events, calls };
}

describe('the desktop runner (electron/harborLite.ts)', () => {
  it('finds the weights in the packaged resources, or build/models in a checkout', () => {
    expect(harborLitePath({ packaged: true, resourcesPath: '/r', appPath: '/a' })).toBe(
      join('/r', 'models', 'harbor-mini.gguf'),
    );
    expect(harborLitePath({ packaged: false, resourcesPath: '/r', appPath: '/a' })).toBe(
      join('/a', 'build', 'models', 'harbor-mini.gguf'),
    );
  });

  it('runs Harbor Lite only, and says so plainly when the weights are missing', async () => {
    expect(await host().h.load('qwen')).toEqual({
      ok: false,
      detail: 'Only Harbor Lite runs inside the desktop app.',
    });
    expect(await host({ present: false }).h.load(HARBOR_LITE_ID)).toEqual({
      ok: false,
      detail: HARBOR_LITE_MISSING,
    });
  });

  it('loads once per window size, and reloads only when the size changes', async () => {
    const { h, calls } = host();
    expect(await h.load(HARBOR_LITE_ID, 4096)).toEqual({ ok: true });
    expect(await h.load(HARBOR_LITE_ID, 4096)).toEqual({ ok: true });
    expect(await h.load(HARBOR_LITE_ID, 2048)).toEqual({ ok: true });
    expect(calls).toEqual([
      'load /res/models/harbor-mini.gguf 4096',
      'unload',
      'load /res/models/harbor-mini.gguf 2048',
    ]);
  });

  it('streams a reply as the phone plugin does: tokens, then one end', async () => {
    const { h, events } = host();
    await h.load(HARBOR_LITE_ID);
    expect(
      h.generate({ requestId: 'r1', system: 's', messages: [{ role: 'user', content: 'hi' }] }),
    ).toEqual({ started: true });
    await tick();
    expect(events).toEqual([
      { kind: 'token', requestId: 'r1', delta: 'Hi' },
      { kind: 'token', requestId: 'r1', delta: ' there' },
      { kind: 'generationDone', requestId: 'r1', stopReason: 'end' },
    ]);
  });

  it('refuses a reply before a load, and reports an engine failure as an error', async () => {
    const cold = host();
    expect(cold.h.generate({ requestId: 'r0', system: 's', messages: [] })).toEqual({
      started: false,
    });
    expect(cold.events[0]).toMatchObject({ kind: 'generationDone', stopReason: 'error' });
    const broken = host({ fail: 'boom' });
    await broken.h.load(HARBOR_LITE_ID);
    broken.h.generate({ requestId: 'r1', system: 's', messages: [] });
    await tick();
    expect(broken.events.at(-1)).toEqual({
      kind: 'generationDone',
      requestId: 'r1',
      stopReason: 'error',
      detail: 'boom',
    });
  });

  it('Stop ends the reply at once, and a new reply stops the one before', async () => {
    const { h, events } = host({ hang: true, text: [] });
    await h.load(HARBOR_LITE_ID);
    h.generate({ requestId: 'a', system: 's', messages: [] });
    h.stop('other');
    await tick();
    expect(events).toEqual([]);
    h.generate({ requestId: 'b', system: 's', messages: [] });
    await tick();
    expect(events).toEqual([{ kind: 'generationDone', requestId: 'a', stopReason: 'stopped' }]);
    h.stop('b');
    await tick();
    expect(events.at(-1)).toEqual({
      kind: 'generationDone',
      requestId: 'b',
      stopReason: 'stopped',
    });
  });

  it('a reply that replaces another waits for its one sequence, never "No sequences left"', async () => {
    const events: HarborLiteEvent[] = [];
    const h = new HarborLiteHost(
      '/m.gguf',
      (e) => events.push(e),
      nodeLlamaEngine(),
      () => true,
    );
    expect(await h.load(HARBOR_LITE_ID)).toEqual({ ok: true });
    h.generate({ requestId: 'a', system: 's', messages: [] });
    await new Promise((r) => setTimeout(r, 1));
    h.generate({ requestId: 'b', system: 's', messages: [] });
    await new Promise((r) => setTimeout(r, 80));
    const ends = events.filter((e) => e.kind === 'generationDone');
    expect(ends).toEqual([
      { kind: 'generationDone', requestId: 'a', stopReason: 'stopped' },
      { kind: 'generationDone', requestId: 'b', stopReason: 'end' },
    ]);
    expect(llamaCpp.opened).toBe(2);
  });

  it('is reached from the renderer only through guarded, checked IPC', () => {
    const main = read('electron', 'main.ts');
    for (const ch of [
      'osc:harborLitePresent',
      'osc:harborLiteLoad',
      'osc:harborLiteUnload',
      'osc:harborLiteGenerate',
      'osc:harborLiteStop',
    ]) {
      expect(main).toContain(`guarded('${ch}'`);
    }
    const preload = read('electron', 'preload.cjs');
    expect(preload).toContain("harborLiteGenerate: invoke('osc:harborLiteGenerate')");
    expect(preload).toContain("onHarborLite: listen('osc:harbor-lite')");
  });
});

function fakeShell(present = true) {
  const listeners = new Set<(e: BridgeEvent) => void>();
  const shell = {
    harborLitePresent: vi.fn(async () => present),
    harborLiteLoad: vi.fn(async () => ({ ok: true })),
    harborLiteUnload: vi.fn(async () => {}),
    harborLiteGenerate: vi.fn(async () => ({ started: true })),
    harborLiteStop: vi.fn(async () => {}),
    onHarborLite: (cb: (e: BridgeEvent) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  const emit = (e: BridgeEvent) => listeners.forEach((l) => l(e));
  return { shell: shell as unknown as OscodeBridge, raw: shell, emit };
}

describe('the desktop plugin (LlamaDesktop)', () => {
  it('lists Harbor Lite as built in, and "downloads" it with nothing to fetch', async () => {
    const { shell } = fakeShell();
    const llama = new LlamaDesktop(shell);
    expect((await llama.listModels()).models.map((m) => m.id)).toEqual(['harbor-mini']);
    const progress: unknown[] = [];
    await llama.addListener('downloadProgress', (d) => progress.push(d));
    await expect(llama.downloadModel({ id: 'harbor-mini', url: 'x' })).resolves.toMatchObject({
      location: 'device',
    });
    expect(progress).toEqual([{ id: 'harbor-mini', completed: 1, total: 1 }]);
  });

  it('says plainly when a build lacks the weights', async () => {
    const llama = new LlamaDesktop(fakeShell(false).shell);
    expect((await llama.listModels()).models).toEqual([]);
    await expect(llama.downloadModel({ id: 'harbor-mini', url: 'x' })).rejects.toThrow(
      /not in this build/,
    );
  });

  it('sends Harbor Lite to main and its events back as the plugin events', async () => {
    const { shell, raw, emit } = fakeShell();
    const llama = new LlamaDesktop(shell);
    const seen: unknown[] = [];
    await llama.addListener('token', (d) => seen.push(['token', d]));
    await llama.addListener('generationDone', (d) => seen.push(['done', d]));
    expect(await llama.load({ id: 'harbor-mini', contextSize: 4096 })).toEqual({ ok: true });
    expect(raw.harborLiteLoad).toHaveBeenCalledWith('harbor-mini', 4096);
    const req = { requestId: 'r', system: 's', messages: [] };
    await llama.generate(req);
    expect(raw.harborLiteGenerate).toHaveBeenCalledWith(req);
    emit({ kind: 'token', requestId: 'r', delta: 'Hi' });
    emit({ kind: 'generationDone', requestId: 'r', stopReason: 'end' });
    expect(seen).toEqual([
      ['token', { requestId: 'r', delta: 'Hi' }],
      ['done', { requestId: 'r', stopReason: 'end' }],
    ]);
    await llama.stop({ requestId: 'r' });
    expect(raw.harborLiteStop).toHaveBeenCalledWith('r');
  });

  it('keeps the honest refusal for every other device model', async () => {
    const { shell, raw } = fakeShell();
    const llama = new LlamaDesktop(shell);
    expect((await llama.load({ id: 'qwen' })).ok).toBe(false);
    expect(raw.harborLiteLoad).not.toHaveBeenCalled();
    await expect(llama.generate({ requestId: 'r', system: 's', messages: [] })).rejects.toThrow();
    expect((await llama.isSupported()).supported).toBe(false);
  });
});

describe('the desktop walk speaks for the desktop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('keeps the four steps, as DeepBlue, your phone, a repository, and a key', async () => {
    vi.resetModules();
    vi.stubGlobal('window', { oscode: { platform: 'electron' } });
    const g = await import('../src/lib/guidedSetup.js');
    expect(g.STEP_COPY).toBe(g.DESKTOP_STEP_COPY);
    expect(g.SETUP_ORDER.map((id) => g.STEP_COPY[id].title)).toEqual([
      'Get DeepBlue',
      'Connect your phone',
      'Set up a repository',
      'Add an API key',
    ]);
    expect(g.HARBOR_READY_MESSAGE).toMatch(/^DeepBlue is ready on this computer\./);
    const facts = {
      harborReady: false,
      harborDownloading: true,
      computer: false,
      repo: false,
      key: false,
      desktop: true,
    };
    const finish = g.finishMessage(facts);
    expect(finish).toContain('DeepBlue is still downloading.');
    expect(finish).not.toMatch(/Repositories come in once your computer is connected/);
    // Nothing in the desktop's steps calls the computer a phone or the phone
    // a computer.
    const all = JSON.stringify(g.DESKTOP_STEP_COPY);
    expect(all).not.toMatch(/this phone|Get Harbor|Connect your computer/);
  });

  it("Harbor Lite's persona names the computer and DeepBlue there", async () => {
    vi.resetModules();
    vi.stubGlobal('window', { oscode: { platform: 'electron' } });
    const { HARBOR_MINI_PERSONA } = await import('../src/lib/harborMini.js');
    expect(HARBOR_MINI_PERSONA).toContain('running on their own computer');
    expect(HARBOR_MINI_PERSONA).not.toContain('Harbor (a coding model on the phone)');
  });

  it('the phone keeps its own words', async () => {
    vi.resetModules();
    const g = await import('../src/lib/guidedSetup.js');
    expect(g.STEP_COPY).toBe(g.PHONE_STEP_COPY);
    expect(g.STEP_COPY.harbor.title).toBe('Get Harbor');
  });
});

describe('first open on the desktop', () => {
  it('opens the guided walk wherever Harbor Lite runs, not only on the phone', () => {
    const store = read('src', 'state', 'store.ts');
    expect(store).toContain('if (harborLiteHere()) void get().beginGuidedSetup();');
    expect(store).not.toContain('if (isPhone()) void get().beginGuidedSetup();');
  });

  it('has no sample page: the row, the action, and the files are gone', () => {
    expect(read('src', 'screens', 'ChatScreen.tsx')).not.toMatch(/sample page|trySampleProject/i);
    expect(read('src', 'state', 'store.ts')).not.toMatch(/trySampleProject|createSample/);
    expect(read('electron', 'preload.cjs')).not.toContain('createSample');
    expect(read('electron', 'main.ts')).not.toContain('osc:createSample');
    expect(existsSync(join(process.cwd(), 'src', 'lib', 'sampleProject.ts'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'electron', 'sampleProject.ts'))).toBe(false);
  });
});
