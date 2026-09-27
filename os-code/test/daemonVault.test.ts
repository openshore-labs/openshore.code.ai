// The engine's Vault index (Vault M4, CTO I7; plan 4.6): one index per vault
// root under the engine state folder, keyed by vaultIndexKey, loaded in the
// background, reconciled by version, saved whole by atomic rename. Two roots
// are two indexes, two files, and no crossover in search.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeEngineVaultIndexes,
  engineVaultIndex,
  openEngineVaultIndex,
} from '../src/core/vault/engineIndex.js';
import { vaultIndexDir, vaultIndexKey, vaultIndexPath } from '../src/core/vault/indexFile.js';
import { listVaultNotes } from '../src/core/vault/listNotes.js';
import { statNote } from '../src/core/vault/noteFile.js';
import { vaultSearchTool } from '../src/core/tools/vaultFind.js';
import type { ToolContext } from '../src/core/tools/index.js';

let a: string;
let b: string;

function write(root: string, rel: string, text: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}

beforeEach(() => {
  a = mkdtempSync(join(tmpdir(), 'osc-vault-a-'));
  b = mkdtempSync(join(tmpdir(), 'osc-vault-b-'));
});
afterEach(async () => {
  await closeEngineVaultIndexes();
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
});

describe('the engine index is per vault root', () => {
  it('two roots, two keys, two files, no crossover in search', async () => {
    write(a, 'Alpha/plan.md', 'the zeppelin plan for root a');
    write(b, 'Beta/plan.md', 'the submarine plan for root b');
    const ia = await engineVaultIndex(a);
    const ib = await engineVaultIndex(b);
    expect(ia).not.toBe(ib);
    expect(ia.key).toBe(await vaultIndexKey(a));
    expect(ib.key).toBe(await vaultIndexKey(b));
    expect(ia.key).not.toBe(ib.key);
    await Promise.all([ia.whenReconciled(5000), ib.whenReconciled(5000)]);
    expect(ia.index.paths()).toEqual(['Alpha/plan.md']);
    expect(ib.index.paths()).toEqual(['Beta/plan.md']);

    // Each root saved its own whole file under the engine state folder.
    const files = readdirSync(vaultIndexDir()).filter((f) => f.endsWith('.json'));
    expect(files).toContain(`${ia.key}.json`);
    expect(files).toContain(`${ib.key}.json`);
    expect(readFileSync(await vaultIndexPath(a), 'utf8')).toContain('Alpha/plan.md');
    expect(readFileSync(await vaultIndexPath(a), 'utf8')).not.toContain('Beta/plan.md');

    // A session reaches only its own root through the tools.
    const ctxA = { vaultRoot: a } as unknown as ToolContext;
    const ctxB = { vaultRoot: b } as unknown as ToolContext;
    const inA = (await vaultSearchTool.execute({ query: 'submarine' }, ctxA)).content;
    expect(inA).toMatch(/^No notes match "submarine"/);
    const inB = (await vaultSearchTool.execute({ query: 'submarine' }, ctxB)).content;
    expect(inB).toContain('1. Beta/plan.md');
    expect((await vaultSearchTool.execute({ query: 'zeppelin' }, ctxB)).content).not.toContain(
      'Alpha',
    );
  });

  it('the same root spelled another way is the same index', async () => {
    const link = join(tmpdir(), `osc-vault-link-${process.pid}-${Date.now()}`);
    symlinkSync(a, link);
    try {
      expect(await engineVaultIndex(link)).toBe(await engineVaultIndex(a));
    } finally {
      unlinkSync(link);
    }
  });

  it('a saved index loads, and a reconcile reads only notes whose version moved', async () => {
    write(a, 'one.md', 'first body');
    write(a, 'two.md', 'second body');
    write(a, 'three.md', 'third body, links [[one]]');
    const first = await engineVaultIndex(a);
    await first.whenReconciled(5000);
    expect(first.index.counters.entriesBuilt).toBe(3);
    await closeEngineVaultIndexes();

    // A fresh process: the file loads, and nothing unchanged is read again.
    const again = await engineVaultIndex(a);
    expect(await again.whenLoaded(5000)).toBe(true);
    expect(again.index.size).toBe(3);
    await again.whenReconciled(5000);
    expect(again.index.counters.entriesBuilt).toBe(0);
    expect(again.index.backlinks('one.md').map((x) => x.source)).toEqual(['three.md']);

    // One edit and one delete: one read, one drop.
    write(a, 'two.md', 'second body, rewritten with more words');
    unlinkSync(join(a, 'one.md'));
    await again.reconcile();
    expect(again.index.counters.entriesBuilt).toBe(1);
    expect(again.index.paths()).toEqual(['three.md', 'two.md']);
    expect(again.index.search('rewritten').map((h) => h.path)).toEqual(['two.md']);
  });

  it('a write the engine made is kept, even before the saved index loads', async () => {
    write(a, 'old.md', 'old');
    const handle = await engineVaultIndex(a);
    write(a, 'new.md', 'fresh words');
    const st = (await statNote(join(a, 'new.md')))!;
    handle.noteWrite({ path: 'new.md', ...st }, 'fresh words');
    expect(handle.index.search('fresh').map((h) => h.path)).toEqual(['new.md']);
    await handle.whenReconciled(5000);
    expect(handle.index.search('fresh').map((h) => h.path)).toEqual(['new.md']);
    expect(handle.index.paths()).toEqual(['new.md', 'old.md']);
    await handle.save();
    expect(readFileSync(await vaultIndexPath(a), 'utf8')).toContain('new.md');
  });

  it('a write never opens an index on its own', async () => {
    expect(await openEngineVaultIndex(a)).toBeUndefined();
    const handle = await engineVaultIndex(a);
    expect(await openEngineVaultIndex(a)).toBe(handle);
  });

  it('the listing skips dot folders and non-notes, and carries noteVersion', async () => {
    write(a, 'Keep/note.md', 'x');
    write(a, '.obsidian/app.md', 'x');
    write(a, 'image.png', 'x');
    const listed = await listVaultNotes(a);
    expect(listed.map((n) => n.path)).toEqual(['Keep/note.md']);
    expect(listed[0]!.version).toBe((await statNote(join(a, 'Keep/note.md')))!.version);
    expect(await listVaultNotes(join(a, 'missing'))).toEqual([]);
    expect(existsSync(join(a, '.obsidian/app.md'))).toBe(true);
  });
});
