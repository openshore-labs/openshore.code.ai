// The Electron main process: one window, one EngineHost, and an IPC surface
// that mirrors OscodeBridge method for method. The renderer stays Node-free;
// everything engine-shaped happens here.
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { EngineHost } from './engineHost.js';

const here = dirname(fileURLToPath(import.meta.url));

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
    const [a, b] = ip.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0) return true; // loopback, private, this-host
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b! >= 16 && b! <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b! >= 64 && b! <= 127) return true; // CGNAT (Tailscale range)
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7)); // v4-mapped
    return false;
  }
  return true; // unresolvable: refuse
}

async function assertPublicHttps(rawUrl: string): Promise<URL> {
  const u = new URL(rawUrl);
  if (u.protocol !== 'https:') throw new Error('blocked: https only');
  if (/(^|\.)(localhost|local)$/i.test(u.hostname)) throw new Error('blocked: local host');
  const { address } = await lookup(u.hostname);
  if (isPrivateAddress(address)) throw new Error('blocked: private address');
  return u;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.length > MAX_HTTP_BYTES) {
      chunks.push(value.slice(0, Math.max(0, MAX_HTTP_BYTES - total)));
      await reader.cancel();
      break;
    }
    total += value.length;
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

interface HttpFetchReq {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

async function handleHttpFetch(req: HttpFetchReq): Promise<{ ok: boolean; status: number; body: string }> {
  const method = req.method === 'POST' ? 'POST' : 'GET';
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (ALLOWED_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }
  let target = req.url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHttps(target);
    const res = await fetch(target, {
      method,
      headers,
      body: method === 'POST' ? req.body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) {
        target = new URL(loc, target).toString();
        continue;
      }
    }
    return { ok: res.ok, status: res.status, body: await readCapped(res) };
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
    title: 'OS Code',
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
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
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
  (_e, sessionId: string, approvalId: string, answer: { approve: boolean; alwaysThisSession?: boolean }) =>
    host.answerApproval(sessionId, approvalId, answer),
);

ipcMain.handle('osc:status', () => host.status());
ipcMain.handle('osc:catalog', () => host.catalog());
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
  host.disposeAll();
  app.quit();
});
