// Where model files may come from (the model library, founder 2026-10-12).
// Sources are not limited to one host, but every host a download starts at is
// named here, once, so the catalog builder can refuse a file anywhere else and
// the What leaves this device list (app/src/lib/egressManifest.ts) can name
// every recipient; app/test/egressManifest.test.ts holds the two together.
// A download goes straight from the source to the person's machine; OpenShore
// never rehosts or proxies weights.
import type { SourceKind } from './schema.js';

/** The hosts a file of each source kind may START at. A redirect the source
 *  itself issues (Hugging Face to its storage CDN, a GitHub release to its
 *  asset host) is followed by the downloader, which checks the final file's
 *  SHA-256 when the catalog carries one. */
export const SOURCE_HOSTS: Record<SourceKind, string[]> = {
  ollama: ['ollama.com', 'registry.ollama.ai'],
  huggingface: ['huggingface.co'],
  github: ['github.com'],
  civitai: ['civitai.com'],
  // A publisher's own site: each host is a named publisher, added with its
  // first model, never a wildcard.
  publisher: [],
};

/** Where a model's weights come from, as the store and the CLI say it. */
export const SOURCE_NAMES: Record<SourceKind, string> = {
  ollama: 'the Ollama library',
  huggingface: 'Hugging Face',
  github: "the publisher's GitHub releases",
  civitai: 'Civitai',
  publisher: "the publisher's own site",
};

/** Every host any source kind may start at, for the egress list. */
export function allSourceHosts(): string[] {
  return [...new Set(Object.values(SOURCE_HOSTS).flat())].sort();
}

/** Whether a file URL starts at a host its source kind allows. https only. */
export function fileHostAllowed(url: string, kind: SourceKind): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return SOURCE_HOSTS[kind].includes(parsed.host);
}
