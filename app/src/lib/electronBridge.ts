// The typed surface Electron's preload exposes as window.oscode. The main
// process implements every method against the engine; the renderer never
// touches Node directly. Keep this file in lockstep with electron/main.ts.
import type {
  ApprovalAnswer,
  AttachmentMeta,
  BytesRead,
  Catalog,
  ConfigRead,
  CurrentsHandles,
  CurrentsHostProbe,
  DriverEvent,
  FreeChatEvent,
  HarnessCurrentsHandle,
  HermesNote,
  HermesNoteMeta,
  PermissionMode,
  PullResult,
  ReconcileResult,
  RoutineClockStatus,
  RoutineInput,
  RoutineRun,
  RoutineView,
  StackHealth,
  StackHealthRange,
  ReadBytesOptions,
  ConfigWriteGuard,
  ConfigWriteResult,
  VaultConfigName,
  VaultOverrides,
  VaultPrivacyWire,
  VaultSettingsConfigName,
} from 'os-code/protocol';
import type {
  CreateFolderResult,
  EmptyTrashResult,
  FolderMoveResult,
  RemoveGuard,
  RemoveResult,
  RenameGuard,
  RenameResult,
  RestoreResult,
  StoredFile,
  StoredFileMeta,
  TrashEntry,
  TrashResult,
  TrashTarget,
  WriteGuard,
  WriteResult,
} from './gitos/providers.js';

/** One streamed chat request (electron/chatStream.ts keeps the same shape):
 *  the renderer's own id, so late data for a stopped request is dropped. */
export interface ChatStreamRequest {
  id: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A piece of a streamed chat response: body text, its end, or why it
 *  stopped (a plain sentence). */
export type ChatStreamEvent =
  | { id: string; kind: 'data'; chunk: string }
  | { id: string; kind: 'end' }
  | { id: string; kind: 'error'; message: string };

/** A change the vault folder watcher saw (Vault M1, tech review F3): the note paths
 *  that changed, or `tree` when it cannot say which (a folder changed, too
 *  many paths, an event with no name). `rootGone` says the vault folder
 *  itself went away (renamed, deleted, or on a drive that left). A hint only:
 *  compare-and-swap is the protection. */
export interface VaultChange {
  paths: string[];
  tree: boolean;
  rootGone?: boolean;
}

/** Why main refused a folder as the vault (electron/vaultDir.ts). The words
 *  are in lib/vaultCopy.ts vaultPickRefusal. */
export type VaultPickRefusal =
  | 'root'
  | 'home'
  | 'home-ancestor'
  | 'osc-home'
  | 'managed-holds'
  | 'managed-inside'
  | 'not-writable'
  | 'denied'
  | 'unreadable'
  | 'save-failed';

/** The sync service a vault folder sits in, read by main from its real path. */
export type VaultCloudKind =
  'icloud' | 'icloud-openshore' | 'dropbox' | 'onedrive' | 'gdrive' | 'box' | 'other';

/** The desktop vault folder as main reports it (Vault M1 1.4). */
export interface VaultDirInfo {
  dir: string;
  /** Home as ~ on macOS and Linux, the full path on Windows. */
  display: string;
  /** The engine's own warning about a relative vault.dir, shown verbatim. */
  warning?: string;
  exists: boolean;
  os: string;
  obsidian: 'vault' | 'installed' | 'none';
  /** The folder is an Obsidian vault (it holds Obsidian's settings folder). */
  obsidianVault?: boolean;
  /** It is OpenShore's own folder, ~/OpenShore/Vault. */
  isDefault?: boolean;
  count?: number;
  capped?: boolean;
}

/** What one bounded walk of a picked folder found. */
export interface VaultSurvey {
  notes: number;
  capped: boolean;
  otherFiles: number;
  obsidian: boolean;
  inside?: { name: string };
  holds?: string[];
  holdsMore?: number;
  icloudRoot?: boolean;
  cloud?: VaultCloudKind;
}

/** What a folder pick or a refinement did. */
export type VaultPickResult =
  | {
      ok: true;
      info: VaultDirInfo;
      survey: VaultSurvey;
      previous?: { display: string; notes?: number };
    }
  | { ok: false; cancelled: true }
  | { ok: false; same: true; info: VaultDirInfo }
  | {
      ok: false;
      refused: VaultPickRefusal;
      defaultDisplay?: string;
      managedDisplay?: string;
    };

/** What Bring did (electron/vaultDir.ts VaultBringResult): the store's
 *  VaultMoveResult shape, so the forked line reads the same. */
export interface VaultBringResult {
  ok: boolean;
  moved: string[];
  skipped: string[];
  forked: Array<{ from: string; to: string }>;
  capped?: boolean;
  reason?: 'unavailable' | 'same' | 'nested' | 'copy-failed' | 'capped';
}

/** A refinement main offered in the result block; never a path. */
export type VaultRefineChoice =
  { to: 'enclosing' } | { to: 'child'; name: string } | { to: 'previous' } | { to: 'default' };

/** The machine in numbers, from the engine's own resource budget (the same
 *  one osc init and doctor use), so a fit verdict never parses prose. `gpu` is
 *  true only for a dedicated GPU worth budgeting around (4 GB VRAM or more);
 *  `maxModelGB` is the largest model that runs comfortably here. */
export interface DesktopHardware {
  ramGB: number;
  gpu: boolean;
  platform: string;
  vramGB: number;
  maxModelGB: number;
  summary: string;
}

/** Ollama as the desktop sees it: the API answered (running, with a version),
 *  or a binary is on this machine (installed) but nothing is listening. */
export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version?: string;
}

