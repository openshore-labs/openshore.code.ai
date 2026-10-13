// The published catalog is signed (security review of the model library,
// 2026-10-12, L7): CI signs catalog.v2.json with a key whose public half the
// engine and the app pin, and a fetched catalog is taken only when its
// signature checks and it is not older than the copy already trusted. With
// no key pinned the catalog is taken as before.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  CATALOG_PUBLIC_KEY,
  catalogMessage,
  olderThanTrusted,
  verifyCatalogBytes,
} from '../src/market/catalogSignature.js';
import { publicKeyOf, signCatalog, signCatalogFile } from '../scripts/build-catalog/sign.js';
import { loadCatalog } from '../src/market/catalog.js';
import { CATALOG_URL, ConfigSchema } from '../src/config/schema.js';
import type { EgressPolicy } from '../src/core/security/egress.js';

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    publicKey: spki.subarray(spki.length - 32).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

const keys = keyPair();
const bytesOf = (text: string) => new TextEncoder().encode(text);
const catalogText = (updated: string) =>
  JSON.stringify({ version: 1, updated, models: [], presets: [] });

describe('the catalog signature', () => {
  it('names the context, the file and the hash', () => {
    expect(catalogMessage('ab')).toBe('openshore-catalog-v1\ncatalog.v2.json\nab');
  });

  it('checks a catalog signed with the pinned key, and refuses any change', async () => {
    const bytes = bytesOf(catalogText('2026-10-12'));
    const sig = signCatalog(bytes, keys.privateKey, 'catalog.v2.json');
    expect(await verifyCatalogBytes(bytes, sig, keys.publicKey)).toEqual({ verdict: 'verified' });
    const changed = bytesOf(catalogText('2026-10-13'));
    expect((await verifyCatalogBytes(changed, sig, keys.publicKey)).verdict).toBe('refused');
    expect((await verifyCatalogBytes(bytes, sig, keyPair().publicKey)).verdict).toBe('refused');
    expect((await verifyCatalogBytes(bytes, undefined, keys.publicKey)).verdict).toBe('refused');
    expect((await verifyCatalogBytes(bytes, 'not-base64!', keys.publicKey)).verdict).toBe(
      'refused',
    );
    // Signed for another file name, it does not check as the catalog.
    const other = signCatalog(bytes, keys.privateKey, 'catalog.json');
    expect((await verifyCatalogBytes(bytes, other, keys.publicKey)).verdict).toBe('refused');
  });

  it('pins either no key yet or one Ed25519 public key', () => {
    expect(CATALOG_PUBLIC_KEY === '' || /^[A-Za-z0-9+/]{43}=$/.test(CATALOG_PUBLIC_KEY)).toBe(true);
  });

  it('takes a catalog as before while no key is pinned', async () => {
    expect(await verifyCatalogBytes(bytesOf('{}'), undefined, '')).toEqual({
      verdict: 'unpinned',
    });
  });

  it('refuses a catalog older than the one already trusted', () => {
    expect(olderThanTrusted({ updated: '2026-10-01' }, { updated: '2026-10-12' })).toBe(true);
    expect(olderThanTrusted({ updated: '2026-10-12' }, { updated: '2026-10-12' })).toBe(false);
    expect(olderThanTrusted({ updated: '2026-10-01' }, undefined)).toBe(false);
  });
});

