// The engine's Vault index (Vault M4, CTO I7; plan 4.6): one index per vault
// root under the engine state folder, keyed by vaultIndexKey, loaded in the
// background, reconciled by version, saved whole by atomic rename. Two roots
// are two indexes, two files, and no crossover in search.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  portUnavailable,
  restoreHome,
  saveHome,
  setHome,
  type SavedHome,
} from './helpers/portable.js';

// The attachment rules are stream A2's (Vault M6); until they land in this
// tree the stub throws "not built", so a small stand-in answers for it. Once
// the real module is here it answers and the stand-in is never asked.
vi.mock('../src/harness/vault/attachments.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/harness/vault/attachments.js')>();
  const EXT: Record<string, string> = { png: 'image/png', pdf: 'application/pdf' };
  const mime = (p: string) => EXT[/\.([a-z]+)$/i.exec(p)?.[1]?.toLowerCase() ?? ''];
  const is = (p: string) =>
    !!mime(p) && !p.includes('\\') && p.split('/').every((s) => s && !s.startsWith('.'));
  const match = (b: Uint8Array, m: string) =>
    m === 'image/png' ? b[0] === 0x89 && b[1] === 0x50 : true;
  const orFake =
    <A extends unknown[], R>(f: (...a: A) => R, fake: (...a: A) => R) =>
    (...a: A): R => {
      try {
        return f(...a);
      } catch (e) {
        if (String(e).includes('not built')) return fake(...a);
        throw e;
      }
    };
  return {
    ...real,
    isAttachmentPath: orFake(real.isAttachmentPath, is),
    attachmentMime: orFake(real.attachmentMime, mime as typeof real.attachmentMime),
    bytesMatchMime: orFake(real.bytesMatchMime, match as typeof real.bytesMatchMime),
  };
});
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
import { startDaemon, type RunningDaemon } from '../src/daemon/serve.js';
import {
  VAULT_CONFIG_PUT_BODY_MAX_BYTES,
  parseVaultOverrides,
  vaultSettingsWriteSeam,
} from '../src/daemon/vaultRoutes.js';
import { writeVaultConfigFile } from '../src/core/vault/configFile.js';
import { parseVaultSettingsFile } from '../src/harness/vault/settings.js';
import { VAULT_CONFIG_MAX_BYTES } from '../src/harness/vault/configDir.js';
import { TerminalManager, TerminalUnavailable } from '../src/daemon/terminal.js';
import { defaultConfig } from '../src/config/load.js';
import { mintCredential } from '../src/core/security/credentials.js';
import { overlapsVault } from '../src/core/security/workspaces.js';
import { memberVaultsDir, vaultRootFor, vaultRootForOwner } from '../src/core/vault/memberRoots.js';
import { vaultPrivacyConfig } from '../src/core/agent/registry.js';
import { HANDOFF_MAX_BYTES } from '../src/harness/handoff.js';
import { _resetRoutineScheduler } from '../src/routines/scheduler.js';
import {
  VAULT_ATTACHMENTS_ROUTE,
  VAULT_CONFIG_ROUTE,
  VAULT_FOLDERS_RENAME_ROUTE,
  VAULT_FOLDERS_ROUTE,
  VAULT_INDEX_ROUTE,
  VAULT_NOTES_ROUTE,
  VAULT_PRIVACY_ROUTE,
  VAULT_RENAME_ROUTE,
  VAULT_SETTINGS_CONFIG_NAME,
  VAULT_TRASH_RESTORE_ROUTE,
  VAULT_TRASH_ROUTE,
  VAULT_WIRE_NOTE_MAX_BYTES,
  vaultFileRoute,
  vaultNoteRoute,
  type HubNoteMeta,
  type VaultAttachmentsListResponse,
  type VaultConfigConflictResponse,
  type VaultConfigPutResponse,
  type VaultConfigResponse,
  type VaultFolderRenameResponse,
  type VaultFoldersListResponse,
  type VaultRenameConflictResponse,
  type VaultRenameResponse,
  type VaultTrashListResponse,
  type VaultTrashResponse,
  type VaultTrashRestoreResponse,
  type VaultNoteConflictResponse,
  type VaultNoteReadResponse,
  type VaultNotesListResponse,
  type VaultPrivacyWire,
} from '../src/daemon/vaultWire.js';

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

// ---------------------------------------------------------------------------
// The daemon's vault routes (Vault M5, CTO J7, J8): every route on the
// caller's own root, jailed, compare-and-swap on every write.

