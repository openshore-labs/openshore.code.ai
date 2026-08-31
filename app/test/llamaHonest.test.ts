// The web/desktop llama fallback must never fabricate an answer. It once
// returned a canned "(demo)" reply that looked real to a paying desktop user;
// this pins that it now refuses instead, and that no fabricated reply text
// survives in the source.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Llama, DEVICE_INFERENCE_UNAVAILABLE } from '../src/lib/llamaPlugin.js';

describe('device inference fallback is honest', () => {
  it('reports the device as unsupported off a real phone', async () => {
    const { supported } = await Llama.isSupported();
    expect(supported).toBe(false);
  });

  it('fails the load with a real message instead of a fake success', async () => {
    const res = await Llama.load({ id: 'anything' });
    expect(res.ok).toBe(false);
    expect(res.detail).toBe(DEVICE_INFERENCE_UNAVAILABLE);
  });

  it('refuses to generate rather than fabricate a reply', async () => {
    await expect(
      Llama.generate({ requestId: 'r1', system: '', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow();
  });

  it('carries no fabricated reply string in its source', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/llamaPlugin.ts'), 'utf8');
    expect(src).not.toContain('would answer');
    expect(src).not.toContain('(demo)');
  });
});
