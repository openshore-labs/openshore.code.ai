import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  existsSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the Electron bridge and platform so the provider's client logic can be
// tested without a main process. `ret.current` lets a test simulate "no bridge".
const h = vi.hoisted(() => {
  const b = {
    vaultList: vi.fn(),
    vaultStat: vi.fn(),
    vaultRead: vi.fn(),
    vaultWrite: vi.fn(),
    vaultRemove: vi.fn(),
  };
  return { b, ret: { current: b as unknown }, platform: vi.fn(() => 'electron') };
});
vi.mock('../src/lib/electronBridge.js', () => ({ bridge: () => h.ret.current }));
vi.mock('../src/lib/platform.js', () => ({ platform: h.platform }));

import { deviceFolderProvider, isDeviceFolderAvailable } from '../src/lib/gitos/deviceFolder.js';
import { isNotePath } from '../src/lib/gitos/providers.js';
import { normalizeNotePath } from '../src/lib/vault.js';
import {
  isVaultNotePath,
  listVaultFolder,
  parseVaultGuard,
  parseVaultRemoveGuard,
  readVaultFile,
  statVaultFile,
  writeVaultFile,
} from '../electron/vaultFs.js';
import {
  VaultDirChooser,
  cloudKindOf,
  refusePick,
  surveyVaultFolder,
  vaultDisplay,
  type VaultDirEnv,
} from '../electron/vaultDir.js';
import { loadVaultDir, saveGlobalConfig } from 'os-code/dist/src/config/load.js';
import { vaultConflictCopyPath } from 'os-code/protocol';
import { RoutineScheduler } from 'os-code/dist/src/routines/scheduler.js';
import * as routineStore from 'os-code/dist/src/routines/store.js';

beforeEach(() => {
  for (const fn of Object.values(h.b)) fn.mockReset();
  h.ret.current = h.b;
  h.platform.mockReturnValue('electron');
});

describe('device folder provider availability', () => {
  it('is available only on Electron with the file bridge present', () => {
    expect(isDeviceFolderAvailable()).toBe(true);
    h.platform.mockReturnValue('web');
    expect(isDeviceFolderAvailable()).toBe(false);
    h.platform.mockReturnValue('electron');
    h.ret.current = undefined;
    expect(isDeviceFolderAvailable()).toBe(false);
  });
});

