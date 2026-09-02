// The typed surface Electron's preload exposes as window.oscode. The main
// process implements every method against the engine; the renderer never
// touches Node directly. Keep this file in lockstep with electron/main.ts.
import type {
  ApprovalAnswer,
  Catalog,
  DriverEvent,
  StackHealth,
  StackHealthRange,
} from 'os-code/protocol';
import type { StoredFile, StoredFileMeta } from './gitos/providers.js';

export interface DesktopStatus {
  ollama: { up: boolean; detail: string; models: string[] };
  hardwareSummary: string;
  stack: {
    configured: boolean;
    description: string;
    orchestrator?: { model: string; provider: string; kind: 'local' | 'cloud' };
    specialists: Array<{ role: string; model: string }>;
  };
  connections: { anthropic: boolean; openai: boolean; github: boolean };
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
  /** A fresh per-device pairing credential (mint-once while the daemon runs),
   *  NOT the shared admin token, so a lost phone can be revoked on its own.
   *  Empty when the daemon is off. */
  token: string;
  /** Credentials paired to this desktop, for the revoke UI. */
  devices?: PairedDevice[];
  tailscaleIp?: string;
  tailscaleUp: boolean;
  /** 'loopback' means the tailnet bind failed and the daemon serves only this
   *  machine, so a pairing QR would be unreachable from the phone. */
  mode?: 'loopback' | 'tailscale';
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

  // Sessions (conversations backed by the engine).
  createSession(cwd?: string): Promise<{ id: string; cwd: string; warnings: string[] }>;
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

  // Machine, stack, marketplace.
  status(): Promise<DesktopStatus>;
  catalog(): Promise<{ catalog: Catalog; note?: string }>;
  /** Fully local read of how the stack is being used, folded from the session
   *  journals on this machine. Read-only; nothing leaves the device. */
  stackHealth(range?: StackHealthRange): Promise<StackHealth>;
  installModel(modelId: string): Promise<{ ok: boolean; detail: string }>;
  onInstallProgress(cb: (payload: InstallProgressPayload) => void): () => void;
  /** Pull any Ollama model by its raw ref (progress arrives keyed by the ref on
   *  onInstallProgress), so the marketplace is not limited to catalog entries. */
  installOllamaRef(ref: string): Promise<{ ok: boolean; detail: string }>;
  setOrchestrator(model: string): Promise<{ ok: boolean; detail: string }>;
  enableSpecialist(role: string, model: string): Promise<{ ok: boolean; detail: string }>;
  disableSpecialist(role: string): Promise<{ ok: boolean; detail: string }>;

  // Connections (keys stay in the engine's credential store on this machine).
  setAnthropicKey(key: string): Promise<{ ok: boolean; detail: string }>;
  setOpenAIKey(key: string): Promise<{ ok: boolean; detail: string }>;
  setGithubToken(token: string): Promise<{ ok: boolean; detail: string }>;
  disconnect(connector: 'anthropic' | 'openai' | 'github'): Promise<void>;

  // Repos.
  pickFolder(): Promise<string | null>;
  cloneRepo(url: string): Promise<{ cwd: string; name: string } | { error: string }>;
  recentWorkspaces(): Promise<Array<{ cwd: string; name: string; lastUsed?: string }>>;

  // Phone pairing (the daemon).
  daemonInfo(): Promise<DaemonInfo>;
  daemonStart(): Promise<DaemonInfo | { error: string }>;
  daemonStop(): Promise<void>;
  /** Every device credential paired to this desktop, for the revoke list. */
  listDeviceCredentials(): Promise<PairedDevice[]>;
  /** Cut off one device by its credential id (a lost phone). Returns how many
   *  credentials were removed. Other paired devices stay connected. */
  revokeDeviceCredential(id: string): Promise<{ removed: number }>;

  // On-disk vault: plain .md files under the agent's vault dir (~/OSCode/Vault),
  // so the app's Vault and the agent share one folder. Paths are jailed to that
  // directory in the main process. Keep in lockstep with electron/main.ts.
  vaultList(): Promise<StoredFileMeta[]>;
  vaultRead(path: string): Promise<StoredFile | null>;
  vaultWrite(path: string, text: string): Promise<StoredFile>;
  vaultRemove(path: string): Promise<void>;

  // OS-encrypted secret store (safeStorage), for the data-encryption key.
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
}

export function bridge(): OscodeBridge | undefined {
  return (window as any).oscode as OscodeBridge | undefined;
}

export function requireBridge(): OscodeBridge {
  const b = bridge();
  if (!b) throw new Error('The desktop bridge is not available in this shell.');
  return b;
}
