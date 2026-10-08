// Ollama pull robustness (F3). A dropped connection mid-pull must return a clean
// {ok:false} (not throw out of the CLI flow), and a stream that ends without a
// terminal status:"success" line must NOT report a false success. A pull that
// fails with the network up says what failed and the way on, in plain words,
// never the model server's own error (Desktop Offline follow-up, 2026-10-08).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installModel, installOllamaRef } from '../src/market/install.js';
import { pullFailedLine, pullFailure } from '../src/market/pullLine.js';
import type { CatalogModel } from '../src/market/schema.js';

const model = {
  id: 'qwen',
  name: 'Qwen2.5 Coder 7B',
  source: {
    kind: 'ollama',
    ref: 'qwen2.5-coder:7b',
    pullCommand: 'ollama pull qwen2.5-coder:7b',
  },
} as unknown as CatalogModel;

// Build a fake fetch Response whose body streams the given NDJSON chunks. When
// `errorAfter` is set, the reader throws once the chunks are exhausted (a
// dropped connection); otherwise it ends cleanly (done).
function fakeResponse(chunks: string[], opts: { errorMidway?: boolean } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read() {
            if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
            if (opts.errorMidway) throw new Error('socket hang up');
            return { done: true, value: undefined };
          },
        };
      },
    },
  };
}

function stubFetch(response: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installModel over the Ollama API', () => {
  it('returns ok:false when the connection drops mid-pull', async () => {
    stubFetch(fakeResponse(['{"status":"pulling manifest"}\n'], { errorMidway: true }));
    const res = await installModel(model, () => {});
    expect(res).toEqual({
      ok: false,
      detail: 'The download of qwen2.5-coder:7b stopped partway. Try again.',
      reason: 'stopped',
    });
    // The socket's own words stay out of the line.
    expect(res.detail).not.toMatch(/socket hang up/);
  });

  it('returns ok:false when the stream ends without a success status', async () => {
    stubFetch(
      fakeResponse([
        '{"status":"pulling manifest"}\n',
        '{"status":"downloading","total":100,"completed":50}\n',
      ]),
    );
    const res = await installModel(model, () => {});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('stopped');
    expect(res.detail).toBe('The download of qwen2.5-coder:7b stopped partway. Try again.');
  });

  it('returns ok:true only after a terminal status:"success"', async () => {
    stubFetch(
      fakeResponse([
        '{"status":"downloading","total":100,"completed":100}\n',
        '{"status":"success"}\n',
      ]),
    );
    const res = await installModel(model, () => {});
    expect(res.ok).toBe(true);
  });

  it('installOllamaRef pulls an arbitrary ref through the same success gate', async () => {
    stubFetch(fakeResponse(['{"status":"success"}\n']));
    const res = await installOllamaRef('qwen3-coder:30b', () => {});
    expect(res.ok).toBe(true);
  });

  it('installOllamaRef refuses an empty name instead of pulling nothing', async () => {
    const res = await installOllamaRef('   ', () => {});
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/model name/i);
  });
});

describe('a pull that fails with the network up says so plainly', () => {
  const ollamaSays = (error: string) =>
    stubFetch(fakeResponse(['{"status":"pulling manifest"}\n', `${JSON.stringify({ error })}\n`]));

  it('a name Ollama does not have: the name, and check it', async () => {
    ollamaSays('pull model manifest: file does not exist');
    const res = await installOllamaRef('qwen9:1b', () => {});
    expect(res).toEqual({
      ok: false,
      detail: 'Ollama has no model called qwen9:1b. Check the name, then try again.',
      reason: 'not-found',
    });
  });

  it('a full disk, and the library out of reach, each with its own way on', async () => {
    ollamaSays('write /usr/share/ollama/.ollama/models/blobs/sha256-1: no space left on device');
    const disk = await installModel(model, () => {});
    expect(disk.reason).toBe('disk');
    expect(disk.detail).toBe(
      'Not enough disk space on your computer for qwen2.5-coder:7b. Free some space, then try again.',
    );

    ollamaSays(
      'pull model manifest: Get "https://registry.ollama.ai/v2/library/qwen2.5-coder/manifests/7b": dial tcp: lookup registry.ollama.ai: no such host',
    );
    const away = await installModel(model, () => {});
    expect(away.reason).toBe('unreachable');
    expect(away.detail).toBe(
      'Could not reach the Ollama library from your computer. Check its internet connection, then try again.',
    );
    expect(away.detail).not.toMatch(/registry|dial|lookup|https?:/);
  });

  it('anything else is one plain line with Try again, never the raw error', async () => {
    ollamaSays('unexpected EOF in layer sha256:abc123');
    const res = await installModel(model, () => {});
    expect(res).toEqual({
      ok: false,
      detail: 'Could not download qwen2.5-coder:7b. Try again.',
      reason: 'failed',
    });
  });

  it('every line names the model, ends on the way on, and carries no dash or raw text', () => {
    const reasons = ['not-found', 'disk', 'unreachable', 'stopped', 'failed'] as const;
    for (const reason of reasons) {
      const line = pullFailedLine('DeepBlue', reason);
      expect(line, line).toMatch(/try again\.$/i);
      expect(line, line).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
      expect(line, line).not.toMatch(/error|exited|code \d/i);
      if (reason !== 'unreachable') expect(line).toContain('DeepBlue');
    }
  });

  it("reads the cause from Ollama's own words", () => {
    expect(pullFailure('pull model manifest: file does not exist')).toBe('not-found');
    expect(pullFailure("model 'nope' not found")).toBe('not-found');
    expect(pullFailure('no space left on device')).toBe('disk');
    expect(pullFailure('dial tcp 104.21.0.1:443: i/o timeout')).toBe('unreachable');
    expect(pullFailure('getaddrinfo ENOTFOUND registry.ollama.ai')).toBe('unreachable');
    expect(pullFailure('max retries exceeded: unexpected EOF')).toBe('failed');
    expect(pullFailure('')).toBe('failed');
  });
});
