// The preload: the only doorway between the renderer and the main process.
// Plain CommonJS so it runs sandboxed. Exposes window.oscode, shaped exactly
// like OscodeBridge in src/lib/electronBridge.ts.
const { contextBridge, ipcRenderer } = require('electron');

const invoke =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(channel, ...args);

const listen = (channel) => (cb) => {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('oscode', {
  platform: 'electron',

  createSession: invoke('osc:createSession'),
  resumeSession: invoke('osc:resumeSession'),
  listSessions: invoke('osc:listSessions'),
  send: invoke('osc:send'),
  abort: invoke('osc:abort'),
  answerApproval: invoke('osc:answerApproval'),
  onEvent: listen('osc:event'),

  status: invoke('osc:status'),
  catalog: invoke('osc:catalog'),
  installModel: invoke('osc:installModel'),
  onInstallProgress: listen('osc:install-progress'),
  setOrchestrator: invoke('osc:setOrchestrator'),
  enableSpecialist: invoke('osc:enableSpecialist'),
  disableSpecialist: invoke('osc:disableSpecialist'),

  setAnthropicKey: invoke('osc:setAnthropicKey'),
  setOpenAIKey: invoke('osc:setOpenAIKey'),
  setGithubToken: invoke('osc:setGithubToken'),
  disconnect: invoke('osc:disconnect'),

  pickFolder: invoke('osc:pickFolder'),
  cloneRepo: invoke('osc:cloneRepo'),
  recentWorkspaces: invoke('osc:recentWorkspaces'),

  daemonInfo: invoke('osc:daemonInfo'),
  daemonStart: invoke('osc:daemonStart'),
  daemonStop: invoke('osc:daemonStop'),

  secureGet: invoke('osc:secureGet'),
  secureSet: invoke('osc:secureSet'),
  secureDelete: invoke('osc:secureDelete'),

  httpFetch: invoke('osc:httpFetch'),
});
