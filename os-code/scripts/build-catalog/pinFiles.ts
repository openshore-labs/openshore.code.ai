// Pin every file a media model downloads (security review, 2026-10-12). The
// hosts a download may start at (src/market/sources.ts) are places anyone can
// upload to, so the host proves nothing about the bytes. Before publishing,
// the builder reads each file's SHA-256 from its source and pins it:
//
//   Hugging Face   the repo's current commit (`/api/models/<repo>/revision/
//                  <rev>`) and the file's LFS SHA-256 at that commit
//                  (`paths-info`); the URL is rewritten to resolve at that
//                  commit, so the address and the hash name the same bytes.
//   GitHub         the release asset's published digest (`sha256:...`).
//
// METADATA ONLY: no weight byte is downloaded here. A file the source gives no
// SHA-256 for stays unpinned, unless a curator pinned it in the seed, and
// dropUnpinned takes its model out of the build (its picks go with it, in
// enrichCatalog), so nothing unverifiable is published. The downloader refuses
// a file with no SHA-256 as the second lock (src/media/install.ts).
import { filePinned } from '../../src/market/sources.js';
import type { Catalog, CatalogFile, CatalogModel } from '../../src/market/schema.js';
import type { DropRecord } from './types.js';

export interface FilePin {
  /** The address pinned to an immutable revision where the source has one. */
  url: string;
  sha256: string;
}

/** Reads a file's pin from where it lives. Undefined when the source does not
 *  answer or publishes no SHA-256 for it. */
export interface FilePinSource {
  pin(url: string): Promise<FilePin | undefined>;
}

const HF_FILE = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/;
const GH_ASSET = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/;
const SHA256 = /^[0-9a-f]{64}$/;

function segments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Hugging Face's public API, as huggingface_hub reads it. An HF_TOKEN in the
 *  environment lifts the anonymous rate limit, as in sources.ts. */
export class HuggingFaceFilePins implements FilePinSource {
  private readonly commits = new Map<string, Promise<string | undefined>>();

  constructor(
    private readonly base = 'https://huggingface.co',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    const token = process.env.HF_TOKEN?.trim();
    return { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  }

  private commit(repo: string, rev: string): Promise<string | undefined> {
    if (/^[0-9a-f]{40}$/.test(rev)) return Promise.resolve(rev);
    const key = `${repo}@${rev}`;
    let found = this.commits.get(key);
    if (!found) {
      found = (async () => {
        const res = await this.fetchImpl(
          `${this.base}/api/models/${segments(repo)}/revision/${encodeURIComponent(rev)}`,
          { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
        );
        if (!res.ok) return undefined;
        const sha = ((await res.json()) as { sha?: unknown }).sha;
        return typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
      })().catch(() => undefined);
      this.commits.set(key, found);
    }
    return found;
  }

  async pin(url: string): Promise<FilePin | undefined> {
    const m = HF_FILE.exec(url);
    if (!m) return undefined;
    const [, repo, rev, path] = m as unknown as [string, string, string, string];
    try {
      const commit = await this.commit(repo, rev);
      if (!commit) return undefined;
      const res = await this.fetchImpl(
        `${this.base}/api/models/${segments(repo)}/paths-info/${commit}`,
        {
          method: 'POST',
          headers: { ...this.headers(), 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ paths: decodeURIComponent(path), expand: 'false' }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) return undefined;
      const entries = (await res.json()) as { path?: string; lfs?: { oid?: unknown } }[];
      const sha256 = entries.find((e) => e.path === decodeURIComponent(path))?.lfs?.oid;
      if (typeof sha256 !== 'string' || !SHA256.test(sha256)) return undefined;
      return { url: `https://huggingface.co/${repo}/resolve/${commit}/${path}`, sha256 };
    } catch {
      return undefined;
    }
  }
}

/** A GitHub release asset's published digest. GitHub names one for each
 *  asset (`sha256:<hex>`); an asset it gives none for stays unpinned. */
export class GitHubReleasePins implements FilePinSource {
  constructor(
    private readonly base = 'https://api.github.com',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async pin(url: string): Promise<FilePin | undefined> {
    const m = GH_ASSET.exec(url);
    if (!m) return undefined;
    const [, repo, tag, name] = m as unknown as [string, string, string, string];
    try {
      const token = process.env.GITHUB_TOKEN?.trim();
      const res = await this.fetchImpl(
        `${this.base}/repos/${segments(repo)}/releases/tags/${encodeURIComponent(decodeURIComponent(tag))}`,
        {
          headers: {
            accept: 'application/vnd.github+json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) return undefined;
      const body = (await res.json()) as { assets?: { name?: string; digest?: unknown }[] };
      const digest = body.assets?.find((a) => a.name === decodeURIComponent(name))?.digest;
      const sha256 = typeof digest === 'string' ? /^sha256:([0-9a-f]{64})$/.exec(digest)?.[1] : '';
      return sha256 ? { url, sha256 } : undefined;
    } catch {
      return undefined;
    }
  }
}

/** Fill in each file's pin from its source. A file the seed already pins (a
 *  curator's own SHA-256) is kept as it is. */
export async function pinCatalogFiles(
  catalog: Catalog,
  sources: { huggingface: FilePinSource; github: FilePinSource },
): Promise<Catalog> {
  const models: CatalogModel[] = [];
  for (const model of catalog.models) {
    const files = model.source.files;
    const source =
      model.source.kind === 'huggingface'
        ? sources.huggingface
        : model.source.kind === 'github'
          ? sources.github
          : undefined;
    if (!files?.length || !source) {
      models.push(model);
      continue;
    }
    const pinned: CatalogFile[] = [];
    for (const file of files) {
      if (filePinned(file, model.source.kind)) {
        pinned.push(file);
        continue;
      }
      const pin = await source.pin(file.url);
      pinned.push(pin ? { ...file, url: pin.url, sha256: pin.sha256 } : file);
    }
    models.push({ ...model, source: { ...model.source, files: pinned } });
  }
  return { ...catalog, models };
}

/** Take out every model with a file that is not pinned (filePinned), with a
 *  reason for the build log. Its library picks fall with it in enrichCatalog. */
export function dropUnpinned(catalog: Catalog): { catalog: Catalog; drops: DropRecord[] } {
  const drops: DropRecord[] = [];
  const models = catalog.models.filter((model) => {
    const loose = (model.source.files ?? []).find((f) => !filePinned(f, model.source.kind));
    if (!loose) return true;
    drops.push({
      id: model.id,
      reason: `${loose.dest} has no SHA-256 pinned from its source (${loose.url})`,
    });
    return false;
  });
  return { catalog: { ...catalog, models }, drops };
}
