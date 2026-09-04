// The read-only GitHub contents client: id parsing, folder listing, file
// reading (base64 and UTF-8), and the 404-means-absent contract.
import { describe, expect, it, vi } from 'vitest';
import { ghListDir, ghReadFile, parseGithubRepoId } from '../src/lib/github.js';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

describe('parseGithubRepoId', () => {
  it('parses a github: id and a bare owner/name', () => {
    expect(parseGithubRepoId('github:acme/app')).toEqual({ owner: 'acme', repo: 'app' });
    expect(parseGithubRepoId('acme/app')).toEqual({ owner: 'acme', repo: 'app' });
  });
  it('rejects malformed ids', () => {
    expect(parseGithubRepoId('github:acme')).toBeUndefined();
    expect(parseGithubRepoId('github:/app')).toBeUndefined();
    expect(parseGithubRepoId('github:acme/')).toBeUndefined();
  });
});

describe('ghListDir', () => {
  it('encodes the folder path (spaces survive) and returns file entries', async () => {
    let calledUrl = '';
    const fetchImpl = vi.fn(async (url: string) => {
      calledUrl = url;
      return jsonResponse(200, [
        { name: 'Current State.md', path: 'x/Current State.md', type: 'file' },
        { name: 'sub', path: 'x/sub', type: 'dir' },
      ]);
    }) as unknown as typeof fetch;
    const entries = await ghListDir(
      'tok',
      'acme',
      'app',
      'OpenShore Project My App MDs',
      fetchImpl,
    );
    expect(calledUrl).toContain('OpenShore%20Project%20My%20App%20MDs');
    expect(calledUrl).not.toContain('MDs/'); // the folder is the last path segment
    expect(entries).toEqual([
      { name: 'Current State.md', path: 'x/Current State.md', type: 'file' },
      { name: 'sub', path: 'x/sub', type: 'dir' },
    ]);
  });

  it('returns undefined for a missing folder (404)', async () => {
    const fetchImpl = (async () => jsonResponse(404, { message: 'Not Found' })) as typeof fetch;
    expect(await ghListDir('tok', 'a', 'b', 'x', fetchImpl)).toBeUndefined();
  });

  it('throws on other failures', async () => {
    const fetchImpl = (async () => jsonResponse(401, {})) as typeof fetch;
    await expect(ghListDir('tok', 'a', 'b', 'x', fetchImpl)).rejects.toThrow(/401/);
  });
});

describe('ghReadFile', () => {
  it('decodes base64 content as UTF-8', async () => {
    // "café" -> base64 of its UTF-8 bytes.
    const fetchImpl = (async () =>
      jsonResponse(200, { content: 'Y2Fmw6k=', encoding: 'base64' })) as typeof fetch;
    expect(await ghReadFile('tok', 'a', 'b', 'x.md', fetchImpl)).toBe('café');
  });

  it('returns undefined for a missing file (404)', async () => {
    const fetchImpl = (async () => jsonResponse(404, {})) as typeof fetch;
    expect(await ghReadFile('tok', 'a', 'b', 'x.md', fetchImpl)).toBeUndefined();
  });
});
