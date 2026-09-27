// The Vault index's Node side (Vault M3, CTO H3 "Persistence" and H5): the
// per-root index file under oscHome()/vault-index, and the desktop folder's
// readConfig with its config-folder detection and allow-list.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VAULT_INDEX_FILE_MAX_BYTES,
  deleteVaultIndexFile,
  loadVaultIndexFile,
  saveVaultIndexFile,
  vaultIndexDir,
  vaultIndexKey,
  vaultIndexPath,
} from '../src/core/vault/indexFile.js';
import { listConfigDirCandidates, readVaultConfigFile } from '../src/core/vault/configFile.js';
import {
  VAULT_CONFIG_MAX_BYTES,
  detectConfigDir,
  isVaultConfigName,
} from '../src/harness/vault/configDir.js';

const posix = process.platform !== 'win32';
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'osc-vault-index-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('the vault index file', () => {
  it('keys a root by its real path and lives under oscHome()/vault-index', async () => {
    const vault = join(tmp, 'Vault');
    mkdirSync(vault);
    const link = join(tmp, 'link');
    symlinkSync(vault, link);
    const key = await vaultIndexKey(vault);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(await vaultIndexKey(link)).toBe(key);
    expect(await vaultIndexKey(join(tmp, 'other'))).not.toBe(key);
    expect(await vaultIndexPath(vault)).toBe(join(vaultIndexDir(), `${key}.json`));
    expect(vaultIndexDir().startsWith(process.env.OSC_HOME!)).toBe(true);
  });

  it('saves with 0700 and 0600, temp then rename, and loads back', async () => {
    const vault = join(tmp, 'V');
    mkdirSync(vault);
    expect(await loadVaultIndexFile(vault)).toBeNull();
    expect(await saveVaultIndexFile(vault, '{"a":1}')).toEqual({ ok: true, bytes: 7 });
    expect(await saveVaultIndexFile(vault, '{"a":2}')).toEqual({ ok: true, bytes: 7 });
    expect(await loadVaultIndexFile(vault)).toBe('{"a":2}');
    if (posix) {
      expect(statSync(vaultIndexDir()).mode & 0o777).toBe(0o700);
      expect(statSync(await vaultIndexPath(vault)).mode & 0o777).toBe(0o600);
    }
    expect(readdirSync(vaultIndexDir()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(await deleteVaultIndexFile(vault)).toBe(true);
    expect(await loadVaultIndexFile(vault)).toBeNull();
    expect(await deleteVaultIndexFile(vault)).toBe(false);
  });

  it('refuses a blob over the cap, and never loads one', async () => {
    const vault = join(tmp, 'V');
    mkdirSync(vault);
    const big = 'x'.repeat(VAULT_INDEX_FILE_MAX_BYTES + 1);
    expect(await saveVaultIndexFile(vault, big)).toEqual({ ok: false, reason: 'too-large' });
    mkdirSync(vaultIndexDir(), { recursive: true });
    writeFileSync(await vaultIndexPath(vault), big);
    expect(await loadVaultIndexFile(vault)).toBeNull();
  });
});

describe('detectConfigDir', () => {
  const obs = { name: '.obsidian', files: ['app.json', 'workspace.json'] };
  const mobile = { name: '.obsidian-mobile', files: ['workspace-mobile.json'] };

  it('prefers .obsidian on the desktop', () => {
    expect(detectConfigDir([mobile, obs], 'desktop')).toBe('.obsidian');
    expect(detectConfigDir([mobile], 'desktop')).toBe('.obsidian-mobile');
  });

  it('on the iPhone prefers the recorded folder, then workspace-mobile.json, then .obsidian', () => {
    const other = { name: '.cfg', files: ['app.json'] };
    expect(detectConfigDir([obs, mobile, other], 'ios', '.cfg')).toBe('.cfg');
    expect(detectConfigDir([obs, mobile, other], 'ios')).toBe('.obsidian-mobile');
    expect(detectConfigDir([obs, other], 'ios')).toBe('.obsidian');
  });

  it('never picks .oscode, .git, .trash, a folder without config, or a bad name', () => {
    const cands = [
      { name: '.oscode', files: ['app.json'] },
      { name: '.git', files: ['app.json'] },
      { name: '.Trash', files: ['app.json'] },
      { name: '.empty', files: ['notes.md'] },
      { name: '.has space', files: ['app.json'] },
      { name: 'visible', files: ['app.json'] },
    ];
    expect(detectConfigDir(cands, 'desktop')).toBeUndefined();
  });

  it('knows only the four logical names', () => {
    expect(isVaultConfigName('obsidian/app')).toBe(true);
    expect(isVaultConfigName('oscode/vault')).toBe(true);
    for (const bad of ['obsidian/workspace', '../x', 'toString', '__proto__', 7, null]) {
      expect(isVaultConfigName(bad)).toBe(false);
    }
  });
});

