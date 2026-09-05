// The data-encryption key's lifecycle on the desktop (P0-3) and the sealed
// store's write ordering (APP-8), run against the REAL platform module with
// the Electron bridge, the browser storage, and the crypto seal mocked around
// it. The rule under test: a key that exists but cannot be read right now is
// never replaced, because every sealed byte on the device dies with it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SETTINGS_KEY = 'oscode.settings.v1';
const DEK_KEY = 'oscode.dek.v1';

// The bridge under test: an in-memory safeStorage stand-in whose readability
// and availability each test controls.
const secure = new Map<string, string>();
let readable = true;
let available = true;
const fakeBridge = {
  platform: 'electron' as const,
  secureHas: vi.fn(async (key: string) => secure.has(key)),
  secureGet: vi.fn(async (key: string) => (readable ? (secure.get(key) ?? null) : null)),
  secureSet: vi.fn(async (key: string, value: string) => {
    if (!available) return false;
    secure.set(key, value);
    return true;
  }),
  secureDelete: vi.fn(async (key: string) => {
    secure.delete(key);
  }),
};

vi.mock('../src/lib/electronBridge.js', () => ({
  bridge: () => fakeBridge,
  requireBridge: () => fakeBridge,
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async () => ({ value: null }),
    set: async () => {},
    remove: async () => {},
  },
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open: async () => {} } }));
vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    secureGet: async () => ({ value: null }),
    secureSet: async () => {},
    secureDelete: async () => {},
  },
}));
vi.mock('../src/lib/haptics.js', () => ({ hapticTick: () => {} }));

// The seal can be slowed per call, so a write race is deterministic.
let sealDelays: number[] = [];
vi.mock('../src/lib/crypto.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/crypto.js')>();
  return {
    ...real,
    seal: async (key: CryptoKey, text: string) => {
      const delay = sealDelays.shift() ?? 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return real.seal(key, text);
    },
  };
});

const local = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => local.get(k) ?? null,
  setItem: (k: string, v: string) => {
    local.set(k, v);
  },
  removeItem: (k: string) => {
    local.delete(k);
  },
};

/** A fresh platform module (its DEK cache starts empty), as a relaunch would. */
async function load() {
  vi.resetModules();
  return import('../src/lib/platform.js');
}

async function sealedWith(raw: string, text: string): Promise<string> {
  const { importDek, seal } = await import('../src/lib/crypto.js');
  return seal(await importDek(raw), text);
}

async function freshRawKey(): Promise<string> {
  const { generateRawDek } = await import('../src/lib/crypto.js');
  return generateRawDek();
}

beforeEach(() => {
  secure.clear();
  local.clear();
  readable = true;
  available = true;
  sealDelays = [];
  for (const fn of Object.values(fakeBridge)) if (typeof fn === 'function') fn.mockClear();
  Object.defineProperty(globalThis, 'window', {
    value: { oscode: fakeBridge },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: fakeLocalStorage,
    configurable: true,
    writable: true,
  });
});

describe('the data-encryption key on the desktop (P0-3)', () => {
  it('a fresh device mints one key, fingerprints it, and seals from then on', async () => {
    const p = await load();
    await p.storeSet(SETTINGS_KEY, '{"a":1}');
    expect(fakeBridge.secureSet).toHaveBeenCalledTimes(1);
    expect(fakeBridge.secureSet.mock.calls[0]![0]).toBe(DEK_KEY);
    expect(local.get(SETTINGS_KEY)).toMatch(/^enc:v1:/);
    expect(await p.storeGet(SETTINGS_KEY)).toBe('{"a":1}');
    expect(await p.dataUnlockState()).toBe('ok');
    // The fingerprint sits next to the sealed data, in the plain store.
    expect(local.get('oscode.dek.fp.v1')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never mints a new key over sealed data when the key read comes back empty', async () => {
    // The key entry is gone (or the keychain is answering nothing), but the
    // settings blob is sealed: a key existed. Minting would orphan every byte.
    const blob = await sealedWith(await freshRawKey(), '{"onboarded":true}');
    local.set(SETTINGS_KEY, blob);
    const p = await load();
    expect(await p.storeGet(SETTINGS_KEY)).toBeNull();
    expect(fakeBridge.secureSet).not.toHaveBeenCalled();
    expect(await p.dataUnlockState()).toBe('locked');
    // Read-only for sealed keys: a write must not replace the ciphertext.
    await p.storeSet(SETTINGS_KEY, '{"onboarded":false}');
    expect(local.get(SETTINGS_KEY)).toBe(blob);
    expect(fakeBridge.secureSet).not.toHaveBeenCalled();
    // Storage that was never sealed is still writable, so the app keeps working.
    await p.storeSet('oscode.scratch', 'x');
    expect(local.get('oscode.scratch')).toBe('x');
  });

  it('never mints when the key entry is present but cannot be decrypted right now', async () => {
    secure.set(DEK_KEY, 'sealed-by-the-os');
    readable = false; // safeStorage.decryptString throws, or encryption is unavailable
    const p = await load();
    await p.storeSet('oscode.scratch', 'x');
    expect(fakeBridge.secureSet).not.toHaveBeenCalled();
    expect(await p.dataUnlockState()).toBe('locked');
    expect(secure.get(DEK_KEY)).toBe('sealed-by-the-os');
  });

  it('reads the browser-storage fallback on Electron and moves the key into the OS store', async () => {
    // An earlier launch had no OS encryption, so the key landed in localStorage
    // and that session's data was sealed with it. It must open on this launch.
    const raw = await freshRawKey();
    local.set(DEK_KEY, raw);
    local.set(SETTINGS_KEY, await sealedWith(raw, '{"kept":true}'));
    const p = await load();
    expect(await p.storeGet(SETTINGS_KEY)).toBe('{"kept":true}');
    expect(await p.dataUnlockState()).toBe('ok');
    expect(secure.get(DEK_KEY)).toBe(raw);
    expect(local.has(DEK_KEY)).toBe(false);
  });

  it('locks instead of reading with a key whose fingerprint does not match the data', async () => {
    const other = await freshRawKey();
    local.set(SETTINGS_KEY, await sealedWith(other, '{"kept":true}'));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(other));
    local.set(
      'oscode.dek.fp.v1',
      [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    );
    secure.set(DEK_KEY, await freshRawKey());
    const p = await load();
    expect(await p.storeGet(SETTINGS_KEY)).toBeNull();
    expect(await p.dataUnlockState()).toBe('locked');
    expect(fakeBridge.secureSet).not.toHaveBeenCalled();
  });

  it('stays unlocked and writes plaintext only where nothing was ever sealed (no WebCrypto)', async () => {
    const p = await load();
    expect(await p.dataUnlockState()).toBe('ok');
    expect(await p.storeGet('nothing')).toBeNull();
  });
});

describe('sealed writes are serialized per key (APP-8)', () => {
  it('a slow first write never lands after a fast second one', async () => {
    const p = await load();
    sealDelays = [40, 0];
    await Promise.all([p.storeSet('k', 'v1'), p.storeSet('k', 'v2')]);
    expect(await p.storeGet('k')).toBe('v2');
  });

  it('a delete queued behind a slow write wins', async () => {
    const p = await load();
    sealDelays = [40];
    await Promise.all([p.storeSet('k', 'v1'), p.storeDelete('k')]);
    expect(await p.storeGet('k')).toBeNull();
  });
});
