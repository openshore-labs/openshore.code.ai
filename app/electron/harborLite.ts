// Harbor Lite on the desktop: the same bundled guide the phone carries
// (SmolLM2-135M, harbor-mini.gguf), run in the main process on llama.cpp
// through node-llama-cpp, so a first open on a computer meets the same guide
// with nothing to install and no network (founder, 2026-10-19: the desktop's
// first open is the phone's). It answers only Harbor Lite: every other model
// on a computer runs through Ollama, the engine, or a key. The renderer reaches
// it through the same contract as the phone's plugin (src/lib/llamaPlugin.ts),
// so the guide's driver, its harness and its walk are one code path.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The one model this host runs, the phone's slot id. */
export const HARBOR_LITE_ID = 'harbor-mini';
/** The weights' file name, inside the app's resources (electron-builder's
 *  extraResources, fetched at build time by scripts/fetch-harbor-lite.mjs). */
export const HARBOR_LITE_FILE = 'harbor-mini.gguf';

export interface HarborLiteMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface HarborLiteGenerate {
  requestId: string;
  system: string;
  messages: HarborLiteMessage[];
  maxTokens?: number;
  temperature?: number;
}

/** What the host says back to the renderer, shaped as the phone plugin's
 *  'token' and 'generationDone' events. */
export type HarborLiteEvent =
  | { kind: 'token'; requestId: string; delta: string }
  | {
      kind: 'generationDone';
      requestId: string;
      stopReason: 'end' | 'stopped' | 'error';
      detail?: string;
    };

/** The slice of llama.cpp this host uses, injectable so the states are pinned
 *  by tests on a machine with no weights. */
export interface HarborLiteEngine {
  load(path: string, contextSize: number): Promise<void>;
  unload(): Promise<void>;
  generate(
    req: Omit<HarborLiteGenerate, 'requestId'>,
    onText: (delta: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

/** Where the weights live: the packaged app's resources, or `build/models` in
 *  a checkout (the same fetch script fills it). */
export function harborLitePath(opts: {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  return opts.packaged
    ? join(opts.resourcesPath, 'models', HARBOR_LITE_FILE)
    : join(opts.appPath, 'build', 'models', HARBOR_LITE_FILE);
}

export const HARBOR_LITE_MISSING =
  'Harbor Lite is not in this build. Reinstall OpenShore from openshore.ai to get it back.';

export class HarborLiteHost {
  private loaded: number | undefined;
  private loading: Promise<{ ok: boolean; detail?: string }> | undefined;
  private active: { requestId: string; abort: AbortController } | undefined;

  constructor(
    private readonly path: string,
    private readonly emit: (event: HarborLiteEvent) => void,
    private readonly engine: HarborLiteEngine = nodeLlamaEngine(),
    private readonly exists: (path: string) => boolean = existsSync,
  ) {}

  /** The bundled weights are on disk. */
  present(): boolean {
    return this.exists(this.path);
  }

  async load(id: string, contextSize = 4096): Promise<{ ok: boolean; detail?: string }> {
    if (id !== HARBOR_LITE_ID) {
      return { ok: false, detail: 'Only Harbor Lite runs inside the desktop app.' };
    }
    if (!this.present()) return { ok: false, detail: HARBOR_LITE_MISSING };
    if (this.loaded === contextSize) return { ok: true };
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        this.stopActive();
        if (this.loaded !== undefined) await this.engine.unload();
        this.loaded = undefined;
        await this.engine.load(this.path, contextSize);
        this.loaded = contextSize;
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: `Harbor Lite would not load: ${(err as Error).message}` };
      } finally {
        this.loading = undefined;
      }
    })();
    return this.loading;
  }

  async unload(): Promise<void> {
    this.stopActive();
    if (this.loaded === undefined) return;
    this.loaded = undefined;
    await this.engine.unload().catch(() => {});
  }

  /** Starts a reply and returns at once; text and the end arrive as events.
   *  One reply at a time, like the phone's single slot: a new one stops the
   *  one before. */
  generate(req: HarborLiteGenerate): { started: boolean } {
    if (this.loaded === undefined) {
      this.emit({
        kind: 'generationDone',
        requestId: req.requestId,
        stopReason: 'error',
        detail: 'Harbor Lite is not loaded.',
      });
      return { started: false };
    }
    this.stopActive();
    const abort = new AbortController();
    const mine = { requestId: req.requestId, abort };
    this.active = mine;
    const { requestId, ...rest } = req;
    void this.engine
      .generate(rest, (delta) => this.emit({ kind: 'token', requestId, delta }), abort.signal)
      .then(
        () =>
          this.emit({
            kind: 'generationDone',
            requestId,
            stopReason: abort.signal.aborted ? 'stopped' : 'end',
          }),
        (err: unknown) =>
          this.emit({
            kind: 'generationDone',
            requestId,
            stopReason: abort.signal.aborted ? 'stopped' : 'error',
            ...(abort.signal.aborted ? {} : { detail: (err as Error)?.message ?? String(err) }),
          }),
      )
      .finally(() => {
        if (this.active === mine) this.active = undefined;
      });
    return { started: true };
  }

  stop(requestId: string): void {
    if (this.active?.requestId === requestId) this.stopActive();
  }

  private stopActive(): void {
    this.active?.abort.abort();
    this.active = undefined;
  }
}

/** The real engine: node-llama-cpp's prebuilt CPU binary (Metal on a Mac),
 *  loaded on first use so a launch that never opens Harbor Lite pays nothing.
 *  The model's own chat template (from the GGUF) formats the turns. */
export function nodeLlamaEngine(): HarborLiteEngine {
  // Typed loosely: node-llama-cpp is ESM and loaded on demand.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let model: any;
  let context: any;
  let mod: any;
  // The context has one sequence. A reply that replaces another starts while
  // the one before is still letting go of it, so each waits its turn.
  let turn: Promise<void> = Promise.resolve();
  return {
    async load(path, contextSize) {
      mod ??= await import('node-llama-cpp');
      const llama = await mod.getLlama({
        build: 'never',
        gpu: process.platform === 'darwin' ? 'metal' : false,
      });
      model = await llama.loadModel({ modelPath: path });
      context = await model.createContext({ contextSize });
    },
    async unload() {
      await context?.dispose();
      await model?.dispose();
      context = undefined;
      model = undefined;
    },
    async generate(req, onText, signal) {
      const before = turn;
      let release!: () => void;
      turn = new Promise((resolve) => (release = resolve));
      try {
        await before;
      } catch {
        // The reply before failed; its sequence is already let go.
      }
      if (signal.aborted) {
        release();
        return;
      }
      if (!context) {
        release();
        throw new Error('Harbor Lite is not loaded.');
      }
      const sequence = context.getSequence();
      const chat = new mod.LlamaChat({ contextSequence: sequence });
      try {
        await chat.generateResponse(
          [
            { type: 'system', text: req.system },
            ...req.messages.map((m) =>
              m.role === 'user'
                ? { type: 'user', text: m.content }
                : { type: 'model', response: [m.content] },
            ),
            { type: 'model', response: [] },
          ],
          {
            maxTokens: req.maxTokens,
            temperature: req.temperature,
            signal,
            stopOnAbortSignal: true,
            onTextChunk: onText,
          },
        );
      } finally {
        chat.dispose({ disposeSequence: true });
        release();
      }
    },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
