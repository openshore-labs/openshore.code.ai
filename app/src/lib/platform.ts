// Where are we running? One question, answered once. The same web build
// serves Electron (desktop), Capacitor (iOS), and a plain browser (dev).
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
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

/** Open a URL in the system browser: Safari on iOS (so it leaves the app, which
 *  is required for anything billing under Apple 3.1.1), and the OS browser on
 *  Electron (via the window-open handler) and the web. */
export function openExternal(url: string): void {
  if (typeof window === 'undefined') return;
  window.open(url, platform() === 'ios' ? '_system' : '_blank', 'noopener');
}

/** Open a URL for a quick errand you're meant to come straight back from
 *  (fetching an API key, for example): an in-app browser sheet on iOS, so
 *  signing in and copying a key never leaves OpenShore, with the standard
 *  Capacitor "Done" button to dismiss back to exactly where you were.
 *  Electron and web have no in-app browser surface, so they fall back to
 *  the system browser via openExternal. */
export function openInAppBrowser(url: string): void {
  // No tick here: every caller is a button, and the global press listener in
  // App.tsx already marks the tap (UI-7), so a second tick reads as a stutter.
  if (platform() === 'ios') {
    void Browser.open({ url });
    return;
  }
  openExternal(url);
}

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

async function storeDeleteRaw(key: string): Promise<void> {
  if (platform() === 'ios') {
    await Preferences.remove({ key });
    return;
  }
  localStorage.removeItem(key);
}

// Writes to one key run in the order they were asked for. saveSettings is
// fire-and-forget from many actions, and a sealed write is several awaits
// long, so without this an older snapshot could land last and a setting would
// "revert after relaunch" (APP-8). Reads are not serialized: they see whatever
// is on disk, which is what a reader expects.
const writeChains = new Map<string, Promise<void>>();

function serialized(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeChains.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  writeChains.set(key, run);
  run
    .finally(() => {
      if (writeChains.get(key) === run) writeChains.delete(key);
    })
    .catch(() => {});
  return run;
}

export function storeDelete(key: string): Promise<void> {
  return serialized(key, () => storeDeleteRaw(key));
}

// ---------------------------------------------------------------------------
// Encryption at rest. A single data-encryption key (DEK) lives in the most
// secure store each platform offers: the iOS Keychain, the Electron OS keychain
// (safeStorage), or, in a plain browser for dev, localStorage. Everything the
// app persists locally is sealed with it. If the key is ever unavailable (a
// platform without WebCrypto, say), the app degrades to a plaintext store
// rather than failing to boot. Data written before encryption reads back fine
// and is resealed the next time it is written (or by sealExistingKeys).
//
// The one thing this module must never do is replace a key that exists
// (P0-3). A keychain that answers nothing for a moment (a Linux keyring
// change, a safeStorage decrypt failure, a Keychain read before first unlock)
// looks exactly like "no key yet"; minting a new key then would orphan every
// sealed byte on the device with no visible cause. So a key is minted only
// when there is no evidence one ever existed: no key entry, no fingerprint,
// and no sealed value under any of the keys the app writes first. Otherwise
// the store goes read-only for sealed keys and init surfaces a locked state.
// ---------------------------------------------------------------------------

const DEK_STORE_KEY = 'oscode.dek.v1';
/** SHA-256 of the key, kept in the plain store next to the sealed data, so a
 *  key that is readable but not the one the data was sealed with is caught
 *  before it silently reads everything as null. */
const DEK_FINGERPRINT_KEY = 'oscode.dek.fp.v1';
/** Keys whose sealed value proves a key once existed on this device. */
const SEALED_EVIDENCE_KEYS = [
  'oscode.settings.v1',
  'oscode.conversations.v1',
  'oscode.auth.session.v1',
];

/** ok: sealing with the device key. locked: a key exists but cannot be read
 *  or does not match the data, so sealed keys are read-only until it is back.
 *  plaintext: no WebCrypto here, nothing is sealed (a dev browser). */
export type UnlockState = 'ok' | 'locked' | 'plaintext';

let dekPromise: Promise<CryptoKey | undefined> | undefined;
let unlockState: UnlockState = 'ok';

/** The device's unlock state, settled once the key has been looked up. init
 *  reads this to tell the person their data could not be unlocked. */
export async function dataUnlockState(): Promise<UnlockState> {
  await getDek();
  return unlockState;
}

/** The key entry as the platform sees it: `present` when an entry exists at
 *  all, `value` only when it could be read right now. */