describe('readVaultConfigFile (desktop folder)', () => {
  function vault(): string {
    const v = join(tmp, 'Vault');
    mkdirSync(join(v, '.obsidian', 'plugins', 'sync'), { recursive: true });
    writeFileSync(join(v, '.obsidian', 'app.json'), '{"attachmentFolderPath":"files"}');
    writeFileSync(join(v, '.obsidian', 'workspace.json'), '{}');
    writeFileSync(join(v, '.obsidian', 'plugins', 'sync', 'data.json'), '{"token":"t"}');
    return v;
  }

  it('reads an allowed file with a version', async () => {
    const r = await readVaultConfigFile(vault(), 'obsidian/app');
    expect(r).toMatchObject({ ok: true, text: '{"attachmentFolderPath":"files"}' });
    if (r.ok) expect(r.version).toMatch(/^\d+:\d+:\d+$/);
  });

  it('answers absent for a missing file, a missing folder, and oscode/vault', async () => {
    const v = vault();
    expect(await readVaultConfigFile(v, 'obsidian/daily-notes')).toEqual({
      ok: false,
      reason: 'absent',
    });
    expect(await readVaultConfigFile(v, 'oscode/vault')).toEqual({ ok: false, reason: 'absent' });
    const bare = join(tmp, 'Bare');
    mkdirSync(bare);
    expect(await readVaultConfigFile(bare, 'obsidian/app')).toEqual({
      ok: false,
      reason: 'absent',
    });
    expect(await readVaultConfigFile(join(tmp, 'nowhere'), 'obsidian/app')).toEqual({
      ok: false,
      reason: 'absent',
    });
  });

  it('refuses an unknown name, a path, a plugin file and the workspace', async () => {
    const v = vault();
    for (const name of [
      'obsidian/workspace',
      '../x',
      '.obsidian/plugins/sync/data.json',
      'obsidian/plugins/sync/data',
      '__proto__',
    ]) {
      expect(await readVaultConfigFile(v, name)).toEqual({ ok: false, reason: 'refused' });
    }
  });

  it('refuses a config file that is a symlink pointing outside', async () => {
    const v = vault();
    const outside = join(tmp, 'secret.json');
    writeFileSync(outside, '{"secret":true}');
    symlinkSync(outside, join(v, '.obsidian', 'templates.json'));
    expect(await readVaultConfigFile(v, 'obsidian/templates')).toEqual({
      ok: false,
      reason: 'refused',
    });
  });

  it('never treats a symlinked folder as the config folder', async () => {
    const v = join(tmp, 'Vault2');
    mkdirSync(v);
    const outside = join(tmp, 'elsewhere');
    mkdirSync(outside);
    writeFileSync(join(outside, 'app.json'), '{}');
    symlinkSync(outside, join(v, '.obsidian'));
    expect(await listConfigDirCandidates(v)).toEqual([]);
    expect(await readVaultConfigFile(v, 'obsidian/app')).toEqual({ ok: false, reason: 'absent' });
    // .oscode is not detected but named; a symlinked one is still refused.
    symlinkSync(outside, join(v, '.oscode'));
    writeFileSync(join(outside, 'vault.json'), '{}');
    expect(await readVaultConfigFile(v, 'oscode/vault')).toEqual({ ok: false, reason: 'refused' });
  });

  it('answers too-large over 256 KB', async () => {
    const v = vault();
    writeFileSync(join(v, '.obsidian', 'templates.json'), 'x'.repeat(VAULT_CONFIG_MAX_BYTES + 1));
    expect(await readVaultConfigFile(v, 'obsidian/templates')).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  it('reads .oscode/vault.json when it exists', async () => {
    const v = vault();
    mkdirSync(join(v, '.oscode'));
    writeFileSync(join(v, '.oscode', 'vault.json'), '{"v":1}');
    expect(await readVaultConfigFile(v, 'oscode/vault')).toMatchObject({
      ok: true,
      text: '{"v":1}',
    });
  });
});
