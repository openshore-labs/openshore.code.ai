// The Electron main process: one window, one EngineHost, and an IPC surface
// that mirrors OscodeBridge method for method. The renderer stays Node-free;
// everything engine-shaped happens here.
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { isIP } from 'node:net';
import { EngineHost } from './engineHost.js';

const here = dirname(fileURLToPath(import.meta.url));

// The only page the shell is ever allowed to navigate to: the app's own bundled
// entry point. Anything else (a stray file:, an http link) is denied below.
const appEntry = pathToFileURL(join(here, '..', 'dist', 'index.html'));

// ------------------------------------------------------------ outbound HTTP
// The renderer cannot reach CORS-hostile third-party APIs directly, so it asks
// the main process to fetch on its behalf. Because the renderer is untrusted,
// this handler is locked down: https only, GET/POST only, a header allowlist,
// an SSRF block that refuses private/loopback targets (re-checked on every
// redirect hop), a response-size cap, and a timeout.
const ALLOWED_HEADERS = new Set(['content-type', 'x-auth-token', 'authorization']);
const MAX_HTTP_BYTES = 25 * 1024 * 1024;

function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0) return true; // loopback, private, this-host
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b! >= 16 && b! <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
    if (a! >= 224 && a! <= 239) return true; // 224.0.0.0/4 multicast
    if (a! >= 240) return true; // 240.0.0.0/4 reserved (incl. 255.255.255.255 broadcast)
    if (a === 100 && b! >= 64 && b! <= 127) return true; // CGNAT (Tailscale range)
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (/^fe[c-f]/.test(lower)) return true; // fec0::/10 deprecated site-local
    if (lower.startsWith('64:ff9b:') || lower.startsWith('0064:ff9b:')) return true; // 64:ff9b::/96 NAT64
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7)); // v4-mapped
    return false;
  }
  return true; // unresolvable: refuse
}

// Resolve the hostname ONCE, validate EVERY address it maps to, and return a
// single vetted address to pin the connection to. Pinning is the anti-rebinding
// fix (D3): a stock fetch re-resolves DNS at connect time, so a 0-TTL record
// that flips public->private (or a multi-A "public first, private second"
// answer) between our check and the connect could still land the socket on
// loopback/LAN/tailnet. Here the socket is forced to the exact IP we already
// vetted, and we reject if ANY resolved address is private, not just the first.
async function vetAndPin(u: URL): Promise<LookupAddress> {
  if (u.protocol !== 'https:') throw new Error('blocked: https only');
  if (/(^|\.)(localhost|local)$/i.test(u.hostname)) throw new Error('blocked: local host');
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length) throw new Error('blocked: unresolvable host');
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) throw new Error('blocked: private address');
  }
  return addrs[0]!;
}

// One https request whose DNS is pinned to `pinned`. The custom `lookup` hands
// back only the address we vetted, so the TCP connection cannot be rebound to a
// different host between the check and the connect. TLS still validates against
// the real hostname (SNI + Host derive from `u`), so legitimate certs verify.
function pinnedHttpsRequest(
  u: URL,
  pinned: LookupAddress,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const pinnedLookup = (
      _hostname: string,
      options: LookupOptions,
      cb: (
        err: NodeJS.ErrnoException | null,
        address: string | LookupAddress[],
        family?: number,
      ) => void,
    ): void => {
      if (options.all) cb(null, [pinned]);
      else cb(null, pinned.address, pinned.family);
    };
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method,
        headers,
        lookup: pinnedLookup,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location ?? null;
        const chunks: Buffer[] = [];
        let total = 0;
        let capped = false;
        res.on('data', (chunk: Buffer) => {
          if (capped) return;
          if (total + chunk.length > MAX_HTTP_BYTES) {
            chunks.push(chunk.subarray(0, Math.max(0, MAX_HTTP_BYTES - total)));
            capped = true;
            res.destroy();
            return;
          }
          total += chunk.length;
          chunks.push(chunk);
        });
        const finish = () =>
          done(() => resolve({ status, location, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', (err) => done(() => reject(err)));
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error('blocked: request timeout')));
    req.on('error', (err) => done(() => reject(err)));
    if (method === 'POST' && body !== undefined) req.write(body);
    req.end();
  });
}