describe('device folder provider', () => {
  it('declares compare-and-swap, since main checks every guard', () => {
    expect(deviceFolderProvider.compareAndSwap).toBe(true);
  });

  it('lists through the bridge', async () => {
    const files = [{ path: 'a.md', updatedAt: 't', size: 3, version: '1:2:3' }];
    h.b.vaultList.mockResolvedValue(files);
    expect(await deviceFolderProvider.list('vault.personal')).toEqual(files);
  });

  it('lists only notes, even if the bridge hands back more (0.6)', async () => {
    h.b.vaultList.mockResolvedValue(
      ['a.md', '.obsidian/app.json', '.trash/Old.md', 'pic.png', 'Board.canvas', 'x/b.md'].map(
        (path) => ({ path, updatedAt: 't', size: 1 }),
      ),
    );
    const paths = (await deviceFolderProvider.list('vault.personal')).map((f) => f.path);
    expect(paths).toEqual(['a.md', 'x/b.md']);
  });

  it('stats one note through vaultStat, never by listing the vault (CTO F1)', async () => {
    h.b.vaultStat.mockResolvedValue({ path: 'x/b.md', updatedAt: 't', size: 1, version: 'v' });
    expect(await deviceFolderProvider.stat('vault.personal', 'x/b.md')).toMatchObject({
      path: 'x/b.md',
      version: 'v',
    });
    expect(h.b.vaultList).not.toHaveBeenCalled();
    h.b.vaultStat.mockResolvedValue(null);
    expect(await deviceFolderProvider.stat('vault.personal', 'gone.md')).toBeUndefined();
    // A path that is not a note never crosses.
    expect(await deviceFolderProvider.stat('vault.personal', '.obsidian/app.json')).toBeUndefined();
    expect(h.b.vaultStat).toHaveBeenCalledTimes(2);
  });

  it('reads, mapping a missing note (null) to undefined', async () => {
    h.b.vaultRead.mockResolvedValue({ path: 'a.md', text: 'hi', updatedAt: 't', version: 'v' });
    expect(await deviceFolderProvider.read('vault.personal', 'a.md')).toEqual({
      path: 'a.md',
      text: 'hi',
      updatedAt: 't',
      version: 'v',
    });
    h.b.vaultRead.mockResolvedValue(null);
    expect(await deviceFolderProvider.read('vault.personal', 'x.md')).toBeUndefined();
  });

  it('writes through the bridge with the guard as the third argument', async () => {
    h.b.vaultWrite.mockResolvedValue({
      ok: true,
      file: { path: 'a.md', text: 'body', updatedAt: 't', version: 'v2' },
    });
    const saved = await deviceFolderProvider.write('anything', 'a.md', 'body', { ifMatch: 'v1' });
    expect(h.b.vaultWrite).toHaveBeenCalledWith('a.md', 'body', { ifMatch: 'v1' });
    expect(saved).toEqual({
      ok: true,
      file: { path: 'a.md', text: 'body', updatedAt: 't', version: 'v2' },
    });
  });

  it('hands a conflict back as a result, never a throw', async () => {
    const theirs = { path: 'a.md', text: 'theirs', updatedAt: 't', version: 'v3' };
    h.b.vaultWrite.mockResolvedValue({ ok: false, conflict: 'changed', theirs });
    expect(await deviceFolderProvider.write('r', 'a.md', 'mine', { ifMatch: 'v1' })).toEqual({
      ok: false,
      conflict: 'changed',
      theirs,
    });
  });

  it('refuses to write or remove anything that is not a note', async () => {
    await expect(deviceFolderProvider.write('r', '.obsidian/app.json', '{}')).rejects.toThrow(
      /not a note/,
    );
    await expect(deviceFolderProvider.remove('r', 'pic.png')).rejects.toThrow(/not a note/);
    expect(h.b.vaultWrite).not.toHaveBeenCalled();
    expect(h.b.vaultRemove).not.toHaveBeenCalled();
  });

  it('removes through the bridge, passing a guard only when there is one', async () => {
    h.b.vaultRemove.mockResolvedValue({ ok: true });
    expect(await deviceFolderProvider.remove('vault.personal', 'a.md')).toEqual({ ok: true });
    expect(h.b.vaultRemove).toHaveBeenCalledWith('a.md');
    const theirs = { path: 'a.md', text: 'x', updatedAt: 't', version: 'v2' };
    h.b.vaultRemove.mockResolvedValue({ ok: false, conflict: 'changed', theirs });
    expect(await deviceFolderProvider.remove('vault.personal', 'a.md', { ifMatch: 'v1' })).toEqual({
      ok: false,
      conflict: 'changed',
      theirs,
    });
    expect(h.b.vaultRemove).toHaveBeenLastCalledWith('a.md', { ifMatch: 'v1' });
  });

  it('throws a clear error when the desktop bridge is absent', async () => {
    h.ret.current = undefined;
    await expect(deviceFolderProvider.list('vault.personal')).rejects.toThrow(/on your computer/i);
  });

  it('grants a lease trivially (shared folder, no exclusive lock)', async () => {
    const lease = await deviceFolderProvider.acquireLease('vault.personal', 'me', 1000);
    expect(lease.holder).toBe('me');
    expect(new Date(lease.expiresAt).getTime()).toBeGreaterThan(0);
  });
});

