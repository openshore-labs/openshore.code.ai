// Vault M7 (CTO L9): the person approves exactly the bytes that land,
// provenance lines included. The real merge runs here (no stand-in): an
// addition to a person's note shows its property change in the diff, execute
// writes the very bytes the preview hashed, and a seat that changed under the
// card writes nothing rather than bytes nobody approved.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '../src/core/tools/index.js';
import { vaultWriteTool } from '../src/core/tools/vault.js';
import { closeEngineVaultIndexes } from '../src/core/vault/engineIndex.js';

let root: string;

function ctx(model = 'qwen2.5:7b', leaves = false): ToolContext {
  return {
    vaultRoot: root,
    config: { vault: { provenance: 'on' } },
    seatLeavesNetwork: () => leaves,
    vaultSeat: () => ({ model, size: 'small', provider: 'anthropic' }),
  } as unknown as ToolContext;
}

const sha = (b: Buffer | string) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const afterHash = (basis: string | undefined) => basis?.split('#after=')[1];

const PERSON_NOTE = [
  '---',
  'tags: [auth]',
  'oscode-source: "agent"',
  'oscode-reviewed: "2026-09-20T10:00:00.000Z"',
  '---',
  '# Auth',
  'Sessions.',
  '',
].join('\n');

describe('the approved bytes are the written bytes (L9)', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'osc-m7-bytes-'));
  });
  afterEach(async () => {
    await closeEngineVaultIndexes();
    rmSync(root, { recursive: true, force: true });
  });

  it('an append to a note shows the property change and writes exactly those bytes', async () => {
    writeFileSync(join(root, 'Auth.md'), PERSON_NOTE.replace('"agent"', '"crew"'));
    const a = { path: 'Auth.md', content: 'Revisit in Q3.\n', mode: 'append' as const };
    const preview = await vaultWriteTool.preview!(a, ctx());
    // The card's diff carries the provenance change, not just the addition.
    expect(preview.detail).toContain('+oscode-source: "agent-edit"');
    expect(preview.detail).toContain('-oscode-reviewed: "2026-09-20T10:00:00.000Z"');
    expect(preview.detail).toContain('+oscode-model: "qwen2.5:7b"');
    expect(preview.detail).toContain('+Revisit in Q3.');
    const out = await vaultWriteTool.execute(a, ctx(), { basis: preview.basis });
    expect(out.ok).toBe(true);
    const written = readFileSync(join(root, 'Auth.md'));
    expect(sha(written)).toBe(afterHash(preview.basis));
    expect(out.diffText).toBe(preview.detail);
    expect(written.toString('utf8')).toContain('oscode-where: "local"');
    expect(written.toString('utf8')).not.toContain('oscode-reviewed');
  });

  it('a replace of a new note writes the created line the preview showed', async () => {
    const a = { path: 'Plan.md', content: '# Plan\n', mode: 'replace' as const };
    const preview = await vaultWriteTool.preview!(a, ctx('m', true));
    await new Promise((r) => setTimeout(r, 5));
    const out = await vaultWriteTool.execute(a, ctx('m', true), { basis: preview.basis });
    expect(out.ok).toBe(true);
    const written = readFileSync(join(root, 'Plan.md'));
    expect(sha(written)).toBe(afterHash(preview.basis));
    expect(written.toString('utf8')).toContain('oscode-provider: "anthropic"');
  });

  it('a seat that changed under the card writes nothing', async () => {
    writeFileSync(join(root, 'Auth.md'), PERSON_NOTE);
    const before = readFileSync(join(root, 'Auth.md'));
    const a = { path: 'Auth.md', content: 'More.\n', mode: 'append' as const };
    const preview = await vaultWriteTool.preview!(a, ctx('qwen2.5:7b'));
    const out = await vaultWriteTool.execute(a, ctx('claude-opus', true), {
      basis: preview.basis,
    });
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/not be written exactly as you approved/);
    expect(readFileSync(join(root, 'Auth.md')).equals(before)).toBe(true);
  });
});
