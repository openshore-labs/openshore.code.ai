// Ollama from inside the app (A3). Three questions the desktop can answer
// without a terminal: is Ollama installed, is it running, and what does it
// take to fix either. Every probe is injectable so the states are pinned by
// tests on a machine with no Ollama at all. Nothing here touches Electron.
import { execFile, spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version?: string;
}

export const OLLAMA_INSTALL_COMMAND = 'curl -fsSL https://ollama.com/install.sh | sh';

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** Is there an `ollama` binary this process could run? PATH first, then the
 *  places the official installers put it when a launched app's PATH is thin. */
export function ollamaCommandExists(platform: NodeJS.Platform = process.platform): boolean {
  const probe = spawnSync('ollama', ['--version'], { encoding: 'utf8', timeout: 4000 });
  if (!probe.error) return true;
  const candidates =
    platform === 'darwin'
      ? ['/Applications/Ollama.app', '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama']
      : platform === 'win32'
        ? [`${process.env.LOCALAPPDATA ?? ''}\\Programs\\Ollama\\ollama.exe`]
        : ['/usr/local/bin/ollama', '/usr/bin/ollama'];
  return candidates.some((p) => p && existsSync(p));
}

async function askVersion(baseUrl: string, fetchImpl: FetchLike): Promise<string | undefined> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return undefined;
    const body = (await res.json().catch(() => ({}))) as { version?: unknown };
    return typeof body.version === 'string' && body.version ? body.version : 'unknown';
  } catch {
    return undefined;
  }
}

export async function probeOllama(opts: {
  baseUrl: string;
  fetch?: FetchLike;
  commandExists?: () => boolean;
}): Promise<OllamaStatus> {
  const fetchImpl = opts.fetch ?? (fetch as FetchLike);
  const version = await askVersion(opts.baseUrl, fetchImpl);
  if (version !== undefined) return { installed: true, running: true, version };
  const installed = (opts.commandExists ?? ollamaCommandExists)();
  return { installed, running: false };
}

type SpawnLike = (cmd: string, args: string[]) => { unref(): void };

const defaultSpawn: SpawnLike = (cmd, args) =>
  nodeSpawn(cmd, args, { detached: true, stdio: 'ignore' });

/** Start `ollama serve` as its own detached process (it outlives the app),
 *  then wait for the API to answer. False when it never does, or the binary
 *  cannot be spawned; never a throw, so the renderer gets a plain answer. */
export async function startOllama(opts: {
  baseUrl: string;
  spawn?: SpawnLike;
  fetch?: FetchLike;
  pollEveryMs?: number;
  timeoutMs?: number;
}): Promise<boolean> {
  const fetchImpl = opts.fetch ?? (fetch as FetchLike);
  if ((await askVersion(opts.baseUrl, fetchImpl)) !== undefined) return true;
  try {
    (opts.spawn ?? defaultSpawn)('ollama', ['serve']).unref();
  } catch {
    return false;
  }
  const every = opts.pollEveryMs ?? 500;
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, every));
    if ((await askVersion(opts.baseUrl, fetchImpl)) !== undefined) return true;
  }
  return false;
}

export interface OllamaInstallPlan {
  /** terminal: run the command in the built-in terminal (Linux). download:
   *  open the page in the browser and poll for the server (macOS, Windows). */
  mode: 'terminal' | 'download';
  /** Always present, so the renderer can show it as a copy block. */
  command: string;
  downloadUrl?: string;
}

export function ollamaInstallPlan(platform: NodeJS.Platform = process.platform): OllamaInstallPlan {
  if (platform === 'darwin') {
    const downloadUrl = 'https://ollama.com/download/mac';
    return { mode: 'download', command: `open ${downloadUrl}`, downloadUrl };
  }
  if (platform === 'win32') {
    const downloadUrl = 'https://ollama.com/download/windows';
    return { mode: 'download', command: `start ${downloadUrl}`, downloadUrl };
  }
  return { mode: 'terminal', command: OLLAMA_INSTALL_COMMAND };
}

// Installing on macOS and Windows from inside the app (v1 Phase 1, desktop
// first run). The official installer is fetched straight from ollama.com into
// the person's Downloads folder and opened, so they click through Ollama's
// own signed installer without hunting for a download page; the app then
// polls ollamaStatus and carries on by itself once Ollama answers. On macOS
// the file is marked as downloaded from the internet, so Gatekeeper checks
// Ollama's signature exactly as it would for a browser download. Anything
// that fails falls back to opening the download page, the old behavior.

export interface OllamaInstaller {
  url: string;
  file: string;
}

/** The official installers, in the order to try them. */
export function ollamaInstallers(platform: NodeJS.Platform): OllamaInstaller[] {
  if (platform === 'darwin') {
    return [
      { url: 'https://ollama.com/download/Ollama.dmg', file: 'Ollama.dmg' },
      { url: 'https://ollama.com/download/Ollama-darwin.zip', file: 'Ollama-darwin.zip' },
    ];
  }
  if (platform === 'win32') {
    return [{ url: 'https://ollama.com/download/OllamaSetup.exe', file: 'OllamaSetup.exe' }];
  }
  return [];
}

type DownloadFetch = (url: string) => Promise<Response>;
type Runner = (cmd: string, args: string[]) => Promise<void>;

const defaultRunner: Runner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120_000 }, (err) => (err ? reject(err) : resolve()));
  });

/**
 * Fetch the official installer into `downloadsDir` and return the path to
 * open: the dmg, the installer exe, or (for the macOS zip) the extracted
 * Ollama.app. Undefined when nothing could be fetched, so the caller falls
 * back to the download page. Never throws.
 */
export async function downloadOllamaInstaller(opts: {
  platform: NodeJS.Platform;
  downloadsDir: string;
  fetch?: DownloadFetch;
  run?: Runner;
}): Promise<string | undefined> {
  const fetchImpl = opts.fetch ?? ((url: string) => fetch(url, { redirect: 'follow' }));
  const run = opts.run ?? defaultRunner;
  for (const installer of ollamaInstallers(opts.platform)) {
    const target = join(opts.downloadsDir, installer.file);
    const partial = `${target}.part`;
    try {
      const res = await fetchImpl(installer.url);
      if (!res.ok || !res.body) continue;
      mkdirSync(opts.downloadsDir, { recursive: true });
      await pipeline(
        Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(partial),
      );
      renameSync(partial, target);
      if (opts.platform === 'darwin') {
        // Marked as downloaded, so Gatekeeper verifies Ollama's signature on
        // first open, as it would for a file the browser saved.
        const stamp = Math.floor(Date.now() / 1000).toString(16);
        await run('xattr', [
          '-w',
          'com.apple.quarantine',
          `0081;${stamp};OpenShore;`,
          target,
        ]).catch(() => undefined);
        if (installer.file.endsWith('.zip')) {
          await run('ditto', ['-x', '-k', target, opts.downloadsDir]);
          const app = join(opts.downloadsDir, 'Ollama.app');
          if (!existsSync(app)) continue;
          await run('xattr', ['-w', 'com.apple.quarantine', `0081;${stamp};OpenShore;`, app]).catch(
            () => undefined,
          );
          return app;
        }
      }
      return target;
    } catch {
      rmSync(partial, { force: true });
    }
  }
  return undefined;
}
