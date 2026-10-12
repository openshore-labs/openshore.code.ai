// Install: a direct pull from the SOURCE (ollama pull, or the printed
// Hugging Face command), never from OpenShore. The license is shown before
// anything downloads.
import { spawn } from 'node:child_process';
import type { CatalogModel } from './schema.js';
import { SOURCE_NAMES } from './sources.js';
import { machineOffline } from '../core/agent/offline.js';
import { pullFailedLine, pullFailure, type PullResult } from './pullLine.js';
import { isOllamaCloudTag } from '../harness/locality.js';

/** A pull asked for while this computer has no network (Desktop Offline):
 *  one plain line instead of the model server's own error about a lookup. */
export const OFFLINE_DOWNLOAD = 'Offline. Models download once your computer is back online.';

export interface InstallProgress {
  /** The raw status line, e.g. "pulling manifest" or "downloading". */
  line: string;
  /** 0..100 when the source reports byte totals (the API path does). */
  percent?: number;
  completed?: number;
  total?: number;
}

export interface InstallOptions {
  /** Ollama base URL for the structured pull. Defaults to localhost. */
  baseUrl?: string;
}

/** What a finished pull says: where the model runs. A cloud tag's "pull"
 *  only registers it with the local Ollama, which passes every request on to
 *  ollama.com, so it says so (CX and CMO, 2026-10-08, B). */
export function pulledLine(ref: string): string {
  return isOllamaCloudTag(ref)
    ? `${ref} is ready. It runs on Ollama's cloud, under your Ollama account, not on this computer, so the Stack lists it apart as a cloud model.`
    : `${ref} is pulled and ready.`;
}

/** The license block a user sees before the pull starts. */
export function licenseNotice(model: CatalogModel): string {
  const lines = [`${model.name} is licensed under ${model.license.name} (${model.license.id}).`];
  if (model.license.note) lines.push(model.license.note);
  if (model.license.url) lines.push(`Full text: ${model.license.url}`);
  if (model.license.conditions) lines.push(model.license.conditions);
  lines.push(
    `Weights come straight from ${SOURCE_NAMES[model.source.kind]}, never from OpenShore.`,
  );
  return lines.join('\n');
}

/**
 * Pull an Ollama-sourced model, streaming progress. The structured Ollama
 * /api/pull endpoint is tried first: it reports exact byte totals, which drive
 * a real progress bar. If the daemon is not answering the HTTP API, this falls
 * back to spawning `ollama pull`. Either way the weights come straight from
 * the Ollama library, never from OpenShore. Hugging Face sources get the exact
 * command printed instead (llama.cpp and vLLM setups vary too much to guess).
 */
export async function installModel(
  model: CatalogModel,
  onProgress: (progress: InstallProgress) => void,
  options: InstallOptions = {},
): Promise<PullResult> {
  if (model.source.kind !== 'ollama') {
    return {
      ok: false,
      detail: `This model comes from ${SOURCE_NAMES[model.source.kind]}. Fetch it with:\n  ${model.source.pullCommand}\nthen point your stack at wherever your server loads it.`,
    };
  }
  return installOllamaRef(model.source.ref, onProgress, options);
}

/** Pull ANY Ollama model by its raw ref (e.g. "qwen3-coder:30b", "gemma3:12b"),
 *  not just a catalog entry, so the marketplace is never limited to the models
 *  we happened to enumerate: whatever is on the Ollama library, the user can
 *  install and place. Same structured pull, same plain failure line as a
 *  catalog install. The ref is trusted as an Ollama model name; a bad name
 *  says Ollama has no model by that name, never a fabricated ok. */
export async function installOllamaRef(
  ref: string,
  onProgress: (progress: InstallProgress) => void,
  options: InstallOptions = {},
): Promise<PullResult> {
  const clean = ref.trim();
  if (!clean) return { ok: false, detail: 'Enter an Ollama model name, for example qwen3:8b.' };
  // The desktop's main process set the machine flag for no network: the pull
  // could only fail, so say why plainly (a chosen Offline still downloads).
  if (machineOffline().reason === 'network') {
    return { ok: false, detail: OFFLINE_DOWNLOAD, reason: 'offline' };
  }
  const baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  const viaApi = await pullViaApi(clean, baseUrl, onProgress);
  if (viaApi) return viaApi;
  return pullViaCli(clean, onProgress);
}

/** Structured pull over /api/pull. Returns null if the API is unreachable. */
async function pullViaApi(
  ref: string,
  baseUrl: string,
  onProgress: (progress: InstallProgress) => void,
): Promise<PullResult | null> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: ref, stream: true }),
    });
  } catch {
    return null; // daemon not answering the API; let the CLI try
  }
  if (!res.ok || !res.body) return null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Ollama ends a successful pull with an explicit {"status":"success"} line.
  // A stream that simply ends (dropped connection, truncated body) is NOT a
  // success, so track it and only report ok:true when we actually saw it.
  let sawSuccess = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof obj.error === 'string') {
          // Ollama's own words name the cause; the person reads what failed
          // and the way on (pullLine.ts), never the server's error.
          return failed(ref, pullFailure(obj.error));
        }
        const status = String(obj.status ?? '');
        if (status === 'success') sawSuccess = true;
        const total = typeof obj.total === 'number' ? obj.total : undefined;
        const completed = typeof obj.completed === 'number' ? obj.completed : undefined;
        const percent = total && completed !== undefined ? (completed / total) * 100 : undefined;
        onProgress({ line: status, percent, total, completed });
      }
    }
  } catch {
    // A connection dropped mid-pull must surface as a clean failure, not throw
    // out of the CLI flow.
    return failed(ref, 'stopped');
  }
  // A stream that ended before Ollama said success stopped partway.
  if (!sawSuccess) return failed(ref, 'stopped');
  return { ok: true, detail: pulledLine(ref) };
}

/** A failed pull: the plain line and why. */
function failed(
  ref: string,
  reason: Exclude<PullResult['reason'], 'offline' | undefined>,
): PullResult {
  return { ok: false, detail: pullFailedLine(ref, reason), reason };
}

/** CLI fallback: spawn `ollama pull` and forward its lines (no byte totals). */
function pullViaCli(
  ref: string,
  onProgress: (progress: InstallProgress) => void,
): Promise<PullResult> {
  return new Promise((resolve) => {
    const child = spawn('ollama', ['pull', ref], { stdio: ['ignore', 'pipe', 'pipe'] });
    // The last line the command printed, which names the cause when it fails.
    let last = '';
    const forward = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        last = trimmed;
        const m = /(\d+)%/.exec(trimmed);
        onProgress({ line: trimmed, percent: m ? Number(m[1]) : undefined });
      }
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', () => {
      // The command rides on its own paragraph, never inside the sentence, so
      // the app renders it as a copy block (tenet 9) and the CLI prints it on
      // its own line.
      resolve({
        ok: false,
        detail:
          'Could not run ollama. Install it first.\n\ncurl -fsSL https://ollama.com/install.sh | sh',
      });
    });
    child.on('close', (code) => {
      resolve(code === 0 ? { ok: true, detail: pulledLine(ref) } : failed(ref, pullFailure(last)));
    });
  });
}
