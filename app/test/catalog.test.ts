// MP-F1: a standalone phone (no desktop bridge, no paired daemon) must fetch
// the published catalog directly, cache it, and fall back to that cache when
// the network is gone. Without this the storefront shows only the bundled
// starter, which carries no ratings, popularity, or staff picks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  bridgeMock,
  isDesktopMock,
  storeGetJsonMock,
  storeSetJsonMock,
  storeDeleteMock,
  nativeFetchMock,
} = vi.hoisted(() => ({
  bridgeMock: vi.fn(() => undefined as unknown),
  isDesktopMock: vi.fn(() => false),
  storeGetJsonMock: vi.fn<(k: string) => Promise<unknown>>(),
  storeSetJsonMock: vi.fn<(k: string, v: unknown) => Promise<void>>(),
  storeDeleteMock: vi.fn<(k: string) => Promise<void>>(async () => {}),
  nativeFetchMock: vi.fn(),
}));

vi.mock('../src/lib/electronBridge.js', () => ({ bridge: bridgeMock }));
vi.mock('../src/lib/platform.js', () => ({
  isDesktop: isDesktopMock,
  storeGetJson: storeGetJsonMock,
  storeSetJson: storeSetJsonMock,
  storeDelete: storeDeleteMock,
}));
vi.mock('../src/lib/nativeFetch.js', () => ({ nativeFetch: nativeFetchMock }));
// The pinned catalog key, empty as shipped; one test pins its own.
const pinned = vi.hoisted(() => ({ key: '' }));
vi.mock('os-code/protocol', async (importOriginal) => ({
  ...(await importOriginal<typeof import('os-code/protocol')>()),
  get CATALOG_PUBLIC_KEY() {
    return pinned.key;
  },
}));

import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { loadAppCatalog } from '../src/lib/catalog.js';
import bundled from 'os-code/catalog.sample.json';

/** The feed answering the catalog address with `catalog`, and its `.sig`
 *  with `sig` when given. */
function served(catalog: unknown, sig?: string) {
  nativeFetchMock.mockImplementation(async (url: string) =>
    url.endsWith('.sig')
      ? sig
        ? { ok: true, status: 200, text: async () => `${sig}\n` }
        : { ok: false, status: 404, text: async () => '' }
      : { ok: true, status: 200, text: async () => JSON.stringify(catalog) },
  );
}

/** A catalog key pair, and the signature CI would write for `catalog`. */
function signer() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    publicKey: spki.subarray(spki.length - 32).toString('base64'),
    sign: (catalog: unknown) => {
      const sha = createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
      const message = `openshore-catalog-v1\ncatalog.v2.json\n${sha}`;
      return sign(null, Buffer.from(message), privateKey).toString('base64');
    },
  };
}

// A valid catalog distinguishable from the bundled sample by its `updated` mark.
const published = { ...(bundled as object), updated: '2099-01-01' };

beforeEach(() => {
  bridgeMock.mockReturnValue(undefined);
  isDesktopMock.mockReturnValue(false);
  storeGetJsonMock.mockResolvedValue(undefined);
  storeSetJsonMock.mockResolvedValue(undefined);
  nativeFetchMock.mockReset();
  pinned.key = '';
});

afterEach(() => vi.clearAllMocks());

describe('loadAppCatalog standalone (MP-F1)', () => {
  it('fetches the published catalog and caches it when nothing is cached', async () => {
    served(published);
    const { catalog, note } = await loadAppCatalog();
    expect(nativeFetchMock).toHaveBeenCalledWith(
      'https://openshore.ai/os-code/catalog.v2.json',
      expect.objectContaining({ responseType: 'text' }),
    );
    expect(catalog.updated).toBe('2099-01-01');
    expect(note).toBeUndefined();
    // The freshly fetched catalog was written to the Preferences cache.
    expect(storeSetJsonMock).toHaveBeenCalledTimes(1);
    const [key, value] = storeSetJsonMock.mock.calls[0];
    expect(key).toBe('oscode.cache.catalog.v2');
    expect((value as { catalog: { updated: string } }).catalog.updated).toBe('2099-01-01');
    // The copy saved under the key from before the library is cleared.
    expect(storeDeleteMock).toHaveBeenCalledWith('oscode.cache.catalog.v1');
  });

  it('serves a fresh cache without hitting the network', async () => {
    storeGetJsonMock.mockResolvedValue({ catalog: published, fetchedAt: Date.now() });
    const { catalog } = await loadAppCatalog();
    expect(catalog.updated).toBe('2099-01-01');
    expect(nativeFetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a stale cache when the fetch fails', async () => {
    storeGetJsonMock.mockResolvedValue({
      catalog: published,
      fetchedAt: Date.now() - 1000 * 60 * 60 * 48,
    });
    nativeFetchMock.mockRejectedValue(new Error('offline'));
    const { catalog, note } = await loadAppCatalog();
    expect(catalog.updated).toBe('2099-01-01');
    expect(note).toMatch(/last saved catalog/i);
  });

  it('gives a catalog from before the library the library bundled with the app', async () => {
    // A catalog as published before the library: no library block, and only
    // the models it had then.
    const { library: _library, ...rest } = published as { library?: unknown; models: unknown[] };
    const older = { ...rest, models: rest.models.slice(0, 5) };
    served(older);
    const { catalog } = await loadAppCatalog();
    expect(catalog.library).toEqual((bundled as { library: unknown }).library);
    // Its own entries win, and every pick's model is there to show.
    expect(catalog.updated).toBe('2099-01-01');
    const ids = new Set(catalog.models.map((m) => m.id));
    for (const row of Object.values(catalog.library!.picks)) {
      for (const pick of Object.values(row ?? {})) expect(ids.has(pick!.model)).toBe(true);
    }
  });

  it('takes the published catalog only when its signature checks, once a key is pinned', async () => {
    const key = signer();
    pinned.key = key.publicKey;
    served(published, key.sign(published));
    expect((await loadAppCatalog()).catalog.updated).toBe('2099-01-01');

    // Unsigned, signed by another key, or changed after signing: the last
    // verified copy stays, and says why.
    const stale = { catalog: { ...published, updated: '2098-01-01' }, fetchedAt: 0 };
    for (const sig of [
      undefined,
      signer().sign(published),
      key.sign({ ...published, updated: 'x' }),
    ]) {
      storeSetJsonMock.mockClear();
      storeGetJsonMock.mockResolvedValue(stale);
      served(published, sig);
      const { catalog, note } = await loadAppCatalog();
      expect(catalog.updated).toBe('2098-01-01');
      expect(note).toMatch(/could not be verified/);
      expect(storeSetJsonMock).not.toHaveBeenCalled();
    }
  });

  it('refuses a catalog older than the one already trusted', async () => {
    storeGetJsonMock.mockResolvedValue({ catalog: published, fetchedAt: 0 });
    served({ ...published, updated: '2026-01-01' });
    const { catalog, note } = await loadAppCatalog();
    expect(catalog.updated).toBe('2099-01-01');
    expect(note).toMatch(/could not be verified/);
  });

  it('falls back to the bundled starter when there is no cache and no network', async () => {
    nativeFetchMock.mockRejectedValue(new Error('offline'));
    const { catalog, note } = await loadAppCatalog();
    expect(catalog.updated).toBe((bundled as { updated: string }).updated);
    expect(note).toMatch(/built-in starter/i);
  });
});
