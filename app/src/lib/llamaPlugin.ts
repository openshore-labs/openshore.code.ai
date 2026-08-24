// The on-device inference plugin: llama.cpp on the iPhone's Metal GPU,
// reached through a small Capacitor plugin (Swift side in
// app/plugins/oscode-llama). This file is the JS contract plus a web mock so
// the app runs and demos everywhere the native side is absent.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface DeviceModelInfo {
  id: string;
  fileName: string;
  sizeBytes: number;
}

export interface LlamaPluginContract {
  /** Can this device run local inference at all? */
  isSupported(): Promise<{ supported: boolean; reason?: string }>;
  /** Models already downloaded into the app's storage. */
  listModels(): Promise<{ models: DeviceModelInfo[] }>;
  /** Download a GGUF straight from its source; progress via 'downloadProgress'.
   *  The transfer runs on a background URLSession, so it keeps going while the
   *  app is backgrounded or closed and the app is relaunched to finish it. */
  downloadModel(options: { id: string; url: string }): Promise<{ path: string }>;
  /** Model ids the background session is still transferring right now. Used on
   *  launch to re-show progress for a download that was mid-flight. */
  activeDownloads(): Promise<{ ids: string[] }>;
  cancelDownload(options: { id: string }): Promise<void>;
  deleteModel(options: { id: string }): Promise<void>;
  /** Load a downloaded model into memory (frees any previous one). */
  load(options: { id: string; contextSize?: number }): Promise<{ ok: boolean; detail?: string }>;
  unload(): Promise<void>;
  /** Start a generation; token deltas via 'token', end via 'generationDone'. */
  generate(options: {
    requestId: string;
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ started: boolean }>;
  stop(options: { requestId: string }): Promise<void>;

  /** Keychain-backed secret storage (iOS). Off iOS, unused (see platform.ts). */
  secureGet(options: { key: string }): Promise<{ value: string | null }>;
  secureSet(options: { key: string; value: string }): Promise<void>;
  secureDelete(options: { key: string }): Promise<void>;

  addListener(
    eventName: 'downloadProgress',
    listener: (data: { id: string; completed: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'token',
    listener: (data: { requestId: string; delta: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'generationDone',
    listener: (data: {
      requestId: string;
      stopReason: 'end' | 'stopped' | 'error';
      detail?: string;
    }) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Web mock: a tiny canned brain so the UI is drivable in a browser and in
// screenshots. It is honest about being a demo.
// ---------------------------------------------------------------------------

class LlamaWeb {
  private models: DeviceModelInfo[] = [];
  private listeners = new Map<string, Set<(data: any) => void>>();
  private stopped = new Set<string>();

  private fire(event: string, data: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(data);
  }

  async isSupported() {
    return { supported: true, reason: 'demo mode (no native inference in a browser)' };
  }

  async listModels() {
    return { models: this.models };
  }

  async downloadModel({ id }: { id: string; url: string }) {
    const total = 1_100_000_000;
    for (let step = 1; step <= 10; step++) {
      await new Promise((r) => setTimeout(r, 120));
      this.fire('downloadProgress', { id, completed: (total / 10) * step, total });
    }
    const model = { id, fileName: `${id}.gguf`, sizeBytes: total };
    this.models = [...this.models.filter((m) => m.id !== id), model];
    return { path: `demo://${id}.gguf` };
  }

  async activeDownloads() {
    return { ids: [] as string[] };
  }

  async cancelDownload() {}

  async deleteModel({ id }: { id: string }) {
    this.models = this.models.filter((m) => m.id !== id);
  }

  async load() {
    return { ok: true };
  }

  async unload() {}

  async generate({
    requestId,
    messages,
  }: {
    requestId: string;
    messages: Array<{ content: string }>;
  }) {
    const last = messages[messages.length - 1]?.content ?? '';
    const reply = `(demo) A local model would answer "${last.slice(0, 60)}" right here, fully offline. On an iPhone this streams from llama.cpp on the Metal GPU.`;
    void (async () => {
      for (const word of reply.split(' ')) {
        if (this.stopped.has(requestId)) break;
        await new Promise((r) => setTimeout(r, 40));
        this.fire('token', { requestId, delta: `${word} ` });
      }
      this.fire('generationDone', {
        requestId,
        stopReason: this.stopped.has(requestId) ? 'stopped' : 'end',
      });
      this.stopped.delete(requestId);
    })();
    return { started: true };
  }

  async stop({ requestId }: { requestId: string }) {
    this.stopped.add(requestId);
  }

  async secureGet({ key }: { key: string }) {
    return { value: localStorage.getItem(key) };
  }

  async secureSet({ key, value }: { key: string; value: string }) {
    localStorage.setItem(key, value);
  }

  async secureDelete({ key }: { key: string }) {
    localStorage.removeItem(key);
  }

  async addListener(eventName: string, listener: (data: any) => void) {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
    this.listeners.get(eventName)!.add(listener);
    return { remove: async () => void this.listeners.get(eventName)?.delete(listener) };
  }

  async removeAllListeners() {
    this.listeners.clear();
  }
}

export const Llama = registerPlugin<LlamaPluginContract>('OscodeLlama', {
  web: () => new LlamaWeb() as unknown as LlamaPluginContract,
});
