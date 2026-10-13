// Each file a pick pulls from another repository names its own license
// (security review of the model library, 2026-10-12, L9): the builder checks
// a model's license, and now each such file's, from the same fail-closed
// allow-list. A model with a file that does not clear is not published.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dropUnlicensedFiles,
  fileLicenseProblem,
  fileRepo,
} from '../scripts/build-catalog/fileLicenses.js';
import { CatalogSchema, type Catalog, type CatalogModel } from '../src/market/schema.js';

const seed: Catalog = CatalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'catalog.sample.json'), 'utf8')),
);
const byId = (id: string) => seed.models.find((m) => m.id === id)!;

describe("a file's own license", () => {
  it('reads the repository a file is served from', () => {
    expect(fileRepo('https://huggingface.co/Comfy-Org/x/resolve/main/a/b.safetensors')).toBe(
      'Comfy-Org/x',
    );
    expect(fileRepo('https://github.com/Sanster/models/releases/download/t/big-lama.pt')).toBe(
      'Sanster/models',
    );
  });

  it("lets a file from the model's own repository carry the model's license", () => {
    const model = byId('z-image-turbo');
    expect(model.source.files!.every((f) => !fileLicenseProblem(model, f))).toBe(true);
  });

  it('needs a file from another repository to name a commercial license', () => {
    const model = byId('flux2-klein-4b');
    const vae = model.source.files!.find((f) => f.dest.startsWith('vae/'))!;
    expect(fileLicenseProblem(model, vae)).toBeUndefined();
    expect(fileLicenseProblem(model, { ...vae, license: undefined })).toMatch(
      /names no license of its own/,
    );
    expect(fileLicenseProblem(model, { ...vae, license: 'CC-BY-NC-4.0' })).toMatch(
      /does not allow commercial use/,
    );
    expect(fileLicenseProblem(model, { ...vae, license: 'Made-Up-1.0' })).toMatch(
      /not on the allow-list/,
    );
  });

  it('holds back a model until each of its files is licensed', () => {
    // Every model in the seed clears today: each file from another
    // repository names its license.
    expect(dropUnlicensedFiles(seed).drops).toEqual([]);
    // Take the Lightning LoRA's license off, and its model is held back.
    const strip = (m: CatalogModel): CatalogModel => ({
      ...m,
      source: {
        ...m.source,
        files: m.source.files!.map(({ license: _license, ...rest }) =>
          rest.url.includes('/lightx2v/') ? rest : { ...rest, license: _license },
        ),
      },
    });
    const unlicensed: Catalog = {
      ...seed,
      models: seed.models.map((m) => (m.id === 'qwen-image-edit-2511' ? strip(m) : m)),
    };
    const { catalog, drops } = dropUnlicensedFiles(unlicensed);
    expect(drops.map((d) => d.id)).toEqual(['qwen-image-edit-2511']);
    expect(catalog.models.some((m) => m.id === 'qwen-image-edit-2511')).toBe(false);
  });
});