interface HttpFetchReq {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function stripHeaders(headers: Record<string, string>, drop: (lower: string) => boolean): void {
  for (const name of Object.keys(headers)) {
    if (drop(name.toLowerCase())) delete headers[name];
  }
}

async function handleHttpFetch(
  req: HttpFetchReq,
): Promise<{ ok: boolean; status: number; body: string }> {
  let method = req.method === 'POST' ? 'POST' : 'GET';
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (ALLOWED_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }
  let body: string | undefined = method === 'POST' ? req.body : undefined;
  let target = new URL(req.url);
  const requestOrigin = target.origin;
  for (let hop = 0; hop < 5; hop++) {
    const pinned = await vetAndPin(target);
    const res = await pinnedHttpsRequest(target, pinned, method, headers, body);
    if (res.status >= 300 && res.status < 400 && res.location) {
      const next = new URL(res.location, target);
      // P2-9: on a cross-origin hop, drop credentials so the app's Codemagic
      // token (or any auth header) never leaks to a redirect target it was not
      // issued for. Once stripped it stays stripped for the rest of the chain.
      if (next.origin !== requestOrigin) {
        stripHeaders(headers, (l) => l === 'authorization' || l === 'x-auth-token');
      }
      // P2-9: per fetch semantics, 301/302/303 turn a POST into a bodyless GET.
      if (method === 'POST' && (res.status === 301 || res.status === 302 || res.status === 303)) {
        method = 'GET';
        body = undefined;
        stripHeaders(headers, (l) => l === 'content-type');
      }
      target = next;
      continue;
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: res.body };
  }
  throw new Error('blocked: too many redirects');
}

// A small OS-encrypted secret store: values (like the app's data-encryption
// key) are sealed by the OS keychain via safeStorage, then persisted to a file
// in userData. Only this machine's login can unseal them.
function secretsPath(): string {
  return join(app.getPath('userData'), 'oscode-secrets.json');
}
function readSecrets(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(secretsPath(), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}
function writeSecrets(all: Record<string, string>): void {
  writeFileSync(secretsPath(), JSON.stringify(all), { mode: 0o600 });
}

// --------------------------------------------------------- Google Drive OAuth
// A one-shot loopback HTTP server for the desktop OAuth redirect (RFC 8252):
// bound to 127.0.0.1 only, answers exactly one request, then closes. The
// renderer builds the consent URL against the returned port and opens it in
// the system browser via the existing window-open handler (openExternal).
let gdriveServer: Server | undefined;

function closeGdriveServer(): void {
  gdriveServer?.close();
  gdriveServer = undefined;
}

ipcMain.handle('osc:gdriveOAuthListen', () => {
  return new Promise<{ port: number }>((resolve, reject) => {
    closeGdriveServer();
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Could not open a local port for sign-in.'));
        return;
      }
      gdriveServer = server;
      resolve({ port: addr.port });
    });
  });
});

ipcMain.handle('osc:gdriveOAuthWait', () => {
  return new Promise<{ code: string; state: string } | { error: string }>((resolve) => {
    const server = gdriveServer;
    if (!server) {
      resolve({ error: 'No sign-in window is open.' });
      return;
    }
    const timeout = setTimeout(() => {
      closeGdriveServer();
      resolve({ error: 'Sign-in timed out.' });
    }, 300_000);
    server.once('request', (req, res) => {
      clearTimeout(timeout);
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>OpenShore</title>' +
          '<body style="font:16px system-ui;padding:2rem">Signed in. You can close this window and return to OpenShore.</body>',
      );
      closeGdriveServer();
      if (error) resolve({ error });
      else if (code && state) resolve({ code, state });
      else resolve({ error: 'The sign-in response was missing required data.' });
    });
  });
});

ipcMain.handle('osc:gdriveOAuthCancel', () => {
  closeGdriveServer();
});

let win: BrowserWindow | undefined;

