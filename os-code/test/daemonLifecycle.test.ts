// H1: sessions and credentials get a lifecycle. A paired device's credential
// ends; the old shared token opens nothing from off this computer once every
// device pairs on its own, and can be replaced; the one route open without a
// credential takes a small body and a few tries; a push grant goes only to
// the app's own push function; the free chat answers one message at a time;
// old sessions are cleared and open ones never are; and a stray fault leaves
// the process up. These start a real loopback daemon where the route is the
// thing under test, with a fake Ollama standing in for the local model.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, type RunningDaemon } from '../src/daemon/serve.js';
import { TerminalManager, TerminalUnavailable } from '../src/daemon/terminal.js';
import { defaultConfig } from '../src/config/load.js';
import {
  DEVICE_CREDENTIAL_TTL_DAYS,
  credentialExpiresAt,
  credentialsPath,
  deviceCredentialExpired,
  loadCredentials,
  mintCredential,
  resolveDeviceCredential,
} from '../src/core/security/credentials.js';
import {
  isLoopbackAddress,
  resolveAuth,
  rotateSharedToken,
} from '../src/core/security/daemonAuth.js';
import { pushSendUrlAllowed } from '../src/daemon/push.js';
import { TokenBucket } from '../src/daemon/rateLimit.js';
import {
  LocalDriver,
  announceProcessFault,
  isSessionOpen,
  pruneStoredSessions,
  sessionsDir,
} from '../src/daemon/session.js';
import { installProcessGuards } from '../src/daemon/processGuard.js';
import { _resetRoutineScheduler } from '../src/routines/scheduler.js';
import type { DriverEvent } from '../src/core/agent/types.js';

let home: string;
let realHome: string | undefined;
let daemon: RunningDaemon;
let base: string;
let legacy: string;
let ollama: Server;
// The fake model holds its answer until the test lets it go, so a chat can
// be caught mid-stream.
let held: ServerResponse[] = [];
let holdAnswers = false;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return addr.port;
}

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
      if (String(err).includes('EADDRINUSE')) continue;
      throw err;
    }
  }
  throw new Error('could not find a free port for the test daemon');
}

function finish(res: ServerResponse): void {
  res.write(`${JSON.stringify({ message: { content: 'Hello.' }, done: false })}\n`);
  res.end(`${JSON.stringify({ done: true })}\n`);
}

beforeEach(async () => {
  held = [];
  holdAnswers = false;
  ollama = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url === '/api/version') {
        res.end(JSON.stringify({ version: '0.9.0' }));
      } else if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.2:3b' }] }));
      } else if (req.url === '/api/show') {
        res.end(JSON.stringify({ model_info: { 'qwen2.context_length': 32768 } }));
      } else if (req.url === '/api/chat') {
        if (holdAnswers) held.push(res);
        else finish(res);
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  const port = await listen(ollama);
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
  realHome = process.env.HOME;
  process.env.HOME = home;
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      providers: { ollama: { kind: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}` } },
      stack: { orchestrator: { provider: 'ollama', model: 'qwen2.5:7b' } },
    }),
  );
  _resetRoutineScheduler();
  daemon = await startOnFreePort();
  base = `http://127.0.0.1:${daemon.port}`;
  legacy = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
});

