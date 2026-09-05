// The on-device inference plugin: llama.cpp on the iPhone's Metal GPU,
// reached through a small Capacitor plugin (Swift side in
// app/plugins/oscode-llama). This file is the JS contract plus a web mock so
// the app runs and demos everywhere the native side is absent.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface DeviceModelInfo {
  id: string;
  fileName: string;
  sizeBytes: number;
  /** Where the bytes live. 'icloud' is the app's iCloud Drive container; such a
   *  model may be evicted (placeholder only) until ensureLocal pulls it back. */
  location?: 'device' | 'icloud';
  /** True for an iCloud model whose bytes are not on this device right now. */
  evicted?: boolean;
}

/** Where a model download should land. 'device' is this phone's own storage;
 *  'icloud' is the app's iCloud Drive container, so a model too big for the
 *  phone still has a home and is pulled back on demand when you are online. */
export type StorageTarget = 'device' | 'icloud';

/** This device's live storage and memory, for the capacity monitor. Bytes for
 *  storage; ramBytes is the physical memory, used to size a machine
 *  recommendation. A zero anywhere means "could not read it" (older native
 *  builds, or the web mock), which the UI degrades around rather than trusting. */
export interface DeviceCapacity {
  freeBytes: number;
  totalBytes: number;
  ramBytes: number;
}

export interface LlamaPluginContract {
  /** Can this device run local inference at all? */
  isSupported(): Promise<{ supported: boolean; reason?: string }>;
  /** Live storage and memory for the capacity monitor. */
  deviceCapacity(): Promise<DeviceCapacity>;
  /** Models already downloaded, on this device or in iCloud. */
  listModels(): Promise<{ models: DeviceModelInfo[] }>;
  /** Download a GGUF straight from its source; progress via 'downloadProgress'.
   *  The transfer runs on a background URLSession, so it keeps going while the
   *  app is backgrounded or closed and the app is relaunched to finish it.
   *  `target` chooses where the bytes land (default 'device'); 'icloud' places
   *  them in the app's iCloud Drive container so a large model never has to fit
   *  on the phone. */
  downloadModel(options: {
    id: string;
    url: string;
    target?: StorageTarget;
  }): Promise<{ path: string; location: StorageTarget }>;
  /** Make an iCloud-stored model's bytes present on this device, downloading
   *  them if they were evicted. A no-op for a device model or one already
   *  materialized. `ready` is false only when it could not be fetched (offline
   *  with an evicted model); `downloading` says a fetch is under way. */
  ensureLocal(options: { id: string }): Promise<{ ready: boolean; downloading?: boolean }>;
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

  /** Ask for notification permission and, if granted, register for APNs. The
   *  token then arrives via the 'pushToken' event (and getPushToken). */
  requestPushPermission(): Promise<{ granted: boolean }>;
  /** The current APNs device token, or null until one has been issued.
   *  `environment` selects which APNs host the token is valid against. */
  getPushToken(): Promise<{ token: string | null; environment: 'sandbox' | 'production' }>;

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
  addListener(
    eventName: 'pushToken',
    listener: (data: { token: string; environment: 'sandbox' | 'production' }) => void,
  ): Promise<PluginListenerHandle>;
  /** The native side unloaded the loaded model on its own, e.g. after an iOS
   *  memory warning. The JS slot owner listens and forgets its claim so the
   *  next send reloads instead of generating against an empty slot. */
  addListener(
    eventName: 'deviceModelUnloaded',
    listener: (data: { reason: string }) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Web / desktop fallback: this device has no native llama.cpp, so on-device
// inference genuinely cannot run here. This stub is HONEST about that: it never
// fabricates an answer. It still serves the download-progress and secure-store
// surfaces so those flows are drivable off a phone, but load() reports an
// unavailable model (the drivers surface that as a real, guided error) and
// generate() refuses outright. A shipping desktop/web build must route real
// answers to the daemon, Ollama, or a cloud key, never to a device model, so
// the stack-readiness gate (see stackReady in stack.ts) keeps callers off this
// path in the first place; this refusal is the belt-and-suspenders behind it.
// ---------------------------------------------------------------------------

// The single source of truth for the "no on-device inference here" message, so
// the driver error, the readiness gate, and this stub all say the same thing.
export const DEVICE_INFERENCE_UNAVAILABLE =
  'On-device models run on iPhone and iPad. This device runs your models through your computer, Ollama, or a cloud key instead.';

class LlamaWeb {
  private models: DeviceModelInfo[] = [];
  private listeners = new Map<string, Set<(data: any) => void>>();

  private fire(event: string, data: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(data);
  }

  async isSupported() {
    return { supported: false, reason: DEVICE_INFERENCE_UNAVAILABLE };
  }

  async deviceCapacity() {
    // Off a real phone there is no per-app volume to read. Return believable
    // numbers so the capacity monitor renders in dev and the marketplace demo,
    // never a stall; a shipping iPhone reads the real figures natively.
    return {
      freeBytes: 64 * 1e9,
      totalBytes: 128 * 1e9,
      ramBytes: 8 * 1e9,
    };
  }

  async listModels() {
    return { models: this.models };
  }

  async downloadModel({ id, target }: { id: string; url: string; target?: StorageTarget }) {
    const location: StorageTarget = target ?? 'device';
    const total = 1_100_000_000;
    for (let step = 1; step <= 10; step++) {
      await new Promise((r) => setTimeout(r, 120));
      this.fire('downloadProgress', { id, completed: (total / 10) * step, total });
    }
    const model = { id, fileName: `${id}.gguf`, sizeBytes: total, location };
    this.models = [...this.models.filter((m) => m.id !== id), model];
    return { path: `demo://${id}.gguf`, location };
  }

  async ensureLocal() {
    // The mock keeps every model materialized, so making it local is a no-op.
    return { ready: true };
  }

  async activeDownloads() {
    return { ids: [] as string[] };
  }

  async cancelDownload() {}

  async deleteModel({ id }: { id: string }) {
    this.models = this.models.filter((m) => m.id !== id);
  }

  async load() {
    // Never claim a load succeeded here. The drivers read load.ok/detail and
    // turn this into a real "run your model another way" message instead of a
    // fake answer.
    return { ok: false, detail: DEVICE_INFERENCE_UNAVAILABLE };
  }

  async unload() {}

  async generate(): Promise<{ started: boolean }> {
    // Refuse rather than fabricate. Reaching here means a caller skipped the
    // readiness gate; fail loud so the bug is caught, never a canned reply.
    throw new Error(DEVICE_INFERENCE_UNAVAILABLE);
  }

  async stop() {}

  async requestPushPermission() {
    // No APNs off a real iPhone; the guide flow treats this as "no push here".
    return { granted: false };
  }

  async getPushToken() {
    return { token: null as string | null, environment: 'production' as const };
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
