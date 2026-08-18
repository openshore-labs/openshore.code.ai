// The daemon. It owns the generation: sessions live here, phones attach and
// detach freely, and a dropped connection costs nothing because every event
// is journaled and replayable from any sequence number.
//
// Security posture (see src/core/security/):
//   - Binds loopback or the Tailscale interface. Never 0.0.0.0, no override.
//   - Every request authenticates with the daemon bearer token, independent
//     of network reachability.
//   - Sessions run on the remote-attached profile: stricter than sitting at
//     the desk, never looser.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  assertSafeBind,
  bearerFrom,
  loadOrCreateToken,
  tokenMatches,
} from '../core/security/daemonAuth.js';
import { oscHome } from '../config/load.js';
import type { OscConfig } from '../config/schema.js';
import { tailscaleIp } from '../connect/tailscale.js';
import { bootstrapSession } from '../core/agent/bootstrap.js';
import { LocalDriver, listSessions } from './session.js';
import { logger } from '../util/log.js';

const log = logger('daemon');

export interface DaemonOptions {
  config: OscConfig;
  bind: 'loopback' | 'tailscale';
  port: number;
}

export interface RunningDaemon {
  host: string;
  port: number;
  close(): void;
}

export function resolveBindHost(bind: 'loopback' | 'tailscale'): string {
  if (bind === 'tailscale') {
    const ip = tailscaleIp();
    if (!ip) {
      throw new Error(
        'No Tailscale interface found. Bring the tailnet up (sudo tailscale up) or use --bind loopback.',
      );
    }
    return ip;
  }
  return '127.0.0.1';
}

export function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const host = resolveBindHost(options.bind);
  assertSafeBind(host);
  const token = loadOrCreateToken(join(oscHome(), 'daemon.token'));
  const drivers = new Map<string, LocalDriver>();

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      log.error('request failed', { err: String(err) });
      sendJson(res, 500, { error: 'Something went wrong in the daemon; check its logs.' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const presented = bearerFrom(req.headers.authorization);
    if (!tokenMatches(presented, token)) {
      sendJson(res, 401, {
        error: 'Missing or wrong daemon token. It lives in ~/.os-code/daemon.token on the desktop.',
      });
      return;
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'daemon'}`);
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, sessions: drivers.size, version: '0.1.0' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/sessions') {
      const live = [...drivers.values()].map((d) => ({
        id: d.id,
        cwd: d.cwd,
        busy: d.busy,
        model: d.describeModel(),
      }));
      sendJson(res, 200, { live, stored: listSessions() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/sessions') {
      const body = await readJson(req);
      const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : process.cwd();
      try {
        const { driver, warnings } = bootstrapSession({ cwd, profile: 'remote-attached' });
        drivers.set(driver.id, driver);
        sendJson(res, 201, { id: driver.id, cwd, warnings });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    if (parts[0] === 'sessions' && parts[1]) {
      const id = parts[1];
      let driver = drivers.get(id);
      if (!driver && listSessions().some((s) => s.id === id)) {
        // Rehydrate a stored session: the journal replays, a fresh agent continues.
        const stored = listSessions().find((s) => s.id === id)!;
        try {
          const { driver: revived } = bootstrapSession({
            cwd: stored.cwd,
            profile: 'remote-attached',
            sessionId: id,
          });
          drivers.set(id, revived);
          driver = revived;
        } catch (err) {
          sendJson(res, 400, { error: (err as Error).message });
          return;
        }
      }
      if (!driver) {
        sendJson(res, 404, { error: `No session ${id}. GET /sessions lists what exists.` });
        return;
      }

      if (req.method === 'POST' && parts[2] === 'input') {
        const body = await readJson(req);
        if (typeof body.text !== 'string' || !body.text.trim()) {
          sendJson(res, 400, { error: 'Send {"text": "..."}.' });
          return;
        }
        driver.send(body.text);
        sendJson(res, 202, { queued: true, busy: driver.busy });
        return;
      }
      if (req.method === 'POST' && parts[2] === 'abort') {
        driver.abort();
        sendJson(res, 200, { aborted: true });
        return;
      }
      if (req.method === 'POST' && parts[2] === 'approvals' && parts[3]) {
        const body = await readJson(req);
        driver.answerApproval(parts[3], {
          approve: Boolean(body.approve),
          alwaysThisSession: Boolean(body.alwaysThisSession),
        });
        sendJson(res, 200, { resolved: true });
        return;
      }
      if (req.method === 'GET' && parts[2] === 'events') {
        const since = Number(url.searchParams.get('since') ?? 0);
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(':ok\n\n');
        const unsubscribe = driver.subscribe((event, seq) => {
          res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
        }, since);
        const keepalive = setInterval(() => res.write(':ka\n\n'), 15_000);
        req.on('close', () => {
          clearInterval(keepalive);
          unsubscribe();
        });
        return;
      }
    }

    sendJson(res, 404, { error: `No route ${req.method} ${url.pathname}.` });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => {
      log.info('daemon up', { host, port: options.port });
      resolve({ host, port: options.port, close: () => server.close() });
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}
