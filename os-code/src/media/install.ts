// Get, for a media model (the model library, 2026-10-12). Chat models install
// through Ollama (market/install.ts); a media model is files for ComfyUI, a
// model a speech server fetches from its own gallery, or a program on this
// computer. This puts each in place and then fills the job it was picked for
// in the Stack.
//
//   ComfyUI   each file straight from its source (Hugging Face, a GitHub
//             release) into ComfyUI's own models folder: started at a host its
//             source kind allows (market/sources.ts), through the egress
//             policy (every redirect hop re-checked, https and off this
//             network), written to a .part file no bigger than the file is
//             said to be, checked against the SHA-256 the catalog names, and
//             only then moved into place. A file the catalog names no SHA-256
//             for is never fetched (security review, 2026-10-12): anyone can
//             upload to these hosts, so the host alone proves nothing. A file
//             already there at its size is kept.
//   speech    the speech server asked to fetch the model from its own gallery
//             (LocalAI's /models/apply), and followed until it says done.
//   programs  audio-separator and deepFilter are checked for; a missing one
//             says the exact pip line, since OpenShore never installs Python
//             packages on its own.
//
// OpenShore never rehosts or proxies weights: every byte comes from the source.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { MediaPlacement, OscConfig } from '../config/schema.js';
import { EgressPolicy, isLocalUrl } from '../core/security/egress.js';
import { scrubbedEnv } from '../core/exec/childEnv.js';
import { picksForModel } from '../market/library.js';
import type { Catalog, CatalogFile, CatalogModel } from '../market/schema.js';
import { installModel as installOllamaModel, type InstallProgress } from '../market/install.js';
import type { PullResult } from '../market/pullLine.js';
import { saveMediaPlacement } from '../config/load.js';
import { fileHostAllowed } from '../market/sources.js';
import { MEDIA_JOB_INFO, type MediaJob } from './jobs.js';
import { SpeechClient } from './speech.js';

export interface MediaInstallProgress {
  line: string;
  percent?: number;
  completed?: number;
  total?: number;
}

export interface MediaInstallResult {
  ok: boolean;
  detail: string;
  /** The placement to save, when the model is ready to fill its job. */
  placement?: MediaPlacement;
  job?: MediaJob;
  /** The folder ComfyUI's files went into, when it was found. */
  modelsDir?: string;
}

