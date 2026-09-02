// Ollama pull robustness (F3). A dropped connection mid-pull must return a clean
// {ok:false} (not throw out of the CLI flow), and a stream that ends without a
// terminal status:"success" line must NOT report a false success.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installModel, installOllamaRef } from '../src/market/install.js';
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
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/interrupted/i);
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
    expect(res.detail).toMatch(/before Ollama reported success/i);
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