// Main's handlers, called directly against a temp folder, the way
// osc:vaultList, osc:vaultStat, osc:vaultRead, and osc:vaultWrite run them.
describe("main's vault handlers on a real folder (CTO F1, F7.4)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'osc-vaultfs-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('list and read give the same version for an untouched note', async () => {
    writeFileSync(join(root, 'a.md'), 'hello');
    const [listed] = listVaultFolder(root);
    const read = await readVaultFile(root, 'a.md');
    const stat = await statVaultFile(root, 'a.md');
    expect(listed!.version).toMatch(/^\d+:\d+:\d+$/);
    expect(read!.version).toBe(listed!.version);
    expect(stat!.version).toBe(listed!.version);
    expect(listed!.size).toBe(5);
  });

  it('a same-size rewrite with a new mtime changes the version', async () => {
    const abs = join(root, 'a.md');
    writeFileSync(abs, 'aaaa');
    const before = (await statVaultFile(root, 'a.md'))!.version;
    writeFileSync(abs, 'bbbb');
    const later = new Date(statSync(abs).mtimeMs + 5000);
    utimesSync(abs, later, later);
    const after = (await statVaultFile(root, 'a.md'))!.version;
    expect(after).not.toBe(before);
  });

  it('a rename-over with identical bytes and mtime changes the version', async () => {
    const abs = join(root, 'a.md');
    writeFileSync(abs, 'same');
    const st = statSync(abs);
    const before = (await statVaultFile(root, 'a.md'))!.version;
    const other = join(root, 'other.tmp');
    writeFileSync(other, 'same');
    utimesSync(other, st.atime, st.mtime);
    renameSync(other, abs);
    const after = (await statVaultFile(root, 'a.md'))!.version;
    expect(readFileSync(abs, 'utf8')).toBe('same');
    expect(after).not.toBe(before);
  });

  it('a picked folder lists its notes and hides .obsidian/ and attachments', () => {
    mkdirSync(join(root, '.obsidian', 'plugins', 'x'), { recursive: true });
    writeFileSync(join(root, '.obsidian', 'plugins', 'x', 'data.json'), '{"key":"secret"}');
    writeFileSync(join(root, '.obsidian', 'Hidden.md'), 'no');
    mkdirSync(join(root, 'ideas'));
    writeFileSync(join(root, 'ideas', 'b.md'), 'b');
    writeFileSync(join(root, 'a.md'), 'a');
    writeFileSync(join(root, 'pic.png'), 'png');
    expect(listVaultFolder(root).map((f) => f.path)).toEqual(['a.md', 'ideas/b.md']);
  });

  it('refuses a read, stat, or write of anything that is not a note', async () => {
    mkdirSync(join(root, '.obsidian', 'plugins', 'x'), { recursive: true });
    writeFileSync(join(root, '.obsidian', 'plugins', 'x', 'data.json'), '{"key":"secret"}');
    await expect(readVaultFile(root, '.obsidian/plugins/x/data.json')).rejects.toThrow(/blocked/);
    await expect(statVaultFile(root, '.obsidian/plugins/x/data.json')).rejects.toThrow(/blocked/);
    await expect(writeVaultFile(root, 'notes.txt', 'x')).rejects.toThrow(/blocked/);
    await expect(readVaultFile(root, '../outside.md')).rejects.toThrow();
  });

  it('writes land with a version the next read agrees with', async () => {
    const r = await writeVaultFile(root, 'n.md', 'one', { ifAbsent: true });
    expect(r.ok).toBe(true);
    const read = await readVaultFile(root, 'n.md');
    expect(r.ok && r.file.version).toBe(read!.version);
  });

  it('validates the guard: ifMatch as a short string, ifAbsent as true, never both', () => {
    expect(parseVaultGuard(undefined)).toBeUndefined();
    expect(parseVaultGuard({ ifMatch: '1:2:3' })).toEqual({ ifMatch: '1:2:3' });
    expect(parseVaultGuard({ ifAbsent: true })).toEqual({ ifAbsent: true });
    expect(() => parseVaultGuard({ ifMatch: 'a', ifAbsent: true })).toThrow(/not both/);
    expect(() => parseVaultGuard({ ifMatch: 'x'.repeat(201) })).toThrow(/blocked/);
    expect(() => parseVaultGuard({ ifMatch: 3 })).toThrow(/blocked/);
    expect(() => parseVaultGuard({ ifAbsent: false })).toThrow(/blocked/);
    expect(() => parseVaultGuard('ifAbsent')).toThrow(/blocked/);
  });

  it('validates a remove guard: ifMatch only', () => {
    expect(parseVaultRemoveGuard(undefined)).toBeUndefined();
    expect(parseVaultRemoveGuard({ ifMatch: '1:2:3' })).toEqual({ ifMatch: '1:2:3' });
    expect(() => parseVaultRemoveGuard({ ifAbsent: true })).toThrow(/ifMatch only/);
    expect(() => parseVaultRemoveGuard({ ifMatch: 'x'.repeat(201) })).toThrow(/blocked/);
  });

  it("main's note rule is the seam's note rule", () => {
    for (const p of [
      'a.md',
      'x/B.MD',
      '.obsidian/a.md',
      'x/.trash/a.md',
      'a.txt',
      'a.md.png',
      'folder/.hidden.md',
      '.obsidian\\plugins\\x\\data.md',
      'x\\a.md',
      'C:\\Vault\\a.md',
      'a.md:hidden.md',
      '/etc/a.md',
    ]) {
      expect(isVaultNotePath(p)).toBe(isNotePath(p));
    }
  });

  // The keep-both name is one pure helper in the engine, imported by the
  // store and by main's Bring; its typed-name rule is the app's own.
  it("the conflict name keeps the app's typed-name rule, and the store and main share it", () => {
    const when = new Date(2026, 8, 27, 14, 5);
    for (const p of ['a.md', 'x/Why #1?.md', 'Caf\u0065\u0301.md', ' spaced .md', 'q/[x].md']) {
      const base = p.replace(/\.md$/i, '');
      for (const n of [1, 2]) {
        const stamp = `2026-09-27 1405${n > 1 ? ` ${n}` : ''}`;
        expect(vaultConflictCopyPath(p, when, n)).toBe(
          normalizeNotePath(`${base} (conflict ${stamp})`),
        );
      }
    }
    const store = readFileSync(join(process.cwd(), 'src', 'state', 'store.ts'), 'utf8');
    const dirs = readFileSync(join(process.cwd(), 'electron', 'vaultDir.ts'), 'utf8');
    expect(store).toMatch(/vaultConflictCopyPath,[\s\S]*?from 'os-code\/protocol'/);
    expect(store).not.toMatch(/function vaultConflictCopyPath/);
    expect(dirs).toMatch(
      /import \{ vaultConflictCopyPath \} from 'os-code\/dist\/src\/core\/vault\/conflictName\.js'/,
    );
  });

  // Review M1-5: on Windows a backslash is a separator, so a dot folder
  // spelled with one slipped past a rule that split on "/" only. A path with
  // a backslash or a leading "/" is never a note, and on Windows neither is
  // one with a colon (a drive, an NTFS stream).
  it('refuses backslash, rooted, and (on Windows) colon spellings of a note path', async () => {
    for (const p of ['.obsidian\\plugins\\x\\data.md', 'x\\a.md', 'C:\\Vault\\a.md', '/etc/a.md']) {
      expect(isVaultNotePath(p, 'linux'), p).toBe(false);
      expect(isVaultNotePath(p, 'win32'), p).toBe(false);
      expect(isNotePath(p), p).toBe(false);
    }
    for (const p of ['C:a.md', 'a.md:hidden.md']) {
      expect(isVaultNotePath(p, 'win32'), p).toBe(false);
    }
    // An agent's "Decision: auth?.md" is still a note off Windows.
    expect(isVaultNotePath('Decision: auth?.md', 'darwin')).toBe(true);
    expect(isNotePath('Decision: auth?.md')).toBe(true);
    mkdirSync(join(root, '.obsidian', 'plugins', 'x'), { recursive: true });
    writeFileSync(join(root, '.obsidian', 'plugins', 'x', 'data.md'), 'plugin data');
    await expect(readVaultFile(root, '.obsidian\\plugins\\x\\data.md')).rejects.toThrow(/blocked/);
    await expect(writeVaultFile(root, 'x\\a.md', 'x')).rejects.toThrow(/blocked/);
  });
});