export interface MediaInstallDeps {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Folders to try for ComfyUI's models, in order (tests stand them in). */
  comfyCandidates?: string[];
  /** Whether a program runs here (tests stand it in). */
  programRuns?: (command: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
}

/** Where ComfyUI keeps its models, by install type (the ComfyUI research,
 *  2026-10-12): Comfy Desktop's shared library, the legacy desktop app's
 *  Documents folder, and a manual install in the home folder. */
export function comfyModelsCandidates(home = homedir(), env = process.env): string[] {
  const out = [
    join(home, 'ComfyUI-Shared', 'models'),
    join(home, 'Documents', 'ComfyUI', 'models'),
    join(home, 'ComfyUI', 'models'),
  ];
  if (env.LOCALAPPDATA)
    out.splice(1, 0, join(env.LOCALAPPDATA, 'Comfy-Desktop', 'ComfyUI-Shared', 'models'));
  return out;
}

/** ComfyUI's models folder: the one the person set, else the first of the
 *  usual places that exists. */
export function comfyModelsDir(
  config: OscConfig,
  candidates = comfyModelsCandidates(),
): string | undefined {
  if (config.media.comfyui?.modelsDir) return config.media.comfyui.modelsDir;
  return candidates.find((dir) => existsSync(dir));
}

/** A file's place under the models folder, refused when it would leave it
 *  (a catalog `dest` is data, so it is checked like any path from outside). */
export function destPath(modelsDir: string, dest: string): string {
  const root = resolve(modelsDir);
  const full = resolve(root, dest);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error(`A file would land outside ComfyUI's models folder: ${dest}`);
  return full;
}

/** The job a Get fills: the job of the shelf the store says it came from,
 *  only when the model is a pick on that shelf (security review,
 *  2026-10-12: a speech model Got from "Your own voice" must be that shelf's
 *  pick); else the job of the model's first pick. Undefined when the shelf
 *  is not one of the model's, or the model has no media pick. */
export function jobFor(
  catalog: Catalog,
  model: CatalogModel,
  shelfId?: string,
): MediaJob | undefined {
  const picks = picksForModel(catalog, model.id).filter((p) => p.shelf.job in MEDIA_JOB_INFO);
  const pick = shelfId ? picks.find((p) => p.shelf.id === shelfId) : picks[0];
  return pick ? (pick.shelf.job as MediaJob) : undefined;
}

async function download(
  file: CatalogFile,
  model: CatalogModel,
  to: string,
  egress: EgressPolicy,
  fetchImpl: MediaInstallDeps['fetchImpl'],
  onProgress: (p: MediaInstallProgress) => void,
): Promise<void> {
  if (!fileHostAllowed(file.url, model.source.kind)) {
    throw new Error(
      `${file.url} does not start at a ${model.source.kind} host, so it was not fetched.`,
    );
  }
  const expected = file.sha256;
  if (!expected) {
    throw new Error(
      `${file.dest} has no published checksum yet, so it was not fetched. The next catalog update carries one.`,
    );
  }
  const res = fetchImpl
    ? await fetchImpl(file.url)
    : await egress.fetch(file.url, 'model-pull', { signal: AbortSignal.timeout(6 * 60 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`The source answered ${res.status} for ${file.dest}.`);
  const said = Number(res.headers.get('content-length')) || 0;
  const total = said || (file.sizeGB ? file.sizeGB * 1e9 : undefined);
  // A source that keeps sending past the size it gave (or the catalog's) is
  // cut off, so a download cannot fill the disk.
  const limit = Math.max(said, (file.sizeGB ?? 0) * 1e9) * 1.1 || undefined;
  mkdirSync(dirname(to), { recursive: true });
  const part = `${to}.part`;
  const out = createWriteStream(part);
  const hash = createHash('sha256');
  let completed = 0;
  let lastReport = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      completed += chunk.byteLength;
      if (limit && completed > limit) {
        throw new Error(`${file.dest} ran past its published size, so it was thrown away.`);
      }
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
      if (completed - lastReport > 8 * 1024 * 1024) {
        lastReport = completed;
        onProgress({
          line: `Getting ${file.dest}`,
          completed,
          ...(total ? { total, percent: Math.min(99, (completed / total) * 100) } : {}),
        });
      }
    }
    await new Promise<void>((resolve, reject) =>
      out.end((err?: Error | null) => (err ? reject(err) : resolve())),
    );
  } catch (err) {
    out.destroy();
    rmSync(part, { force: true });
    throw err;
  }
  const got = hash.digest('hex');
  if (got !== expected) {
    rmSync(part, { force: true });
    throw new Error(`${file.dest} did not match its published checksum, so it was thrown away.`);
  }
  renameSync(part, to);
}

/** Put a ComfyUI model's files in place. */
async function installComfy(
  model: CatalogModel,
  config: OscConfig,
  deps: MediaInstallDeps,
  onProgress: (p: MediaInstallProgress) => void,
): Promise<{ ok: boolean; detail: string; modelsDir?: string }> {
  const modelsDir = comfyModelsDir(config, deps.comfyCandidates);
  if (!modelsDir) {
    return {
      ok: false,
      detail:
        "OpenShore could not find ComfyUI's models folder. Set it once in Stack, Media servers, then tap Get again.",
    };
  }
  const egress = new EgressPolicy(config.egress);
  const files = model.source.files ?? [];
  for (const [i, file] of files.entries()) {
    const to = destPath(modelsDir, file.dest);
    if (
      existsSync(to) &&
      (!file.sizeGB || Math.abs(statSync(to).size - file.sizeGB * 1e9) / (file.sizeGB * 1e9) < 0.1)
    ) {
      onProgress({
        line: `${file.dest} is already in place`,
        percent: ((i + 1) / files.length) * 100,
      });
      continue;
    }
    onProgress({
      line: `Getting ${file.dest} (${i + 1} of ${files.length})`,
      percent: (i / files.length) * 100,
    });
    await download(file, model, to, egress, deps.fetchImpl, onProgress);
  }
  return { ok: true, detail: `${model.name} is in ComfyUI's models folder.`, modelsDir };
}

/** The line that installs each program, fixed in code (security review,
 *  2026-10-12): a catalog is data, so it never chooses a command the person
 *  is told to paste. */
export const PROGRAM_INSTALL: Readonly<Record<'separator' | 'denoiser', string>> = {
  separator: 'pip install audio-separator',
  denoiser: 'pip install deepfilternet',
};

async function programRuns(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      command,
      ['--help'],
      { env: scrubbedEnv(), timeout: 30_000, windowsHide: true },
      (err) => {
        resolve(!err || (err as NodeJS.ErrnoException).code !== 'ENOENT');
      },
    );
  });
}

/** Get a media model and work out its placement for `job`. The caller saves
 *  the placement (machine config is the engine's to write). */