describe('signing in CI', () => {
  function catalogFile(): string {
    const dir = mkdtempSync(join(tmpdir(), 'osc-sign-'));
    const path = join(dir, 'catalog.v2.json');
    writeFileSync(path, catalogText('2026-10-12'));
    return path;
  }

  it('writes a signature the pinned key checks', async () => {
    const path = catalogFile();
    const line = await signCatalogFile(
      path,
      { CATALOG_SIGNING_KEY: keys.privateKey },
      keys.publicKey,
    );
    expect(line).toContain(keys.publicKey);
    const sig = readFileSync(`${path}.sig`, 'utf8').trim();
    expect(await verifyCatalogBytes(readFileSync(path), sig, keys.publicKey)).toEqual({
      verdict: 'verified',
    });
    expect(publicKeyOf(keys.privateKey)).toBe(keys.publicKey);
  });

  it('signs nothing with no key pinned and no secret', async () => {
    const path = catalogFile();
    expect(await signCatalogFile(path, {}, '')).toMatch(/published unsigned/);
    expect(existsSync(`${path}.sig`)).toBe(false);
  });

  it('fails the job when apps would refuse what it publishes', async () => {
    const path = catalogFile();
    await expect(signCatalogFile(path, {}, keys.publicKey)).rejects.toThrow(
      /CATALOG_SIGNING_KEY is not set/,
    );
    await expect(
      signCatalogFile(path, { CATALOG_SIGNING_KEY: keyPair().privateKey }, keys.publicKey),
    ).rejects.toThrow(/is not the pinned key/);
    await expect(
      signCatalogFile(path, { CATALOG_SIGNING_KEY: keys.privateKey }, ''),
    ).rejects.toThrow(/no key is pinned/);
    expect(existsSync(`${path}.sig`)).toBe(false);
  });
});

describe('the engine takes only a verified catalog', () => {
  /** A temporary engine home with a cached catalog from `cachedOn`, made
   *  stale so the loader goes to the network. */
  function home(cachedOn?: string): void {
    const previous = process.env.OSC_HOME;
    const dir = mkdtempSync(join(tmpdir(), 'osc-home-'));
    process.env.OSC_HOME = dir;
    onTestFinished(() => {
      if (previous === undefined) delete process.env.OSC_HOME;
      else process.env.OSC_HOME = previous;
    });
    if (cachedOn) {
      const cache = join(dir, 'catalog.json');
      writeFileSync(cache, catalogText(cachedOn));
      const old = new Date(Date.now() - 48 * 3_600_000);
      utimesSync(cache, old, old);
    }
  }

  /** The published feed: the catalog text and, when given, its signature. */
  function feed(text: string, sig?: string): EgressPolicy {
    return {
      fetch: async (url: string) => {
        if (url === CATALOG_URL) return new Response(text);
        if (url === `${CATALOG_URL}.sig` && sig) return new Response(`${sig}\n`);
        return new Response('', { status: 404 });
      },
    } as unknown as EgressPolicy;
  }

  const config = ConfigSchema.parse({});

  it('takes a signed catalog from the published address', async () => {
    home('2026-10-01');
    const text = catalogText('2026-10-12');
    const sig = signCatalog(bytesOf(text), keys.privateKey, 'catalog.v2.json');
    const loaded = await loadCatalog(config, feed(text, sig), { publicKey: keys.publicKey });
    expect(loaded.source).toBe('remote');
    expect(loaded.catalog.updated).toBe('2026-10-12');
  });

  it('keeps the last verified copy when the new one is unsigned, changed, or older', async () => {
    const text = catalogText('2026-10-12');
    const sig = signCatalog(bytesOf(text), keys.privateKey, 'catalog.v2.json');
    for (const published of [
      feed(text),
      feed(catalogText('2026-10-13'), sig),
      feed(
        catalogText('2026-09-30'),
        signCatalog(bytesOf(catalogText('2026-09-30')), keys.privateKey, 'catalog.v2.json'),
      ),
    ]) {
      home('2026-10-01');
      const loaded = await loadCatalog(config, published, { publicKey: keys.publicKey });
      expect(loaded.source).toBe('cache');
      expect(loaded.catalog.updated).toBe('2026-10-01');
      expect(loaded.note).toMatch(/could not be verified/);
    }
  });

  it('falls back to the bundled catalog when there is no verified copy', async () => {
    home();
    const loaded = await loadCatalog(config, feed(catalogText('2026-10-12')), {
      publicKey: keys.publicKey,
    });
    expect(loaded.source).toBe('bundled');
  });
});