/** What installing Ollama takes here. On Linux nothing runs (`started` is
 *  false): the official script is the person's to run in their own terminal;
 *  on macOS and Windows the installer or the download page opens and the app
 *  polls ollamaStatus. `command` is always present so it can be shown as a
 *  copy block. */
export interface OllamaInstallResult {
  started: boolean;
  command: string;
  mode: 'terminal' | 'download';
  downloadUrl?: string;
  termId?: string;
  detail?: string;
  /** macOS and Windows: the official installer was fetched and opened (else
   *  the download page opened instead). */
  installerOpened?: boolean;
}

/** A newer desktop version the main process found (electron/main.ts). Every
 *  push to main publishes one, and the bar across the top of the window
 *  (UpdateBanner) shows it until the app updates. `phase`:
 *  - downloading: an older shell fetching in the background; a click
 *    installs the moment it lands.
 *  - ready: downloaded; a click restarts onto it.
 *  - available: found, nothing downloaded yet (every platform now asks
 *    first); a click downloads, installs, and restarts.
 *  - installing: the person clicked; `percent` tracks it until the restart.
 *  - failed: it did not finish; a click tries again. `refused` when the
 *    download failed its signature check: nothing was installed. */
export interface PendingUpdate {
  version: string;
  phase: 'downloading' | 'ready' | 'available' | 'installing' | 'failed';
  percent?: number;
  detail?: string;
  refused?: boolean;
}

/** One free chat event as main forwards it: the engine's own events, less the
 *  refusal (it arrives as an error) and the ready marker. */
export type FreeChatFrame = Exclude<FreeChatEvent, { type: 'refused' | 'open' }>;

/** Where the media programs are (EngineHost.mediaServers). `modelsDir` is
 *  the folder set, else the one found; `modelsDirSet` says which. */
export interface MediaServers {
  comfyui: { baseUrl: string; modelsDir?: string; modelsDirSet: boolean };
  speech: { baseUrl: string };
}

export interface DesktopStatus {
  /** The first model server on this computer's network, judged by address:
   *  the one the Stack's picker lists and writes to. */
  ollama: { up: boolean; detail: string; models: string[] };
  /** The model the engine seats while offline (its local seat, read across
   *  every configured provider by address), so a room names what will
   *  actually answer. Absent when nothing on this network can. */
  offlineSeat?: { model: string; provider: string };
  hardwareSummary: string;
  /** Structured numbers behind hardwareSummary; absent on an older engine. */
  hardware?: DesktopHardware;
  stack: {
    configured: boolean;
    description: string;
    /** `kind` is judged by seatLeaves (by address, and by an Ollama cloud
     *  tag). `onThisComputer` is set on a seat that stays when its server is
     *  this computer itself (hostIsLoopback, never the LAN or the tailnet),
     *  so the Stack's chip can say On this computer or On your network (UX review
     *  and copy review, 2026-10-08, B); GET /stack reports the same shape. */
    orchestrator?: {
      model: string;
      provider: string;
      kind: 'local' | 'cloud';
      onThisComputer?: true;
    };
    /** Each placed specialist, judged as the orchestrator is. Both fields are
     *  additive: a specialist whose server is no longer configured, or one
     *  from an older engine, has neither, and wears no chip. */
    specialists: Array<{
      role: string;
      model: string;
      kind?: 'local' | 'cloud';
      onThisComputer?: true;
    }>;
    /** The media jobs placed (the model library); absent on an older engine. */
    media?: Array<{ job: string; runtime: string; catalogId?: string }>;
  };
  connections: { anthropic: boolean; openai: boolean; github: boolean };
}

/** What main answers a Desktop Offline report: the network as main reads it,
 *  and whether the engine now works offline, and why. */
export interface DesktopOfflineAnswer {
  online: boolean;
  offline: boolean;
  reason?: 'network' | 'chosen';
}

