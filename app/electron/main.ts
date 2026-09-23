// The Electron main process: one window, one EngineHost, and an IPC surface
// that mirrors OscodeBridge method for method. The renderer stays Node-free;
// everything engine-shaped happens here.
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerSaveBlocker,
  safeStorage,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from 'electron';
import { dirname, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { Jail } from 'os-code/dist/src/core/security/jail.js';
import {
  parseCurrentsHandles,
  parseHarnessCurrentsHandle,
} from 'os-code/dist/src/currents/model.js';
import { loadConfig } from 'os-code/dist/src/config/load.js';
import { lookup } from 'node:dns/promises';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { isIP } from 'node:net';
// electron-updater ships CJS; Node's ESM/CJS interop cannot statically prove
// `autoUpdater` as a named export from it, and a packaged app (real ESM, not
// bundled) throws a SyntaxError on this at startup before anything else runs
// (caught by the Linux package-smoke test, run 35178322792). The default
// import always works, CJS or ESM.
import electronUpdaterPkg from 'electron-updater';
const { autoUpdater } = electronUpdaterPkg;
import { EngineHost } from './engineHost.js';
import { versionIsNewer } from './updateVersion.js';
import { EmbeddedWeb, type EmbeddedBounds } from './embeddedWeb.js';
import { processVideoDesktop, type DesktopMediaOptions } from './media.js';
import {
  HIDDEN_LAUNCH_FLAG,
  autostartEntry,
  autostartEntryPath,
  closeAction,
  isHiddenLaunch,
  launchAtLoginSupport,
  powerBlockerNext,
  trayMenuTemplate,
} from './lifecycle.js';

const here = dirname(fileURLToPath(import.meta.url));

// The only page the shell is ever allowed to navigate to: the app's own bundled
// entry point. Anything else (a stray file:, an http link) is denied below.
const appEntry = pathToFileURL(join(here, '..', 'dist', 'index.html'));

// ------------------------------------------------------------------ IPC guard
// The renderer is untrusted input (UI-6). Every handler is registered through
// `guarded`, which refuses any call whose sender is not the app's own bundled
// page, and every argument is checked by the small validators below before it
// reaches the engine. Defense in depth over the CSP and the pinned navigation:
// a future XSS in rendered markdown must not turn into code execution here.
function trustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  return typeof url === 'string' && url.split('#')[0] === appEntry.href;
}

function guarded<A extends unknown[], R>(channel: string, fn: (...args: A) => R): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!trustedSender(event)) throw new Error(`blocked: untrusted sender on ${channel}`);
    return fn(...(args as A));
  });
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new Error(`blocked: ${name} must be a string`);
  return v;
}
function optStr(v: unknown, name: string): string | undefined {
  return v === undefined || v === null ? undefined : str(v, name);
}
function num(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`blocked: ${name} must be a number`);
  }
  return v;
}
function bool(v: unknown): boolean {
  return v === true;
}
function optBool(v: unknown, name: string): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw new Error(`blocked: ${name} must be a boolean`);
  return v;
}
function obj(v: unknown, name: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`blocked: ${name} must be an object`);
  }
  return v as Record<string, unknown>;
}
function strList(v: unknown, name: string): string[] {
  if (!Array.isArray(v)) throw new Error(`blocked: ${name} must be a list`);
  return v.map((x, i) => str(x, `${name}[${i}]`));
}
/** An existing directory, or undefined when none was given. */
function dir(v: unknown, name: string): string | undefined {
  const s = optStr(v, name);
  if (s === undefined) return undefined;
  if (!existsSync(s) || !statSync(s).isDirectory()) {
    throw new Error(`blocked: ${name} is not a directory`);
  }
  return s;
}

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