export async function installMediaModel(
  model: CatalogModel,
  job: MediaJob,
  config: OscConfig,
  onProgress: (p: MediaInstallProgress) => void = () => {},
  deps: MediaInstallDeps = {},
): Promise<MediaInstallResult> {
  const runtime = model.runtime;
  const runner = model.runner ?? {};
  if (!runtime || runtime === 'ollama') {
    return { ok: false, detail: `${model.name} is not a media model; it installs through Ollama.` };
  }
  if (!MEDIA_JOB_INFO[job].runtimes.includes(runtime)) {
    return {
      ok: false,
      detail: `${model.name} does not do ${MEDIA_JOB_INFO[job].plain.toLowerCase()}.`,
    };
  }
  try {
    if (runtime === 'comfyui') {
      const done = await installComfy(model, config, deps, onProgress);
      if (!done.ok) return done;
      return {
        ok: true,
        detail: `${model.name} is ready. It runs in ComfyUI for ${MEDIA_JOB_INFO[job].plain}.`,
        job,
        modelsDir: done.modelsDir!,
        placement: {
          runtime,
          catalogId: model.id,
          ...(runner.graph ? { graph: runner.graph } : {}),
          ...(runner.files ? { files: runner.files } : {}),
        },
      };
    }
    if (runtime === 'speech') {
      const baseUrl = config.media.speech?.baseUrl ?? 'http://127.0.0.1:8080';
      // Plain http only on this network, as the media host holds it: the
      // server's key rides every request.
      if (/^http:/i.test(baseUrl) && !isLocalUrl(baseUrl)) {
        return {
          ok: false,
          detail: `The speech server is set to ${baseUrl}, off this network over plain http, so nothing was sent. Give it an https address, or reach it over your tailnet.`,
        };
      }
      const speech = new SpeechClient({
        baseUrl,
        ...(config.media.speech?.apiKeyEnv && process.env[config.media.speech.apiKeyEnv]
          ? { apiKey: process.env[config.media.speech.apiKeyEnv] }
          : {}),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl as typeof fetch } : {}),
      });
      if (runner.install) {
        const health = await speech.health();
        if (!health.ok) return { ok: false, detail: health.detail };
        onProgress({ line: `Asking the speech server for ${model.name}` });
        const id = await speech.install(runner.install);
        const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
        for (let i = 0; i < 60 * 60; i++) {
          const status = await speech.installStatus(id);
          if (status.error)
            return { ok: false, detail: `The speech server could not get it: ${status.error}` };
          if (status.done) break;
          onProgress({
            line: `The speech server is getting ${model.name}`,
            ...(status.percent !== undefined ? { percent: status.percent } : {}),
          });
          await sleep(2000);
        }
      }
      return {
        ok: true,
        detail: `${model.name} is ready on the speech server for ${MEDIA_JOB_INFO[job].plain}.`,
        job,
        placement: {
          runtime,
          catalogId: model.id,
          ...(runner.model ? { model: runner.model } : {}),
          ...(runner.voice ? { voice: runner.voice } : {}),
        },
      };
    }
    // A program on this computer: check it is there; never install it.
    const command =
      runtime === 'separator'
        ? (config.media.separator?.command ?? 'audio-separator')
        : (config.media.denoiser?.command ?? 'deepFilter');
    const runs = await (deps.programRuns ?? programRuns)(command);
    if (!runs) {
      return {
        ok: false,
        detail: `${command} is not installed on this computer. Install it with: ${PROGRAM_INSTALL[runtime]}, then tap Get again.`,
      };
    }
    return {
      ok: true,
      detail: `${model.name} is ready for ${MEDIA_JOB_INFO[job].plain}. It fetches its model file the first time it runs.`,
      job,
      placement: { runtime, catalogId: model.id, ...(runner.model ? { model: runner.model } : {}) },
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Get, for any catalog model: a chat model pulls through Ollama; a media
 *  model is put in place by installMediaModel and fills the job it was picked
 *  for (the shelf the Get came from, else its first pick), saved in this
 *  machine's config. One door for the desktop and for a docked phone. */
export async function getModel(
  model: CatalogModel,
  catalog: Catalog,
  config: OscConfig,
  onProgress: (p: InstallProgress) => void,
  opts: {
    shelfId?: string;
    ollamaBaseUrl?: string;
    deps?: MediaInstallDeps;
    /** Saves what a Get placed (saveMediaPlacement, by default). */
    save?: (got: { job: MediaJob; placement: MediaPlacement; modelsDir?: string }) => void;
  } = {},
): Promise<PullResult> {
  if (!model.runtime || model.runtime === 'ollama') {
    return installOllamaModel(
      model,
      onProgress,
      opts.ollamaBaseUrl ? { baseUrl: opts.ollamaBaseUrl } : {},
    );
  }
  const job = jobFor(catalog, model, opts.shelfId);
  if (!job) {
    return {
      ok: false,
      detail: opts.shelfId
        ? `${model.name} is not a pick on that shelf, so it was not placed.`
        : `${model.name} has no job in the library to fill.`,
    };
  }
  const result = await installMediaModel(model, job, config, onProgress, opts.deps);
  if (result.ok && result.placement) {
    const save =
      opts.save ??
      ((got: { job: MediaJob; placement: MediaPlacement; modelsDir?: string }) =>
        void saveMediaPlacement(got.job, got.placement, got.modelsDir));
    save({
      job,
      placement: result.placement,
      ...(result.modelsDir && !config.media.comfyui?.modelsDir
        ? { modelsDir: result.modelsDir }
        : {}),
    });
  }
  return { ok: result.ok, detail: result.detail };
}
