// A phone session revived after the computer restarts keeps the person's
// switches (Personal v1 readiness): Humanize Writing, Memory, and Chain of
// Thought ride into info.json when the session opens and come back on
// rehydrate, the way the project name and standing instructions already do.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalDriver,
  deleteSession,
  sessionsDir,
  storedSessionProject,
} from '../src/daemon/session.js';
import { bootstrapSession } from '../src/core/agent/bootstrap.js';
import { _setFakeKeychain, getCredential } from '../src/auth/store.js';
import { loadOrCreateDataKey, sealString } from '../src/core/security/atRest.js';

let home: string;
let keychain: Map<string, string>;
const prior = process.env.OSC_HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'osc-switches-'));
  process.env.OSC_HOME = home;
  // The credential store is an in-memory keychain here, never the machine's.
  keychain = new Map();
  _setFakeKeychain({ entries: keychain });
});
afterEach(() => {
  _setFakeKeychain(undefined);
  if (prior === undefined) delete process.env.OSC_HOME;
  else process.env.OSC_HOME = prior;
  rmSync(home, { recursive: true, force: true });
});

describe("a revived session keeps the app's switches", () => {
  it('stores them at open and reads them back', () => {
    const driver = new LocalDriver(home, {
      project: {
        projectName: 'Bakery site',
        switches: { humanize: false, memory: false, chainOfThought: true },
      },
      checkpoints: false,
    });
    expect(storedSessionProject(driver.id)).toEqual({
      projectName: 'Bakery site',
      switches: { humanize: false, memory: false, chainOfThought: true },
    });
    // Plain booleans in the file, no content.
    const info = JSON.parse(readFileSync(join(sessionsDir(), driver.id, 'info.json'), 'utf8')) as {
      switches?: unknown;
    };
    expect(info.switches).toEqual({ humanize: false, memory: false, chainOfThought: true });
  });

  it('writes nothing when the app sent no switch', () => {
    const driver = new LocalDriver(home, { project: { switches: {} }, checkpoints: false });
    expect(storedSessionProject(driver.id).switches).toBeUndefined();
  });

  it('bootstrap falls back to the stored switches for a revived session', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'core', 'agent', 'bootstrap.ts'), 'utf8');
    expect(src).toContain('const humanize = options.humanize ?? stored.switches?.humanize;');
    expect(src).toContain('const memorySwitch = options.memory ?? stored.switches?.memory;');
    expect(src).toContain('humanizerEnabled(config.humanizer?.standard, humanize)');
    expect(src).toContain('memoryEnabled(config.memory?.enabled, memorySwitch)');
  });
});

// H1 (finding 17): a revived session forgot a declined web search and its
// currents, so it could search after the person said no and lost the tool the
// person connected. Both now ride info.json; a current's key never does.
describe('a revived session keeps a declined search and its currents (H1)', () => {
  const hermes = {
    baseUrl: 'http://mini.tail1234.ts.net:8642/v1',
    apiKey: 'sk-hermes-secret-123',
    model: 'hermes-3',
  };
  const jev = { baseUrl: 'https://api.typesafe.ai', apiKey: 'jev-secret-456' };

  it('keeps them in info.json with every key moved to the credential store', () => {
    const driver = new LocalDriver(home, {
      project: {
        switches: {
          webSearch: false,
          currents: { hermes },
          harnessCurrents: { jev },
        },
      },
      checkpoints: false,
    });
    const raw = readFileSync(join(sessionsDir(), driver.id, 'info.json'), 'utf8');
    expect(raw).not.toContain('sk-hermes-secret-123');
    expect(raw).not.toContain('jev-secret-456');
    // The address is sealed with the rest of the handle.
    expect(raw).not.toContain('tail1234');
    expect(JSON.parse(raw).switches).toEqual({ webSearch: false });

    const back = storedSessionProject(driver.id).switches;
    expect(back?.webSearch).toBe(false);
    expect(back?.currents).toEqual({ hermes });
    expect(back?.harnessCurrents).toEqual({ jev: { ...jev, model: undefined } });
    driver.dispose();

    // Deleting the session takes its keys along.
    expect([...keychain.values()]).toEqual(
      expect.arrayContaining(['sk-hermes-secret-123', 'jev-secret-456']),
    );
    expect(deleteSession(driver.id)).toBe(true);
    expect([...keychain.values()]).not.toContain('sk-hermes-secret-123');
    expect([...keychain.values()]).not.toContain('jev-secret-456');
  });

  it('reads a key back only under the name this session used, never another credential', () => {
    keychain.set('anthropic-api-key', 'sk-ant-the-persons-own');
    const driver = new LocalDriver(home, {
      project: { switches: { currents: { hermes } } },
      checkpoints: false,
    });
    const infoPath = join(sessionsDir(), driver.id, 'info.json');
    const info = JSON.parse(readFileSync(infoPath, 'utf8')) as { handles: string };
    const dk = loadOrCreateDataKey()!;
    // A hand-edited info.json that points the current at another credential.
    info.handles = sealString(
      dk.key,
      JSON.stringify({
        currents: { hermes: { baseUrl: hermes.baseUrl, keyRef: 'anthropic-api-key' } },
      }),
    );
    writeFileSync(infoPath, JSON.stringify(info));
    expect(storedSessionProject(driver.id).switches?.currents?.hermes?.apiKey).toBeUndefined();
    driver.dispose();
    // Deleting the session leaves that credential where it is.
    deleteSession(driver.id);
    expect(keychain.get('anthropic-api-key')).toBe('sk-ant-the-persons-own');
  });

  it('a revive through bootstrapSession has no web search and the current, key and all', () => {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } } }),
    );
    const first = bootstrapSession({
      cwd: home,
      profile: 'local-interactive',
      webSearch: false,
      currents: { hermes },
    });
    const id = first.driver.id;
    expect(first.tools.names()).not.toContain('webSearch');
    expect(first.tools.names()).toContain('askHermes');
    first.driver.dispose();

    // The daemon's rehydrate and the desktop's resume pass only the id.
    const revived = bootstrapSession({ cwd: home, profile: 'local-interactive', sessionId: id });
    expect(revived.tools.names()).not.toContain('webSearch');
    expect(revived.tools.names()).toContain('askHermes');
    expect(revived.toolContext.currents?.hermes?.apiKey).toBe('sk-hermes-secret-123');
    revived.driver.dispose();

    // A key the store lost is simply absent on revive; the handle still is.
    for (const name of [...keychain.keys()]) {
      if (getCredential(name) === 'sk-hermes-secret-123') keychain.delete(name);
    }
    const again = bootstrapSession({ cwd: home, profile: 'local-interactive', sessionId: id });
    expect(again.toolContext.currents?.hermes?.baseUrl).toBe(hermes.baseUrl);
    expect(again.toolContext.currents?.hermes?.apiKey).toBeUndefined();
    again.driver.dispose();

    // A session that never declined keeps the tool on revive.
    const open = bootstrapSession({ cwd: home, profile: 'local-interactive' });
    open.driver.dispose();
    const reopened = bootstrapSession({
      cwd: home,
      profile: 'local-interactive',
      sessionId: open.driver.id,
    });
    expect(reopened.tools.names()).toContain('webSearch');
    expect(reopened.tools.names()).not.toContain('askHermes');
    reopened.driver.dispose();
  });
});
