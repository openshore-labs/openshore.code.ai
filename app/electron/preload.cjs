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
  setMode: invoke('osc:setMode'),
  setInstructions: invoke('osc:setInstructions'),
  compact: invoke('osc:compact'),
  listFiles: invoke('osc:listFiles'),
  answerApproval: invoke('osc:answerApproval'),
  onEvent: listen('osc:event'),

  runCommand: invoke('osc:runCommand'),
  sendCommandStdin: invoke('osc:sendCommandStdin'),
  killCommand: invoke('osc:killCommand'),

  openTerminal: invoke('osc:openTerminal'),
  terminalSubscribe: invoke('osc:terminalSubscribe'),
  terminalUnsubscribe: invoke('osc:terminalUnsubscribe'),
  terminalStdin: invoke('osc:terminalStdin'),
  terminalResize: invoke('osc:terminalResize'),
  terminalKill: invoke('osc:terminalKill'),
  onTerminalData: listen('osc:terminal-data'),

  status: invoke('osc:status'),
  catalog: invoke('osc:catalog'),
  stackHealth: invoke('osc:stackHealth'),
  installModel: invoke('osc:installModel'),
  installOllamaRef: invoke('osc:installOllamaRef'),
  onInstallProgress: listen('osc:install-progress'),
  setOrchestrator: invoke('osc:setOrchestrator'),
  enableSpecialist: invoke('osc:enableSpecialist'),
  disableSpecialist: invoke('osc:disableSpecialist'),

  setAnthropicKey: invoke('osc:setAnthropicKey'),
  setOpenAIKey: invoke('osc:setOpenAIKey'),
  setGithubToken: invoke('osc:setGithubToken'),
  disconnect: invoke('osc:disconnect'),

  repoReadDir: invoke('osc:repoReadDir'),
  repoReadFile: invoke('osc:repoReadFile'),

  pickFolder: invoke('osc:pickFolder'),
  cloneRepo: invoke('osc:cloneRepo'),
  recentWorkspaces: invoke('osc:recentWorkspaces'),

  daemonInfo: invoke('osc:daemonInfo'),
  daemonStart: invoke('osc:daemonStart'),
  daemonStop: invoke('osc:daemonStop'),
  listDeviceCredentials: invoke('osc:listDeviceCredentials'),
  revokeDeviceCredential: invoke('osc:revokeDeviceCredential'),

  vaultList: invoke('osc:vaultList'),
  vaultRead: invoke('osc:vaultRead'),
  vaultWrite: invoke('osc:vaultWrite'),
  vaultRemove: invoke('osc:vaultRemove'),

  secureGet: invoke('osc:secureGet'),
  secureSet: invoke('osc:secureSet'),
  secureDelete: invoke('osc:secureDelete'),

  httpFetch: invoke('osc:httpFetch'),

  gdriveOAuthListen: invoke('osc:gdriveOAuthListen'),
  gdriveOAuthWait: invoke('osc:gdriveOAuthWait'),
  gdriveOAuthCancel: invoke('osc:gdriveOAuthCancel'),

  onDeepLink: listen('osc:deep-link'),

  embeddedOpen: invoke('osc:embeddedOpen'),
  embeddedBounds: invoke('osc:embeddedBounds'),
  embeddedVisible: invoke('osc:embeddedVisible'),
  embeddedBack: invoke('osc:embeddedBack'),
  embeddedReload: invoke('osc:embeddedReload'),
  embeddedHome: invoke('osc:embeddedHome'),
  embeddedSignOut: invoke('osc:embeddedSignOut'),
  embeddedClose: invoke('osc:embeddedClose'),
  onEmbeddedState: listen('osc:embedded-state'),
});
