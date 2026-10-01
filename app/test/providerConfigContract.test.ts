// readConfig across the seam (Vault M3, CTO H5). Only logical names cross; each
// provider that implements the method reads an allowed file or answers
// `absent` by design, and an unknown name, a path, a plugin's data.json and a
// symlink pointing outside all answer `refused`. readVaultConfig answers
// `unsupported` for a provider without the method, and the JSON readers turn
// anything malformed into "not set", never a throw.
//
// The desktop folder runs over the engine's real Node reader
// (core/vault/configFile.ts) on a temp folder, standing in for main behind
// osc:vaultReadConfig, so the jail and the symlink rule are the real ones.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVaultConfigFile } from 'os-code/dist/src/core/vault/configFile.js';
import type { ConfigRead, VaultConfigName } from 'os-code/protocol';

const h = vi.hoisted(() => ({
  mem: new Map<string, string>(),
  bridge: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'electron',
  storeGetJson: async (k: string) => {
    const v = h.mem.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    h.mem.set(k, JSON.stringify(v));
  },
  storeGet: async (k: string) => h.mem.get(k) ?? null,
  storeSet: async (k: string, v: string) => {
    h.mem.set(k, v);
  },
  storeDelete: async (k: string) => {
    h.mem.delete(k);
  },
  storeKeys: async (prefix: string) => [...h.mem.keys()].filter((k) => k.startsWith(prefix)),
}));
vi.mock('../src/lib/electronBridge.js', () => ({ bridge: () => h.bridge.current }));
// The team vault reads its settings row (Vault M7, 0025) through the one fake
// of its server half, with no row yet: absent by design.
vi.mock('../src/lib/supabase.js', async () => {
  const { createFakeOrgVaultServer } = await import('./fixtures/fakeOrgVaultServer.js');
  const team = createFakeOrgVaultServer('vault');
  return {
    isConfigured: () => true,
    select: (table: string, token: string, query: string) => team.select(table, token, query),
    rpc: (fn: string, token: string, args: Record<string, unknown>) => team.rpc(fn, token, args),
  };
});

import { localProvider } from '../src/lib/gitos/local.js';
import { orgVaultProvider } from '../src/lib/gitos/orgVault.js';
import { setOrgVaultAuth } from '../src/lib/gitos/orgVault.js';
import { gdriveProvider } from '../src/lib/gitos/gdrive.js';
import { deviceFolderProvider } from '../src/lib/gitos/deviceFolder.js';
import {
  asConfigRead,
  configJson,
  readDailyNotesConfig,
  readObsidianAppConfig,
  readTemplatesConfig,
  readVaultConfig,
} from '../src/lib/gitos/config.js';
import type { StorageProvider } from '../src/lib/gitos/providers.js';

const NAMES: VaultConfigName[] = [
  'obsidian/app',
  'obsidian/daily-notes',
  'obsidian/templates',
  'oscode/vault',
];
const HOSTILE = [
  'obsidian/workspace',
  'obsidian/plugins',
  '../x',
  '.obsidian/app.json',
  'obsidian/plugins/sync/data.json',
  '.obsidian/plugins/sync/data.json',
  'workspace.json',
  '',
  'OBSIDIAN/APP',
  'constructor',
  '__proto__',
];

let root: string;
let vault: string;
let planted: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'oscode-cfg-'));
  vault = join(root, 'Vault');
  outside = join(root, 'outside.json');
  writeFileSync(outside, '{"folder":"stolen"}');
  mkdirSync(join(vault, '.obsidian', 'plugins', 'sync'), { recursive: true });
  writeFileSync(join(vault, '.obsidian', 'app.json'), '{"newFileLocation":"folder"}');
  writeFileSync(join(vault, '.obsidian', 'workspace.json'), '{"secret":"layout"}');
  writeFileSync(join(vault, '.obsidian', 'daily-notes.json'), '{"folder":"Daily"}');
  writeFileSync(join(vault, '.obsidian', 'plugins', 'sync', 'data.json'), '{"token":"t"}');
  // A second vault with a symlink planted in its config folder, pointing
  // outside the vault, where the templates file would be.
  planted = join(root, 'Planted');
  mkdirSync(join(planted, '.obsidian'), { recursive: true });
  writeFileSync(join(planted, '.obsidian', 'app.json'), '{}');
  symlinkSync(outside, join(planted, '.obsidian', 'templates.json'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  h.mem.clear();
  h.bridge.current = {
    vaultList: async () => [],
    vaultReadConfig: (name: unknown) => readVaultConfigFile(vault, name),
  };
});

