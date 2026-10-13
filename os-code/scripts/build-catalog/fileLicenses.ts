// Each file's own license (security review of the model library, 2026-10-12,
// L9). The builder checks a model's license, but a pick can pull files from
// another repository: a text encoder from a repack, a VAE, a speed-up LoRA.
// Such a file must name its own license (`files[].license`), from the same
// fail-closed allow-list (licenses.table.ts), with a commercial posture; a
// model with a file that does not is taken out of the build, its picks with
// it, and the gate refuses to publish one. A file from the model's own
// repository carries the model's license unless it names another.
import type { Catalog, CatalogFile, CatalogModel } from '../../src/market/schema.js';
import type { DropRecord } from './types.js';
import { resolveLicense } from './licenses.table.js';

/** The repository a file is served from ("owner/name"), when it is one. */
export function fileRepo(url: string): string | undefined {
  return /^https:\/\/(?:huggingface\.co|github\.com)\/([^/]+\/[^/]+)\//.exec(url)?.[1];
}

/** Why a file's license does not clear, or undefined when it does. */
export function fileLicenseProblem(model: CatalogModel, file: CatalogFile): string | undefined {
  const fromElsewhere = fileRepo(file.url) !== model.source.ref;
  if (!file.license) {
    return fromElsewhere
      ? `${file.dest} comes from ${fileRepo(file.url) ?? file.url}, not ${model.source.ref}, and names no license of its own`
      : undefined;
  }
  const row = resolveLicense(file.license);
  if (!row) return `${file.dest} names a license that is not on the allow-list (${file.license})`;
  if (row.commercial === 'non-commercial') {
    return `${file.dest} is under ${row.name}, which does not allow commercial use`;
  }
  return undefined;
}

/** Take out every model with a file whose license does not clear. */
export function dropUnlicensedFiles(catalog: Catalog): { catalog: Catalog; drops: DropRecord[] } {
  const drops: DropRecord[] = [];
  const models = catalog.models.filter((model) => {
    for (const file of model.source.files ?? []) {
      const problem = fileLicenseProblem(model, file);
      if (problem) {
        drops.push({ id: model.id, reason: problem });
        return false;
      }
    }
    return true;
  });
  return { catalog: { ...catalog, models }, drops };
}
