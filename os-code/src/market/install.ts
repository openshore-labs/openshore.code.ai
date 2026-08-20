// Install: a direct pull from the SOURCE (ollama pull, or the printed
// Hugging Face command), never from OpenShore. The license is shown before
// anything downloads.
import { spawn } from 'node:child_process';
import type { CatalogModel } from './schema.js';

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

/** The license block a user sees before the pull starts. */
export function licenseNotice(model: CatalogModel): string {
  const lines = [`${model.name} is licensed under ${model.license.name} (${model.license.id}).`];
  if (model.license.note) lines.push(model.license.note);
  if (model.license.url) lines.push(`Full text: ${model.license.url}`);
  lines.push(
    `Weights come straight from ${model.source.kind === 'ollama' ? 'the Ollama library' : 'Hugging Face'}, never from OpenShore.`,
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
): Promise<{ ok: boolean; detail: string }> {
  if (model.source.kind !== 'ollama') {
    return {
      ok: false,
      detail: `This model comes from Hugging Face. Fetch it with:\n  ${model.source.pullCommand}\nthen point your stack at wherever your server loads it.`,
    };
  }
  const baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  const viaApi = await pullViaApi(model.source.ref, baseUrl, onProgress);
  if (viaApi) return viaApi;
  return pullViaCli(model.source.ref, onProgress);
}

/** Structured pull over /api/pull. Returns null if the API is unreachable. */
async function pullViaApi(
  ref: string,
  baseUrl: string,
  onProgress: (progress: InstallProgress) => void,
): Promise<{ ok: boolean; detail: string } | null> {
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
          return { ok: false, detail: `Ollama could not pull ${ref}: ${obj.error}` };
        }
        const status = String(obj.status ?? '');
        if (status === 'success') sawSuccess = true;
        const total = typeof obj.total === 'number' ? obj.total : undefined;
        const completed = typeof obj.completed === 'number' ? obj.completed : undefined;
        const percent = total && completed !== undefined ? (completed / total) * 100 : undefined;
        onProgress({ line: status, percent, total, completed });
      }
    }
  } catch (err) {
    // A connection dropped mid-pull must surface as a clean failure, not throw
    // out of the CLI flow.
    return {
      ok: false,
      detail: `The pull of ${ref} was interrupted: ${(err as Error).message}. Check your connection and disk space, then try again.`,
    };
  }
  if (!sawSuccess) {
    return {
      ok: false,
      detail: `The pull of ${ref} ended before Ollama reported success. Check your connection and disk space, then try again.`,
    };
  }
  return { ok: true, detail: `${ref} is pulled and ready.` };
}

/** CLI fallback: spawn `ollama pull` and forward its lines (no byte totals). */
function pullViaCli(
  ref: string,
  onProgress: (progress: InstallProgress) => void,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn('ollama', ['pull', ref], { stdio: ['ignore', 'pipe', 'pipe'] });
    const forward = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = /(\d+)%/.exec(trimmed);
        onProgress({ line: trimmed, percent: m ? Number(m[1]) : undefined });
      }
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', () => {
      resolve({
        ok: false,
        detail:
          'Could not run ollama. Install it first: curl -fsSL https://ollama.com/install.sh | sh',
      });
    });
    child.on('close', (code) => {
      resolve(
        code === 0
          ? { ok: true, detail: `${ref} is pulled and ready.` }
          : {
              ok: false,
              detail: `ollama pull exited with code ${code}. Check connectivity and disk space, then try again.`,
            },
      );
    });
  });
}
