// TS-P1-1: a tailscale-bound daemon must ALSO answer on loopback, so the pair
// wizard's own `osc attach` step (which defaults to 127.0.0.1) reaches it.
// A real tailnet is not available in CI, so tailscaleIp is mocked to a
// bindable loopback-range address that is distinct from 127.0.0.1; the daemon
// then must answer on both that address and 127.0.0.1.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/connect/tailscale.js', () => ({
  tailscaleIp: () => '127.0.0.2',
}));

import { startDaemon, type RunningDaemon } from '../src/daemon/serve.js';
import { defaultConfig } from '../src/config/load.js';

let home: string;
let daemon: RunningDaemon;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-bind-'));
  process.env.OSC_HOME = home;
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } } }),
  );
});

afterEach(() => {
  daemon?.close();
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('daemon dual bind (TS-P1-1)', () => {
  it('answers on both the tailnet address and loopback when bound to tailscale', async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const port = 40000 + Math.floor(Math.random() * 20000);
      try {
        daemon = await startDaemon({ config: defaultConfig(), bind: 'tailscale', port });
        break;
      } catch (err) {
        if (String(err).includes('EADDRINUSE')) continue;
        throw err;
      }
    }
    expect(daemon).toBeDefined();
    expect(daemon.host).toBe('127.0.0.2');
    const token = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
    const authHeader = { authorization: `Bearer ${token}` };

    const tailnet = await fetch(`http://127.0.0.2:${daemon.port}/health`, { headers: authHeader });
    expect(tailnet.status).toBe(200);

    const loopback = await fetch(`http://127.0.0.1:${daemon.port}/health`, { headers: authHeader });
    expect(loopback.status).toBe(200);
  });
});