/** The renderer's fetch request, field by field. */
function httpFetchReq(v: unknown): HttpFetchReq {
  const o = obj(v, 'request');
  const headers: Record<string, string> = {};
  if (o.headers !== undefined) {
    for (const [k, val] of Object.entries(obj(o.headers, 'headers'))) {
      headers[k] = str(val, `headers.${k}`);
    }
  }
  return {
    url: str(o.url, 'url'),
    method: optStr(o.method, 'method'),
    headers,
    body: optStr(o.body, 'body'),
  };
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

guarded('osc:gdriveOAuthListen', () => {
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

guarded('osc:gdriveOAuthWait', () => {
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

guarded('osc:gdriveOAuthCancel', () => {
  closeGdriveServer();
});

let win: BrowserWindow | undefined;

const host = new EngineHost(
  (payload) => win?.webContents.send('osc:event', payload),
  (payload) => win?.webContents.send('osc:install-progress', payload),
  (payload) => win?.webContents.send('osc:terminal-data', payload),
);

// ------------------------------------------------------------ hub lifecycle
// The hub (the daemon) starts with the app and lives in the tray: closing the
// window hides it, Quit really quits. The rules are pure helpers in
// lifecycle.ts; this is the wiring. `quitting` flips on Quit (tray or app
// menu) so the window's close handler lets it go; `hubPaused` is the person's
// own Pause, which the re-bind poll respects.
let tray: Tray | undefined;
let quitting = false;
let hubPaused = false;
let disposed = false;

function trayIconPath(): string {
  return join(here, '..', 'build', 'icon.png');
}

function showWindow(): void {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function refreshTrayMenu(): void {
  if (!tray) return;
  const template = trayMenuTemplate({ hubRunning: host.daemonRunning() });
  tray.setContextMenu(
    Menu.buildFromTemplate(
      template.map((item) => ({ label: item.label, click: () => void onTrayAction(item.id) })),
    ),
  );
}

async function onTrayAction(id: 'open' | 'hub' | 'quit'): Promise<void> {
  if (id === 'open') {
    showWindow();
  } else if (id === 'hub') {
    if (host.daemonRunning()) {
      await host.daemonStop();
      hubPaused = true;
    } else {
      hubPaused = false;
      const result = await host.daemonStart();
      if ('error' in result) console.error(hubStartError(result.error));
    }
    refreshTrayMenu();
  } else {
    quitting = true;
    app.quit();
  }
}

/** A tray needs a status area; a desktop without one (some Wayland sessions,
 *  a headless smoke run) gets the old behavior: closing the window quits. */
function createTray(): boolean {
  try {
    const image = nativeImage.createFromPath(trayIconPath());
    if (image.isEmpty()) return false;
    tray = new Tray(image.resize({ width: 22, height: 22 }));
    tray.setToolTip('OpenShore');
    tray.on('click', () => showWindow());
    refreshTrayMenu();
    return true;
  } catch (err) {
    console.error(`OpenShore: no tray on this desktop (${(err as Error).message}).`);
    tray = undefined;
    return false;
  }
}

function hubStartError(message: string): string {
  return `OpenShore hub did not start: ${message}\nFor the whole picture, with one fix per line: npx osc doctor`;
}

// The power-save blocker holds only while a run is active; the re-bind poll
// moves a loopback hub onto the tailnet once Tailscale comes up.
let blockerId: number | undefined;

function startLifecyclePolls(): void {
  const power = setInterval(() => {
    const next = powerBlockerNext({
      active: blockerId !== undefined,
      busyRuns: host.activeRuns(),
    });
    if (next === 'start') blockerId = powerSaveBlocker.start('prevent-app-suspension');
    else if (next === 'stop' && blockerId !== undefined) {
      powerSaveBlocker.stop(blockerId);
      blockerId = undefined;
    }
  }, 5000);
  power.unref();
  const rebind = setInterval(() => {
    if (hubPaused) return;
    void host.daemonRebind().then((moved) => {
      if (moved) refreshTrayMenu();
    });
  }, 15_000);
  rebind.unref();
}

// Launch at login, opt-in from the Pair screen. Electron's login item covers
// macOS and Windows; Linux gets an XDG autostart entry that starts the app
// hidden (to the tray). A source run has no stable executable to register.
function launchExecutable(): string | undefined {
  if (process.env.APPIMAGE) return process.env.APPIMAGE;
  return app.isPackaged ? process.execPath : undefined;
}

function launchAtLogin(): { on: boolean; supported: boolean } {
  const supported = launchExecutable() !== undefined;
  if (launchAtLoginSupport(process.platform) === 'native') {
    return { on: app.getLoginItemSettings().openAtLogin, supported };
  }
  return { on: existsSync(autostartEntryPath(homedir())), supported };
}

function setLaunchAtLogin(on: boolean): { on: boolean; detail?: string } {
  const execPath = launchExecutable();
  if (!execPath) {
    return {
      on: false,
      detail: 'Start with your computer needs the installed app, not a run from source.',
    };
  }
  if (launchAtLoginSupport(process.platform) === 'native') {
    app.setLoginItemSettings({ openAtLogin: on, openAsHidden: on, args: [HIDDEN_LAUNCH_FLAG] });
    return { on: app.getLoginItemSettings().openAtLogin };
  }
  const path = autostartEntryPath(homedir());
  try {
    if (on) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, autostartEntry({ execPath }));
    } else {
      rmSync(path, { force: true });
    }
    return { on };
  } catch (err) {
    return { on: existsSync(path), detail: `Could not write ${path}: ${(err as Error).message}` };
  }
}

function shutdown(): void {
  if (disposed) return;
  disposed = true;
  embedded.close();
  closeGdriveServer();
  host.disposeAll();
  if (blockerId !== undefined) powerSaveBlocker.stop(blockerId);
  tray?.destroy();
  tray = undefined;
  app.quit();
}

// A contained third-party site (Codemagic today) hosted inside the window,
// fenced to its own hosts. The renderer names the site; it never picks a URL.
const embedded = new EmbeddedWeb(
  () => win,
  (state) => win?.webContents.send('osc:embedded-state', state),
);

function bounds(v: unknown): EmbeddedBounds {
  const o = obj(v, 'bounds');
  return {
    x: num(o.x, 'bounds.x'),
    y: num(o.y, 'bounds.y'),
    width: num(o.width, 'bounds.width'),
    height: num(o.height, 'bounds.height'),
  };
}

guarded('osc:embeddedOpen', (name: unknown, b: unknown) =>
  embedded.open(str(name, 'name'), bounds(b)),
);
guarded('osc:embeddedBounds', (b: unknown) => embedded.setBounds(bounds(b)));
guarded('osc:embeddedVisible', (visible: unknown) => embedded.setVisible(bool(visible)));
guarded('osc:embeddedBack', () => embedded.back());
guarded('osc:embeddedReload', () => embedded.reload());
guarded('osc:embeddedHome', () => embedded.home());
guarded('osc:embeddedSignOut', () => embedded.signOut());
guarded('osc:embeddedClose', () => embedded.close());

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

  // A found-but-not-yet-shown update (the check can resolve before the window
  // finishes its first load, or the tray keeps the old window instance around
  // across hide/show) reaches the renderer here instead of only at discovery
  // time, so a fresh page is never out of sync with what main already knows.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('osc:update-status', pendingUpdate);
  });

  // OSC_SMOKE=1 makes a headless CI run prove the page and bridge came up.
  // The engine half of the proof is logged from whenReady (below); once both
  // are in, the run quits by itself so scripts/package-smoke.mjs can judge it.
  if (process.env.OSC_SMOKE) {
    win.webContents.on('did-finish-load', () => {
      void win?.webContents
        .executeJavaScript('typeof window.oscode')
        .then((kind) => {
          console.log(`[smoke] page loaded; window.oscode is ${kind}`);
          smokeStep();
        })
        .catch((err) => console.error('[smoke] bridge probe failed', err));
    });
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer] ${(event as unknown as { message: string }).message}`);
    });
  }

  // Close hides to the tray while there is one; Quit sets `quitting` first.
  win.on('close', (event) => {
    if (closeAction({ quitting, trayReady: Boolean(tray) }) === 'hide') {
      event.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => {
    win = undefined;
  });

  // A deep link (oscode://auth-callback or oscode://checkout-success) may arrive
  // before the renderer has subscribed, on a cold start launched by the link
  // itself. Flush any buffered one once the page is up.
  win.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      win?.webContents.send('osc:deep-link', pendingDeepLink);
      pendingDeepLink = undefined;
    }
  });

  void win.loadFile(join(here, '..', 'dist', 'index.html'));
}

// The smoke run ends itself once the page and the engine both reported in.
let smokeSteps = 0;
function smokeStep(): void {
  smokeSteps++;
  if (smokeSteps < 2) return;
  console.log('[smoke] done');
  setTimeout(() => {
    quitting = true;
    shutdown();
  }, 300);
}

// ------------------------------------------------------ deep links (oscode://)
// Both the Supabase auth callback and the Stripe checkout-return page bounce
// back into the desktop app through the oscode:// scheme. The OS hands us the
// URL via open-url (macOS) or a second-instance argv (Windows/Linux); we
// forward it to the renderer, buffering one that arrives before the window is
// ready. The renderer routes it (see useElectronDeepLink): auth-callback signs
// in, checkout-success re-checks the entitlement.
let pendingDeepLink: string | undefined;

function deliverDeepLink(url: string | undefined): void {
  if (!url || !url.startsWith('oscode://')) return;
  if (win && !win.webContents.isLoading()) win.webContents.send('osc:deep-link', url);
  else pendingDeepLink = url;
}

function deepLinkFromArgv(argv: string[]): string | undefined {
  return argv.find((a) => a.startsWith('oscode://'));
}

// ------------------------------------------------------------------ IPC map
// Keep in lockstep with src/lib/electronBridge.ts and electron/preload.cjs.
// Every argument arrives as `unknown` and is validated before use.

function sessionOpts(v: unknown) {
  if (v === undefined || v === null) return undefined;
  const o = obj(v, 'opts');
  let codemagicTarget:
    { appId: string; workflowId: string; branch: string; platform?: string } | undefined;
  if (o.codemagicTarget !== undefined && o.codemagicTarget !== null) {
    const t = obj(o.codemagicTarget, 'codemagicTarget');
    codemagicTarget = {
      appId: str(t.appId, 'codemagicTarget.appId'),
      workflowId: str(t.workflowId, 'codemagicTarget.workflowId'),
      branch: str(t.branch, 'codemagicTarget.branch'),
      platform: optStr(t.platform, 'codemagicTarget.platform'),
    };
  }
  return {
    instructions: optStr(o.instructions, 'instructions'),
    // The permission mode is validated by the engine's own schema on entry.
    permissionMode: optStr(o.permissionMode, 'permissionMode') as never,
    projectName: optStr(o.projectName, 'projectName'),
    projectSecrets: optStr(o.projectSecrets, 'projectSecrets'),
    humanize: optBool(o.humanize, 'humanize'),
    codemagicToken: optStr(o.codemagicToken, 'codemagicToken'),
    codemagicTarget,
    // The Agentic Current's handle: the shared parser drops anything malformed,
    // so a bad shape leaves the tool out rather than failing the session.
    currents: parseCurrentsHandles(o.currents),
    // The Harness Current's handle (Jev), parsed the same way.
    harnessCurrents: parseHarnessCurrentsHandle(o.harnessCurrents),
  };
}

guarded('osc:createSession', (cwd: unknown, opts: unknown) =>
  host.createSession(dir(cwd, 'cwd'), sessionOpts(opts)),
);
guarded('osc:setMode', (sessionId: unknown, mode: unknown) =>
  host.setMode(str(sessionId, 'sessionId'), str(mode, 'mode') as never),
);
guarded('osc:setInstructions', (sessionId: unknown, text: unknown) =>
  host.setInstructions(str(sessionId, 'sessionId'), optStr(text, 'text')),
);
guarded('osc:compact', (sessionId: unknown, focus: unknown) =>
  host.compact(str(sessionId, 'sessionId'), optStr(focus, 'focus')),
);
guarded('osc:listFiles', (sessionId: unknown, query: unknown) =>
  host.listFiles(str(sessionId, 'sessionId'), str(query, 'query')),
);
guarded('osc:resumeSession', (id: unknown) => host.resumeSession(str(id, 'id')));
guarded('osc:listSessions', () => host.listStoredSessions());
guarded('osc:send', (sessionId: unknown, text: unknown) =>
  host.send(str(sessionId, 'sessionId'), str(text, 'text')),
);
guarded('osc:abort', (sessionId: unknown) => host.abort(str(sessionId, 'sessionId')));
guarded('osc:answerApproval', (sessionId: unknown, approvalId: unknown, answer: unknown) => {
  const a = obj(answer, 'answer');
  return host.answerApproval(str(sessionId, 'sessionId'), str(approvalId, 'approvalId'), {
    approve: bool(a.approve),
    alwaysThisSession: optBool(a.alwaysThisSession, 'alwaysThisSession'),
    alwaysInProject: optBool(a.alwaysInProject, 'alwaysInProject'),
    reason: optStr(a.reason, 'reason'),
  });
});

// Chat-to-terminal lane. runCommand returns the runId the renderer drives with
// stdin/kill; command output arrives as command-* events on osc:event.
guarded('osc:runCommand', (sessionId: unknown, command: unknown) =>
  host.runCommand(str(sessionId, 'sessionId'), str(command, 'command')),
);
guarded('osc:sendCommandStdin', (sessionId: unknown, runId: unknown, data: unknown) =>
  host.sendCommandStdin(str(sessionId, 'sessionId'), str(runId, 'runId'), str(data, 'data')),
);
guarded('osc:killCommand', (sessionId: unknown, runId: unknown) =>
  host.killCommand(str(sessionId, 'sessionId'), str(runId, 'runId')),
);

// Interactive terminal (Phase 2). Output streams as osc:terminal-data events;
// stdin/resize/kill drive the live PTY.
guarded('osc:openTerminal', (sessionId: unknown, cols: unknown, rows: unknown) =>
  host.openTerminal(str(sessionId, 'sessionId'), num(cols, 'cols'), num(rows, 'rows')),
);
guarded('osc:terminalSubscribe', (termId: unknown, sinceOffset: unknown) =>
  host.terminalSubscribe(str(termId, 'termId'), num(sinceOffset, 'sinceOffset')),
);
guarded('osc:terminalUnsubscribe', (termId: unknown) =>
  host.terminalUnsubscribe(str(termId, 'termId')),
);
guarded('osc:terminalStdin', (termId: unknown, data: unknown) =>
  host.terminalStdin(str(termId, 'termId'), str(data, 'data')),
);
guarded('osc:terminalResize', (termId: unknown, cols: unknown, rows: unknown) =>
  host.terminalResize(str(termId, 'termId'), num(cols, 'cols'), num(rows, 'rows')),
);
guarded('osc:terminalKill', (termId: unknown) => host.terminalKill(str(termId, 'termId')));

guarded('osc:status', () => host.status());
guarded('osc:catalog', () => host.catalog());
guarded('osc:stackHealth', (range: unknown) =>
  host.stackHealth(optStr(range, 'range') as Parameters<typeof host.stackHealth>[0]),
);
guarded('osc:installModel', (modelId: unknown) => host.installModel(str(modelId, 'modelId')));
guarded('osc:installOllamaRef', (ref: unknown) => host.installOllamaRef(str(ref, 'ref')));
guarded('osc:setOrchestrator', (model: unknown) => host.setOrchestrator(str(model, 'model')));
guarded('osc:enableSpecialist', (role: unknown, model: unknown) =>
  host.enableSpecialist(str(role, 'role'), str(model, 'model')),
);
guarded('osc:disableSpecialist', (role: unknown) => host.disableSpecialist(str(role, 'role')));

guarded('osc:setAnthropicKey', (key: unknown, workspaceId: unknown) =>
  host.setAnthropicKey(str(key, 'key'), optStr(workspaceId, 'workspaceId')),
);
guarded('osc:setOpenAIKey', (key: unknown) => host.setOpenAIKey(str(key, 'key')));
guarded('osc:setGithubToken', (token: unknown) => host.setGithubToken(str(token, 'token')));
guarded('osc:disconnect', (connector: unknown) => {
  const c = str(connector, 'connector');
  if (c !== 'anthropic' && c !== 'openai' && c !== 'github') {
    throw new Error('blocked: unknown connector');
  }
  return host.disconnect(c);
});

guarded('osc:pickFolder', async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Choose a project folder',
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});
guarded('osc:cloneRepo', (url: unknown) => host.cloneRepo(str(url, 'url')));
guarded('osc:recentWorkspaces', () => host.recentWorkspaces());
guarded('osc:reconcileRepos', (roots: unknown) =>
  host.reconcileRepos(Array.isArray(roots) ? strList(roots, 'roots') : []),
);

// Crew routines. Objects pass through as-is: the host validates every field
// through the shared routine model before anything reaches the scheduler.
guarded('osc:routinesList', () => host.routinesList());
guarded('osc:routineCreate', (input: unknown) => host.routineCreate(input));
guarded('osc:routineUpdate', (id: unknown, patch: unknown) =>
  host.routineUpdate(str(id, 'id'), patch),
);
guarded('osc:routineDelete', (id: unknown) => host.routineDelete(str(id, 'id')));
guarded('osc:routineRun', (id: unknown) => host.routineRun(str(id, 'id')));
guarded('osc:routineStop', (id: unknown) => host.routineStop(str(id, 'id')));
guarded('osc:routineNote', (runId: unknown) => host.routineNote(str(runId, 'runId')));

// Agentic Currents: what this computer can host, and a Hermes home's notes.
// Read-only; the engine jails the path to the Hermes home and serves markdown
// only, so a bad path answers null rather than escaping.
guarded('osc:currentsProbe', () => host.currentsProbe());
guarded('osc:hermesNotes', () => host.hermesNotes());
guarded('osc:hermesNote', (path: unknown) => host.hermesNote(str(path, 'path')));

guarded('osc:daemonInfo', () => host.daemonInfo());
guarded('osc:daemonStart', async () => {
  hubPaused = false;
  const result = await host.daemonStart();
  refreshTrayMenu();
  return result;
});
guarded('osc:daemonStop', async () => {
  hubPaused = true;
  await host.daemonStop();
  refreshTrayMenu();
});
guarded('osc:listDeviceCredentials', () => host.listDeviceCredentials());
guarded('osc:revokeDeviceCredential', (id: unknown) => host.revokeDeviceCredential(str(id, 'id')));
guarded('osc:launchAtLogin', () => launchAtLogin());
guarded('osc:setLaunchAtLogin', (on: unknown) => setLaunchAtLogin(bool(on)));

// Ollama from inside the app, and the machine in numbers. A download-page
// plan opens the page here (the renderer never picks a URL); the command is
// returned in every case so the renderer shows it as a copy block.
guarded('osc:ollamaStatus', () => host.ollamaStatus());
guarded('osc:ollamaStart', () => host.ollamaStart());
guarded('osc:ollamaInstall', async () => {
  const plan = await host.ollamaInstall();
  if (plan.mode === 'download' && plan.downloadUrl) void shell.openExternal(plan.downloadUrl);
  return plan;
});
guarded('osc:hardware', () => host.hardware());

// On-disk vault: the SAME markdown folder the agent's daemon tools write
// (~/OSCode/Vault, or config vault.dir), so the app's Vault and the agent share
// one folder. Every note path is jailed to that directory (symlink-safe), so a
// path from the renderer can never touch a file outside the vault.
function vaultDir(): string {
  try {
    return loadConfig().config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault');
  } catch {
    return join(homedir(), 'OSCode', 'Vault');
  }
}
function vaultJail(): Jail {
  const dir = vaultDir();
  mkdirSync(dir, { recursive: true });
  return new Jail(dir);
}

guarded('osc:vaultList', () => {
  const root = vaultDir();
  if (!existsSync(root)) return [];
  const out: Array<{ path: string; updatedAt: string; size: number }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const st = statSync(abs);
        out.push({
          path: relative(root, abs).split(sep).join('/'),
          updatedAt: st.mtime.toISOString(),
          size: st.size,
        });
      }
    }
  };
  walk(root);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
});
guarded('osc:vaultRead', (p: unknown) => {
  const path = str(p, 'path');
  const abs = vaultJail().resolve(path);
  if (!existsSync(abs)) return null;
  return { path, text: readFileSync(abs, 'utf8'), updatedAt: statSync(abs).mtime.toISOString() };
});
guarded('osc:vaultWrite', (p: unknown, t: unknown) => {
  const path = str(p, 'path');
  const text = str(t, 'text');
  const abs = vaultJail().resolve(path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  return { path, text, updatedAt: statSync(abs).mtime.toISOString() };
});
guarded('osc:vaultRemove', (p: unknown) => {
  const abs = vaultJail().resolve(str(p, 'path'));
  if (existsSync(abs)) rmSync(abs);
});

// Read-only access to a repo working tree, for the project-memory viewer. Two
// layers of containment: every path resolves through a Jail rooted at the repo
// (so a relative path can never escape it, symlinks included), AND the read is
// confined to the project-memory folders themselves ("OpenShore Project <name>
// MDs/") and to .md files. So even a compromised renderer can only ever read
// markdown notes in those folders, never arbitrary files under the root. Read
// only; there is no repo-write bridge. `null` means "not there / not allowed".
// The folder shape mirrors app/src/lib/projectMemory.ts (kept simple on purpose,
// this is a security guard, not the source of truth).
const MEM_FOLDER_PREFIX = 'OpenShore Project ';
const MEM_FOLDER_SUFFIX = ' MDs';
const MAX_MEMORY_FILE_BYTES = 4 * 1024 * 1024;
function isMemoryFolderSegment(seg: string): boolean {
  if (seg.includes('/') || seg.includes('\\')) return false;
  if (!seg.startsWith(MEM_FOLDER_PREFIX) || !seg.endsWith(MEM_FOLDER_SUFFIX)) return false;
  const inner = seg.slice(MEM_FOLDER_PREFIX.length, seg.length - MEM_FOLDER_SUFFIX.length);
  return inner.length > 0 && !/^\.+$/.test(inner);
}
guarded('osc:repoReadDir', (root: unknown, subdir: unknown): string[] | null => {
  try {
    // Only a single memory folder may be listed, never an arbitrary directory.
    if (typeof root !== 'string' || !root || typeof subdir !== 'string') return null;
    if (!isMemoryFolderSegment(subdir)) return null;
    if (!existsSync(root) || !statSync(root).isDirectory()) return null;
    const abs = new Jail(root).resolve(subdir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return null;
    return readdirSync(abs, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return null;
  }
});
// Video framing over FFmpeg. The renderer hands the picked file's real path and
// the plan; the main process compresses (if large) and samples frames, and
// returns downscaled JPEG base64 stills. Every numeric field is validated, and
// the path must be an existing file (checked in processVideoDesktop) before any
// binary runs. Never sends the video anywhere; it is read locally and framed.
guarded('osc:mediaProcess', (options: unknown): Promise<unknown> => {
  if (!options || typeof options !== 'object') {
    throw new Error('blocked: mediaProcess needs options');
  }
  const o = options as Record<string, unknown>;
  const opts: DesktopMediaOptions = {
    path: str(o.path, 'path'),
    maxFrames: num(o.maxFrames, 'maxFrames'),
    maxDimension: num(o.maxDimension, 'maxDimension'),
    frameQuality: num(o.frameQuality, 'frameQuality'),
    compressThresholdBytes: num(o.compressThresholdBytes, 'compressThresholdBytes'),
    targetMinBytes: num(o.targetMinBytes, 'targetMinBytes'),
    targetMaxBytes: num(o.targetMaxBytes, 'targetMaxBytes'),
    targetBytes: num(o.targetBytes, 'targetBytes'),
  };
  return processVideoDesktop(opts);
});

guarded('osc:repoReadFile', (root: unknown, relPath: unknown): string | null => {
  try {
    // Only an .md file directly inside a memory folder may be read.
    if (typeof root !== 'string' || !root || typeof relPath !== 'string') return null;
    const parts = relPath.split('/');
    if (parts.length !== 2 || !isMemoryFolderSegment(parts[0]!) || !/\.md$/i.test(parts[1]!)) {
      return null;
    }
    if (!existsSync(root)) return null;
    const abs = new Jail(root).resolve(relPath);
    if (!existsSync(abs) || !statSync(abs).isFile()) return null;
    if (statSync(abs).size > MAX_MEMORY_FILE_BYTES) return null;
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
});

// OS-encrypted secret store (used for the app's data-encryption key). secureHas
// tells "no entry" from "an entry this launch cannot decrypt" (P0-3): secureGet
// answers null for both, and the renderer must never mint a new key over the
// second case, because every sealed byte on the device dies with the old one.
guarded('osc:secureHas', (k: unknown): boolean => Boolean(readSecrets()[str(k, 'key')]));
guarded('osc:secureGet', (k: unknown): string | null => {
  const sealed = readSecrets()[str(k, 'key')];
  if (!sealed) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(sealed, 'base64'));
  } catch {
    return null;
  }
});
guarded('osc:secureSet', (k: unknown, v: unknown): boolean => {
  const key = str(k, 'key');
  const value = str(v, 'value');
  if (!safeStorage.isEncryptionAvailable()) return false;
  const all = readSecrets();
  all[key] = safeStorage.encryptString(value).toString('base64');
  writeSecrets(all);
  return true;
});
guarded('osc:secureDelete', (k: unknown): void => {
  const all = readSecrets();
  delete all[str(k, 'key')];
  writeSecrets(all);
});

guarded('osc:httpFetch', async (req: unknown) => {
  try {
    return await handleHttpFetch(httpFetchReq(req));
  } catch (err) {
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
  }
});

// ------------------------------------------------------------- auto-update
// electron-updater against the same GitHub Releases release.yml already
// publishes to (app/package.json's build.publish carries the feed, so no
// setFeedURL call is needed here). Windows and Linux get the full silent
// flow: download in the background, then the renderer's banner offers a
// restart to install. macOS ships unsigned outside the App Store by design
// (codemagic.yaml, "no Apple certs needed"), and electron-updater's in-place
// install relies on Squirrel.Mac matching the running build's code signature
// against the new one, which an unsigned build never holds consistently
// (confirmed against electron-updater's own docs: unsigned apps cannot use
// its auto-update path on macOS). So macOS gets a lighter check: compare the
// running version against the latest GitHub release tag, and the banner's
// click opens that release in the browser instead of reinstalling in place.
const UPDATE_REPO = 'openshore-labs/openshore.code.ai';
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let pendingUpdate: { version: string; mode: 'install' | 'download' } | undefined;

function sendUpdateStatus(update: typeof pendingUpdate): void {
  pendingUpdate = update;
  win?.webContents.send('osc:update-status', update);
}

async function checkMacUpdate(): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return;
    const release = (await res.json()) as { tag_name?: string };
    const latest = release.tag_name?.replace(/^v/, '');
    if (latest && versionIsNewer(latest, app.getVersion())) {
      sendUpdateStatus({ version: latest, mode: 'download' });
    }
  } catch (err) {
    console.error('[update] macOS version check failed', err);
  }
}

if (process.platform !== 'darwin') {
  autoUpdater.autoDownload = true;
  // Never install on quit: the renderer's banner is the only trigger, so a
  // person is never surprised by a relaunch they didn't ask for.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({ version: info.version, mode: 'install' });
  });
  autoUpdater.on('error', (err) => {
    console.error('[update] electron-updater error', err);
  });
}

function scheduleUpdateChecks(): void {
  // An unpackaged dev run (`pnpm desktop`) has no app-update.yml and nothing
  // real to compare against; skip rather than log a check that can only fail.
  if (!app.isPackaged) return;
  const check =
    process.platform === 'darwin'
      ? checkMacUpdate
      : async () => {
          try {
            await autoUpdater.checkForUpdates();
          } catch (err) {
            console.error('[update] checkForUpdates failed', err);
          }
        };
  void check();
  setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
}

guarded('osc:installUpdate', async () => {
  if (!pendingUpdate) return;
  if (pendingUpdate.mode === 'download') {
    await shell.openExternal(
      `https://github.com/${UPDATE_REPO}/releases/tag/v${pendingUpdate.version}`,
    );
    return;
  }
  autoUpdater.quitAndInstall();
});