setOrgVaultAuth(
  async () => 'tok',
  () => true,
);

const PROVIDERS: Array<[string, StorageProvider]> = [
  ['local', localProvider],
  ['org', orgVaultProvider],
  ['gdrive', gdriveProvider],
  ['files', deviceFolderProvider],
];

describe('every provider that reads config (the contract)', () => {
  it.each(PROVIDERS)('%s implements readConfig', (_id, p) => {
    expect(typeof p.readConfig).toBe('function');
  });

  it.each(PROVIDERS)('%s reads an allowed name or answers absent by design', async (_id, p) => {
    for (const name of NAMES) {
      const r = await p.readConfig!('vault', name);
      if (r.ok) {
        expect(typeof r.text).toBe('string');
        expect(typeof r.version).toBe('string');
      } else {
        expect(r.reason, `${_id} ${name}`).toBe('absent');
      }
    }
  });

  it.each(PROVIDERS)('%s refuses an unknown name, a path, and a plugin file', async (_id, p) => {
    for (const name of HOSTILE) {
      const r = await p.readConfig!('vault', name as VaultConfigName);
      expect(r, `${_id} ${JSON.stringify(name)}`).toEqual({ ok: false, reason: 'refused' });
    }
  });
});

describe('the desktop folder (through main)', () => {
  it('reads the allowed files from the Obsidian folder, never workspace or a plugin', async () => {
    const app = await deviceFolderProvider.readConfig!('vault', 'obsidian/app');
    expect(app).toMatchObject({ ok: true, text: '{"newFileLocation":"folder"}' });
    const daily = await deviceFolderProvider.readConfig!('vault', 'obsidian/daily-notes');
    expect(readDailyNotesConfig(daily)).toEqual({ folder: 'Daily' });
    expect(await deviceFolderProvider.readConfig!('vault', 'oscode/vault')).toEqual({
      ok: false,
      reason: 'absent',
    });
  });

  it('refuses a symlink pointing outside the vault', async () => {
    h.bridge.current = {
      vaultList: async () => [],
      vaultReadConfig: (name: unknown) => readVaultConfigFile(planted, name),
    };
    expect(await deviceFolderProvider.readConfig!('vault', 'obsidian/app')).toMatchObject({
      ok: true,
    });
    expect(await deviceFolderProvider.readConfig!('vault', 'obsidian/templates')).toEqual({
      ok: false,
      reason: 'refused',
    });
  });

  it('never sends a name main would refuse anyway', async () => {
    const sent: unknown[] = [];
    h.bridge.current = {
      vaultList: async () => [],
      vaultReadConfig: async (name: unknown) => {
        sent.push(name);
        return { ok: false, reason: 'absent' };
      },
    };
    for (const name of HOSTILE) await deviceFolderProvider.readConfig!('vault', name as never);
    expect(sent).toEqual([]);
  });

  it('answers unsupported on a main without the IPC, and off the desktop', async () => {
    h.bridge.current = { vaultList: async () => [] };
    expect(await deviceFolderProvider.readConfig!('vault', 'obsidian/app')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    h.bridge.current = undefined;
    expect(await deviceFolderProvider.readConfig!('vault', 'obsidian/app')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });
});

describe('This device', () => {
  it('reads the vault own config from its sealed key, and no Obsidian file', async () => {
    h.mem.set(
      'oscode.gitos.config.vault.vault',
      JSON.stringify({ text: '{"a":1}', updatedAt: '2026-09-27T00:00:00.000Z', v: 'tok' }),
    );
    expect(await localProvider.readConfig!('vault', 'oscode/vault')).toEqual({
      ok: true,
      text: '{"a":1}',
      version: 'tok',
    });
    expect(await localProvider.readConfig!('vault', 'obsidian/app')).toEqual({
      ok: false,
      reason: 'absent',
    });
  });
});

describe('readVaultConfig', () => {
  const stub = (readConfig?: StorageProvider['readConfig']) => ({ readConfig });

  it('answers unsupported for a provider without readConfig', async () => {
    expect(await readVaultConfig(stub(), 'vault', 'obsidian/app')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(await readVaultConfig(undefined, 'vault', 'obsidian/app')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('refuses a name outside the allow-list before any provider sees it', async () => {
    const seen: string[] = [];
    const p = stub(async (_r, name) => {
      seen.push(name);
      return { ok: false, reason: 'absent' };
    });
    for (const name of HOSTILE) {
      expect(await readVaultConfig(p, 'vault', name)).toEqual({ ok: false, reason: 'refused' });
    }
    expect(seen).toEqual([]);
  });

  it('holds every answer to the cap and the known shapes', async () => {
    const big = 'x'.repeat(256 * 1024 + 1);
    const answer = (r: unknown) => stub(async () => r as ConfigRead);
    expect(
      await readVaultConfig(answer({ ok: true, text: big, version: 'v' }), 'r', 'oscode/vault'),
    ).toEqual({ ok: false, reason: 'too-large' });
    expect(await readVaultConfig(answer({ ok: true, text: 1 }), 'r', 'oscode/vault')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(
      await readVaultConfig(answer({ ok: false, reason: 'nope' }), 'r', 'oscode/vault'),
    ).toEqual({ ok: false, reason: 'unsupported' });
    expect(await readVaultConfig(answer(null), 'r', 'oscode/vault')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(
      await readVaultConfig(answer({ ok: false, reason: 'downloading' }), 'r', 'obsidian/app'),
    ).toEqual({ ok: false, reason: 'downloading' });
    const throws = stub(async () => {
      throw new Error('offline');
    });
    expect(await readVaultConfig(throws, 'r', 'obsidian/app')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(asConfigRead({ ok: true, text: 'é'.repeat(131_073), version: 'v' })).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });
});

describe('the JSON readers tolerate anything', () => {
  const ok = (text: string): ConfigRead => ({ ok: true, text, version: 'v' });

  it('bad JSON, a refusal, or a non-object reads as nothing set', () => {
    for (const read of [
      ok('{not json'),
      ok('[1,2]'),
      ok('"str"'),
      ok('null'),
      ok(''),
      { ok: false, reason: 'absent' } as ConfigRead,
    ]) {
      expect(configJson(read)).toBeUndefined();
      expect(readObsidianAppConfig(read)).toEqual({});
      expect(readDailyNotesConfig(read)).toEqual({});
      expect(readTemplatesConfig(read)).toEqual({});
    }
  });

  it('keeps only known keys of the right type, and never a folder that climbs out', () => {
    expect(
      readObsidianAppConfig(
        ok(
          '\uFEFF{"newFileLocation":"folder","newFileFolderPath":"/Inbox/","newLinkFormat":"weird",' +
            '"useMarkdownLinks":"yes","alwaysUpdateLinks":true,"attachmentFolderPath":"./"}',
        ),
      ),
    ).toEqual({
      newFileLocation: 'folder',
      newFileFolderPath: 'Inbox',
      alwaysUpdateLinks: true,
      attachmentFolderPath: './',
    });
    expect(readDailyNotesConfig(ok('{"folder":"../../etc","format":"YYYY-MM-DD"}'))).toEqual({
      format: 'YYYY-MM-DD',
    });
    expect(readTemplatesConfig(ok('{"folder":"Templates\\\\Daily","dateFormat":7}'))).toEqual({
      folder: 'Templates/Daily',
    });
  });

  it('a __proto__ key never reaches a prototype', () => {
    const j = configJson(ok('{"__proto__":{"polluted":true},"a":1}'))!;
    expect(Object.getPrototypeOf(j)).toBeNull();
    expect(j.a).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