async function dekSecretRead(): Promise<{ present: boolean; value: string | null }> {
  switch (platform()) {
    case 'ios': {
      // The Keychain plugin answers nil for absent and for unreadable alike;
      // the fingerprint and sealed-evidence checks in getDek cover the gap.
      const v = (await Llama.secureGet({ key: DEK_STORE_KEY })).value ?? null;
      return { present: v != null, value: v };
    }
    case 'electron': {
      const b = bridge();
      if (!b) {
        const v = localStorage.getItem(DEK_STORE_KEY);
        return { present: v != null, value: v };
      }
      const present = typeof b.secureHas === 'function' ? await b.secureHas(DEK_STORE_KEY) : false;
      const value = await b.secureGet(DEK_STORE_KEY);
      if (value) return { present: true, value };
      if (present) return { present: true, value: null };
      // No OS entry. A launch without OS encryption keeps the key in
      // localStorage (see dekSecretSet); read it here too, and move it into
      // the OS store now that encryption is back, so there is one home.
      const fallback = localStorage.getItem(DEK_STORE_KEY);
      if (fallback) {
        if (await b.secureSet(DEK_STORE_KEY, fallback)) localStorage.removeItem(DEK_STORE_KEY);
        return { present: true, value: fallback };
      }
      return { present: false, value: null };
    }
    default: {
      const v = localStorage.getItem(DEK_STORE_KEY);
      return { present: v != null, value: v };
    }
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

async function fingerprint(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when anything on the device says a key once existed. */
async function keyEvidence(): Promise<boolean> {
  if (await storeGetRaw(DEK_FINGERPRINT_KEY)) return true;
  for (const key of SEALED_EVIDENCE_KEYS) {
    const raw = await storeGetRaw(key);
    if (raw != null && isSealed(raw)) return true;
  }
  return false;
}

/** The device's data-encryption key, generated once and cached. Undefined if
 *  crypto is unavailable or the key cannot be used right now; callers then
 *  read plaintext through and never overwrite a sealed value. */
async function getDek(): Promise<CryptoKey | undefined> {
  if (!dekPromise) {
    dekPromise = (async () => {
      try {
        if (typeof crypto === 'undefined' || !crypto.subtle) {
          unlockState = 'plaintext';
          return undefined;
        }
        const read = await dekSecretRead();
        if (read.value) {
          const mine = await fingerprint(read.value);
          const stored = await storeGetRaw(DEK_FINGERPRINT_KEY);
          if (stored && stored !== mine) {
            // A readable key that is not the one this data was sealed with.
            unlockState = 'locked';
            return undefined;
          }
          if (!stored) await storeSetRaw(DEK_FINGERPRINT_KEY, mine);
          unlockState = 'ok';
          return await importDek(read.value);
        }
        if (read.present || (await keyEvidence())) {
          // A key exists (or did) and cannot be read right now. Never mint
          // over it: that is the one irreversible move this module can make.
          unlockState = 'locked';
          return undefined;
        }
        const raw = generateRawDek();
        await dekSecretSet(raw);
        await storeSetRaw(DEK_FINGERPRINT_KEY, await fingerprint(raw));
        unlockState = 'ok';
        return await importDek(raw);
      } catch {
        // The secure store itself failed. Treat any sign of an earlier key as
        // locked (read-only for sealed data); only a device with nothing
        // sealed degrades to plaintext.
        try {
          unlockState = (await keyEvidence()) ? 'locked' : 'plaintext';
        } catch {
          unlockState = 'locked';
        }
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

async function writeSealed(key: string, value: string): Promise<void> {
  const dek = await getDek();
  const existing = await storeGetRaw(key);
  if (existing && isSealed(existing)) {
    // No usable key: a sealed value is read-only. Overwriting it with
    // plaintext would destroy data the key could still open later.
    if (!dek) return;
    // Never silently overwrite sealed data we cannot read: if the current key
    // fails to open it (a rotated or lost DEK), copy it aside first so the
    // ciphertext is recoverable rather than lost forever.
    if (!key.includes('.recovery.') && (await open(dek, existing)) === null) {
      await storeSetRaw(`${key}.recovery.${Date.now()}`, existing);
    }
  }
  await storeSetRaw(key, dek ? await seal(dek, value) : value);
}

export function storeSet(key: string, value: string): Promise<void> {
  return serialized(key, () => writeSealed(key, value));
}

/** Reseal any plaintext values left from before encryption. Best-effort: a key
 *  that is missing, already sealed, or unreadable is skipped, never lost. */
export async function sealExistingKeys(keys: string[]): Promise<void> {
  const dek = await getDek();
  if (!dek) return;
  for (const key of keys) {
    try {
      await serialized(key, async () => {
        const raw = await storeGetRaw(key);
        if (raw != null && !isSealed(raw)) await storeSetRaw(key, await seal(dek, raw));
      });
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
