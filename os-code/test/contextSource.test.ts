// The engine's vault context source (Vault M4, CTO I7, I8): prepare reads the
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
