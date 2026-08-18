// Install: a direct pull from the SOURCE (ollama pull, or the printed
// Hugging Face command), never from OpenShore. The license is shown before
// anything downloads.
import { spawn } from 'node:child_process';
import type { CatalogModel } from './schema.js';

export interface InstallProgress {
  line: string;
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
 * Pull an Ollama-sourced model, streaming progress lines. Hugging Face
 * sources get the exact command printed instead (llama.cpp and vLLM setups
 * vary too much to guess at).
 */
export function installModel(
  model: CatalogModel,
  onProgress: (progress: InstallProgress) => void,
): Promise<{ ok: boolean; detail: string }> {
  if (model.source.kind !== 'ollama') {
    return Promise.resolve({
      ok: false,
      detail: `This model comes from Hugging Face. Fetch it with:\n  ${model.source.pullCommand}\nthen point your stack at wherever your server loads it.`,
    });
  }
  return new Promise((resolve) => {
    const child = spawn('ollama', ['pull', model.source.ref], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const forward = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) onProgress({ line: line.trim() });
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
          ? { ok: true, detail: `${model.source.ref} is pulled and ready.` }
          : {
              ok: false,
              detail: `ollama pull exited with code ${code}. Check connectivity and disk space, then try again.`,
            },
      );
    });
  });
}