describe('the daemon vault routes, on the caller own root', () => {
  let home: string;
  let daemon: RunningDaemon;
  let base: string;
  let admin: string;
  let realHome: SavedHome;

  async function startOnFreePort(): Promise<RunningDaemon> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const port = 40000 + Math.floor(Math.random() * 20000);
      try {
        return await startDaemon({
          config: defaultConfig(),
          bind: 'loopback',
          port,
          terminals: new TerminalManager({
            spawn: async () => {
              throw new TerminalUnavailable();
            },
          }),
        });
      } catch (err) {
        if (portUnavailable(err)) continue;
        throw err;
      }
    }
    throw new Error('could not find a free port for the test daemon');
  }

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'oschome-'));
    process.env.OSC_HOME = home;
    realHome = saveHome();
    setHome(home);
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } } }),
    );
    mkdirSync(join(home, 'OSCode', 'repo'), { recursive: true });
    _resetRoutineScheduler();
    daemon = await startOnFreePort();
    base = `http://127.0.0.1:${daemon.port}`;
    admin = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
  });

  afterEach(() => {
    daemon.close();
    _resetRoutineScheduler();
    restoreHome(realHome);
    delete process.env.OSC_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  const hdr = (token: string): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  });
  const put = (token: string, path: string, body: Record<string, unknown>) =>
    fetch(`${base}${vaultNoteRoute(path)}`, {
      method: 'PUT',
      headers: hdr(token),
      body: JSON.stringify(body),
    });
  const get = (token: string, route: string) => fetch(`${base}${route}`, { headers: hdr(token) });
  const member = (userId: string) =>
    mintCredential({ role: 'member', label: 'Phone', userId }).token;

  it('picks one root per caller: the owner vault, or a member root outside ~/OSCode', () => {
    const owner = vaultRootFor({ userId: 'legacy', role: 'admin' });
    expect(owner).toBe(join(home, 'OSCode', 'Vault'));
    const m1 = vaultRootFor({ userId: 'u_one', role: 'member' });
    const m2 = vaultRootFor({ userId: 'u_two', role: 'member' });
    expect(m1).toBe(join(home, 'vaults', 'members', basename(m1)));
    expect(basename(m1)).toMatch(/^[0-9a-f]{16}$/);
    expect(m1).not.toBe(m2);
    expect(m1.startsWith(join(home, 'OSCode'))).toBe(false);
    expect(vaultRootForOwner('u_one', false)).toBe(m1);
    expect(vaultRootForOwner(undefined)).toBe(owner);
    expect(vaultRootForOwner('legacy')).toBe(owner);
    // A member workspace can reach neither the owner's vault nor a member root.
    expect(overlapsVault(join(home, 'OSCode', 'repo'))).toBe(false);
    expect(overlapsVault(join(home, 'OSCode'))).toBe(true);
    expect(overlapsVault(memberVaultsDir())).toBe(true);
    expect(overlapsVault(m1)).toBe(true);
    expect(overlapsVault(home)).toBe(true);
  });

  it('creates, reads, lists, and guards every write with the version read', async () => {
    const created = await put(admin, 'Plans/Launch.md', { text: 'first', ifAbsent: true });
    expect(created.status).toBe(200);
    const { meta } = (await created.json()) as { meta: HubNoteMeta };
    expect(meta).toMatchObject({ path: 'Plans/Launch.md', size: 5 });
    expect(readFileSync(join(home, 'OSCode', 'Vault', 'Plans', 'Launch.md'), 'utf8')).toBe('first');

    const listed = (await (await get(admin, VAULT_NOTES_ROUTE)).json()) as VaultNotesListResponse;
    expect(listed).toEqual({ notes: [meta], truncated: false });
    const read = (await (
      await get(admin, vaultNoteRoute('Plans/Launch.md'))
    ).json()) as VaultNoteReadResponse;
    expect(read).toEqual({
      path: 'Plans/Launch.md',
      text: 'first',
      version: meta.version,
      mtime: meta.mtime,
    });
    expect((await get(admin, vaultNoteRoute('Plans/None.md'))).status).toBe(404);

    // ifAbsent on a note that is there: 409 exists, the note untouched.
    const again = await put(admin, 'Plans/Launch.md', { text: 'second', ifAbsent: true });
    expect(again.status).toBe(409);
    const exists = (await again.json()) as VaultNoteConflictResponse;
    expect(exists.conflict).toBe('exists');
    expect(exists.current?.version).toBe(meta.version);

    // A good ifMatch saves; the stale one after it is 409 changed.
    const saved = await put(admin, 'Plans/Launch.md', { text: 'second', ifMatch: meta.version });
    expect(saved.status).toBe(200);
    const next = ((await saved.json()) as { meta: HubNoteMeta }).meta;
    expect(next.version).not.toBe(meta.version);
    const stale = await put(admin, 'Plans/Launch.md', { text: 'third', ifMatch: meta.version });
    expect(stale.status).toBe(409);
    const changed = (await stale.json()) as VaultNoteConflictResponse;
    expect(changed).toEqual({ conflict: 'changed', current: next });
    expect(readFileSync(join(home, 'OSCode', 'Vault', 'Plans', 'Launch.md'), 'utf8')).toBe(
      'second',
    );
    // ifMatch on a note that is gone: 409 missing, never recreated.
    const missing = await put(admin, 'Plans/Gone.md', { text: 'x', ifMatch: meta.version });
    expect(((await missing.json()) as VaultNoteConflictResponse).conflict).toBe('missing');
    expect(existsSync(join(home, 'OSCode', 'Vault', 'Plans', 'Gone.md'))).toBe(false);
    // Both guards at once is refused.
    const both = await put(admin, 'Plans/Launch.md', {
      text: 'x',
      ifMatch: next.version,
      ifAbsent: true,
    });
    expect(both.status).toBe(400);

    // Delete: the version is required, a stale one is 409, the right one removes.
    const del = (q: string) =>
      fetch(`${base}${vaultNoteRoute('Plans/Launch.md')}${q}`, {
        method: 'DELETE',
        headers: hdr(admin),
      });
    expect((await del('')).status).toBe(400);
    expect((await del(`?ifMatch=${encodeURIComponent(meta.version)}`)).status).toBe(409);
    expect((await del(`?ifMatch=${encodeURIComponent(next.version)}`)).status).toBe(200);
    expect(existsSync(join(home, 'OSCode', 'Vault', 'Plans', 'Launch.md'))).toBe(false);
  });

  it('caps a note PUT', async () => {
    const big = 'x'.repeat(VAULT_WIRE_NOTE_MAX_BYTES + 1);
    expect((await put(admin, 'Big.md', { text: big })).status).toBe(413);
    expect(existsSync(join(home, 'OSCode', 'Vault', 'Big.md'))).toBe(false);
  });

  it('never leaves the root: .., dot segments, backslashes, non-notes, and links', async () => {
    const vault = join(home, 'OSCode', 'Vault');
    mkdirSync(vault, { recursive: true });
    const outside = join(home, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.md'), 'secret');
    symlinkSync(outside, join(vault, 'Linked'));
    const raw = (route: string, init: RequestInit = {}) =>
      fetch(`${base}${route}`, { ...init, headers: hdr(admin) });
    for (const route of [
      '/vault/notes/..%2Foutside%2Fsecret.md',
      '/vault/notes/a%2F..%2F..%2Fsecret.md',
      '/vault/notes/.obsidian/app.md',
      '/vault/notes/a/.hidden/x.md',
      '/vault/notes/a%5Cb.md',
      '/vault/notes/notes.txt',
      '/vault/notes/%E0%A4%A.md',
      '/vault/notes/Linked/secret.md',
    ]) {
      const res = await raw(route);
      expect(res.status, route).toBe(400);
      const body = await res.text();
      expect(body, route).not.toContain('secret"');
    }
    // A dot segment the URL itself resolves never reaches a note route.
    const dots = await raw('/vault/notes/%2E%2E/%2E%2E/%2E%2E/outside/secret.md');
    expect(dots.status).toBe(404);
    const write = await raw('/vault/notes/Linked/new.md', {
      method: 'PUT',
      body: JSON.stringify({ text: 'x', ifAbsent: true }),
    });
    expect(write.status).toBe(400);
    expect(existsSync(join(outside, 'new.md'))).toBe(false);
  });

  it('a member reaches only their own root, and never the owner vault', async () => {
    const one = member('u_one');
    const two = member('u_two');
    expect((await put(admin, 'Owner.md', { text: 'owner only', ifAbsent: true })).status).toBe(200);
    expect((await put(one, 'Mine.md', { text: 'one', ifAbsent: true })).status).toBe(200);
    const oneRoot = vaultRootFor({ userId: 'u_one', role: 'member' });
    expect(readFileSync(join(oneRoot, 'Mine.md'), 'utf8')).toBe('one');
    if (process.platform !== 'win32') {
      expect(statSync(oneRoot).mode & 0o777).toBe(0o700);
      expect(statSync(memberVaultsDir()).mode & 0o777).toBe(0o700);
    }
    expect(existsSync(join(home, 'OSCode', 'Vault', 'Mine.md'))).toBe(false);

    const paths = async (token: string) =>
      ((await (await get(token, VAULT_NOTES_ROUTE)).json()) as VaultNotesListResponse).notes.map(
        (n) => n.path,
      );
    expect(await paths(admin)).toEqual(['Owner.md']);
    expect(await paths(one)).toEqual(['Mine.md']);
    expect(await paths(two)).toEqual([]);
    expect((await get(one, vaultNoteRoute('Owner.md'))).status).toBe(404);
    expect((await get(two, vaultNoteRoute('Mine.md'))).status).toBe(404);
    expect((await get(admin, vaultNoteRoute('Mine.md'))).status).toBe(404);
    // Another member's ifAbsent on the same name lands in their own root.
    expect((await put(two, 'Mine.md', { text: 'two', ifAbsent: true })).status).toBe(200);
    expect(readFileSync(join(oneRoot, 'Mine.md'), 'utf8')).toBe('one');
  });

  it("reports the machine's Room for notes with its privacy rules, read fresh each time", async () => {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        stack: { orchestrator: { provider: 'ollama', model: 'qwen' } },
        vault: { packSize: 'small' },
      }),
    );
    const small = (await (await get(admin, VAULT_PRIVACY_ROUTE)).json()) as VaultPrivacyWire;
    expect(small.packSize).toBe('small');
    // A member's seat runs on the same machine config, so it reads the same.
    const theirs = (await (
      await get(member('u_one'), VAULT_PRIVACY_ROUTE)
    ).json()) as VaultPrivacyWire;
    expect(theirs.packSize).toBe('small');
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        stack: { orchestrator: { provider: 'ollama', model: 'qwen' } },
        vault: { packSize: 'large' },
      }),
    );
    const large = (await (await get(admin, VAULT_PRIVACY_ROUTE)).json()) as VaultPrivacyWire;
    expect(large.packSize).toBe('large');
  });

  it('serves the machine privacy rules, a config file, and the saved index with an ETag', async () => {
    const privacy = (await (await get(admin, VAULT_PRIVACY_ROUTE)).json()) as VaultPrivacyWire;
    const defaults = vaultPrivacyConfig(defaultConfig());
    expect(privacy).toEqual({
      exclude: [...defaults.exclude],
      localOnly: { paths: [...defaults.localOnly.paths], tags: [...defaults.localOnly.tags] },
      // Vault M8: the machine's Room for notes rides along, Normal unset.
      packSize: 'normal',
    });

    const vault = join(home, 'OSCode', 'Vault');
    mkdirSync(join(vault, '.oscode'), { recursive: true });
    writeFileSync(join(vault, '.oscode', 'vault.json'), '{"a":1}');
    const cfg = await get(admin, `${VAULT_CONFIG_ROUTE}/${encodeURIComponent('oscode/vault')}`);
    expect(cfg.status).toBe(200);
    expect(((await cfg.json()) as { text: string }).text).toBe('{"a":1}');
    expect((await get(admin, `${VAULT_CONFIG_ROUTE}/nope`)).status).toBe(400);
    const oneCfg = await get(
      member('u_one'),
      `${VAULT_CONFIG_ROUTE}/${encodeURIComponent('oscode/vault')}`,
    );
    expect(oneCfg.status).toBe(404);

    expect((await get(admin, VAULT_INDEX_ROUTE)).status).toBe(404);
    writeFileSync(join(vault, 'Indexed.md'), 'an indexed note');
    const handle = await engineVaultIndex(vault);
    await handle.whenReconciled(5000);
    await handle.save();
    const first = await get(admin, VAULT_INDEX_ROUTE);
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(await first.text()).toContain('Indexed.md');
    const again = await fetch(`${base}${VAULT_INDEX_ROUTE}`, {
      headers: { ...hdr(admin), 'if-none-match': etag },
    });
    expect(again.status).toBe(304);
    // A member's index is their root's own: none yet.
    expect((await get(member('u_one'), VAULT_INDEX_ROUTE)).status).toBe(404);
  });

  it('a phone write reaches the engine index the pack reads', async () => {
    const vault = join(home, 'OSCode', 'Vault');
    mkdirSync(vault, { recursive: true });
    const handle = await engineVaultIndex(vault);
    await handle.whenReconciled(5000);
    expect((await put(admin, 'Fresh.md', { text: 'a zeppelin plan', ifAbsent: true })).status).toBe(
      200,
    );
    expect(handle.index.search('zeppelin').map((h) => h.path)).toEqual(['Fresh.md']);
  });

  it('lets the WebView send a PUT and read the ETag', async () => {
    const pre = await fetch(`${base}${vaultNoteRoute('Plans/Launch.md')}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'capacitor://localhost',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization, content-type, if-none-match',
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(pre.headers.get('access-control-allow-headers')).toContain('if-none-match');
    expect(pre.headers.get('access-control-expose-headers')).toContain('etag');
  });

  it("a member session gets its own root's folder, made 0700 on first use", async () => {
    const one = member('u_one');
    const res = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: hdr(one),
      body: JSON.stringify({ cwd: join(home, 'OSCode', 'repo') }),
    });
    expect(res.status).toBe(201);
    const root = vaultRootFor({ userId: 'u_one', role: 'member' });
    expect(existsSync(root)).toBe(true);
    // A member cwd inside the member roots is refused outright.
    const inRoots = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: hdr(one),
      body: JSON.stringify({ cwd: root }),
    });
    expect(inRoots.status).toBe(403);
    // An oversized handoff is refused, never cut.
    const long = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: hdr(admin),
      body: JSON.stringify({
        cwd: join(home, 'OSCode', 'repo'),
        handoff: 'x'.repeat(HANDOFF_MAX_BYTES + 1),
      }),
    });
    expect(long.status).toBe(400);
  });

  // Vault M6 (CTO K13): rename, folders, Trash and attachments, on the
  // caller's own root, every path through the rules and the Jail.
  describe('M6 routes', () => {
    const vault = () => join(home, 'OSCode', 'Vault');
    const send = (method: string, route: string, body?: unknown, token = admin) =>
      fetch(`${base}${route}`, {
        method,
        headers: hdr(token),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    it('renames a note guarded by its version, never replacing', async () => {
      const made = (await (
        await put(admin, 'Plans/Launch.md', { text: 'launch', ifAbsent: true })
      ).json()) as { meta: HubNoteMeta };
      await put(admin, 'Other.md', { text: 'other', ifAbsent: true });
      const taken = await send('POST', VAULT_RENAME_ROUTE, {
        from: 'Plans/Launch.md',
        to: 'other.md',
        ifMatch: made.meta.version,
      });
      expect(taken.status).toBe(409);
      const exists = (await taken.json()) as VaultRenameConflictResponse;
      expect(exists.conflict).toBe('exists');
      expect(exists.current?.path).toBe('Other.md');

      const stale = await send('POST', VAULT_RENAME_ROUTE, {
        from: 'Plans/Launch.md',
        to: 'Done/Launch.md',
        ifMatch: '1:2:3',
      });
      expect(stale.status).toBe(409);
      expect(((await stale.json()) as VaultRenameConflictResponse).conflict).toBe('changed');

      const ok = await send('POST', VAULT_RENAME_ROUTE, {
        from: 'Plans/Launch.md',
        to: 'Done/Launch.md',
        ifMatch: made.meta.version,
      });
      expect(ok.status).toBe(200);
      const { meta } = (await ok.json()) as VaultRenameResponse;
      expect(meta).toMatchObject({ path: 'Done/Launch.md', size: 6 });
      expect(readFileSync(join(vault(), 'Done', 'Launch.md'), 'utf8')).toBe('launch');
      expect(existsSync(join(vault(), 'Plans', 'Launch.md'))).toBe(false);

      for (const body of [
        { from: 'Done/Launch.md', to: '../out.md', ifMatch: meta.version },
        { from: 'Done/Launch.md', to: '.trash/x.md', ifMatch: meta.version },
        { from: 'Done/Launch.md', to: 'x.md' },
      ]) {
        expect((await send('POST', VAULT_RENAME_ROUTE, body)).status).toBe(400);
      }
    });

    it('lists, creates and renames folders with what moved', async () => {
      await put(admin, 'Work/a.md', { text: 'a', ifAbsent: true });
      mkdirSync(join(vault(), 'Empty'));
      mkdirSync(join(vault(), '.obsidian'));
      const listed = (await (
        await get(admin, VAULT_FOLDERS_ROUTE)
      ).json()) as VaultFoldersListResponse;
      expect(listed.folders).toEqual(['Empty', 'Work']);
      expect((await send('POST', VAULT_FOLDERS_ROUTE, { path: 'New/Inner' })).status).toBe(200);
      const again = await send('POST', VAULT_FOLDERS_ROUTE, { path: 'new/inner' });
      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ conflict: 'exists' });
      expect((await send('POST', VAULT_FOLDERS_ROUTE, { path: '.hidden' })).status).toBe(400);

      const moved = await send('POST', VAULT_FOLDERS_RENAME_ROUTE, {
        from: 'Work',
        to: 'Archive/Work',
      });
      expect(moved.status).toBe(200);
      const body = (await moved.json()) as VaultFolderRenameResponse;
      expect(body.moved.map((m) => m.to)).toEqual(['Archive/Work/a.md']);
      expect(body.attachments).toBe(0);
      const missing = await send('POST', VAULT_FOLDERS_RENAME_ROUTE, { from: 'Work', to: 'X' });
      expect(missing.status).toBe(409);
      expect(await missing.json()).toEqual({ conflict: 'missing' });
    });

    it('moves to Trash, lists it, restores beside a taken name, and empties', async () => {
      const made = (await (
        await put(admin, 'Plan.md', { text: 'the plan', ifAbsent: true })
      ).json()) as { meta: HubNoteMeta };
      const stale = await send('POST', VAULT_TRASH_ROUTE, {
        kind: 'note',
        path: 'Plan.md',
        ifMatch: '1:2:3',
      });
      expect(stale.status).toBe(409);
      const trashed = await send('POST', VAULT_TRASH_ROUTE, {
        kind: 'note',
        path: 'Plan.md',
        ifMatch: made.meta.version,
      });
      expect(trashed.status).toBe(200);
      const t = (await trashed.json()) as VaultTrashResponse;
      expect(t).toMatchObject({
        notes: 1,
        attachments: 0,
        entry: { path: 'Plan.md', kind: 'note' },
      });
      expect(readFileSync(join(vault(), '.trash', 'Plan.md'), 'utf8')).toBe('the plan');
      // .trash never reaches the note list or a note read.
      const notes = (await (await get(admin, VAULT_NOTES_ROUTE)).json()) as VaultNotesListResponse;
      expect(notes.notes).toEqual([]);
      expect((await get(admin, '/vault/notes/.trash/Plan.md')).status).toBe(400);

      const list = (await (await get(admin, VAULT_TRASH_ROUTE)).json()) as VaultTrashListResponse;
      expect(list.entries.map((e) => e.id)).toEqual([t.entry.id]);

      await put(admin, 'Plan.md', { text: 'a new plan', ifAbsent: true });
      const back = await send('POST', VAULT_TRASH_RESTORE_ROUTE, { id: t.entry.id });
      expect(back.status).toBe(200);
      const r = (await back.json()) as VaultTrashRestoreResponse;
      expect(r).toMatchObject({ renamed: true, meta: { path: 'Plan (restored).md' } });
      const gone = await send('POST', VAULT_TRASH_RESTORE_ROUTE, { id: t.entry.id });
      expect(gone.status).toBe(409);
      expect(await gone.json()).toEqual({ conflict: 'missing' });

      await put(admin, 'B.md', { text: 'b', ifAbsent: true });
      await send('POST', VAULT_TRASH_ROUTE, { kind: 'folder', path: 'Nope' });
      const bMeta = (await (await get(admin, vaultNoteRoute('B.md'))).json()) as {
        version: string;
      };
      await send('POST', VAULT_TRASH_ROUTE, { kind: 'note', path: 'B.md', ifMatch: bMeta.version });
      const emptied = await send('DELETE', VAULT_TRASH_ROUTE, {});
      expect(emptied.status).toBe(200);
      expect(await emptied.json()).toEqual({ removed: 1 });
      expect((await send('DELETE', VAULT_TRASH_ROUTE, { ids: ['../x'] })).status).toBe(400);
    });

    it('lists attachments and answers bytes with the allow-listed type, nosniff and an ETag', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
      mkdirSync(join(vault(), 'img'), { recursive: true });
      writeFileSync(join(vault(), 'img', 'a b.png'), png);
      writeFileSync(join(vault(), 'img', 'fake.png'), 'nope');
      writeFileSync(join(vault(), 'img', 'x.exe'), 'MZ');
      const list = (await (
        await get(admin, VAULT_ATTACHMENTS_ROUTE)
      ).json()) as VaultAttachmentsListResponse;
      expect(list.truncated).toBe(false);
      expect(list.attachments.map((a) => a.path)).toEqual(['img/a b.png', 'img/fake.png']);

      const res = await get(admin, vaultFileRoute('img/a b.png'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
      const etag = res.headers.get('etag')!;
      expect(etag).toBe(`"${list.attachments[0]!.version}"`);
      expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
      const cached = await fetch(`${base}${vaultFileRoute('img/a b.png')}`, {
        headers: { ...hdr(admin), 'if-none-match': etag },
      });
      expect(cached.status).toBe(304);

      expect((await get(admin, vaultFileRoute('img/none.png'))).status).toBe(404);
      expect((await get(admin, vaultFileRoute('img/fake.png'))).status).toBe(415);
      expect((await get(admin, vaultFileRoute('img/x.exe'))).status).toBe(415);
      expect((await get(admin, '/vault/files/..%2F..%2Fx.png')).status).toBe(400);
      expect((await get(admin, '/vault/files/.obsidian/icon.png')).status).toBe(400);
    });

    it('keeps a member on their own root', async () => {
      const one = member('u_one');
      await put(admin, 'Owner.md', { text: 'owner only', ifAbsent: true });
      const list = (await (
        await send('GET', VAULT_TRASH_ROUTE, undefined, one)
      ).json()) as VaultTrashListResponse;
      expect(list.entries).toEqual([]);
      const rename = await send(
        'POST',
        VAULT_RENAME_ROUTE,
        { from: 'Owner.md', to: 'Mine.md', ifMatch: '1:2:3' },
        one,
      );
      expect(rename.status).toBe(409);
      expect(((await rename.json()) as VaultRenameConflictResponse).conflict).toBe('missing');
      expect(readFileSync(join(vault(), 'Owner.md'), 'utf8')).toBe('owner only');
    });
  });

  // Vault M7 (CTO L7, L13): the settings file's one write, on the caller's
  // own root, guarded, capped, parsed, never through a link under .oscode.
  // The real writer (`writeVaultConfigFile`) and parser, end to end: no
  // stand-in (Vault M7 wave 2).
  describe('M7 settings write', () => {
    const vault = () => join(home, 'OSCode', 'Vault');
    const route = `${VAULT_CONFIG_ROUTE}/${VAULT_SETTINGS_CONFIG_NAME}`;
    it('writes through the engine writer and the core parser themselves', () => {
      expect(vaultSettingsWriteSeam.write).toBe(writeVaultConfigFile);
      expect(vaultSettingsWriteSeam.parse).toBe(parseVaultSettingsFile);
    });

    const putCfg = (body: unknown, token = admin, path = route) =>
      fetch(`${base}${path}`, { method: 'PUT', headers: hdr(token), body: JSON.stringify(body) });

    it('creates with ifAbsent, replaces with the version read, and answers the new one', async () => {
      const made = await putCfg({ text: '{"version":1}\n', ifAbsent: true });
      expect(made.status).toBe(200);
      const first = (await made.json()) as VaultConfigPutResponse;
      expect(first.name).toBe('oscode/vault');
      expect(readFileSync(join(vault(), '.oscode', 'vault.json'), 'utf8')).toBe('{"version":1}\n');
      const read = (await (
        await get(admin, `${VAULT_CONFIG_ROUTE}/${encodeURIComponent('oscode/vault')}`)
      ).json()) as VaultConfigResponse;
      expect(read.version).toBe(first.version);
      // The one-segment spelling reaches the same file.
      const next = await putCfg(
        { text: '{"version":1,"tree":{"sort":"modified"}}\n', ifMatch: first.version },
        admin,
        `${VAULT_CONFIG_ROUTE}/${encodeURIComponent('oscode/vault')}`,
      );
      expect(next.status).toBe(200);
      expect(((await next.json()) as VaultConfigPutResponse).version).not.toBe(first.version);
      // Keys the parser sets aside are kept as sent (L7).
      const aside = '{"version":1,"packSize":"large"}\n';
      const cur = (await (await get(admin, route)).json()) as VaultConfigResponse;
      expect((await putCfg({ text: aside, ifMatch: cur.version })).status).toBe(200);
      expect(readFileSync(join(vault(), '.oscode', 'vault.json'), 'utf8')).toBe(aside);
    });

    it('a stale guard is a 409 with the file as it is now, and nothing is written', async () => {
      const first = (await (
        await putCfg({ text: '{"a":1}', ifAbsent: true })
      ).json()) as VaultConfigPutResponse;
      await new Promise((r) => setTimeout(r, 20));
      writeFileSync(join(vault(), '.oscode', 'vault.json'), '{"theirs":true}');
      const stale = await putCfg({ text: '{"mine":true}', ifMatch: first.version });
      expect(stale.status).toBe(409);
      const body = (await stale.json()) as VaultConfigConflictResponse;
      expect(body.conflict).toBe('changed');
      expect(body.current?.text).toBe('{"theirs":true}');
      expect(body.current?.name).toBe('oscode/vault');
      expect(readFileSync(join(vault(), '.oscode', 'vault.json'), 'utf8')).toBe('{"theirs":true}');
      const exists = await putCfg({ text: '{"b":1}', ifAbsent: true });
      expect(exists.status).toBe(409);
      expect(((await exists.json()) as VaultConfigConflictResponse).conflict).toBe('exists');
    });

    it('a member writes only their own root', async () => {
      const one = member('u_one');
      expect((await putCfg({ text: '{"owner":1}', ifAbsent: true })).status).toBe(200);
      const mine = await putCfg({ text: '{"one":1}', ifAbsent: true }, one);
      expect(mine.status).toBe(200);
      const oneRoot = vaultRootFor({ userId: 'u_one', role: 'member' });
      expect(readFileSync(join(oneRoot, '.oscode', 'vault.json'), 'utf8')).toBe('{"one":1}');
      expect(readFileSync(join(vault(), '.oscode', 'vault.json'), 'utf8')).toBe('{"owner":1}');
      // The owner's version means nothing on the member's root.
      const owner = (await (await get(admin, route)).json()) as VaultConfigResponse;
      const cross = await putCfg({ text: '{"x":1}', ifMatch: owner.version }, one);
      expect(cross.status).toBe(409);
      expect(readFileSync(join(vault(), '.oscode', 'vault.json'), 'utf8')).toBe('{"owner":1}');
      // A second member starts empty.
      expect((await get(member('u_two'), route)).status).toBe(404);
    });

    it('refuses an oversized file, an oversized body, Obsidian names, bad guards and bad text', async () => {
      const big = 'x'.repeat(VAULT_CONFIG_MAX_BYTES + 1);
      expect((await putCfg({ text: `{"a":"${big}"}`, ifAbsent: true })).status).toBe(413);
      const huge = await putCfg({ text: '\u0001'.repeat(VAULT_CONFIG_PUT_BODY_MAX_BYTES / 5) });
      expect(huge.status).toBe(413);
      for (const name of ['obsidian/app', 'obsidian/daily-notes', 'obsidian/templates']) {
        const res = await putCfg(
          { text: '{}', ifAbsent: true },
          admin,
          `${VAULT_CONFIG_ROUTE}/${name}`,
        );
        expect(res.status, name).toBe(403);
      }
      expect((await putCfg({ text: '{}' })).status).toBe(400);
      expect((await putCfg({ text: '{}', ifAbsent: true, ifMatch: '1:2:3' })).status).toBe(400);
      expect((await putCfg({ text: '{}', ifAbsent: 'yes' })).status).toBe(400);
      expect((await putCfg({ text: '{}', ifMatch: '' })).status).toBe(400);
      expect((await putCfg({ ifAbsent: true })).status).toBe(400);
      expect((await putCfg({ text: 'not json', ifAbsent: true })).status).toBe(400);
      expect(existsSync(join(vault(), '.oscode', 'vault.json'))).toBe(false);
    });

    it('never writes through a link under .oscode', async () => {
      if (process.platform === 'win32') return;
      const outside = mkdtempSync(join(tmpdir(), 'osc-outside-'));
      try {
        mkdirSync(vault(), { recursive: true });
        symlinkSync(outside, join(vault(), '.oscode'));
        expect((await putCfg({ text: '{}', ifAbsent: true })).status).toBe(403);
        expect(readdirSync(outside)).toEqual([]);
        unlinkSync(join(vault(), '.oscode'));
        mkdirSync(join(vault(), '.oscode'));
        writeFileSync(join(outside, 'target.json'), 'keep');
        symlinkSync(join(outside, 'target.json'), join(vault(), '.oscode', 'vault.json'));
        expect((await putCfg({ text: '{}', ifMatch: '1:2:3' })).status).toBe(403);
        expect(readFileSync(join(outside, 'target.json'), 'utf8')).toBe('keep');
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('lets the WebView preflight the settings PUT', async () => {
      const pre = await fetch(`${base}${route}`, {
        method: 'OPTIONS',
        headers: {
          origin: 'capacitor://localhost',
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'authorization, content-type',
        },
      });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe('*');
      expect(pre.headers.get('access-control-allow-methods')).toContain('PUT');
      expect(pre.headers.get('access-control-allow-headers')).toContain('content-type');
      expect(pre.headers.get('access-control-allow-credentials')).toBeNull();
    });

    it('a session create takes vaultOverrides, off-only, dropping anything else', async () => {
      expect(parseVaultOverrides({ context: 'off', handoff: 'off', packSize: 'small' })).toEqual({
        context: 'off',
        handoff: 'off',
        packSize: 'small',
      });
      expect(
        parseVaultOverrides({ context: 'on', handoff: 'auto', packSize: 'huge', memory: true }),
      ).toBeUndefined();
      expect(parseVaultOverrides({ context: 'off', packSize: 9 })).toEqual({ context: 'off' });
      for (const v of [undefined, null, 'off', ['off'], 3])
        expect(parseVaultOverrides(v)).toBeUndefined();
      const res = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: hdr(admin),
        body: JSON.stringify({
          cwd: join(home, 'OSCode', 'repo'),
          vaultOverrides: { context: 'off', handoff: 'on', packSize: 'giant' },
        }),
      });
      expect(res.status).toBe(201);
    });
  });
});