afterEach(() => {
  for (const res of held) res.destroy();
  daemon.close();
  ollama.close();
  _resetRoutineScheduler();
  process.env.HOME = realHome;
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

describe('device credentials end (H1)', () => {
  it('a new credential ends after the named lifetime, and an expired one is refused', async () => {
    const { token, credential } = mintCredential({ role: 'admin', label: 'Phone' });
    const days = (Date.parse(credential.expiresAt!) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(DEVICE_CREDENTIAL_TTL_DAYS);
    expect(resolveDeviceCredential(token)?.label).toBe('Phone');

    const { token: old } = mintCredential({ role: 'admin', label: 'Old phone', ttlDays: -1 });
    expect(resolveDeviceCredential(old)).toBeUndefined();
    expect(deviceCredentialExpired(old)).toBe(true);
    const res = await fetch(`${base}/health`, { headers: auth(old) });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toMatch(/pairing has expired/);
    expect((await fetch(`${base}/health`, { headers: auth(token) })).status).toBe(200);
  });

  it('a credential stored before every one carried an end date ends by its birth date', () => {
    const { token } = mintCredential({ role: 'member', label: 'Legacy' });
    const file = JSON.parse(readFileSync(credentialsPath(), 'utf8')) as {
      credentials: Array<Record<string, unknown>>;
    };
    delete file.credentials[0]!.expiresAt;
    file.credentials[0]!.createdAt = new Date(
      Date.now() - (DEVICE_CREDENTIAL_TTL_DAYS + 1) * 86_400_000,
    ).toISOString();
    writeFileSync(credentialsPath(), JSON.stringify(file));
    expect(resolveDeviceCredential(token)).toBeUndefined();
    const stored = loadCredentials()[0]!;
    expect(Date.parse(credentialExpiresAt(stored))).toBeLessThan(Date.now());
  });

  it('the pairing answer says when the new credential ends', async () => {
    const claim = daemon.mintPairClaim().claim;
    const res = await fetch(`${base}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claim, deviceName: 'Test phone' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { expiresAt?: string };
    expect(Date.parse(body.expiresAt ?? '')).toBeGreaterThan(Date.now());
  });
});

describe('the legacy shared token (H1)', () => {
  it('is refused from a tailnet address once any device has its own credential', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('100.101.102.103')).toBe(false);
    // No device paired on its own yet: the shared token still works from the
    // tailnet, so a phone on an older build is never stranded.
    expect(resolveAuth(legacy, legacy, { from: '100.101.102.103' })?.source).toBe('legacy');
    mintCredential({ role: 'admin', label: 'Phone' });
    expect(resolveAuth(legacy, legacy, { from: '100.101.102.103' })).toBeNull();
    expect(resolveAuth(legacy, legacy, { from: '::ffff:100.101.102.103' })).toBeNull();
    // On this computer itself it still works.
    expect(resolveAuth(legacy, legacy, { from: '127.0.0.1' })?.source).toBe('legacy');
  });

  it('the daemon passes the socket address in', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'daemon', 'serve.ts'), 'utf8');
    expect(src).toContain('const from = req.socket.remoteAddress;');
    expect(src).toContain('resolveAuth(presented, legacyToken(), { from })');
  });

  it('osc token rotate replaces it, and the running daemon takes the new one at once', async () => {
    expect((await fetch(`${base}/health`, { headers: auth(legacy) })).status).toBe(200);
    rotateSharedToken(join(home, 'daemon.token'));
    const fresh = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
    expect(fresh).not.toBe(legacy);
    expect(fresh.startsWith('osc_')).toBe(true);
    expect(statSync(join(home, 'daemon.token')).mode & 0o777).toBe(0o600);
    expect((await fetch(`${base}/health`, { headers: auth(legacy) })).status).toBe(401);
    expect((await fetch(`${base}/health`, { headers: auth(fresh) })).status).toBe(200);
  });
});

describe('POST /pair/claim takes a small body and a few tries (H1)', () => {
  async function claim(body: string): Promise<Response> {
    return fetch(`${base}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  }

  it('refuses a 5 KB body before reading a claim', async () => {
    const res = await claim(JSON.stringify({ claim: 'pc_x', deviceName: 'x'.repeat(5 * 1024) }));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toContain('4 KB');
  });

  it('throttles claim attempts from one address, and never the empty probe', async () => {
    const answers: number[] = [];
    for (let i = 0; i < 7; i++)
      answers.push((await claim(JSON.stringify({ claim: `pc_${i}` }))).status);
    expect(answers.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(answers.slice(5)).toEqual([429, 429]);
    const throttled = await claim(JSON.stringify({ claim: 'pc_more' }));
    expect(throttled.headers.get('retry-after')).toMatch(/^\d+$/);
    // The phone's "is anything there" probe (an empty claim) still answers 400.
    expect((await claim('{}')).status).toBe(400);
  });

  it('refills over time', () => {
    const bucket = new TokenBucket({ capacity: 2, refillMs: 1000 });
    expect(bucket.take('a', 0).ok).toBe(true);
    expect(bucket.take('a', 0).ok).toBe(true);
    const refused = bucket.take('a', 0);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.retryAfterMs).toBe(1000);
    // Another address has its own bucket.
    expect(bucket.take('b', 0).ok).toBe(true);
    expect(bucket.take('a', 1000).ok).toBe(true);
  });
});

describe('POST /push/register goes only to the app push function (H1)', () => {
  it('refuses a foreign host and keeps the Supabase function', async () => {
    const register = (sendUrl: string) =>
      fetch(`${base}/push/register`, {
        method: 'POST',
        headers: auth(legacy),
        body: JSON.stringify({ grant: 'g_1', sendUrl, deviceId: 'd1' }),
      });
    const foreign = await register('https://collector.example.com/functions/v1/push-send');
    expect(foreign.status).toBe(400);
    expect(((await foreign.json()) as { error: string }).error).toMatch(/notification service/);
    const ok = await register('https://abcdefghijklmnopqrst.supabase.co/functions/v1/push-send');
    expect(ok.status).toBe(200);
  });

  it('pins the path, the scheme, and the host', () => {
    const good = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/push-send';
    expect(pushSendUrlAllowed(good)).toBe(true);
    expect(pushSendUrlAllowed(good.replace('https:', 'http:'))).toBe(false);
    expect(pushSendUrlAllowed(`${good}?to=elsewhere`)).toBe(false);
    expect(pushSendUrlAllowed(good.replace('push-send', 'other'))).toBe(false);
    expect(pushSendUrlAllowed(good.replace('https://', 'https://user:pw@'))).toBe(false);
    expect(pushSendUrlAllowed(good.replace('.supabase.co', '.supabase.co:8443'))).toBe(false);
    expect(pushSendUrlAllowed(good.replace('.supabase.co', '.supabase.co.evil.net'))).toBe(false);
    // A project on its own domain is named in machine config.
    const own = 'https://api.openshore.ai/functions/v1/push-send';
    expect(pushSendUrlAllowed(own)).toBe(false);
    expect(pushSendUrlAllowed(own, 'api.openshore.ai')).toBe(true);
    expect(pushSendUrlAllowed(good, 'api.openshore.ai')).toBe(false);
  });
});

describe('POST /chat answers one message at a time (H1)', () => {
  const messages = [{ role: 'user', content: 'Hi there' }];
  const chat = (token: string, body: Record<string, unknown>) =>
    fetch(`${base}/chat`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });

  async function modelHas(n: number): Promise<void> {
    for (let i = 0; i < 200 && held.length < n; i++) await new Promise((r) => setTimeout(r, 10));
    expect(held).toHaveLength(n);
  }

  it('refuses a second request while the first still streams, per credential', async () => {
    holdAnswers = true;
    // The model holds its answer, so the first chat is mid-stream.
    const first = chat(legacy, { messages });
    await modelHas(1);

    const second = await chat(legacy, { messages });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toMatch(/still answering/);

    // Another device's credential is its own line.
    const { token: phone } = mintCredential({ role: 'member', label: 'Phone' });
    const other = chat(phone, { messages });
    await modelHas(2);

    // Once the first answer ends, the next is taken.
    holdAnswers = false;
    for (const res of held.splice(0)) finish(res);
    expect((await first).status).toBe(200);
    expect((await other).status).toBe(200);
    await (await first).text();
    await (await other).text();
    const third = await chat(legacy, { messages });
    expect(third.status).toBe(200);
    await third.text();
  });

  it('refuses a conversation too long to send, by count and by size', async () => {
    const many = Array.from({ length: 201 }, () => ({ role: 'user', content: 'x' }));
    expect((await chat(legacy, { messages: many })).status).toBe(413);
    const big = [{ role: 'user', content: 'x'.repeat(600 * 1024) }];
    const res = await chat(legacy, { messages: big });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toMatch(/Start a new chat/);
  });

  it('checks a named model against what the computer serves', async () => {
    const unknown = await chat(legacy, { messages, model: 'gpt-imaginary' });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toContain('gpt-imaginary');
    const served = await chat(legacy, { messages, model: 'llama3.2:3b' });
    expect(served.status).toBe(200);
    await served.text();
  });
});

describe('session retention (H1)', () => {
  function storedSession(id: string, daysOld: number): string {
    const dir = join(sessionsDir(), id);
    mkdirSync(dir, { recursive: true });
    const at = new Date(Date.now() - daysOld * 86_400_000);
    writeFileSync(
      join(dir, 'info.json'),
      JSON.stringify({
        id,
        cwd: home,
        title: id,
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
      }),
    );
    writeFileSync(join(dir, 'events.jsonl'), '');
    for (const name of ['info.json', 'events.jsonl']) utimesSync(join(dir, name), at, at);
    return dir;
  }

  it('prunes an old closed session and never an open one', () => {
    storedSession('old1', 120);
    storedSession('recent1', 5);
    // An open session whose files look old: open wins.
    const open = new LocalDriver(home, { checkpoints: false });
    const past = new Date(Date.now() - 200 * 86_400_000);
    const info = JSON.parse(readFileSync(join(sessionsDir(), open.id, 'info.json'), 'utf8'));
    info.updatedAt = past.toISOString();
    writeFileSync(join(sessionsDir(), open.id, 'info.json'), JSON.stringify(info));
    utimesSync(join(sessionsDir(), open.id, 'info.json'), past, past);
    try {
      expect(isSessionOpen(open.id)).toBe(true);
      const removed = pruneStoredSessions({ retentionDays: 90 });
      expect(removed).toEqual(['old1']);
      expect(() => statSync(join(sessionsDir(), 'recent1'))).not.toThrow();
      expect(() => statSync(join(sessionsDir(), open.id))).not.toThrow();
      // A caller's own keep list is honored too, and zero keeps everything.
      storedSession('old2', 120);
      expect(pruneStoredSessions({ retentionDays: 90, keep: (id) => id === 'old2' })).toEqual([]);
      expect(pruneStoredSessions({ retentionDays: 0 })).toEqual([]);
    } finally {
      open.dispose();
    }
    // Closed now, and old: the next pass takes it.
    expect(isSessionOpen(open.id)).toBe(false);
    expect(pruneStoredSessions({ retentionDays: 90 })).toEqual(
      expect.arrayContaining([open.id, 'old2']),
    );
  });

  it('the daemon prunes at start, by the machine setting', async () => {
    storedSession('ancient1', 400);
    storedSession('fresh1', 1);
    daemon.close();
    daemon = await startOnFreePort();
    for (let i = 0; i < 50; i++) {
      try {
        statSync(join(sessionsDir(), 'ancient1'));
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(() => statSync(join(sessionsDir(), 'ancient1'))).toThrow();
    expect(() => statSync(join(sessionsDir(), 'fresh1'))).not.toThrow();
  });
});

describe('a stray fault keeps the process up (H1)', () => {
  it('tells each working session once, and the hosts install the guard', () => {
    const working = new LocalDriver(home, { checkpoints: false });
    const idle = new LocalDriver(home, { checkpoints: false });
    const seen: DriverEvent[] = [];
    working.onEvent((e) => seen.push(e));
    idle.onEvent((e) => seen.push(e));
    (working as unknown as { running: boolean }).running = true;
    try {
      expect(announceProcessFault(10_000_000)).toBe(1);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ type: 'status' });
      expect((seen[0] as { message: string }).message).toMatch(/press Stop and send it again/);
      // Not again within the minute.
      expect(announceProcessFault(10_000_000 + 30_000)).toBe(0);
    } finally {
      working.dispose();
      idle.dispose();
    }

    const before = process.listenerCount('unhandledRejection');
    const off = installProcessGuards({ where: 'test' });
    expect(process.listenerCount('unhandledRejection')).toBe(before + 1);
    expect(process.listenerCount('uncaughtException')).toBeGreaterThan(0);
    // A second install is a no-op.
    installProcessGuards({ where: 'test' })();
    expect(process.listenerCount('unhandledRejection')).toBe(before + 1);
    off();
    expect(process.listenerCount('unhandledRejection')).toBe(before);

    const serve = readFileSync(join(__dirname, '..', 'src', 'commands', 'serve.ts'), 'utf8');
    expect(serve).toContain('installProcessGuards(');
    const main = readFileSync(join(__dirname, '..', '..', 'app', 'electron', 'main.ts'), 'utf8');
    expect(main).toContain('installProcessGuards(');
  });
});
