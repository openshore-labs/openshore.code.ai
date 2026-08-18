// Per-backend capability detection. Local inference servers differ in how
// they do constrained decoding (llama.cpp GBNF / JSON schema, vLLM guided
// decoding, Ollama structured outputs, LM Studio its own), so OS Code probes
// once, remembers what the backend can do, and picks grammar decoding where
// it exists and validate-plus-repair where it does not.
import { logger } from '../util/log.js';

const log = logger('capabilities');

export type BackendFlavor = 'ollama' | 'llamacpp' | 'vllm' | 'lmstudio' | 'generic';

export interface BackendProfile {
  flavor: BackendFlavor;
  /** Can we constrain output to a JSON schema at decode time? */
  grammar: boolean;
  /** Does the OpenAI-compatible endpoint accept `tools`? */
  nativeTools: boolean;
  /** Human name for doctor and the status line. */
  label: string;
}

const PROFILES: Record<BackendFlavor, Omit<BackendProfile, 'flavor'>> = {
  ollama: { grammar: true, nativeTools: true, label: 'Ollama' },
  llamacpp: { grammar: true, nativeTools: true, label: 'llama.cpp' },
  vllm: { grammar: true, nativeTools: true, label: 'vLLM' },
  lmstudio: { grammar: true, nativeTools: true, label: 'LM Studio' },
  generic: { grammar: false, nativeTools: true, label: 'OpenAI-compatible server' },
};

const probeCache = new Map<string, BackendProfile>();

async function tryJson(url: string, timeoutMs = 1500): Promise<unknown | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * Detect which server is behind an OpenAI-compatible base URL. Cheap probes,
 * cached per base URL for the life of the process.
 */
export async function probeBackend(baseUrl: string): Promise<BackendProfile> {
  const cached = probeCache.get(baseUrl);
  if (cached) return cached;

  let flavor: BackendFlavor = 'generic';

  const ollama = await tryJson(`${baseUrl}/api/version`);
  if (ollama && typeof ollama === 'object' && 'version' in ollama) {
    flavor = 'ollama';
  } else {
    const lmstudio = await tryJson(`${baseUrl}/api/v0/models`);
    if (lmstudio) {
      flavor = 'lmstudio';
    } else {
      const props = await tryJson(`${baseUrl}/props`);
      if (props && typeof props === 'object' && ('default_generation_settings' in props || 'total_slots' in props)) {
        flavor = 'llamacpp';
      } else {
        const version = await tryJson(`${baseUrl}/version`);
        if (version && typeof version === 'object' && 'version' in version) {
          flavor = 'vllm';
        }
      }
    }
  }

  const profile: BackendProfile = { flavor, ...PROFILES[flavor] };
  probeCache.set(baseUrl, profile);
  log.info('probed backend', { baseUrl, flavor });
  return profile;
}

/** Test seam: preload or reset the probe cache. */
export function _setProbeResult(baseUrl: string, profile: BackendProfile | undefined): void {
  if (profile) probeCache.set(baseUrl, profile);
  else probeCache.delete(baseUrl);
}

/** Heuristics for vision-capable local models, refined by /api/show when available. */
export function looksVisionCapable(model: string): boolean {
  return /llava|moondream|vision|qwen[\d.]*-?vl|minicpm-v|gemma3|pixtral|bakllava/i.test(model);
}

/** Rough context-window defaults per family; /api/show overrides when it answers. */
export function defaultContextTokens(model: string): number {
  if (/qwen|deepseek|devstral|mistral-small|codestral/i.test(model)) return 32768;
  if (/llama3\.[12]|llama-3\.[12]/i.test(model)) return 131072;
  if (/llama3|llama-3/i.test(model)) return 8192;
  if (/phi/i.test(model)) return 16384;
  if (/gemma/i.test(model)) return 8192;
  return 8192;
}