/** One device paired to this desktop, as shown in the revoke list. `id` is the
 *  credential's token hash, the handle revokeDeviceCredential matches on. */
export interface PairedDevice {
  id: string;
  label: string;
  createdAt: string;
  expiresAt?: string;
}

export interface DaemonInfo {
  running: boolean;
  host?: string;
  port: number;
  /** The one-time pairing claim on the QR right now: not a credential. The
   *  phone trades it at POST /pair/claim for its own per-device credential,
   *  after which it is spent and the next poll carries a fresh one. Absent
   *  while the hub is off. */
  claim?: string;
  claimExpiresAt?: string;
  /** Credentials paired to this desktop, for the revoke UI. */
  devices?: PairedDevice[];
  tailscaleIp?: string;
  tailscaleUp: boolean;
  /** 'loopback' means the tailnet bind failed and the daemon serves only this
   *  machine, so a pairing QR would be unreachable from the phone. */
  mode?: 'loopback' | 'tailscale';
  /** Why the last bind failed: the tailnet (the hub fell back to loopback),
   *  or every address (the hub is off and main retries on its poll). Absent
   *  once a bind succeeds or the hub is paused. */
  bindError?: string;
}

export interface SessionRow {
  id: string;
  cwd: string;
  title: string;
  updatedAt: string;
}

export interface InstallProgressPayload {
  modelId: string;
  line: string;
  percent?: number;
  completed?: number;
  total?: number;
}

export interface OscodeBridge {
  platform: 'electron';
  /** The run before this one ended in Quit: the page opens fresh (lib/resumePoint.ts). */
  afterQuit?: boolean;

