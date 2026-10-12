// ComfyUI, reached over its HTTP API (the model library, 2026-10-12). It runs
// the picture, photo-editing, video, music and sound-effect jobs. ComfyUI is
// GPL-3.0 and a separate program the person installs; OpenShore only talks to
// it, from the engine (a call from a web page is refused by ComfyUI's origin
// guard unless it was started with --enable-cors-header).
//
// The routes it calls, and nothing else (ComfyUI's server.py at v0.39):
//   GET  /system_stats              health and version
//   GET  /object_info/<class>       whether a node exists, before a run
//   POST /upload/image              a picture the job starts from
//   POST /prompt                    run a graph: { prompt, client_id }
//   GET  /history/<prompt_id>       empty while it runs, its outputs when done
//   GET  /view?filename=&subfolder=&type=output   an output file
//   POST /interrupt                 Stop, for this prompt only
//
// It talks only to the address the person set (media.comfyui.baseUrl, machine
// config).
import { randomUUID } from 'node:crypto';
import type { ApiGraph } from './graphs.js';

export interface ComfyOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** How long one run may take, in ms. A video on a CPU is slow. */
  runTimeoutMs?: number;
  /** How often to ask whether a run is done, in ms. */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ComfyFile {
  filename: string;
  subfolder: string;
  type: string;
}

export class ComfyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ComfyError';
  }
}

export class ComfyClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: ComfyOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    // A redirect is never followed (security review, 2026-10-12): a 307
    // would re-send an upload, and the key, to wherever it points.
    const send = options.fetchImpl ?? fetch;
    this.fetchImpl = (input, init) => send(input, { ...init, redirect: 'error' });
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Whether ComfyUI answers, and its version when it says. */
  async health(): Promise<{ ok: boolean; detail: string; version?: string }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return { ok: false, detail: `ComfyUI answered ${res.status}.` };
      const body = (await res.json()) as { system?: { comfyui_version?: unknown } };
      const version =
        typeof body.system?.comfyui_version === 'string' ? body.system.comfyui_version : undefined;
      return {
        ok: true,
        detail: `ComfyUI${version ? ` ${version}` : ''} is up at ${this.baseUrl}`,
        ...(version ? { version } : {}),
      };
    } catch {
      return {
        ok: false,
        detail: `No ComfyUI at ${this.baseUrl}. Start it, or take the job out of your Stack.`,
      };
    }
  }

  /** The node classes this ComfyUI does not have, of the ones named. */
  async missingNodes(classes: string[]): Promise<string[]> {
    const missing: string[] = [];
    for (const name of classes) {
      const res = await this.fetchImpl(`${this.baseUrl}/object_info/${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        missing.push(name);
        continue;
      }
      const body = (await res.json()) as Record<string, unknown>;
      if (!body || !(name in body)) missing.push(name);
    }
    return missing;
  }

  /** Put a picture in ComfyUI's input folder. Returns the name a LoadImage
   *  node reads, with its subfolder when ComfyUI chose one. */
  async upload(bytes: Uint8Array, filename: string): Promise<string> {
    const form = new FormData();
    form.append('image', new Blob([bytes]), filename);
    form.append('type', 'input');
    form.append('subfolder', 'openshore');
    form.append('overwrite', 'true');
    const res = await this.fetchImpl(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok)
      throw new ComfyError(`ComfyUI would not take the picture (${res.status}).`, res.status);
    const body = (await res.json()) as { name?: unknown; subfolder?: unknown };
    if (typeof body.name !== 'string')
      throw new ComfyError('ComfyUI took the picture but gave no name.');
    return typeof body.subfolder === 'string' && body.subfolder
      ? `${body.subfolder}/${body.name}`
      : body.name;
  }

  /** Run a graph to its end and return the files it saved. Stop interrupts
   *  this prompt (and only this one) and ends the wait. */
  async run(graph: ApiGraph, signal?: AbortSignal): Promise<ComfyFile[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: randomUUID() }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: { message?: unknown }; node_errors?: unknown };
        detail = typeof body.error?.message === 'string' ? body.error.message : '';
      } catch {}
      throw new ComfyError(
        `ComfyUI refused the workflow (${res.status})${detail ? `: ${detail}` : ''}. A missing model file is the usual cause; Get puts each file in place.`,
        res.status,
      );
    }
    const { prompt_id: id } = (await res.json()) as { prompt_id?: string };
    if (!id) throw new ComfyError('ComfyUI queued nothing.');

    const deadline = Date.now() + (this.options.runTimeoutMs ?? 60 * 60_000);
    const poll = this.options.pollMs ?? 1000;
    for (;;) {
      if (signal?.aborted) {
        await this.interrupt(id);
        throw new ComfyError('Stopped.');
      }
      if (Date.now() > deadline) {
        await this.interrupt(id);
        throw new ComfyError('ComfyUI took too long, so the job was stopped.');
      }
      const h = await this.fetchImpl(`${this.baseUrl}/history/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (h.ok) {
        const body = (await h.json()) as Record<string, HistoryEntry>;
        const entry = body[id];
        if (entry) return finished(entry);
      }
      await this.sleep(poll);
    }
  }

  async interrupt(promptId: string): Promise<void> {
    try {
      await this.fetchImpl(`${this.baseUrl}/interrupt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt_id: promptId }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {}
  }

  /** One output file's bytes. */
  async fetchFile(file: ComfyFile): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const q = new URLSearchParams({
      filename: file.filename,
      subfolder: file.subfolder,
      type: file.type,
    });
    const res = await this.fetchImpl(`${this.baseUrl}/view?${q.toString()}`, {
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok)
      throw new ComfyError(`ComfyUI would not hand back ${file.filename} (${res.status}).`);
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mediaType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }
}

interface HistoryEntry {
  outputs?: Record<string, { images?: ComfyFile[]; audio?: ComfyFile[]; gifs?: ComfyFile[] }>;
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: Array<[string, Record<string, unknown>]>;
  };
}

/** A finished history entry's saved files, or its error as a ComfyError. A
 *  video lands under `images` with `animated`; a sound under `audio`. Only
 *  saved outputs count (`type: output`), never previews. */
export function finished(entry: HistoryEntry): ComfyFile[] {
  if (entry.status?.status_str === 'error') {
    const error = entry.status.messages?.find(([event]) => event === 'execution_error')?.[1];
    const message =
      typeof error?.exception_message === 'string' ? error.exception_message.trim() : '';
    const node = typeof error?.node_type === 'string' ? ` in ${error.node_type}` : '';
    throw new ComfyError(`ComfyUI stopped${node}${message ? `: ${message}` : '.'}`);
  }
  const files: ComfyFile[] = [];
  for (const out of Object.values(entry.outputs ?? {})) {
    for (const f of [...(out.images ?? []), ...(out.gifs ?? []), ...(out.audio ?? [])]) {
      if (f && typeof f.filename === 'string' && (f.type ?? 'output') === 'output') {
        files.push({
          filename: f.filename,
          subfolder: f.subfolder ?? '',
          type: f.type ?? 'output',
        });
      }
    }
  }
  if (!files.length) throw new ComfyError('ComfyUI finished but saved nothing.');
  return files;
}
