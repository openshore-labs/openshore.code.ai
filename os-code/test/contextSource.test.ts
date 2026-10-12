// The engine's vault context source (Vault M4, tech review I7, I8): prepare reads the
// bodies the widest plan asks for, within a 250 ms cold budget. The pure
// planner is injected here, so this tests the adapter alone.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VAULT_PACK_COLD_MS,
  createVaultContextSource,
  currentStateReader,
} from '../src/core/vault/contextSource.js';
import {
  closeEngineVaultIndexes,
  engineVaultIndex,
  settlesWithin,
  type EngineVaultIndex,
} from '../src/core/vault/engineIndex.js';
import { VAULT_PACK_MAX_TOKENS } from '../src/harness/profile.js';
import type { PackInput } from '../src/harness/vaultContext.js';
import type { VaultPrivacy } from '../src/harness/vault/types.js';

let root: string;
let cwd: string;

const privacy: VaultPrivacy = {
  visibility: ({ path, oscode }) =>
    path.startsWith('Secret/') || oscode?.includes('exclude')
      ? 'hidden'
      : path.startsWith('Private/')
        ? 'local-only'
        : 'open',
};

function write(base: string, rel: string, text: string): void {
  const abs = join(base, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'osc-ctx-vault-'));
  cwd = mkdtempSync(join(tmpdir(), 'osc-ctx-repo-'));
});
afterEach(async () => {
  await closeEngineVaultIndexes();
  rmSync(root, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe('the engine vault context source', () => {
  it('reads what the widest plan asks for, never a hidden note, and hands on the pins', async () => {
    write(root, 'Notes/a.md', 'body a');
    write(root, 'Private/b.md', 'body b');
    write(root, 'Secret/c.md', 'body c');
    write(root, 'Pinned.md', '---\noscode: pin\n---\npinned body');
    write(root, 'HiddenPin.md', '---\noscode: [pin, exclude]\n---\nno');
    write(cwd, 'OpenShore Project Demo MDs/Current State.md', '# Current State\nall green');
    await (await engineVaultIndex(root)).whenReconciled(5000);
    const seen: PackInput[] = [];
    const source = createVaultContextSource({
      vaultRoot: root,
      privacy,
      currentState: currentStateReader(cwd, 'Demo'),
      plan: (input) => {
        seen.push(input);
        return { read: ['Notes/a.md', 'Private/b.md', 'Secret/c.md', 'Gone.md'] };
      },
    });
    const prepared = await source.prepare('find the thing');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      mode: 'full',
      query: 'find the thing',
      budgetTokens: VAULT_PACK_MAX_TOKENS,
      seat: { leavesNetwork: false },
      lockdown: { egress: false, secrets: false },
      pins: ['Pinned.md'],
    });
    expect(prepared.index).not.toBeNull();
    expect([...prepared.bodies.keys()].sort()).toEqual(['Notes/a.md', 'Private/b.md']);
    expect(prepared.bodies.get('Notes/a.md')).toBe('body a');
    expect(prepared.pins).toEqual(['Pinned.md']);
    expect(prepared.currentState).toEqual({
      path: 'OpenShore Project Demo MDs/Current State.md',
      text: '# Current State\nall green',
    });
    expect(prepared.privacy).toBe(privacy);
  });

  it('a cold index goes on with Current State alone, within the budget', async () => {
    expect(VAULT_PACK_COLD_MS).toBe(250);
    let planned = false;
    let refreshed = false;
    const never: Promise<void> = new Promise(() => undefined);
    const cold = {
      refresh: () => {
        refreshed = true;
      },
      whenLoaded: (ms: number, signal?: AbortSignal) => settlesWithin(never, ms, signal),
      get index() {
        throw new Error('a cold index is never read');
      },
    } as unknown as EngineVaultIndex;
    const source = createVaultContextSource({
      vaultRoot: root,
      privacy,
      coldMs: 30,
      currentState: () => ({ path: 'cs.md', text: 'state' }),
      openIndex: async () => cold,
      plan: () => {
        planned = true;
        return { read: [] };
      },
    });
    const started = Date.now();
    const prepared = await source.prepare('task');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(prepared.index).toBeNull();
    expect(prepared.bodies.size).toBe(0);
    expect(prepared.pins).toEqual([]);
    expect(prepared.currentState).toEqual({ path: 'cs.md', text: 'state' });
    expect(planned).toBe(false);
    expect(refreshed).toBe(true);
  });

  it('a loaded index counts before its reconcile, and a missing body is skipped', async () => {
    write(root, 'a.md', 'a');
    const handle = await engineVaultIndex(root);
    await handle.whenReconciled(5000);
    const source = createVaultContextSource({
      vaultRoot: root,
      privacy,
      plan: () => ({ read: ['a.md', 'b.md'] }),
      readBody: async (_root, path) => (path === 'a.md' ? 'from disk' : undefined),
    });
    const prepared = await source.prepare('t');
    expect([...prepared.bodies]).toEqual([['a.md', 'from disk']]);
  });

  it('no vault root: no index and no reads, Current State still rides', async () => {
    const source = createVaultContextSource({
      privacy,
      currentState: currentStateReader(cwd, 'Nothing'),
      plan: () => {
        throw new Error('no plan without a vault');
      },
    });
    const prepared = await source.prepare('t');
    expect(prepared).toEqual({ index: null, bodies: new Map(), pins: [], privacy });
  });

  it('an aborted task stops before it reads', async () => {
    write(root, 'a.md', 'a');
    const ctl = new AbortController();
    ctl.abort();
    const source = createVaultContextSource({ vaultRoot: root, privacy });
    const prepared = await source.prepare('t', ctl.signal);
    expect(prepared.index).toBeNull();
    expect(prepared.bodies.size).toBe(0);
  });
});

// Vault M5 (tech review J13, J14): the project's own pins are read first and judged
// from the note itself; the stored handoff is the first prepare's alone.
describe('project pins and the stored handoff (M5)', () => {
  const tagged: VaultPrivacy = {
    visibility: ({ path, tags }) =>
      path.startsWith('Secret/')
        ? 'hidden'
        : path.startsWith('Private/') || tags?.includes('private')
          ? 'local-only'
          : 'open',
  };

  it('reads the pins first, in order, never a hidden one, and never reads them twice', async () => {
    write(root, 'Plan.md', 'the plan');
    write(root, 'Secret/key.md', 'no');
    write(root, 'Notes/a.md', 'body a');
    await (await engineVaultIndex(root)).whenReconciled(5000);
    const reads: string[] = [];
    const seen: PackInput[] = [];
    const source = createVaultContextSource({
      vaultRoot: root,
      privacy: tagged,
      projectPins: ['Plan.md', 'Secret/key.md', 'Plan.md', '../escape.md', 'Gone.md'],
      readBody: async (_root, path) => {
        reads.push(path);
        return path === 'Plan.md' ? 'the plan' : path === 'Notes/a.md' ? 'body a' : undefined;
      },
      plan: (input) => {
        seen.push(input);
        return { read: ['Plan.md', 'Notes/a.md'] };
      },
    });
    const prepared = await source.prepare('t');
    expect(prepared.projectPins).toEqual(['Plan.md']);
    expect(seen[0]!.projectPins).toEqual(['Plan.md']);
    expect(prepared.bodies.get('Plan.md')).toBe('the plan');
    expect(prepared.bodies.get('Notes/a.md')).toBe('body a');
    // The pins came first, a hidden one never read; Plan.md was not read
    // again for the plan.
    expect(reads.slice(0, 2).sort()).toEqual(['Gone.md', 'Plan.md']);
    expect(reads).not.toContain('Secret/key.md');
    expect(reads.filter((p) => p === 'Plan.md')).toHaveLength(1);
    expect(reads).not.toContain('../escape.md');
  });

  it('a local-only pin rides with a warm index and is left out while it is cold', async () => {
    write(root, 'Diary.md', '---\ntags: [private]\n---\ndear diary');
    write(root, 'Open.md', 'open pin');
    await (await engineVaultIndex(root)).whenReconciled(5000);
    const warm = await createVaultContextSource({
      vaultRoot: root,
      privacy: tagged,
      projectPins: ['Diary.md', 'Open.md'],
      plan: () => ({ read: [] }),
    }).prepare('t');
    expect(warm.projectPins).toEqual(['Diary.md', 'Open.md']);

    const never: Promise<void> = new Promise(() => undefined);
    const cold = {
      refresh: () => undefined,
      whenLoaded: (ms: number, signal?: AbortSignal) => settlesWithin(never, ms, signal),
    } as unknown as EngineVaultIndex;
    const coldPrepared = await createVaultContextSource({
      vaultRoot: root,
      privacy: tagged,
      coldMs: 10,
      projectPins: ['Diary.md', 'Open.md'],
      openIndex: async () => cold,
    }).prepare('t');
    expect(coldPrepared.index).toBeNull();
    expect(coldPrepared.projectPins).toEqual(['Open.md']);
    expect(coldPrepared.bodies.has('Diary.md')).toBe(false);
  });

  it('no vault root, no pins', async () => {
    const prepared = await createVaultContextSource({
      privacy: tagged,
      projectPins: ['Plan.md'],
    }).prepare('t');
    expect(prepared.projectPins).toBeUndefined();
  });

  it('the handoff is asked once, on the first prepare, and a throw means none', async () => {
    let asked = 0;
    const source = createVaultContextSource({
      privacy: tagged,
      handoff: () => {
        asked += 1;
        return 'HANDOFF from m, 2026-09-26, covering 5 earlier turns.';
      },
    });
    expect((await source.prepare('one')).handoff).toContain('HANDOFF from m');
    expect((await source.prepare('two')).handoff).toBeUndefined();
    expect(asked).toBe(1);

    const failing = createVaultContextSource({
      privacy: tagged,
      handoff: () => {
        throw new Error('store gone');
      },
    });
    expect((await failing.prepare('one')).handoff).toBeUndefined();
  });

  it("leaves the templates folder and Obsidian's ignored paths out of the reads (Vault M7, L2)", async () => {
    write(root, 'Notes/a.md', 'body a');
    write(root, 'Templates/Daily.md', '## Plan');
    write(root, 'Archive/old.md', 'old');
    await (await engineVaultIndex(root)).whenReconciled(5000);
    const source = createVaultContextSource({
      vaultRoot: root,
      privacy,
      settings: () => ({
        templates: { folder: 'templates', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
        ignore: { paths: ['Archive/'], regexSkipped: 0 },
      }),
      plan: () => ({ read: ['Notes/a.md', 'Templates/Daily.md', 'Archive/old.md'] }),
    });
    const prepared = await source.prepare('plan the day');
    expect([...prepared.bodies.keys()]).toEqual(['Notes/a.md']);
  });
});
