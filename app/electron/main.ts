// The Electron main process: one window, one EngineHost, and an IPC surface
// that mirrors OscodeBridge method for method. The renderer stays Node-free;
// everything engine-shaped happens here.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineHost } from './engineHost.js';

const here = dirname(fileURLToPath(import.meta.url));

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
