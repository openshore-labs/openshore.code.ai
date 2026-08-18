// The typed surface Electron's preload exposes as window.oscode. The main
// process implements every method against the engine; the renderer never
// touches Node directly. Keep this file in lockstep with electron/main.ts.
import type { ApprovalAnswer, Catalog, DriverEvent } from 'os-code/protocol';

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

export interface DaemonInfo {
  running: boolean;
  host?: string;
  port: number;
  token: string;
  tailscaleIp?: string;
  tailscaleUp: boolean;
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
  resumeSession(id: string): Promise<{ id: string; cwd: string } | { error: string }>;
  listSessions(): Promise<SessionRow[]>;
  send(sessionId: string, text: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
  answerApproval(sessionId: string, approvalId: string, answer: ApprovalAnswer): Promise<void>;
  onEvent(
    cb: (payload: { sessionId: string; seq: number; event: DriverEvent }) => void,
  ): () => void;

  // Machine, stack, marketplace.
  status(): Promise<DesktopStatus>;
  catalog(): Promise<{ catalog: Catalog; note?: string }>;
  installModel(modelId: string): Promise<{ ok: boolean; detail: string }>;
  onInstallProgress(cb: (payload: InstallProgressPayload) => void): () => void;
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
}

export function bridge(): OscodeBridge | undefined {
  return (window as any).oscode as OscodeBridge | undefined;
}

export function requireBridge(): OscodeBridge {
  const b = bridge();
  if (!b) throw new Error('The desktop bridge is not available in this shell.');
  return b;
}