// -------------------------------------------------------------- app lifecycle

// Single-instance: a second launch (including one triggered by an oscode:// link
// on Windows/Linux) forwards its URL to the running instance instead of opening
// a duplicate window. Register oscode:// as this app's protocol so the OS routes
// those links here at all.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAsDefaultProtocolClient('oscode');
  app.on('second-instance', (_e, argv) => {
    deliverDeepLink(deepLinkFromArgv(argv));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // macOS delivers the link as an event rather than argv.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    deliverDeepLink(url);
  });

  void app.whenReady().then(async () => {
    const trayReady = createTray();
    // A login launch (--hidden) starts in the tray alone; without a tray to
    // hide in, the window opens regardless.
    if (!isHiddenLaunch(process.argv) || !trayReady) createWindow();
    // Cold start on Windows/Linux: the link is in this process's own argv.
    deliverDeepLink(deepLinkFromArgv(process.argv));
    app.on('activate', () => showWindow());

    // The hub starts with the app: the tailnet when it is up, else loopback
    // (and it moves to the tailnet on its own once Tailscale appears).
    const started = await host.daemonStart();
    if ('error' in started) console.error(hubStartError(started.error));
    refreshTrayMenu();
    startLifecyclePolls();
    scheduleUpdateChecks();

    if (process.env.OSC_SMOKE) {
      try {
        const status = await host.status();
        console.log(
          `[smoke] engine booted; hub ${host.daemonRunning() ? 'up' : 'down'}; ollama ${status.ollama.up ? 'up' : 'down'}`,
        );
      } catch (err) {
        console.error(`[smoke] engine failed: ${(err as Error).message}`);
      }
      smokeStep();
    }
  });
}

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  // The hub lives in the tray: closing the last window keeps it serving. Only
  // Quit (or a desktop with no tray) takes the process down.
  if (!quitting && tray) return;
  shutdown();
});

app.on('will-quit', () => shutdown());
