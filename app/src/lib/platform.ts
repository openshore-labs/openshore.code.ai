// Where are we running? One question, answered once. The same web build
// serves Electron (desktop), Capacitor (iOS), and a plain browser (dev).
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Llama } from './llamaPlugin.js';
import { bridge } from './electronBridge.js';
import { generateRawDek, importDek, isSealed, open, seal } from './crypto.js';

export type Platform = 'electron' | 'ios' | 'web';

export function platform(): Platform {
  if (typeof window !== 'undefined' && (window as any).oscode?.platform === 'electron') {
    return 'electron';
  }
  if (Capacitor.isNativePlatform()) return 'ios';
  return 'web';
}

export const isDesktop = () => platform() === 'electron';
export const isPhone = () => platform() === 'ios';

// ---------------------------------------------------------------------------
// Raw key-value storage: the right home per platform, no encryption. iOS uses
// Capacitor Preferences (survives app updates); everywhere else, localStorage.
// The public store* wrappers below seal values on top of these.
// ---------------------------------------------------------------------------

async function storeGetRaw(key: string): Promise<string | null> {
  if (platform() === 'ios') {
    const { value } = await Preferences.get({ key });
    return value;
  }
  return localStorage.getItem(key);
}

async function storeSetRaw(key: string, value: string): Promise<void> {
  if (platform() === 'ios') {
    await Preferences.set({ key, value });
    return;
  }
  localStorage.setItem(key, value);
}

export async function storeDelete(key: string): Promise<void> {
  if (platform() === 'ios') {
    await Preferences.remove({ key });
    return;
  }
  localStorage.removeItem(key);
}

// ---------------------------------------------------------------------------
// Encryption at rest. A single data-encryption key (DEK) lives in the most
// secure store each platform offers: the iOS Keychain, the Electron OS keychain
// (safeStorage), or, in a plain browser for dev, localStorage. Everything the
// app persists locally is sealed with it. If the key is ever unavailable (a
// platform without WebCrypto, say), the app degrades to a plaintext store
// rather than failing to boot. Data written before encryption reads back fine
// and is resealed the next time it is written (or by sealExistingKeys).
// ---------------------------------------------------------------------------

const DEK_STORE_KEY = 'oscode.dek.v1';
let dekPromise: Promise<CryptoKey | undefined> | undefined;

async function dekSecretGet(): Promise<string | null> {
  switch (platform()) {
    case 'ios':
      return (await Llama.secureGet({ key: DEK_STORE_KEY })).value ?? null;
    case 'electron': {
      const b = bridge();
      if (b) return b.secureGet(DEK_STORE_KEY);
      return localStorage.getItem(DEK_STORE_KEY);
    }
    default:
      return localStorage.getItem(DEK_STORE_KEY);
  }
}

async function dekSecretSet(value: string): Promise<void> {
  switch (platform()) {
    case 'ios':
      await Llama.secureSet({ key: DEK_STORE_KEY, value });
      return;
    case 'electron': {
      const b = bridge();
      if (b && (await b.secureSet(DEK_STORE_KEY, value))) return;
      localStorage.setItem(DEK_STORE_KEY, value);
      return;
    }
    default:
      localStorage.setItem(DEK_STORE_KEY, value);
  }
}

/** The device's data-encryption key, generated once and cached. Undefined if
 *  crypto is unavailable, so callers fall back to a plaintext store. */
async function getDek(): Promise<CryptoKey | undefined> {
  if (!dekPromise) {
    dekPromise = (async () => {
      try {
        if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
        let raw = await dekSecretGet();
        if (!raw) {
          raw = generateRawDek();
          await dekSecretSet(raw);
        }
        return await importDek(raw);
      } catch {
        return undefined;
      }
    })();
  }
  return dekPromise;
}

export async function storeGet(key: string): Promise<string | null> {
  const raw = await storeGetRaw(key);
  if (raw == null) return null;
  const dek = await getDek();
  // No key: a sealed value cannot be read (return null, never delete it);
  // a plaintext value passes through.
  if (!dek) return isSealed(raw) ? null : raw;
  return open(dek, raw);
}

export async function storeSet(key: string, value: string): Promise<void> {
  const dek = await getDek();
  await storeSetRaw(key, dek ? await seal(dek, value) : value);
}

/** Reseal any plaintext values left from before encryption. Best-effort: a key
 *  that is missing, already sealed, or unreadable is skipped, never lost. */
export async function sealExistingKeys(keys: string[]): Promise<void> {
  const dek = await getDek();
  if (!dek) return;
  for (const key of keys) {
    try {
      const raw = await storeGetRaw(key);
      if (raw != null && !isSealed(raw)) await storeSetRaw(key, await seal(dek, raw));
    } catch {
      // Leave this key as-is; a resealing hiccup must never lose data.
    }
  }
}

export async function storeGetJson<T>(key: string): Promise<T | undefined> {
  const raw = await storeGet(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function storeSetJson(key: string, value: unknown): Promise<void> {
  await storeSet(key, JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Secret storage. On iOS, secrets (API keys) go to the Keychain via the native
// plugin, never the plist that plain Preferences use. Off iOS they fall back
// to the same local store; a desktop secret store is a follow-up.
// ---------------------------------------------------------------------------

export async function secretGet(key: string): Promise<string | null> {
  if (platform() === 'ios') {
    const { value } = await Llama.secureGet({ key });
    return value ?? null;
  }
  return storeGet(key);
}

export async function secretSet(key: string, value: string): Promise<void> {
  if (platform() === 'ios') {
    await Llama.secureSet({ key, value });
    return;
  }
  await storeSet(key, value);
}

export async function secretDelete(key: string): Promise<void> {
  if (platform() === 'ios') {
    await Llama.secureDelete({ key });
    return;
  }
  await storeDelete(key);
}