const host = new EngineHost(
  (payload) => win?.webContents.send('osc:event', payload),
  (payload) => win?.webContents.send('osc:install-progress', payload),
);

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#f6f4ef',
    autoHideMenuBar: true,
    title: 'OpenShore',
    webPreferences: {
      preload: join(here, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // External links open in the system browser, never inside the shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Allow navigation ONLY to the app's own bundled entry point. Any other
  // target (a different file: path, an http link, a data: URL) is denied so the
  // full Node-backed bridge can never be attached to foreign content; http(s)
  // is handed to the system browser instead.
  win.webContents.on('will-navigate', (event, url) => {
    let sameApp = false;
    try {
      const u = new URL(url);
      sameApp = u.protocol === 'file:' && u.pathname === appEntry.pathname;
    } catch {
      sameApp = false;
    }
    if (sameApp) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  // OSC_SMOKE=1 makes a headless CI run prove the page and bridge came up.
  if (process.env.OSC_SMOKE) {
    win.webContents.on('did-finish-load', () => {
      void win?.webContents
        .executeJavaScript('typeof window.oscode')
        .then((kind) => console.log(`[smoke] page loaded; window.oscode is ${kind}`))
        .catch((err) => console.error('[smoke] bridge probe failed', err));
    });
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer] ${(event as unknown as { message: string }).message}`);
    });
  }

  void win.loadFile(join(here, '..', 'dist', 'index.html'));
}

// ------------------------------------------------------------------ IPC map
// Keep in lockstep with src/lib/electronBridge.ts and electron/preload.cjs.

ipcMain.handle('osc:createSession', (_e, cwd?: string) => host.createSession(cwd));
ipcMain.handle('osc:resumeSession', (_e, id: string) => host.resumeSession(id));
ipcMain.handle('osc:listSessions', () => host.listStoredSessions());
ipcMain.handle('osc:send', (_e, sessionId: string, text: string) => host.send(sessionId, text));
ipcMain.handle('osc:abort', (_e, sessionId: string) => host.abort(sessionId));
ipcMain.handle(
  'osc:answerApproval',
  (
    _e,
    sessionId: string,
    approvalId: string,
    answer: { approve: boolean; alwaysThisSession?: boolean },
  ) => host.answerApproval(sessionId, approvalId, answer),
);

ipcMain.handle('osc:status', () => host.status());
ipcMain.handle('osc:catalog', () => host.catalog());
ipcMain.handle('osc:stackHealth', (_e, range?: string) =>
  host.stackHealth(range as Parameters<typeof host.stackHealth>[0]),
);
ipcMain.handle('osc:installModel', (_e, modelId: string) => host.installModel(modelId));
ipcMain.handle('osc:setOrchestrator', (_e, model: string) => host.setOrchestrator(model));
ipcMain.handle('osc:enableSpecialist', (_e, role: string, model: string) =>
  host.enableSpecialist(role, model),
);
ipcMain.handle('osc:disableSpecialist', (_e, role: string) => host.disableSpecialist(role));

ipcMain.handle('osc:setAnthropicKey', (_e, key: string) => host.setAnthropicKey(key));
ipcMain.handle('osc:setOpenAIKey', (_e, key: string) => host.setOpenAIKey(key));
ipcMain.handle('osc:setGithubToken', (_e, token: string) => host.setGithubToken(token));
ipcMain.handle('osc:disconnect', (_e, connector: 'anthropic' | 'openai' | 'github') =>
  host.disconnect(connector),
);

ipcMain.handle('osc:pickFolder', async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Choose a project folder',
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});
ipcMain.handle('osc:cloneRepo', (_e, url: string) => host.cloneRepo(url));
ipcMain.handle('osc:recentWorkspaces', () => host.recentWorkspaces());

ipcMain.handle('osc:daemonInfo', () => host.daemonInfo());
ipcMain.handle('osc:daemonStart', () => host.daemonStart());
ipcMain.handle('osc:daemonStop', () => host.daemonStop());

// OS-encrypted secret store (used for the app's data-encryption key).
ipcMain.handle('osc:secureGet', (_e, key: string): string | null => {
  const sealed = readSecrets()[key];
  if (!sealed) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(sealed, 'base64'));
  } catch {
    return null;
  }
});
ipcMain.handle('osc:secureSet', (_e, key: string, value: string): boolean => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const all = readSecrets();
  all[key] = safeStorage.encryptString(value).toString('base64');
  writeSecrets(all);
  return true;
});
ipcMain.handle('osc:secureDelete', (_e, key: string): void => {
  const all = readSecrets();
  delete all[key];
  writeSecrets(all);
});

ipcMain.handle('osc:httpFetch', async (_e, req: HttpFetchReq) => {
  try {
    return await handleHttpFetch(req);
  } catch (err) {
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
  }
});

// -------------------------------------------------------------- app lifecycle

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeGdriveServer();
  host.disposeAll();
  app.quit();
});
