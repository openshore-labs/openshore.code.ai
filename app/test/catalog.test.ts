// MP-F1: a standalone phone (no desktop bridge, no paired daemon) must fetch
// the published catalog directly, cache it, and fall back to that cache when
// the network is gone. Without this the storefront shows only the bundled
// starter, which carries no ratings, popularity, or staff picks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { bridgeMock, isDesktopMock, storeGetJsonMock, storeSetJsonMock, nativeFetchMock } =
  vi.hoisted(() => ({
    bridgeMock: vi.fn(() => undefined as unknown),
    isDesktopMock: vi.fn(() => false),
    storeGetJsonMock: vi.fn<(k: string) => Promise<unknown>>(),
    storeSetJsonMock: vi.fn<(k: string, v: unknown) => Promise<void>>(),
    nativeFetchMock: vi.fn(),
  }));

vi.mock('../src/lib/electronBridge.js', () => ({ bridge: bridgeMock }));
vi.mock('../src/lib/platform.js', () => ({
  isDesktop: isDesktopMock,
  storeGetJson: storeGetJsonMock,
  storeSetJson: storeSetJsonMock,
}));
vi.mock('../src/lib/nativeFetch.js', () => ({ nativeFetch: nativeFetchMock }));

import { loadAppCatalog } from '../src/lib/catalog.js';
import bundled from 'os-code/catalog.sample.json';

// A valid catalog distinguishable from the bundled sample by its `updated` mark.
const published = { ...(bundled as object), updated: '2099-01-01' };

beforeEach(() => {
  bridgeMock.mockReturnValue(undefined);
  isDesktopMock.mockReturnValue(false);
  storeGetJsonMock.mockResolvedValue(undefined);
  storeSetJsonMock.mockResolvedValue(undefined);
  nativeFetchMock.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('loadAppCatalog standalone (MP-F1)', () => {
  it('fetches the published catalog and caches it when nothing is cached', async () => {
    nativeFetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => published });
    const { catalog, note } = await loadAppCatalog();
    expect(nativeFetchMock).toHaveBeenCalledWith(
      'https://openshore.ai/os-code/catalog.json',
      expect.objectContaining({ responseType: 'json' }),
    );
    expect(catalog.updated).toBe('2099-01-01');
    expect(note).toBeUndefined();
    // The freshly fetched catalog was written to the Preferences cache.
    expect(storeSetJsonMock).toHaveBeenCalledTimes(1);
    const [key, value] = storeSetJsonMock.mock.calls[0];
    expect(key).toBe('oscode.cache.catalog.v1');
    expect((value as { catalog: { updated: string } }).catalog.updated).toBe('2099-01-01');
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

  it('falls back to the bundled starter when there is no cache and no network', async () => {
    nativeFetchMock.mockRejectedValue(new Error('offline'));
    const { catalog, note } = await loadAppCatalog();
    expect(catalog.updated).toBe((bundled as { updated: string }).updated);
    expect(note).toMatch(/built-in starter/i);
  });
});
