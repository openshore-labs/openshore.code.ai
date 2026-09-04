// A tiny read-only GitHub contents client, enough to list a folder and read a
// file's text from a repo the signed-in account can see. Used to show a
// project's memory notes (which live in the repo) on devices with no local
// clone, iPhone included. The token comes from repoAccessToken('github'); the
// fetch is injectable so it can be tested and, on desktop, routed if needed.
//
// Read only on purpose: this client never writes. The agent writes the notes
// into the repo working tree and commits them; the app only reads.

/** One entry in a repo folder listing. */
export interface GhEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

/** owner/name parsed from a "github:owner/name" repo id. */
export function parseGithubRepoId(id: string): { owner: string; repo: string } | undefined {
  const full = id.startsWith('github:') ? id.slice('github:'.length) : id;
  const slash = full.indexOf('/');
  if (slash <= 0 || slash === full.length - 1) return undefined;
  return { owner: full.slice(0, slash), repo: full.slice(slash + 1) };
}

/** Encode a repo-relative path for the contents API without turning its slashes
 *  into %2F (each segment is encoded, separators kept), so a folder name with
 *  spaces reaches GitHub correctly. */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

function contentsUrl(owner: string, repo: string, path: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/contents/${encodePath(path)}`;
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
}

/** List a folder in a repo. Returns the entries, or undefined when the folder
 *  does not exist yet (a 404, which is the normal "the agent has not created
 *  these notes yet" case). Throws on auth or network failure so the UI can tell
 *  "empty" from "could not reach GitHub". */
export async function ghListDir(
  token: string,
  owner: string,
  repo: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GhEntry[] | undefined> {
  const res = await fetchImpl(contentsUrl(owner, repo, path), { headers: headers(token) });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) return undefined; // a file, not a folder
  return body
    .map((row) => row as { name?: unknown; path?: unknown; type?: unknown })
    .filter((row) => typeof row.name === 'string' && typeof row.path === 'string')
    .map((row) => ({
      name: row.name as string,
      path: row.path as string,
      type: row.type === 'dir' ? 'dir' : 'file',
    }));
}

/** Decode GitHub's base64 file content (which carries newlines) as UTF-8. */
function decodeBase64Utf8(b64: string): string {
  const clean = b64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Read a file's text from a repo. Returns undefined when the file does not
 *  exist (404). Throws on auth or network failure. */
export async function ghReadFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const res = await fetchImpl(contentsUrl(owner, repo, path), { headers: headers(token) });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  const body = (await res.json()) as { content?: unknown; encoding?: unknown };
  if (typeof body.content !== 'string') return undefined;
  if (body.encoding === 'base64') return decodeBase64Utf8(body.content);
  return body.content;
}
