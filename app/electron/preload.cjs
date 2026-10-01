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
  trustFolder: invoke('osc:trustFolder'),
  giveMoreRoom: invoke('osc:giveMoreRoom'),
  restoreCheckpoint: invoke('osc:restoreCheckpoint'),
  rewind: invoke('osc:rewind'),
  createSample: invoke('osc:createSample'),
  answerApproval: invoke('osc:answerApproval'),
  onEvent: listen('osc:event'),

  freeChat: invoke('osc:freeChat'),
  freeChatAbort: invoke('osc:freeChatAbort'),
  onFreeChat: listen('osc:free-chat'),

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

  mediaProcess: invoke('osc:mediaProcess'),

  reconcileRepos: invoke('osc:reconcileRepos'),

  pickFolder: invoke('osc:pickFolder'),
  cloneRepo: invoke('osc:cloneRepo'),
  recentWorkspaces: invoke('osc:recentWorkspaces'),

  daemonInfo: invoke('osc:daemonInfo'),
  daemonStart: invoke('osc:daemonStart'),
  daemonStop: invoke('osc:daemonStop'),
  listDeviceCredentials: invoke('osc:listDeviceCredentials'),
  revokeDeviceCredential: invoke('osc:revokeDeviceCredential'),
  rotateSharedToken: invoke('osc:rotateSharedToken'),
  launchAtLogin: invoke('osc:launchAtLogin'),
  setLaunchAtLogin: invoke('osc:setLaunchAtLogin'),
  setAppIcon: invoke('osc:setAppIcon'),

  ollamaStatus: invoke('osc:ollamaStatus'),
  ollamaStart: invoke('osc:ollamaStart'),
  ollamaInstall: invoke('osc:ollamaInstall'),
  hardware: invoke('osc:hardware'),

  routinesList: invoke('osc:routinesList'),
  routineCreate: invoke('osc:routineCreate'),
  routineUpdate: invoke('osc:routineUpdate'),
  routineDelete: invoke('osc:routineDelete'),
  routineRun: invoke('osc:routineRun'),
  routineStop: invoke('osc:routineStop'),
  routineNote: invoke('osc:routineNote'),

  currentsProbe: invoke('osc:currentsProbe'),
  hermesNotes: invoke('osc:hermesNotes'),
  hermesNote: invoke('osc:hermesNote'),

  vaultList: invoke('osc:vaultList'),
  vaultStat: invoke('osc:vaultStat'),
  vaultRead: invoke('osc:vaultRead'),
  vaultWrite: invoke('osc:vaultWrite'),
  vaultRemove: invoke('osc:vaultRemove'),
  vaultWatch: invoke('osc:vaultWatch'),
  vaultIndexLoad: invoke('osc:vaultIndexLoad'),
  vaultIndexSave: invoke('osc:vaultIndexSave'),
  vaultReadConfig: invoke('osc:vaultReadConfig'),
  vaultWriteConfig: invoke('osc:vaultWriteConfig'),
  vaultPrivacy: invoke('osc:vaultPrivacy'),
  vaultRename: invoke('osc:vaultRename'),
  vaultFolders: invoke('osc:vaultFolders'),
  vaultFolderCreate: invoke('osc:vaultFolderCreate'),
  vaultFolderRename: invoke('osc:vaultFolderRename'),
  vaultTrash: invoke('osc:vaultTrash'),
  vaultTrashList: invoke('osc:vaultTrashList'),
  vaultTrashRestore: invoke('osc:vaultTrashRestore'),
  vaultTrashEmpty: invoke('osc:vaultTrashEmpty'),
  vaultAttachments: invoke('osc:vaultAttachments'),
  vaultReadBytes: invoke('osc:vaultReadBytes'),
  vaultOpenAttachment: invoke('osc:vaultOpenAttachment'),
  clearHandoffs: invoke('osc:clearHandoffs'),
  onVaultChanged: listen('osc:vault-changed'),
  vaultDirInfo: invoke('osc:vaultDirInfo'),
  vaultChooseDir: invoke('osc:vaultChooseDir'),
  vaultRefineDir: invoke('osc:vaultRefineDir'),
  vaultBringPrevious: invoke('osc:vaultBringPrevious'),
  vaultReveal: invoke('osc:vaultReveal'),
  vaultOpenObsidian: invoke('osc:vaultOpenObsidian'),
  vaultTeamExport: invoke('osc:vaultTeamExport'),
  openPrivacySettings: invoke('osc:openPrivacySettings'),

  secureHas: invoke('osc:secureHas'),
  secureGet: invoke('osc:secureGet'),
  secureSet: invoke('osc:secureSet'),
  secureDelete: invoke('osc:secureDelete'),

  httpFetch: invoke('osc:httpFetch'),
  chatStream: invoke('osc:chatStream'),
  chatStreamAbort: invoke('osc:chatStreamAbort'),
  onChatStream: listen('osc:chat-stream'),

  gdriveOAuthListen: invoke('osc:gdriveOAuthListen'),
  gdriveOAuthWait: invoke('osc:gdriveOAuthWait'),
  gdriveOAuthCancel: invoke('osc:gdriveOAuthCancel'),

  onDeepLink: listen('osc:deep-link'),

  onUpdateStatus: listen('osc:update-status'),
  installUpdate: invoke('osc:installUpdate'),

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
