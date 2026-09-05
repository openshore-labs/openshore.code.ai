// saveGlobalConfig durability (E1). The read-modify-write must never treat an
// unparsable existing config as {} (that would discard providers/stack/
// permissions), and the write must be atomic so a crash leaves the old config
// intact rather than a torn file.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addProjectPermissionRule,
  globalConfigPath,
  loadConfig,
  loadDaemonConfig,
  saveGlobalConfig,
} from '../src/config/load.js';

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
