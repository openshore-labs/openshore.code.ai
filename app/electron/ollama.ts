// Ollama from inside the app (A3). Three questions the desktop can answer
// without a terminal: is Ollama installed, is it running, and what does it
// take to fix either. Every probe is injectable so the states are pinned by
// tests on a machine with no Ollama at all. Nothing here touches Electron.
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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