  // Sessions (conversations backed by the engine).
  createSession(
    cwd?: string,
    opts?: {
      instructions?: string;
      permissionMode?: PermissionMode;
      projectName?: string;
      projectSecrets?: string;
      humanize?: boolean;
      /** Chain of Thought for this session (off unless true). */
      chainOfThought?: boolean;
      /** False until the person allows web search on this device. */
      webSearch?: boolean;
      /** The Wayfinding Memory switch: false turns project memory off for
       *  this session; absent leaves the project's config in charge. */
      memory?: boolean;
      /** The person's Codemagic token, so the engine's codemagic tool can drive
       *  App Launch builds. Delivered only on this local engine and only when
       *  Codemagic Access is on; never sent to a remote daemon. */
      codemagicToken?: string;
      codemagicTarget?: { appId: string; workflowId: string; branch: string; platform?: string };
      /** The Agentic Current the person turned on, as the handle its engine
       *  tool needs (a Hermes box, an A2A agent, a paired coding CLI). */
      currents?: CurrentsHandles;
      /** The Harness Current the person turned on (Jev), as its per-session
       *  handle for the engine's verify judge. */
      harnessCurrents?: HarnessCurrentsHandle;
      /** A handoff from the chat this session continues (Vault M5, tech review J12),
       *  prepended to the first task only, at most `HANDOFF_MAX_BYTES`. */
      handoff?: string;
      /** The project's own pinned notes (`Project.vaultPins`, tech review J14), at
       *  most 8 vault paths, read first by the pack. */
      vaultPins?: string[];
      /** The app's vault switches (Vault M7, tech review L13): off-only and
       *  lower-only, into `BootstrapOptions.vaultOverrides`. */
      vaultOverrides?: VaultOverrides;
    },
  ): Promise<{ id: string; cwd: string; warnings: string[] }>;
  /** The person's controls over a live session (Claude Code parity): the
   *  permission mode, the project's standing instructions, manual compaction,
   *  and a ranked file search for @ mentions. */
  setMode(sessionId: string, mode: PermissionMode): Promise<void>;
  setInstructions(sessionId: string, text?: string): Promise<void>;
  compact(
    sessionId: string,
    focus?: string,
  ): Promise<{ before: number; after: number } | { error: string }>;
  listFiles(sessionId: string, query: string): Promise<string[]>;
  /** Trust this session's folder on this computer (the trust card's tap): its
   *  own os-code.config.json applies from the next session there. */
  trustFolder(sessionId: string): Promise<{ ok: true; folder: string } | { error: string }>;
  /** The truncation card's tap (C1, tech review 5): serve this provider's models the
   *  larger window from the next message, in every chat. Absent on an older
   *  shell. */
  giveMoreRoom?(provider: string): Promise<{ ok: true; provider: string } | { error: string }>;
  /** The sample page for a first try (v1 Phase 1): written to ~/OpenShore/Repositories/Try
   *  OpenShore, kept as it is when already there. Absent on an older shell. */
  createSample?(): Promise<{ path: string; created: boolean } | { error: string }>;
  /** Undo or redo a task's changes, every file or one (the changed-files
   *  card's tap). */
  restoreCheckpoint(
    sessionId: string,
    id: string,
    direction: 'undo' | 'redo',
    path?: string,
  ): Promise<{ ok: true; paths: string[] } | { error: string }>;
  /** Rewind a chat to one of the person's messages (P2), and its files with
   *  `files`. Absent on an older shell. */
  rewind?(
    sessionId: string,
    toSeq: number,
    files: boolean,
  ): Promise<{ ok: true; paths: string[] } | { error: string }>;
  /** Resume a session and return its journal so the renderer can replay it AFTER
   *  subscribing (IPC is not buffered, so a pushed replay would be lost). */
  resumeSession(
    id: string,
  ): Promise<
    | { id: string; cwd: string; journal: Array<{ seq: number; event: DriverEvent }> }
    | { error: string }
  >;
  listSessions(): Promise<SessionRow[]>;
  send(sessionId: string, text: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
  answerApproval(sessionId: string, approvalId: string, answer: ApprovalAnswer): Promise<void>;
  onEvent(
    cb: (payload: { sessionId: string; seq: number; event: DriverEvent }) => void,
  ): () => void;

  // The free chat (tech review ruling 8): one answer from this computer's own local
  // model, with no session, no tools and no notes. freeChat resolves once the
  // answer has ended; its events arrive on onFreeChat under the request id,
  // `done` or `error` last. Absent on an older shell.
  freeChat?(requestId: string, body: Record<string, unknown>): Promise<void>;
  freeChatAbort?(requestId: string): Promise<void>;
  onFreeChat?(cb: (payload: { requestId: string; event: FreeChatFrame }) => void): () => void;

  // Chat-to-terminal lane. runCommand runs a command on this machine and
  // returns its runId (undefined if the session is gone); output streams back as
  // command-* DriverEvents on the onEvent channel. sendCommandStdin and
  // killCommand drive a live run.
  runCommand(sessionId: string, command: string): Promise<string | undefined>;
  sendCommandStdin(sessionId: string, runId: string, data: string): Promise<void>;
  killCommand(sessionId: string, runId: string): Promise<void>;

  // Interactive terminal (Phase 2). openTerminal ensures a PTY on this machine
  // for the session; output arrives as osc:terminal-data via onTerminalData
  // once terminalSubscribe registers it (ring replay from the offset, then
  // live). The rest drive the live PTY. stdin is never logged.
  openTerminal(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<{ termId: string; cols: number; rows: number } | { unavailable: true; error: string }>;
  terminalSubscribe(termId: string, sinceOffset: number): Promise<boolean>;
  terminalUnsubscribe(termId: string): Promise<void>;
  terminalStdin(termId: string, data: string): Promise<boolean>;
  terminalResize(termId: string, cols: number, rows: number): Promise<boolean>;
  terminalKill(termId: string): Promise<boolean>;
  onTerminalData(
    cb: (payload: { termId: string; b64: string; offset: number }) => void,
  ): () => void;

  // Machine, stack, Local Library.
  status(): Promise<DesktopStatus>;
  catalog(): Promise<{ catalog: Catalog; note?: string }>;
  /** Fully local read of how the stack is being used, folded from the session
   *  journals on this machine. Read-only; nothing leaves the device. */
  stackHealth(range?: StackHealthRange): Promise<StackHealth>;
  /** A failed pull carries why (`reason`), so a room words it plainly. A
   *  media model from the library takes the shelf its Get came from, so it
   *  fills that job in the Stack. */
  installModel(modelId: string, shelfId?: string): Promise<PullResult>;
  onInstallProgress(cb: (payload: InstallProgressPayload) => void): () => void;
  /** Pull any Ollama model by its raw ref (progress arrives keyed by the ref on
   *  onInstallProgress), so the Local Library is not limited to catalog entries. */
  installOllamaRef(ref: string): Promise<PullResult>;
  setOrchestrator(model: string): Promise<{ ok: boolean; detail: string }>;
  enableSpecialist(role: string, model: string): Promise<{ ok: boolean; detail: string }>;
  disableSpecialist(role: string): Promise<{ ok: boolean; detail: string }>;
  /** The media programs (the model library): where ComfyUI and the speech
   *  server are, set them, and take a placed job out of the Stack. */
  mediaServers(): Promise<MediaServers>;
  setMediaServer(
    runtime: 'comfyui' | 'speech',
    baseUrl?: string,
    modelsDir?: string,
  ): Promise<{ ok: boolean; detail: string }>;
  /** Take a media job out of the Stack; `deleteFiles` also deletes the
   *  files Get wrote for its model that nothing else placed needs. */
  removeMedia(job: string, deleteFiles?: boolean): Promise<{ ok: boolean; detail: string }>;
  /** What Remove could delete for a job's model. */
  mediaRemoval(job: string): Promise<{ files: number; bytes: number }>;
  /** The pictures, clips and sounds the media jobs saved on this computer. */
  mediaOutputs(): Promise<{ files: number; bytes: number }>;
  clearMediaOutputs(): Promise<{ files: number; bytes: number }>;

  // Connections (keys stay in the engine's credential store on this machine).
  /** Connect Claude to the engine on this machine. An identity-linked key
   *  needs the workspace it acts in; the result says so when it is missing. */
  setAnthropicKey(
    key: string,
    workspaceId?: string,
  ): Promise<{ ok: boolean; detail: string; needsWorkspace?: boolean }>;
  setOpenAIKey(key: string): Promise<{ ok: boolean; detail: string }>;
  setGithubToken(token: string): Promise<{ ok: boolean; detail: string }>;
  disconnect(connector: 'anthropic' | 'openai' | 'github'): Promise<void>;

  // Repos.
  pickFolder(): Promise<string | null>;
  /** Clone into ~/OpenShore/Repositories. `token` is the connected platform's token for a
   *  private repository, used for this one clone and never stored. */
  cloneRepo(
    url: string,
    token?: string,
  ): Promise<{ cwd: string; name: string } | { error: string }>;
  /** Recent session folders, then every clone under ~/OpenShore/Repositories, each with its
   *  origin address when it has one. */
  recentWorkspaces(): Promise<
    Array<{ cwd: string; name: string; lastUsed?: string; remote?: string }>
  >;
  /** Push each clone's unpushed commits to its remote (merging a moved-on
   *  remote first), so nothing a project committed lingers only on this device.
   *  Never force-pushes; surfaces conflicts. Returns one result per repo. */
  reconcileRepos(
    roots: string[],
    /** This app's connected platform tokens, so a clone it made with a token
     *  can be pushed from a computer with no git credential of its own. */
    tokens?: Partial<Record<'github' | 'gitlab' | 'bitbucket', string>>,
  ): Promise<ReconcileResult[]>;

  // Phone pairing (the daemon).
  daemonInfo(): Promise<DaemonInfo>;
  daemonStart(): Promise<DaemonInfo | { error: string }>;
  daemonStop(): Promise<void>;
  /** Every device credential paired to this desktop, for the revoke list. */
  listDeviceCredentials(): Promise<PairedDevice[]>;
  /** Cut off one device by its credential id (a lost phone). Returns how many
   *  credentials were removed. Other paired devices stay connected. */
  revokeDeviceCredential(id: string): Promise<{ removed: number }>;
  /** Replace the old shared token in ~/.os-code/daemon.token (H1). Nothing on
   *  a paired phone changes; only a device still on the shared token must pair
   *  again. Absent on an older shell. */
  rotateSharedToken?(): Promise<{ rotated: true } | { error: string }>;
  /** Start with your computer (opt-in). `supported` is false on a run from
   *  source, which has no installed executable to register. Absent on an
   *  older shell. */
  launchAtLogin?(): Promise<{ on: boolean; supported: boolean }>;
  setLaunchAtLogin?(on: boolean): Promise<{ on: boolean; detail?: string }>;
  /** The app icon picked in Settings, Appearance: the window and Dock icon
   *  change while the app runs (the installed icon on disk does not). */
  setAppIcon?(id: string): Promise<{ ok: boolean }>;

  // Ollama from inside the app, and the machine in numbers. Optional because
  // an older shell may not carry them; callers fall back to the Stack probe.
  ollamaStatus?(): Promise<OllamaStatus>;
  /** Start `ollama serve` on this machine and wait for it to answer. */
  ollamaStart?(): Promise<boolean>;
  /** Run the platform's install plan (see OllamaInstallResult). Call it only
   *  after the person confirmed on a card that shows the command. */
  ollamaInstall?(): Promise<OllamaInstallResult>;
  hardware?(): Promise<DesktopHardware>;

  // Crew routines: the scheduled, unattended jobs that run on this computer.
  // The same surface the daemon serves a phone; validation and the workspace
  // gate live in the engine. Keep in lockstep with electron/main.ts.
  /** `clock` says whose clock fires the slots (H1); absent on an older shell. */
  routinesList(): Promise<{
    routines: RoutineView[];
    runs: RoutineRun[];
    clock?: RoutineClockStatus;
    webSearch?: boolean;
  }>;
  routineCreate(input: RoutineInput): Promise<{ routine: RoutineView } | { error: string }>;
  routineUpdate(
    id: string,
    patch: Partial<RoutineInput>,
  ): Promise<{ routine: RoutineView } | { error: string }>;
  routineDelete(id: string): Promise<{ deleted: boolean }>;
  routineRun(id: string): Promise<{ queued: true; position: number } | { error: string }>;
  routineStop(id: string): Promise<{ stopped: boolean }>;
  routinesWebSearch(allowed: boolean): Promise<{ webSearch: boolean }>;
  /** Desktop Offline (2026-10-07): the person's choice (true for
   *  Offline) for this computer's engine. Main combines it with its own read
   *  of the network (net.isOnline(), no request) and tells every session;
   *  the answer is main's view, so the renderer learns it at once. Optional
   *  for an older main. */
  setOffline?(chosen: boolean): Promise<DesktopOfflineAnswer>;
  /** Main saw the network change, so the window flips as promptly as the
   *  engine does. */
  onNetwork?(cb: (payload: { online: boolean }) => void): () => void;
  webFetchMode?(mode: 'ask' | 'allow' | 'off'): Promise<{ webFetch: 'ask' | 'allow' | 'off' }>;
  /** One picture of this window's page, as a JPEG data URL (Slack Water's floor). */
  snapshot?(): Promise<string | null>;
  routineNote(runId: string): Promise<{ path: string; markdown: string } | null>;

  // Agentic Currents: what this computer can host (a Hermes home present, a
  // coding CLI on PATH), and the read-only notes in a Hermes home (memory,
  // identity, skills), jailed and markdown-only in the engine. Keep in
  // lockstep with electron/main.ts.
  currentsProbe(): Promise<CurrentsHostProbe>;
  hermesNotes(): Promise<{ home: string; notes: HermesNoteMeta[] }>;
  hermesNote(path: string): Promise<HermesNote | null>;

  // On-disk vault: plain .md files under the agent's vault dir (~/OpenShore/Vault),
  // so the app's Vault and the agent share one folder. Paths are jailed to that
  // directory in the main process, and only notes (.md, no dot segment) cross.
  // Every file carries its opaque version (the lstat token), and a write may
  // carry a guard, which main checks before it publishes (compare-and-swap).
  // Keep in lockstep with electron/main.ts.
  vaultList(): Promise<StoredFileMeta[]>;
  vaultStat(path: string): Promise<StoredFileMeta | null>;
  vaultRead(path: string): Promise<StoredFile | null>;
  vaultWrite(path: string, text: string, guard?: WriteGuard): Promise<WriteResult>;
  /** Remove a note; with a guard, only while its version is still ifMatch
   *  (a stale one answers 'changed' and the note stays). */
  vaultRemove(path: string, guard?: RemoveGuard): Promise<RemoveResult>;
  /** Watch the vault folder while the Vault room is open: on with the open
   *  note's path (Linux watches that note's folder too), off when it leaves. */
  vaultWatch(on: boolean, openPath?: string): Promise<void>;
  /** The vault folder's saved index blob (serializeIndex's output), or null
   *  when there is none or it is over the cap (Vault M3, tech review H3). Main keys it
   *  by the vault root it reads itself; no path crosses. */
  vaultIndexLoad(): Promise<string | null>;
  /** Save the index blob for the current vault root: temp file then rename,
   *  0600. A blob over 32 MB is refused ('too-large') and nothing is written. */
  vaultIndexSave(
    blob: string,
  ): Promise<{ ok: true; bytes: number } | { ok: false; reason: 'too-large' }>;
  /** Read one allowed config file by its logical name (Vault M3, tech review H5):
   *  main maps the name to a file in the vault's config folder, reads it only
   *  as a regular file inside the folder, capped at 256 KB. An unknown name
   *  answers 'refused'. */
  vaultReadConfig(name: VaultConfigName): Promise<ConfigRead>;
  /** This machine's own vault privacy rules (Vault M5, tech review J3): hidden globs
   *  and the local-only paths and tags, from the machine config only, for
   *  the core's compileVaultPrivacy. */
  vaultPrivacy(): Promise<VaultPrivacyWire>;
  /** Forget every handoff the engine on this computer keeps (Clear
   *  conversations, tech review J13). Optional: an older desktop build has none. */
  clearHandoffs?(): Promise<void>;
  // Chats as files (folder and sync plan, M3): the mirror of each chat in
  // ~/OpenShore/Chats. The renderer names only `YYYY-MM/<name>.md` inside that
  // folder; main checks the shape, jails it there (no dot names, no link out)
  // and writes temp then rename. Optional: an older desktop build has none.
  // Keep in lockstep with electron/main.ts.
  chatFileWrite?(path: string, text: string): Promise<void>;
  /** Remove one chat file; true when it was there. */
  chatFileRemove?(path: string): Promise<boolean>;
  /** The chat files in one month folder, by name, with their modified times. */
  chatFileList?(month: string): Promise<Array<{ name: string; mtimeMs: number }>>;
  // Sync on all devices, chats and projects (2026-10-16): this desktop's own
  // store, the one a docked phone reaches over /sync. Kinds and ids only; main
  // checks both and never takes a path. Optional: an older build has none.
  syncList?(
    kind: string,
  ): Promise<Array<{ id: string; version: string; updatedAt: string; size: number }>>;
  syncGet?(kind: string, id: string): Promise<{ text: string; version: string } | undefined>;
  syncPut?(
    kind: string,
    id: string,
    text: string,
    guard: { ifMatch: string } | { ifAbsent: true },
  ): Promise<{ ok: true; version: string; updatedAt: string } | { ok: false; conflict: string }>;
  syncRemove?(kind: string, id: string, ifMatch: string): Promise<{ ok: boolean }>;
  /** Changes the watcher saw, debounced in main. Returns an unsubscribe. */
  onVaultChanged(cb: (change: VaultChange) => void): () => void;
  /** Where the vault folder is, whether it is there, and whether Obsidian
   *  opens it (Vault M1 1.4). */
  vaultDirInfo(): Promise<VaultDirInfo>;
  /** The system folder picker, run and checked in main; takes no path. */
  vaultChooseDir(): Promise<VaultPickResult>;
  /** One of the choices the result block offered (a vault around or inside
   *  the pick, or the folder before it); never a path. */
  vaultRefineDir(choice: VaultRefineChoice): Promise<VaultPickResult>;
  /** Copy the notes of the folder before the last pick into this one, with
   *  nothing replaced and nothing removed; takes no path. */
  vaultBringPrevious(): Promise<VaultBringResult>;
  /** Open the vault folder in Finder, File Explorer, or the file manager. */
  vaultReveal(): Promise<{ ok: boolean }>;
  /** Open the vault folder in Obsidian (obsidian://open, built in main). */
  vaultOpenObsidian(): Promise<void>;
  /** Export the team vault's notes as plain files under "Vault Team/<org>"
   *  beside the default vault folder (Vault M2 2.8); main picks the folder,
   *  checks every path, and follows the export manifest rule. */
  vaultTeamExport(
    org: string,
    notes: Array<{ path: string; text: string }>,
    failed: string[],
  ): Promise<{
    written: number;
    total: number;
    removed: number;
    unread: number;
    kept: string[];
    dir: string;
    display: string;
  }>;
  /** macOS: open Privacy & Security, Files and Folders. */
  openPrivacySettings(): Promise<void>;

  // Vault M6 (tech review K13): one IPC each, validated in main like parseVaultGuard,
  // every path through the note rule or isAttachmentPath and the Jail, and
  // `.trash` reached only by the trash calls. Optional: a desktop build whose
  // main does not answer them yet has none, and the provider checks before
  // use. Keep in lockstep with electron/main.ts and preload.cjs (stream B).
  /** osc:vaultRename. Never replaces (K3). */
  vaultRename?(from: string, to: string, guard: RenameGuard): Promise<RenameResult>;
  /** osc:vaultFolders. The real folders, empty ones too. */
  vaultFolders?(): Promise<string[]>;
  /** osc:vaultFolderCreate. */
  vaultFolderCreate?(path: string): Promise<CreateFolderResult>;
  /** osc:vaultFolderRename. One directory rename, the destination absent. */
  vaultFolderRename?(from: string, to: string): Promise<FolderMoveResult>;
  /** osc:vaultTrash. Into `<vault>/.trash/<original path>`. */
  vaultTrash?(target: TrashTarget): Promise<TrashResult>;
  /** osc:vaultTrashList. */
  vaultTrashList?(): Promise<TrashEntry[]>;
  /** osc:vaultTrashRestore. Never overwrites. */
  vaultTrashRestore?(id: string): Promise<RestoreResult>;
  /** osc:vaultTrashEmpty. The ids given, or all of Trash. */
  vaultTrashEmpty?(ids?: string[]): Promise<EmptyTrashResult>;
  /** osc:vaultAttachments. */
  vaultAttachments?(): Promise<AttachmentMeta[]>;
  /** osc:vaultReadBytes. Capped at 20 MB. */
  vaultReadBytes?(path: string, opts?: ReadBytesOptions): Promise<BytesRead>;
  /** osc:vaultOpenAttachment. Opens a PDF or an image in the system viewer
   *  (jailed, pdf and image extensions only). */
  vaultOpenAttachment?(path: string): Promise<{ ok: boolean }>;

  // Vault M7 (tech review L7): the settings sheet's one write. Optional, like the M6
  // calls; keep in lockstep with electron/main.ts and preload.cjs (stream D).
  /** osc:vaultWriteConfig. Main writes `.oscode/vault.json` under the vault
   *  root it holds (`writeVaultConfigFile`): `.oscode` made if missing and
   *  lstat'd as a real directory, temp and rename through the Jail, never
   *  following a link. Only `oscode/vault`; anything else is `refused`. The
   *  person's own write, from the sheet only; no agent path names it. */
  vaultWriteConfig?(
    name: VaultSettingsConfigName,
    text: string,
    guard: ConfigWriteGuard,
  ): Promise<ConfigWriteResult>;

  // Read-only access to a repo working tree, for the project-memory viewer. The
  // notes live in the repo under "OpenShore Project <name> MDs/"; these list a
  // folder's filenames and read a file's text, both jailed to `root` in the main
  // process (symlink-safe). `root` is a project workspace path. Never writes.
  // null means the folder or file is not there yet. Keep in lockstep with main.ts.
  repoReadDir(root: string, subdir: string): Promise<string[] | null>;
  repoReadFile(root: string, relPath: string): Promise<string | null>;

  // Video framing on the desktop: FFmpeg compresses a large clip into the size
  // band, then samples it into stills, so a vision model reviews it frame by
  // frame and never sees the video. `options.path` is the picked file's real
  // path. Kept in lockstep with lib/mediaPlugin.ts (the phone's contract) and
  // main.ts (the FFmpeg driver).
  mediaProcess(
    options: import('./mediaPlugin.js').MediaProcessOptions,
  ): Promise<import('./mediaPlugin.js').MediaProcessResult>;

  // OS-encrypted secret store (safeStorage), for the data-encryption key.
  // secureHas tells "no entry" from "an entry this launch cannot decrypt", so
  // the renderer never mints a new key over data sealed with the old one.
  secureHas(key: string): Promise<boolean>;
  secureGet(key: string): Promise<string | null>;
  secureSet(key: string, value: string): Promise<boolean>;
  secureDelete(key: string): Promise<void>;

  // Guarded outbound HTTP for CORS-hostile third-party APIs (see main.ts).
  httpFetch(req: {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ ok: boolean; status: number; body: string }>;

  // A streamed chat completion for a model seat (build 2026-09-29, tech review 7;
  // electron/chatStream.ts): POST only, to a path ending /chat/completions or
  // /api/chat, public https pinned, plain http only on your own network, no
  // redirects. chatStream resolves at the response head; the body arrives as
  // osc:chat-stream events for the renderer's id, and chatStreamAbort ends it.
  chatStream(req: ChatStreamRequest): Promise<{ status: number }>;
  chatStreamAbort(id: string): Promise<void>;
  onChatStream(cb: (event: ChatStreamEvent) => void): () => void;

  // Google Drive OAuth redirect capture: a one-shot loopback server. listen()
  // opens it and returns the port to build the redirect_uri against; wait()
  // blocks for the single callback request (or times out); cancel() closes
  // it early if the user backs out of the flow.
  gdriveOAuthListen(): Promise<{ port: number }>;
  gdriveOAuthWait(): Promise<{ code: string; state: string } | { error: string }>;
  gdriveOAuthCancel(): Promise<void>;

  // Deep links the OS routed to this app over the oscode:// scheme (Supabase
  // auth callback, Stripe checkout return). The renderer subscribes and routes
  // each URL. Returns an unsubscribe function.
  onDeepLink(cb: (url: string) => void): () => void;

  // The tray's and the Dock menu's New chat: the main process shows the
  // window, then asks the renderer for a plain chat. Optional, so a desktop
  // build from before it simply has no menu item.
  onNewChat?(cb: () => void): () => void;

  // Pushed unprompted whenever the main process finds (Windows, Linux) or
  // detects (macOS) a newer release than the one running, and again whenever
  // the window reloads, so a fresh renderer is never out of sync with what
  // main already knows. undefined clears it. installUpdate() acts on
  // whatever was last pushed (see PendingUpdate).
  onUpdateStatus(cb: (update: PendingUpdate | undefined) => void): () => void;
  installUpdate(): Promise<void>;

  // A contained third-party site inside the window (Codemagic in Launch).
  // The renderer names the site and places it by bounds in CSS pixels of the
  // window; the main process owns the URL fence and the cookie partition.
  embeddedOpen(name: 'codemagic', bounds: EmbeddedBounds): Promise<boolean>;
  embeddedBounds(bounds: EmbeddedBounds): Promise<void>;
  embeddedVisible(visible: boolean): Promise<void>;
  embeddedBack(): Promise<void>;
  embeddedReload(): Promise<void>;
  embeddedHome(): Promise<void>;
  embeddedSignOut(): Promise<void>;
  embeddedClose(): Promise<void>;
  onEmbeddedState(cb: (state: EmbeddedState) => void): () => void;
}

export interface EmbeddedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmbeddedState {
  site: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
}

export function bridge(): OscodeBridge | undefined {
  return (window as any).oscode as OscodeBridge | undefined;
}

export function requireBridge(): OscodeBridge {
  const b = bridge();
  if (!b) throw new Error('The desktop bridge is not available in this shell.');
  return b;
}
