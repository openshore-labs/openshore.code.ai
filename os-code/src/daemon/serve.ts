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
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
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
import { clone } from '../git/index.js';
import { loadCatalog } from '../market/catalog.js';
import { EgressPolicy } from '../core/security/egress.js';
import { logger } from '../util/log.js';

// The phone app runs in a WebView, so the daemon must speak CORS: a
// capacitor://localhost origin preflights every authorized request. The
// bearer token still gates everything; CORS is transport manners, not auth.
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};

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
    // CORS preflights carry no Authorization header by design; answer them
    // before the auth gate so the WebView can proceed to the real request.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
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

    // ---- Phone-app surfaces: workspaces, the stack, the catalog. ----
    if (req.method === 'GET' && url.pathname === '/workspaces') {
      sendJson(res, 200, { workspaces: recentWorkspaces() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/workspaces/clone') {
      const body = await readJson(req);
      const gitUrl = typeof body.url === 'string' ? body.url.trim() : '';
      if (!/^(https:\/\/|git@)/.test(gitUrl)) {
        sendJson(res, 400, { error: 'Send {"url": "https://github.com/owner/repo"}.' });
        return;
      }
      const name = basename(gitUrl.replace(/\.git$/, '')) || 'repo';
      const parent = join(homedir(), 'OSCode');
      mkdirSync(parent, { recursive: true });
      const target = join(parent, name);
      try {
        if (!existsSync(target)) await clone(gitUrl, target);
        sendJson(res, 200, { cwd: target, name });
      } catch (err) {
        sendJson(res, 400, { error: `Could not clone: ${(err as Error).message}` });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/stack') {
      const stack = options.config.stack;
      const orchestrator = stack.orchestrator
        ? {
            model: stack.orchestrator.model,
            provider: stack.orchestrator.provider,
            kind: (options.config.providers[stack.orchestrator.provider]?.kind === 'anthropic'
              ? 'cloud'
              : 'local') as 'local' | 'cloud',
          }
        : undefined;
      const specialists = Object.entries(stack.specialists)
        .filter(([role]) => role !== 'imageGen')
        .map(([role, ref]) => ({ role, model: (ref as { model?: string }).model ?? '' }));
      sendJson(res, 200, {
        description: orchestrator
          ? `${orchestrator.model}${specialists.length ? ` + ${specialists.map((s) => s.role).join(', ')}` : ', solo'}`
          : 'not set up yet',
        orchestrator,
        specialists,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/catalog') {
      try {
        const loaded = await loadCatalog(options.config, new EgressPolicy(options.config.egress));
        sendJson(res, 200, { catalog: loaded.catalog, source: loaded.source, note: loaded.note });
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
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
          ...CORS_HEADERS,
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
    ...CORS_HEADERS,
  });
  res.end(text);
}

/** Recent workspaces: session cwds, newest first, deduped, existing only. */
function recentWorkspaces(): Array<{ cwd: string; name: string; lastUsed?: string }> {
  const seen = new Set<string>();
  const out: Array<{ cwd: string; name: string; lastUsed?: string }> = [];
  for (const session of listSessions()) {
    if (seen.has(session.cwd) || !existsSync(session.cwd)) continue;
    seen.add(session.cwd);
    out.push({ cwd: session.cwd, name: basename(session.cwd), lastUsed: session.updatedAt });
    if (out.length >= 12) break;
  }
  return out;
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