// The folder picker as main runs it (osc:vaultChooseDir, osc:vaultRefineDir;
// CTO F7, CX 1.4): a temp home stands in for the person's, the dialog's
// answer is passed straight in, and vault.dir is written through the
// engine's real config writer into a temp OSC_HOME.
describe('picking the vault folder (Vault M1 1.4)', () => {
  let home: string;
  let env: VaultDirEnv;
  let chooser: VaultDirChooser;
  let saves: string[];
  let failSave: boolean;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'osc-pick-')));
    process.env.OSC_HOME = join(home, '.os-code');
    mkdirSync(join(home, 'OSCode', 'Vault'), { recursive: true });
    env = {
      home,
      oscHome: join(home, '.os-code'),
      managedRoot: join(home, 'OSCode'),
      defaultVaultDir: join(home, 'OSCode', 'Vault'),
      platform: 'linux',
    };
    saves = [];
    failSave = false;
    chooser = new VaultDirChooser({
      env: () => env,
      current: () => {
        const v = loadVaultDir();
        // The engine's default is the real home's; this test's is the temp one.
        return saves.length ? v : { dir: env.defaultVaultDir };
      },
      save: (dir) => {
        if (failSave) throw new Error('disk full');
        saveGlobalConfig({ vault: { dir } });
        saves.push(dir);
      },
      obsidianApp: () => true,
    });
  });
  afterEach(() => {
    delete process.env.OSC_HOME;
    chmodSync(home, 0o755);
    rmSync(home, { recursive: true, force: true });
  });

  it('a picked temp folder lists its notes, hides .obsidian/, and saves its realpath', () => {
    const brain = join(home, 'Brain');
    mkdirSync(join(brain, '.obsidian', 'plugins', 'x'), { recursive: true });
    writeFileSync(join(brain, '.obsidian', 'plugins', 'x', 'data.json'), '{"key":"secret"}');
    writeFileSync(join(brain, '.obsidian', 'Hidden.md'), 'no');
    mkdirSync(join(brain, 'ideas'));
    writeFileSync(join(brain, 'ideas', 'b.md'), 'b');
    writeFileSync(join(brain, 'a.md'), 'a');
    writeFileSync(join(brain, 'pic.png'), 'png');
    const r = chooser.pick(brain);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(loadVaultDir().dir).toBe(brain);
    expect(r.info).toMatchObject({ dir: brain, exists: true, obsidian: 'vault', count: 2 });
    expect(r.survey).toMatchObject({ notes: 2, otherFiles: 1, obsidian: true, capped: false });
    // Main's list of the new root, as osc:vaultList runs it.
    expect(listVaultFolder(loadVaultDir().dir).map((f) => f.path)).toEqual(['a.md', 'ideas/b.md']);
    expect(r.previous?.display).toBe(vaultDisplay(env.defaultVaultDir, home, 'linux'));
  });

  it('osc:vaultRead of .obsidian plugin data is refused after a pick', async () => {
    const brain = join(home, 'Brain');
    mkdirSync(join(brain, '.obsidian', 'plugins', 'x'), { recursive: true });
    writeFileSync(join(brain, '.obsidian', 'plugins', 'x', 'data.json'), '{"key":"secret"}');
    chooser.pick(brain);
    await expect(
      readVaultFile(loadVaultDir().dir, '.obsidian/plugins/x/data.json'),
    ).rejects.toThrow(/blocked/);
  });

  it('refuses home, ~/.os-code, ~/OSCode, a drive root, and inside OSCode, each with its code', () => {
    mkdirSync(join(home, '.os-code', 'inner'), { recursive: true });
    mkdirSync(join(home, 'OSCode', 'repo'), { recursive: true });
    const cases: Array<[string, string]> = [
      [home, 'home'],
      [join(home, '.os-code'), 'osc-home'],
      [join(home, '.os-code', 'inner'), 'osc-home'],
      [join(home, 'OSCode'), 'managed-holds'],
      [join(home, 'OSCode', 'repo'), 'managed-inside'],
      ['/', 'root'],
    ];
    for (const [dir, code] of cases) {
      const r = chooser.pick(dir);
      expect(r, dir).toMatchObject({ ok: false, refused: code });
    }
    expect(refusePick(join(home, '..'), env)).toBe('home-ancestor');
    // The default vault inside OSCode is allowed, and nothing was saved.
    expect(refusePick(env.defaultVaultDir, env)).toBeUndefined();
    expect(saves).toEqual([]);
    const inside = chooser.pick(join(home, 'OSCode', 'repo'));
    expect(inside).toMatchObject({ defaultDisplay: '~/OSCode/Vault', managedDisplay: '~/OSCode' });
  });

  it.skipIf(process.getuid?.() === 0)('refuses a read-only folder, and saves nothing', () => {
    const ro = join(home, 'ReadOnly');
    mkdirSync(ro);
    chmodSync(ro, 0o555);
    expect(chooser.pick(ro)).toMatchObject({ ok: false, refused: 'not-writable' });
    chmodSync(ro, 0o755);
    expect(saves).toEqual([]);
  });

  it('a cancelled dialog does nothing, and the same folder is not a refusal', () => {
    expect(chooser.pick(undefined)).toEqual({ ok: false, cancelled: true });
    expect(chooser.pick(env.defaultVaultDir)).toMatchObject({ ok: false, same: true });
    expect(saves).toEqual([]);
  });

  it('a config write that fails changes nothing and says so by code', () => {
    const notes = join(home, 'Notes');
    mkdirSync(notes);
    failSave = true;
    expect(chooser.pick(notes)).toEqual({ ok: false, refused: 'save-failed' });
  });

  it('an empty folder reports no notes and its other files', () => {
    const empty = join(home, 'Empty');
    mkdirSync(empty);
    writeFileSync(join(empty, 'photo.jpg'), 'x');
    const r = chooser.pick(empty);
    expect(r.ok && r.survey).toMatchObject({ notes: 0, otherFiles: 1, obsidian: false });
  });

  it('a subfolder of a vault offers the whole vault, never climbing above home', () => {
    const brain = join(home, 'Brain');
    mkdirSync(join(brain, '.obsidian'), { recursive: true });
    mkdirSync(join(brain, 'Projects'));
    const r = chooser.pick(join(brain, 'Projects'));
    expect(r.ok && r.survey.inside).toEqual({ name: 'Brain' });
    const up = chooser.refine({ to: 'enclosing' });
    expect(up.ok && up.info.dir).toBe(brain);
    // From the vault itself there is nothing above it inside home.
    expect(() => chooser.refine({ to: 'enclosing' })).toThrow(/blocked/);
  });

  it('a nested vault is a vault: the nearest one wins', () => {
    const outer = join(home, 'Outer');
    mkdirSync(join(outer, '.obsidian'), { recursive: true });
    mkdirSync(join(outer, 'Inner', '.obsidian'), { recursive: true });
    mkdirSync(join(outer, 'Inner', 'Deep'));
    const inner = chooser.pick(join(outer, 'Inner'));
    expect(inner.ok && inner.survey.obsidian).toBe(true);
    expect(inner.ok && inner.survey.inside).toBeUndefined();
    const deep = chooser.pick(join(outer, 'Inner', 'Deep'));
    expect(deep.ok && deep.survey.inside).toEqual({ name: 'Inner' });
  });

  it('a folder holding vaults names them, and only those names can be chosen', () => {
    const parent = join(home, 'Obsidian');
    mkdirSync(join(parent, 'Work', '.obsidian'), { recursive: true });
    mkdirSync(join(parent, 'Home', '.obsidian'), { recursive: true });
    mkdirSync(join(parent, 'Plain'));
    const r = chooser.pick(parent);
    expect(r.ok && r.survey.holds).toEqual(['Home', 'Work']);
    expect(() => chooser.refine({ to: 'child', name: 'Plain' })).toThrow(/blocked/);
    expect(() => chooser.refine({ to: 'child', name: '../Brain' })).toThrow(/blocked/);
    expect(() => chooser.refine({ to: 'child', name: '.obsidian' })).toThrow(/blocked/);
    expect(() => chooser.refine({ to: '/etc' })).toThrow(/blocked/);
    const work = chooser.refine({ to: 'child', name: 'Work' });
    expect(work.ok && work.info.dir).toBe(join(parent, 'Work'));
  });

  it('Go back repoints to the folder before, and nothing is copied', () => {
    writeFileSync(join(env.defaultVaultDir, 'old.md'), 'old');
    const notes = join(home, 'Notes');
    mkdirSync(notes);
    chooser.pick(notes);
    expect(listVaultFolder(loadVaultDir().dir)).toEqual([]);
    const back = chooser.refine({ to: 'previous' });
    expect(back.ok && back.info.dir).toBe(env.defaultVaultDir);
    expect(listVaultFolder(notes)).toEqual([]);
  });

  // ---- Bring N notes from the previous folder (CTO ruling on Bring) -------
  // One argument-free call that copies the folder the vault used before the
  // last pick into the one it uses now, with ifAbsent only: never a
  // replacement, never a removal, never a write into the previous folder.

  /** Every file under a folder, dot files and temps included, with its bytes,
   *  so a test can say the folder is byte for byte what it was. */
  function snapshot(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (d: string, rel: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const abs = join(d, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isSymbolicLink()) out[r] = `-> ${readlinkSync(abs)}`;
        else if (e.isDirectory()) walk(abs, r);
        else out[r] = readFileSync(abs).toString('base64');
      }
    };
    walk(dir, '');
    return out;
  }

  it('Bring copies what is missing, never replaces a note, and forks different text', async () => {
    const old = env.defaultVaultDir;
    writeFileSync(join(old, 'same.md'), 'same text');
    writeFileSync(join(old, 'b.md'), 'the one in the old folder');
    mkdirSync(join(old, 'Crew', 'Morning review'), { recursive: true });
    writeFileSync(join(old, 'Crew', 'Morning review', '2026-09-01 06-00.md'), '# Run');
    mkdirSync(join(old, '.obsidian'));
    writeFileSync(join(old, '.obsidian', 'Hidden.md'), 'plugin');
    writeFileSync(join(old, 'pic.png'), 'png');
    // A save in flight in the old folder: its temp must survive the walk.
    writeFileSync(join(old, '.b.md.oscode-0123abcd.tmp'), 'in flight');
    const notes = join(home, 'Notes');
    mkdirSync(notes);
    writeFileSync(join(notes, 'same.md'), 'same text');
    writeFileSync(join(notes, 'b.md'), 'the one already here');
    const r = chooser.pick(notes);
    expect(r.ok && r.previous?.notes).toBe(3);
    const before = snapshot(old);
    // Hours later by the clock, so a sweeping walk would take the temp.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 3 * 60 * 60 * 1000 });
    const when = new Date();
    let res;
    try {
      // Extra arguments, as a hostile renderer might send, are ignored.
      res = await (
        chooser.bringPrevious as (...a: unknown[]) => ReturnType<typeof chooser.bringPrevious>
      )('/etc', { to: '/etc' });
    } finally {
      vi.useRealTimers();
    }
    const copy = vaultConflictCopyPath('b.md', when);
    expect(copy).toMatch(/^b \(conflict \d{4}-\d{2}-\d{2} \d{4}\)\.md$/);
    expect(res).toEqual({
      ok: true,
      moved: ['Crew/Morning review/2026-09-01 06-00.md', 'same.md'],
      skipped: [],
      forked: [{ from: 'b.md', to: copy }],
    });
    expect(readFileSync(join(notes, 'b.md'), 'utf8')).toBe('the one already here');
    expect(readFileSync(join(notes, copy), 'utf8')).toBe('the one in the old folder');
    expect(readFileSync(join(notes, 'same.md'), 'utf8')).toBe('same text');
    expect(
      listVaultFolder(notes)
        .map((f) => f.path)
        .sort(),
    ).toEqual([copy, 'b.md', 'Crew/Morning review/2026-09-01 06-00.md', 'same.md'].sort());
    // Nothing but notes crossed, and the old folder is exactly as it was.
    expect(existsSync(join(notes, '.obsidian'))).toBe(false);
    expect(existsSync(join(notes, 'pic.png'))).toBe(false);
    expect(snapshot(old)).toEqual(before);
    expect(readFileSync(join(old, '.b.md.oscode-0123abcd.tmp'), 'utf8')).toBe('in flight');
    // The new folder holds no temp of its own either.
    expect(readdirSync(notes).filter((n) => n.includes('.oscode-'))).toEqual([]);
  });

  it('Bring names a fork exactly as the store does, trying the next name when one is taken', async () => {
    const old = env.defaultVaultDir;
    writeFileSync(join(old, 'b.md'), 'old text');
    const notes = join(home, 'Notes');
    mkdirSync(notes);
    writeFileSync(join(notes, 'b.md'), 'new text');
    chooser.pick(notes);
    const now = new Date(2026, 8, 27, 14, 5);
    writeFileSync(join(notes, vaultConflictCopyPath('b.md', now)), 'someone else');
    vi.useFakeTimers({ toFake: ['Date'], now });
    let res;
    try {
      res = await chooser.bringPrevious();
    } finally {
      vi.useRealTimers();
    }
    expect(res?.forked).toEqual([{ from: 'b.md', to: 'b (conflict 2026-09-27 1405 2).md' }]);
    expect(readFileSync(join(notes, 'b (conflict 2026-09-27 1405).md'), 'utf8')).toBe(
      'someone else',
    );
    expect(readFileSync(join(notes, 'b (conflict 2026-09-27 1405 2).md'), 'utf8')).toBe('old text');
  });

  it('Bring is blocked with no earlier folder, and runs one at a time', async () => {
    await expect(chooser.bringPrevious()).rejects.toThrow(/blocked/);
    writeFileSync(join(env.defaultVaultDir, 'a.md'), 'a');
    const notes = join(home, 'Notes');
    mkdirSync(notes);
    chooser.pick(notes);
    const first = chooser.bringPrevious();
    await expect(chooser.bringPrevious()).rejects.toThrow(/blocked/);
    expect((await first).ok).toBe(true);
    expect(readFileSync(join(notes, 'a.md'), 'utf8')).toBe('a');
  });

  it('Bring refuses the same folder and a folder inside the other, writing nothing', async () => {
    const brain = join(home, 'Brain');
    const inner = join(brain, 'Inner');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(brain, 'a.md'), 'a');
    chooser.pick(brain);
    chooser.pick(inner);
    const nested = await chooser.bringPrevious();
    expect(nested).toEqual({ ok: false, moved: [], skipped: [], forked: [], reason: 'nested' });
    expect(readdirSync(inner)).toEqual([]);
    // The config moved back to the earlier folder behind the chooser's back.
    saveGlobalConfig({ vault: { dir: brain } });
    const same = await chooser.bringPrevious();
    expect(same).toMatchObject({ ok: false, reason: 'same' });
    // A previous folder that went away is not there to bring from.
    saveGlobalConfig({ vault: { dir: inner } });
    rmSync(join(brain, 'a.md'));
    renameSync(brain, join(home, 'Gone'));
    const gone = await chooser.bringPrevious();
    expect(gone).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(existsSync(brain)).toBe(false);
  });

  it('Bring does not follow a link in the previous folder', async () => {
    const old = env.defaultVaultDir;
    const outside = join(home, 'Outside');
    mkdirSync(join(outside, 'dir'), { recursive: true });
    writeFileSync(join(outside, 'secret.md'), 'secret');
    writeFileSync(join(outside, 'dir', 'n.md'), 'n');
    symlinkSync(join(outside, 'secret.md'), join(old, 'link.md'));
    symlinkSync(join(outside, 'dir'), join(old, 'linkdir'));
    writeFileSync(join(old, 'real.md'), 'real');
    const notes = join(home, 'Notes');
    mkdirSync(notes);
    chooser.pick(notes);
    const res = await chooser.bringPrevious();
    expect(res).toMatchObject({ ok: true, moved: ['real.md'], skipped: [] });
    expect(readdirSync(notes)).toEqual(['real.md']);
  });

  it('Bring stops at the note limit and says so', async () => {
    const capped = new VaultDirChooser({
      env: () => env,
      current: () => (saves.length ? loadVaultDir() : { dir: env.defaultVaultDir }),
      save: (dir) => {
        saveGlobalConfig({ vault: { dir } });
        saves.push(dir);
      },
      obsidianApp: () => true,
      bringLimit: 2,
    });
    for (const n of ['a', 'b', 'c']) writeFileSync(join(env.defaultVaultDir, `${n}.md`), n);
    const notes = join(home, 'Notes');
    mkdirSync(notes);
    capped.pick(notes);
    const res = await capped.bringPrevious();
    expect(res).toMatchObject({ ok: false, capped: true, reason: 'capped', skipped: [] });
    expect(res.moved).toHaveLength(2);
  });

  it("an earlier Crew run's note opens again after Bring (M1-3)", async () => {
    const rel = 'Crew/Morning review/2026-09-01 06-00.md';
    mkdirSync(join(env.defaultVaultDir, 'Crew', 'Morning review'), { recursive: true });
    writeFileSync(join(env.defaultVaultDir, rel), '# Morning review\n\nTwo commits landed.');
    // A run recorded before the absolute path was kept: only the relative one.
    const run = routineStore.appendRun({
      routineId: 'r1',
      startedAt: new Date().toISOString(),
      state: 'done',
      trigger: 'schedule',
      notePath: rel,
    });
    const scheduler = new RoutineScheduler({
      autostart: false,
      vaultRoot: () => (saves.length ? loadVaultDir().dir : env.defaultVaultDir),
      lock: { acquire: () => ({ pid: process.pid, startedAt: '' }), release: () => {} },
    });
    expect(scheduler.readNote(run.id)?.markdown).toContain('Two commits landed.');
    const notes = join(home, 'Notes');
    mkdirSync(notes);
    chooser.pick(notes);
    // The pick hid it: the vault's folder no longer holds it.
    expect(scheduler.readNote(run.id)).toBeUndefined();
    await chooser.bringPrevious();
    expect(scheduler.readNote(run.id)?.markdown).toContain('Two commits landed.');
    routineStore.invalidateRoutineStore();
  });

  it('a huge folder stops the walk at its limits and says so', () => {
    const big = join(home, 'Big');
    mkdirSync(big);
    for (let i = 0; i < 30; i++) writeFileSync(join(big, `n${i}.md`), 'x');
    const s = surveyVaultFolder(big, env, { notes: 10, entries: 50_000, ms: 3_000 });
    expect(s).toMatchObject({ notes: 10, capped: true });
  });

  it('reads the sync service from the real path, and claims none it cannot tell', () => {
    const mac: VaultDirEnv = { ...env, platform: 'darwin' };
    const at = (...p: string[]) => join(home, ...p);
    expect(cloudKindOf(at('Library', 'Mobile Documents', 'com~apple~CloudDocs', 'V'), mac)).toBe(
      'icloud',
    );
    expect(
      cloudKindOf(
        at(
          'Library',
          'Mobile Documents',
          'iCloud~ai~openshore~oscode',
          'Documents',
          'vault.personal',
        ),
        mac,
      ),
    ).toBe('icloud-openshore');
    expect(cloudKindOf(at('Library', 'CloudStorage', 'Dropbox-Personal', 'V'), mac)).toBe(
      'dropbox',
    );
    expect(cloudKindOf(at('Library', 'CloudStorage', 'GoogleDrive-me', 'My Drive'), mac)).toBe(
      'gdrive',
    );
    expect(cloudKindOf(at('Library', 'CloudStorage', 'Somebody'), mac)).toBe('other');
    expect(cloudKindOf(at('Dropbox', 'Notes'), env)).toBe('dropbox');
    expect(cloudKindOf(at('Notes'), env)).toBeUndefined();
  });
});
