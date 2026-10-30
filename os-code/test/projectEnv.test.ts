// Project Wayfinder (founder, 2026-10-27): a project's own environment, the
// way Claude Code sets one up. Its variables reach every command its agent
// runs with a secret-looking value cut from what the model reads back, its
// network access shapes the agent's own tools, and the pure half (the `.env`
// text, the limits) is what the app and the daemon share.
import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import {
  PROJECT_ENV_MAX_VARS,
  cleanProjectEnv,
  cleanSetupScript,
  parseEnvText,
  projectNetworkNote,
} from '../src/harness/projectEnv.js';
import { redactProjectEnv, runCommand } from '../src/core/exec/commandRunner.js';
import { buildToolRegistry } from '../src/core/agent/registry.js';

describe('parseEnvText', () => {
  it('reads NAME=value lines, export and quotes, and skips comments', () => {
    const { env, skipped } = parseEnvText(
      ['# a comment', '', 'API_URL=https://x.test', 'export MODE="dev"', "NAME='a b'"].join('\n'),
    );
    expect(env).toEqual({ API_URL: 'https://x.test', MODE: 'dev', NAME: 'a b' });
    expect(skipped).toEqual([]);
  });

  it('names the lines that are not a variable', () => {
    const { env, skipped } = parseEnvText('GOOD=1\nnot a var\n1BAD=2\n');
    expect(env).toEqual({ GOOD: '1' });
    expect(skipped).toEqual([2, 3]);
  });
});

describe('a session create is held to the limits', () => {
  it('keeps string values under valid names only', () => {
    expect(cleanProjectEnv({ OK: 'v', 'bad name': 'x', N: 3 })).toEqual({ OK: 'v' });
    expect(cleanProjectEnv(['A=1'])).toBeUndefined();
    expect(cleanProjectEnv({})).toBeUndefined();
  });

  it('caps the count', () => {
    const many = Object.fromEntries(
      Array.from({ length: PROJECT_ENV_MAX_VARS + 5 }, (_, i) => [`V${i}`, 'x']),
    );
    expect(Object.keys(cleanProjectEnv(many)!)).toHaveLength(PROJECT_ENV_MAX_VARS);
  });

  it('drops a blank or oversized setup script', () => {
    expect(cleanSetupScript('npm ci')).toBe('npm ci');
    expect(cleanSetupScript('  ')).toBeUndefined();
    expect(cleanSetupScript('x'.repeat(20_000))).toBeUndefined();
  });
});

describe("a project's variables reach its commands", () => {
  it('sets them on the command and cuts a secret value from the output', async () => {
    const run = runCommand({
      command: 'echo "$PROJECT_MODE $SERVICE_TOKEN"',
      cwd: tmpdir(),
      stdin: 'ignore',
      env: { PROJECT_MODE: 'staging', SERVICE_TOKEN: 'tok-123456789' },
    });
    const result = await run.done;
    expect(result.stdout).toContain('staging');
    expect(result.stdout).not.toContain('tok-123456789');
    expect(result.stdout).toContain('[SERVICE_TOKEN]');
  });

  it('leaves a value under an ordinary name alone', () => {
    expect(redactProjectEnv('mode staging', { MODE: 'staging' })).toBe('mode staging');
  });
});

describe('network access shapes the agent tools', () => {
  const base = { stackHasVision: false, stackHasImageGen: false, stackHasSpecialists: false };

  it('full keeps every network tool', () => {
    const names = buildToolRegistry(base).names();
    expect(names).toContain('webSearch');
    expect(names).toContain('webFetch');
  });

  it('search keeps web search only', () => {
    const names = buildToolRegistry({ ...base, network: 'search' }).names();
    expect(names).toContain('webSearch');
    expect(names).not.toContain('webFetch');
  });

  it('none keeps none, and the shell stays', () => {
    const names = buildToolRegistry({ ...base, network: 'none' }).names();
    expect(names).not.toContain('webSearch');
    expect(names).not.toContain('webFetch');
    expect(names).toContain('runShell');
  });

  it('the model reads a narrowed network, and nothing for full', () => {
    expect(projectNetworkNote('full')).toBeUndefined();
    expect(projectNetworkNote(undefined)).toBeUndefined();
    expect(projectNetworkNote('search')).toMatch(/search only/);
    expect(projectNetworkNote('none')).toMatch(/do not search the web/);
  });
});

describe('the setup script runs before the first task (CX, 2026-10-30)', async () => {
  const { LocalDriver } = await import('../src/daemon/session.js');
  const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');

  it('holds the first task until the script ends, with its variables set', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'osc-setup-'));
    try {
      const driver = new LocalDriver(folder, { persist: false });
      driver.projectEnv = { MARK: 'ready' };
      const seen: string[] = [];
      driver.onEvent((e) => {
        if (e.type === 'status') seen.push(e.message);
      });
      let ranAfterSetup: boolean | undefined;
      driver.attachAgent({
        run: async () => {
          ranAfterSetup = existsSync(join(folder, 'ready'));
          driver.emit({ type: 'task-done', reason: 'complete' });
        },
        generateTitle: async () => undefined,
        flushHandoff: () => undefined,
      } as never);
      driver.runSetup('sleep 0.3 && touch "$MARK"');
      driver.send('build the page');
      const until = Date.now() + 5000;
      while (ranAfterSetup === undefined && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(ranAfterSetup).toBe(true);
      expect(seen.some((m) => m.includes('setup script to finish'))).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
