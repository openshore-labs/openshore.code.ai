// saveGlobalConfig durability (E1). The read-modify-write must never treat an
// unparsable existing config as {} (that would discard providers/stack/
// permissions), and the write must be atomic so a crash leaves the old config
// intact rather than a torn file.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addProjectPermissionRule,
  defaultVaultDir,
  ensureVaultRoot,
  globalConfigPath,
  loadConfig,
  loadDaemonConfig,
  loadVaultDir,
  saveGlobalConfig,
} from '../src/config/load.js';
import { ConfigSchema } from '../src/config/schema.js';
import { buildToolContext } from '../src/core/agent/registry.js';
import type { Router } from '../src/router/router.js';
import type { ProviderRegistry } from '../src/providers/registry.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'osc-cfg-'));
  process.env.OSC_HOME = home;
});
afterEach(() => {
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('saveGlobalConfig durability', () => {
  it('refuses to overwrite an unparsable config, preserving it and a recovery copy', () => {
    mkdirSync(home, { recursive: true });
    const path = globalConfigPath();
    const garbage = '{ this is not: valid json ]';
    writeFileSync(path, garbage);

    // Refuse rather than clobber: a partial save on a corrupt file would drop
    // every key the file held.
    expect(() => saveGlobalConfig({ routing: { escalation: { enabled: true } } })).toThrow();

    // The original bytes survive untouched...
    expect(readFileSync(path, 'utf8')).toBe(garbage);
    // ...and a recovery copy was preserved.
    expect(existsSync(`${path}.corrupt`)).toBe(true);
    expect(readFileSync(`${path}.corrupt`, 'utf8')).toBe(garbage);
  });

  it('merges onto a valid existing config without dropping prior keys', () => {
    // First save records a guardrails setting; a later, unrelated save must not
    // erase it.
    saveGlobalConfig({ guardrails: { maxDollars: 9 } });
    saveGlobalConfig({ daemon: { port: 5000 } });

    const { config } = loadConfig(home);
    expect(config.guardrails.maxDollars).toBe(9);
    expect(config.daemon.port).toBe(5000);
  });

  it('leaves no temp file behind after a successful write', () => {
    saveGlobalConfig({ daemon: { port: 5001 } });
    const strays = readdirSync(home).filter((f) => f.includes('.tmp'));
    expect(strays).toEqual([]);
  });

  // Vault M1, CTO F7.3: the desktop app writes vault.dir through this writer,
  // and its temp-and-rename must not silently reset a person's chmod.
  it.skipIf(process.platform === 'win32')('keeps an existing 0o600 mode across a save', () => {
    const path = globalConfigPath();
    writeFileSync(path, '{}\n');
    chmodSync(path, 0o600);
    saveGlobalConfig({ vault: { dir: join(home, 'Notes') } });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadVaultDir().dir).toBe(join(home, 'Notes'));
  });

  it.skipIf(process.platform === 'win32')('keeps a wider mode the person chose', () => {
    const path = globalConfigPath();
    writeFileSync(path, '{}\n');
    chmodSync(path, 0o640);
    saveGlobalConfig({ daemon: { port: 5002 } });
    expect(statSync(path).mode & 0o777).toBe(0o640);
  });

  it.skipIf(process.platform === 'win32')('writes a new config owner-only', () => {
    saveGlobalConfig({ daemon: { port: 5003 } });
    expect(statSync(globalConfigPath()).mode & 0o777).toBe(0o600);
  });
});

describe('daemon settings are machine config (DAE-9)', () => {
  it('loadDaemonConfig reads the global file alone, and loadConfig drops a project daemon key', () => {
    const home = mkdtempSync(join(tmpdir(), 'oschome-dae9-'));
    const prev = process.env.OSC_HOME;
    process.env.OSC_HOME = home;
    try {
      writeFileSync(
        join(home, 'config.json'),
        JSON.stringify({ daemon: { port: 5000, outboxAllowedRoots: ['/srv/global'] } }),
      );
      const project = mkdtempSync(join(tmpdir(), 'oscproj-dae9-'));
      writeFileSync(
        join(project, 'os-code.config.json'),
        JSON.stringify({ daemon: { port: 6000, outboxAllowedRoots: ['/'] }, ui: { plain: true } }),
      );
      const daemon = loadDaemonConfig();
      expect(daemon.port).toBe(5000);
      expect(daemon.outboxAllowedRoots).toEqual(['/srv/global']);
      const loaded = loadConfig(project);
      expect(loaded.config.daemon.port).toBe(5000);
      expect(loaded.config.daemon.outboxAllowedRoots).toEqual(['/srv/global']);
      expect(loaded.config.ui.plain).toBe(true);
      expect(loaded.warnings.join('\n')).toMatch(/daemon settings are machine config/);
      rmSync(project, { recursive: true, force: true });
    } finally {
      process.env.OSC_HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// The vault folder is machine config too: the vault tools read under it
// without a prompt, so a repo's os-code.config.json must not move it (the same
// threat DAE-9 closed for daemon.*), and every process resolves it through one
// helper so the agent, the routines, and the desktop app share one folder.
describe('the vault folder is machine config', () => {
  it('ignores a project vault.dir with a warning, and resolves ~ under home', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ vault: { dir: '~/Obsidian' } }));
    const project = mkdtempSync(join(tmpdir(), 'oscproj-vault-'));
    try {
      writeFileSync(
        join(project, 'os-code.config.json'),
        JSON.stringify({ vault: { dir: '/' }, ui: { plain: true } }),
      );
      const loaded = loadConfig(project);
      expect(loaded.config.vault.dir).toBe('~/Obsidian');
      expect(loaded.config.ui.plain).toBe(true);
      expect(loaded.warnings.join('\n')).toMatch(/vault settings are machine config/);
      expect(loadVaultDir()).toEqual({ dir: join(homedir(), 'Obsidian') });
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("the agent's vault root comes from the machine config, never the config it is handed", () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ vault: { dir: '~/Obsidian' } }));
    const cwd = mkdtempSync(join(tmpdir(), 'osc-vault-ctx-'));
    try {
      const router = { embeddingRole: () => undefined } as unknown as Router;
      const providers = { imageProvider: () => undefined } as unknown as ProviderRegistry;
      const config = ConfigSchema.parse({ vault: { dir: '/' } });
      const ctx = buildToolContext({ cwd, config, router, providers });
      expect(ctx.vaultRoot).toBe(join(homedir(), 'Obsidian'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('unset means ~/OSCode/Vault, and a relative path is refused, never resolved against a cwd', () => {
    expect(loadVaultDir()).toEqual({ dir: join(homedir(), 'OSCode', 'Vault') });
    writeFileSync(join(home, 'config.json'), JSON.stringify({ vault: { dir: 'Notes/Vault' } }));
    const vault = loadVaultDir();
    expect(vault.dir).toBe(join(homedir(), 'OSCode', 'Vault'));
    expect(vault.warning).toMatch(/not an absolute path/);
    // doctor and the session warnings carry it.
    expect(loadConfig(home).warnings.join('\n')).toMatch(
      /vault\.dir "Notes\/Vault" is not an absolute path/,
    );
  });

  it('keeps an absolute path, tidied', () => {
    const abs = join(home, 'Vault', '..', 'Notes');
    writeFileSync(join(home, 'config.json'), JSON.stringify({ vault: { dir: abs } }));
    expect(loadVaultDir()).toEqual({ dir: join(home, 'Notes') });
  });
});

// Review M1-1: the engine and the routine scheduler never recreate a vault
// folder that went missing (renamed, or on a drive that is not connected), so
// notes are never scattered between two places. Only the default is made.
describe('ensureVaultRoot', () => {
  it('makes the default folder on first use', () => {
    const prev = process.env.HOME;
    process.env.HOME = home;
    try {
      expect(defaultVaultDir()).toBe(join(home, 'OSCode', 'Vault'));
      expect(ensureVaultRoot(defaultVaultDir())).toBe(defaultVaultDir());
      expect(statSync(defaultVaultDir()).isDirectory()).toBe(true);
    } finally {
      process.env.HOME = prev;
    }
  });

  it('never recreates a configured folder that is not there, and says so', () => {
    const gone = join(home, 'Drive', 'Brain');
    expect(() => ensureVaultRoot(gone)).toThrow('The vault folder is not there right now.');
    expect(existsSync(gone)).toBe(false);
    expect(existsSync(join(home, 'Drive'))).toBe(false);
    mkdirSync(gone, { recursive: true });
    expect(ensureVaultRoot(gone)).toBe(gone);
  });
});

describe('project permission rules (ENG-4)', () => {
  it('persists a commandPrefix rule and reads it back through loadConfig', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'osc-proj-'));
    try {
      addProjectPermissionRule(cwd, { tool: 'runShell', commandPrefix: 'npm' });
      // A second identical save is a no-op, not a duplicate row.
      addProjectPermissionRule(cwd, { tool: 'runShell', commandPrefix: 'npm' });
      const rules = loadConfig(cwd).config.permissions.rules;
      const shell = rules.filter((r) => r.tool === 'runShell');
      expect(shell).toEqual([{ tool: 'runShell', decision: 'allow', commandPrefix: 'npm' }]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
