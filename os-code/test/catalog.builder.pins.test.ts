// Every media file is pinned before it is published (security review,
// 2026-10-12): the hosts a download starts at are places anyone can upload
// to, so the builder reads each file's SHA-256 from its source (and pins a
// Hugging Face file to its commit), drops a model with a file left unpinned,
// and the gate refuses to publish an unpinned file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dropUnpinned,
  GitHubReleasePins,
  HuggingFaceFilePins,
  pinCatalogFiles,
} from '../scripts/build-catalog/pinFiles.js';
import { enrichCatalog } from '../scripts/build-catalog/enrich.js';
import { regressionGate } from '../scripts/build-catalog/gate.js';
import { filePinned } from '../src/market/sources.js';
import { CatalogSchema, type Catalog } from '../src/market/schema.js';

const seed: Catalog = CatalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'catalog.sample.json'), 'utf8')),
);
const COMMIT = 'a'.repeat(40);
const HASH = 'b'.repeat(64);

describe('filePinned', () => {
  it('needs the host, a SHA-256, and a commit for a Hugging Face file', () => {
    const at = (rev: string) => `https://huggingface.co/o/r/resolve/${rev}/f.safetensors`;
    expect(filePinned({ url: at(COMMIT), sha256: HASH }, 'huggingface')).toBe(true);
    expect(filePinned({ url: at('main'), sha256: HASH }, 'huggingface')).toBe(false);
    expect(filePinned({ url: at(COMMIT) }, 'huggingface')).toBe(false);
    expect(filePinned({ url: 'https://evil.example/f', sha256: HASH }, 'huggingface')).toBe(false);
    expect(
      filePinned(
        { url: 'https://github.com/o/r/releases/download/v1/f.pt', sha256: HASH },
        'github',
      ),
    ).toBe(true);
  });
});

describe('reading pins from the source', () => {
  it('pins a Hugging Face file to its commit and its LFS SHA-256', async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/revision/')) return Response.json({ sha: COMMIT });
      expect(String(init?.body)).toBe('paths=split_files%2Fvae%2Fae.safetensors&expand=false');
      return Response.json([{ path: 'split_files/vae/ae.safetensors', lfs: { oid: HASH } }]);
    }) as typeof fetch;
    const pins = new HuggingFaceFilePins('https://hf.test', fetchImpl);
    const pin = await pins.pin(
      'https://huggingface.co/Comfy-Org/x/resolve/main/split_files/vae/ae.safetensors',
    );
    expect(pin).toEqual({
      url: `https://huggingface.co/Comfy-Org/x/resolve/${COMMIT}/split_files/vae/ae.safetensors`,
      sha256: HASH,
    });
    expect(asked).toEqual([
      'GET https://hf.test/api/models/Comfy-Org/x/revision/main',
      `POST https://hf.test/api/models/Comfy-Org/x/paths-info/${COMMIT}`,
    ]);
  });

  it('leaves a file unpinned when the source gives no SHA-256', async () => {
    const noLfs = (async (url: string) =>
      url.includes('/revision/')
        ? Response.json({ sha: COMMIT })
        : Response.json([{ path: 'f.json' }])) as typeof fetch;
    const hf = new HuggingFaceFilePins('https://hf.test', noLfs);
    expect(await hf.pin('https://huggingface.co/o/r/resolve/main/f.json')).toBeUndefined();
    const down = (async () => new Response('', { status: 503 })) as typeof fetch;
    expect(
      await new HuggingFaceFilePins('https://hf.test', down).pin(
        'https://huggingface.co/o/r/resolve/main/f',
      ),
    ).toBeUndefined();
  });

  it("reads a GitHub release asset's published digest", async () => {
    const fetchImpl = (async (url: string) => {
      expect(url).toBe('https://gh.test/repos/Sanster/models/releases/tags/add_big_lama');
      return Response.json({
        assets: [
          { name: 'other.pt', digest: `sha256:${'c'.repeat(64)}` },
          { name: 'big-lama.pt', digest: `sha256:${HASH}` },
        ],
      });
    }) as typeof fetch;
    const url = 'https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt';
    expect(await new GitHubReleasePins('https://gh.test', fetchImpl).pin(url)).toEqual({
      url,
      sha256: HASH,
    });
    const none = (async () => Response.json({ assets: [{ name: 'big-lama.pt' }] })) as typeof fetch;
    expect(await new GitHubReleasePins('https://gh.test', none).pin(url)).toBeUndefined();
  });
});

describe('publishing only pinned files', () => {
  it('pins every file it can, drops a model with one it cannot, and its picks go too', async () => {
    const pinned = await pinCatalogFiles(seed, {
      huggingface: {
        pin: async (url) => ({
          url: url.replace('/resolve/main/', `/resolve/${COMMIT}/`),
          sha256: HASH,
        }),
      },
      github: { pin: async () => undefined },
    });
    const { catalog, drops } = dropUnpinned(pinned);
    expect(drops.map((d) => d.id)).toEqual(['lama']);
    expect(catalog.models.find((m) => m.id === 'sam3.1')?.source.files?.[0]?.sha256).toBe(HASH);
    const built = enrichCatalog({
      seed: catalog,
      metadata: {},
      benchmarks: {},
      evals: {},
      overlay: {},
      previous: undefined,
    });
    expect(built.catalog.library?.picks['imageEdit.remove']).toBeUndefined();
    expect(built.catalog.library?.picks['imageEdit.select']?.laptop?.model).toBe('sam3.1');
  });

  it('drops every unpinned media model offline, keeping the chat models', () => {
    const { catalog, drops } = dropUnpinned(seed);
    expect(drops.length).toBe(seed.models.filter((m) => m.source.files?.length).length);
    expect(catalog.models.every((m) => !m.source.files?.length)).toBe(true);
    expect(catalog.models.some((m) => m.id === 'qwen3.5-4b')).toBe(true);
  });

  it('refuses to publish an unpinned file', () => {
    const gate = regressionGate(seed, undefined);
    expect(gate.ok).toBe(false);
    expect(gate.breaches.some((b) => b.check === 'files are pinned')).toBe(true);
    const clean = regressionGate(dropUnpinned(seed).catalog, undefined);
    expect(clean.breaches.filter((b) => b.check === 'files are pinned')).toEqual([]);
  });
});
