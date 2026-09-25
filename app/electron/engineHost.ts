// The engine host: everything the renderer reaches through IPC, implemented
// against the os-code engine in the Electron main process. One place, typed,
// no Node in the renderer, keys never leave the machine.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { loadConfig, saveGlobalConfig } from 'os-code/dist/src/config/load.js';
import { bootstrapSession } from 'os-code/dist/src/core/agent/bootstrap.js';
import {
  listSessions,
  sealSessionsAtRest,
  type LocalDriver,
} from 'os-code/dist/src/daemon/session.js';
import { startDaemon, type RunningDaemon } from 'os-code/dist/src/daemon/serve.js';
import { TerminalManager, TerminalUnavailable } from 'os-code/dist/src/daemon/terminal.js';
import { HOME_SHELL_ID } from 'os-code/dist/src/daemon/homeShellId.js';
import { ProviderRegistry } from 'os-code/dist/src/providers/registry.js';
import { getAnthropicKey, loginWithApiKey, logoutClaude } from 'os-code/dist/src/auth/claude.js';
import { loginWithPat, logoutGithub, isGithubConnected } from 'os-code/dist/src/auth/github.js';
import { getCredential, setCredential, deleteCredential } from 'os-code/dist/src/auth/store.js';
import { detectHardware, budgetFor } from 'os-code/dist/src/router/resourceBudget.js';
import { loadCatalog, findModel } from 'os-code/dist/src/market/catalog.js';
import { installModel, installOllamaRef } from 'os-code/dist/src/market/install.js';
import { computeStackHealth } from 'os-code/dist/src/insights/stackHealth.js';
import { EgressPolicy } from 'os-code/dist/src/core/security/egress.js';
import { redactToken } from 'os-code/dist/src/git/index.js';
import {
  cloneFolderName,
  cloneIntoManaged,
  listWorkspaces,
  type WorkspaceRow,
} from 'os-code/dist/src/git/workspaces.js';
import { reconcileRepos, type ReconcileResult } from 'os-code/dist/src/git/reconcile.js';
import { detectTailscale, tailscaleIp } from 'os-code/dist/src/connect/tailscale.js';
import { loadCredentials, revokeCredential } from 'os-code/dist/src/core/security/credentials.js';
import { oscHome } from 'os-code/dist/src/config/load.js';
import { shouldRebind } from './lifecycle.js';
import {
  ollamaInstallPlan,
  probeOllama,
  startOllama,
  type OllamaInstallPlan,
  type OllamaStatus,
} from './ollama.js';
import { getRoutineScheduler, type RoutineScheduler } from 'os-code/dist/src/routines/scheduler.js';
import { validateRoutineInput } from 'os-code/dist/src/routines/model.js';
import {
  cliCommandAvailable,
  hermesHome,
  listHermesNotes,
  probeCurrentsHost,
  readHermesNote,
} from 'os-code/dist/src/currents/host.js';
import type {
  CurrentsHandles,
  CurrentsHostProbe,
  DriverEvent,
  HarnessCurrentsHandle,
  HermesNote,
  HermesNoteMeta,
  PermissionMode,
  RoutineInput,
  RoutineRun,
  RoutineView,
  StackHealth,
  StackHealthRange,
} from 'os-code/protocol';

// One paired device as the renderer sees it. `id` is the credential's token
// hash, which is also the handle the revoke store matches on (revokeCredential
// takes a label or a token-hash prefix). Structural, so no shared import with
// electronBridge is needed.
export interface PairedDeviceWire {
  id: string;
  label: string;
  createdAt: string;
  expiresAt?: string;
}

// The label the retired shared QR credential carried, and the file its clear
// token sat in. Both are gone: the QR now carries a one-time claim and every
// phone mints its own credential at POST /pair/claim.
const SHARED_PAIRING_LABEL = 'iPhone via QR';

function sharedPairingTokenPath(): string {
  return join(oscHome(), 'pairing-device.token');
}

/** Every paired device credential, mapped to the renderer's revoke-list shape. */
export function listPairedDevices(): PairedDeviceWire[] {
  return loadCredentials().map((c) => ({
    id: c.tokenHash,
    label: c.label,
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
  }));
}

/** One-time migration, run on every daemon start (idempotent): delete the
 *  clear-text pairing token file and revoke the shared "iPhone via QR"
 *  credential it belonged to. That credential was one token for every phone,
 *  written in the clear on disk, so it cannot stay; phones paired with it
 *  re-pair once and get their own. */
export function retireSharedPairingCredential(): { fileRemoved: boolean; revoked: number } {
  const path = sharedPairingTokenPath();
  let fileRemoved = false;
  if (existsSync(path)) {
    try {
      rmSync(path, { force: true });
      fileRemoved = true;
    } catch {}
  }
  const revoked = revokeCredential(SHARED_PAIRING_LABEL);
  return { fileRemoved, revoked };
}

/** What the host needs from the world, injectable so the daemon lifecycle is
 *  pinned by tests on a machine with no Tailscale and no Ollama. */
export interface EngineHostDeps {
  tailscale?: () => { running: boolean; ip: string | undefined };
  startDaemon?: typeof startDaemon;
  platform?: NodeJS.Platform;
}

export interface HardwareWire {
  ramGB: number;
  gpu: boolean;
  platform: NodeJS.Platform;
  vramGB: number;
  maxModelGB: number;
  summary: string;
}

export type EventForward = (payload: {
  sessionId: string;
  seq: number;
  event: DriverEvent;
}) => void;

export type InstallForward = (payload: {
  modelId: string;
  line: string;
  percent?: number;
  completed?: number;
  total?: number;
}) => void;

// Raw PTY output for the renderer's xterm, base64 with its absolute end offset
// so a reopened terminal resumes from where it left off (Phase 2 desktop).
export type TerminalForward = (payload: { termId: string; b64: string; offset: number }) => void;

const OPENAI_KEY_NAME = 'openai-api-key';

export class EngineHost {
  private drivers = new Map<string, LocalDriver>();
  private unsubs = new Map<string, () => void>();
  private daemon?: RunningDaemon;
  // The desktop app's own PTYs (the same TerminalManager the daemon uses), plus
  // the live output subscriptions the renderer opened, keyed by termId.
  private terminals = new TerminalManager();
  private termSubs = new Map<string, () => void>();
  // Crew routines: the process-wide scheduler. The desktop is home, so it
  // runs whenever the app is open, daemon or no daemon; when the daemon is
  // started later it shares this same instance, so a routine fires once.
  private readonly scheduler: RoutineScheduler;
  private readonly deps: Required<EngineHostDeps>;

  constructor(
    private readonly forwardEvent: EventForward,
    private readonly forwardInstall: InstallForward,
    private readonly forwardTerminal: TerminalForward,
    deps: EngineHostDeps = {},
  ) {
    this.deps = {
      tailscale:
        deps.tailscale ?? (() => ({ running: detectTailscale().running, ip: tailscaleIp() })),
      startDaemon: deps.startDaemon ?? startDaemon,
      platform: deps.platform ?? process.platform,
    };
    // Reseal any pre-encryption sessions once the host is up. Off the launch
    // path and failure-tolerant: sealing protects data, it never blocks the app.
    setImmediate(() => {
      try {
        sealSessionsAtRest({ skipNewerThanMs: 60_000 });
      } catch {}
    });
    this.scheduler = getRoutineScheduler();
    // A run's session is registered here as it opens, so opening its
    // transcript from the command center resumes the live driver (and its
    // journal replay) instead of rehydrating a second copy under the run.
    this.scheduler.onDriver((driver) => {
      this.drivers.set(driver.id, driver as LocalDriver);
    });
  }

  // ---------------------------------------------------------------- sessions

  // Subscribe the forwarder and CAPTURE the journal replay instead of pushing it
  // over IPC. subscribe(sink, 0) synchronously replays every journaled entry
  // before it registers the sink for live events, so the entries emitted during
  // that synchronous window are the journal; everything after is live and
  // forwarded. Returning the journal (rather than webContents.send-ing it) fixes
  // G1: the renderer's osc:event listener is not attached yet at resume time, so
  // a pushed replay would land on the floor and the reopened chat renders blank.
  // The driver replays the returned journal AFTER it has subscribed.
  private attach(driver: LocalDriver): Array<{ seq: number; event: DriverEvent }> {
    this.unsubs.get(driver.id)?.();
    const journal: Array<{ seq: number; event: DriverEvent }> = [];
    let live = false;
    const off = driver.subscribe((event, seq) => {
      if (live) this.forwardEvent({ sessionId: driver.id, seq, event });
      else journal.push({ seq, event });
    }, 0);
    live = true;
    this.unsubs.set(driver.id, off);
    this.drivers.set(driver.id, driver);
    return journal;
  }

  // The agent's readTerminal tool reads this session's live PTY (Phase 2). Wired
  // through bootstrapSession the same way the daemon wires it, so the desktop
  // agent can look at the terminal too.
  private readTerminal = (sessionId: string, lines: number, termId?: string): string | undefined =>
    this.terminals.readForSession(sessionId, lines, termId);

  async createSession(
    cwd?: string,
    opts: {
      instructions?: string;
      permissionMode?: PermissionMode;
      projectName?: string;
      projectSecrets?: string;
      humanize?: boolean;
      codemagicToken?: string;
      codemagicTarget?: { appId: string; workflowId: string; branch: string; platform?: string };
      currents?: CurrentsHandles;
      harnessCurrents?: HarnessCurrentsHandle;
    } = {},
  ): Promise<{ id: string; cwd: string; warnings: string[] }> {
    const workDir = cwd ?? defaultWorkspace();
    // A CLI handle is honored only when that CLI is really on this machine's
    // PATH (same rule as the daemon), so the tool never registers for a
    // command that cannot run.
    let currents = opts.currents;
    if (currents?.cli && !cliCommandAvailable(currents.cli.command)) {
      const { cli: _dropped, ...rest } = currents;
      currents = Object.keys(rest).length ? rest : undefined;
    }
    const { driver, warnings } = bootstrapSession({
      cwd: workDir,
      profile: 'local-interactive',
      terminalReader: this.readTerminal,
      instructions: opts.instructions,
      permissionMode: opts.permissionMode,
      projectName: opts.projectName,
      projectSecrets: opts.projectSecrets,
      humanize: opts.humanize,
      codemagicToken: opts.codemagicToken,
      codemagicTarget: opts.codemagicTarget,
      currents,
      harnessCurrents: opts.harnessCurrents,
    });
    this.attach(driver); // a fresh session has an empty journal; nothing to replay
    return { id: driver.id, cwd: workDir, warnings };
  }

  async resumeSession(
    id: string,
  ): Promise<
    | { id: string; cwd: string; journal: Array<{ seq: number; event: DriverEvent }> }
    | { error: string }
  > {
    const live = this.drivers.get(id);
    if (live) {
      const journal = this.attach(live);
      return { id, cwd: live.cwd, journal };
    }
    const stored = listSessions().find((s) => s.id === id);
    if (!stored) return { error: `No stored session ${id}.` };
    try {
      const { driver } = bootstrapSession({
        cwd: stored.cwd,
        profile: 'local-interactive',
        sessionId: id,
        terminalReader: this.readTerminal,
      });
      const journal = this.attach(driver);
      return { id, cwd: stored.cwd, journal };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  listStoredSessions() {
    return listSessions().map((s) => ({
      id: s.id,
      cwd: s.cwd,
      title: s.title,
      updatedAt: s.updatedAt,
    }));
  }

  send(sessionId: string, text: string): void {
    this.drivers.get(sessionId)?.send(text);
  }

  abort(sessionId: string): void {
    this.drivers.get(sessionId)?.abort();
  }

  answerApproval(
    sessionId: string,
    approvalId: string,
    answer: {
      approve: boolean;
      alwaysThisSession?: boolean;
      alwaysInProject?: boolean;
      reason?: string;
    },
  ): void {
    this.drivers.get(sessionId)?.answerApproval(approvalId, answer);
  }

  // ---- the person's controls over a session: mode, instructions, compaction,
  // file search for @ mentions. Thin pass-throughs to the driver.

  setMode(sessionId: string, mode: PermissionMode): void {
    this.drivers.get(sessionId)?.setMode(mode);
  }

  setInstructions(sessionId: string, text: string | undefined): void {
    this.drivers.get(sessionId)?.setInstructions(text);
  }

  async compact(
    sessionId: string,
    focus?: string,
  ): Promise<{ before: number; after: number } | { error: string }> {
    const driver = this.drivers.get(sessionId);
    if (!driver) return { error: 'That session is not open.' };
    return driver.compact(focus);
  }

  listFiles(sessionId: string, query: string): string[] {
    return this.drivers.get(sessionId)?.listFiles(query) ?? [];
  }

  // ---------------------------------------------------- chat-to-terminal lane
  // The owner's tap on the desktop IS the approval, so runCommand runs straight
  // away. Output streams back as command-* events on the same LocalDriver the
  // host already subscribed in attach(), so nothing extra forwards them: they
  // ride the existing osc:event channel and the CommandCard renders for free.

  runCommand(sessionId: string, command: string): string | undefined {
    const driver = this.drivers.get(sessionId);
    if (!driver) return undefined;
    return driver.runCommand(command, { source: 'user' }).runId;
  }

  sendCommandStdin(sessionId: string, runId: string, data: string): void {
    this.drivers.get(sessionId)?.writeCommandStdin(runId, data);
  }

  killCommand(sessionId: string, runId: string): void {
    this.drivers.get(sessionId)?.killCommand(runId);
  }

  // ------------------------------------------- interactive terminal (Phase 2)
  // The desktop app runs the same TerminalManager the daemon does. A PTY is an
  // unjailed interactive shell; on the desktop the local user IS the owner, so
  // there is no cross-user boundary to enforce here (that gate lives on the
  // daemon, for a remote phone). Output rides its own forwarder, never the event
  // journal; stdin is never logged.

  async openTerminal(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<
    { termId: string; cols: number; rows: number } | { unavailable: true; error: string }
  > {
    // The plain home shell belongs to no session: it opens in the home folder
    // and reopens the shell it left running, the same rule as the daemon's.
    if (sessionId === HOME_SHELL_ID) {
      try {
        const termId = this.terminals.liveTermId(HOME_SHELL_ID);
        return await this.terminals.ensure({ sessionId, termId, cwd: homedir(), cols, rows });
      } catch (err) {
        return { unavailable: true, error: (err as Error).message };
      }
    }
    const driver = this.drivers.get(sessionId);
    if (!driver) return { unavailable: true, error: 'That session is not open.' };
    try {
      const info = await this.terminals.ensure({ sessionId, cwd: driver.cwd, cols, rows });
      // Content-free audit marker only (never output or stdin).
      driver.emit({ type: 'terminal-opened', termId: info.termId, cwd: driver.cwd });
      return info;
    } catch (err) {
      if (err instanceof TerminalUnavailable) return { unavailable: true, error: err.message };
      return { unavailable: true, error: (err as Error).message };
    }
  }

  /** Start forwarding a terminal's output (ring replay from sinceOffset, then
   *  live) to the renderer. Idempotent: a re-subscribe replaces the old one. */
  terminalSubscribe(termId: string, sinceOffset: number): boolean {
    this.termSubs.get(termId)?.();
    this.termSubs.delete(termId);
    const unsub = this.terminals.subscribe(termId, sinceOffset, (data, offset) => {
      this.forwardTerminal({ termId, b64: data.toString('base64'), offset });
    });
    if (!unsub) return false;
    this.termSubs.set(termId, unsub);
    return true;
  }

  terminalUnsubscribe(termId: string): void {
    this.termSubs.get(termId)?.();
    this.termSubs.delete(termId);
  }

  terminalStdin(termId: string, data: string): boolean {
    return this.terminals.write(termId, data);
  }

  terminalResize(termId: string, cols: number, rows: number): boolean {
    return this.terminals.resize(termId, cols, rows);
  }

  terminalKill(termId: string): boolean {
    this.terminalUnsubscribe(termId);
    return this.terminals.kill(termId);
  }

  // ------------------------------------------------------------------ status

  async status() {
    const { config } = loadConfig();
    const providers = new ProviderRegistry(config, getAnthropicKey);
    const hardware = detectHardware();
    const budget = budgetFor(
      hardware,
      config.resourceBudget.vramProfile === 'auto' ? undefined : config.resourceBudget.vramProfile,
    );

    let ollama = { up: false, detail: 'No local provider configured.', models: [] as string[] };
    for (const [id, provider] of providers.all()) {
      if (provider.kind !== 'local') continue;
      const health = await provider.health();
      let models: string[] = [];
      if (health.ok) {
        try {
          models = await provider.listModels();
        } catch {}
      }
      ollama = { up: health.ok, detail: health.detail, models };
      void id;
      break;
    }

    const stackConfig = config.stack;
    const orchestrator = stackConfig.orchestrator
      ? {
          model: stackConfig.orchestrator.model,
          provider: stackConfig.orchestrator.provider,
          kind: (config.providers[stackConfig.orchestrator.provider]?.kind === 'anthropic'
            ? 'cloud'
            : 'local') as 'local' | 'cloud',
        }
      : undefined;
    const specialists = Object.entries(stackConfig.specialists)
      .filter(([role]) => role !== 'imageGen')
      .map(([role, ref]) => ({ role, model: (ref as { model?: string }).model ?? '' }));

    return {
      ollama,
      hardwareSummary: budget.summary,
      hardware: this.hardware(),
      stack: {
        configured: Boolean(orchestrator),
        description: orchestrator
          ? `${orchestrator.model}${specialists.length ? ` + ${specialists.map((s) => s.role).join(', ')}` : ', solo'}`
          : 'not set up yet',
        orchestrator,
        specialists,
      },
      connections: {
        anthropic: Boolean(getAnthropicKey()),
        openai: Boolean(getCredential(OPENAI_KEY_NAME) ?? process.env.OPENAI_API_KEY),
        github: isGithubConnected(),
      },
    };
  }

  /** The machine in numbers, from the engine's own budget (the same one osc
   *  init and doctor use), so the app's fit verdicts never parse prose. */
  hardware(): HardwareWire {
    const { config } = loadConfig();
    const hw = detectHardware();
    const budget = budgetFor(
      hw,
      config.resourceBudget.vramProfile === 'auto' ? undefined : config.resourceBudget.vramProfile,
    );
    return {
      ramGB: hw.systemRamGB,
      gpu: hw.gpus.length > 0 && hw.totalVramGB >= 4,
      platform: this.deps.platform,
      vramGB: hw.totalVramGB,
      maxModelGB: budget.maxModelGB,
      summary: budget.summary,
    };
  }

  // ------------------------------------------------------------------ ollama
  // Ollama from inside the app (A3). Detection asks the API, then the binary;
  // starting spawns `ollama serve` detached; installing follows the platform's
  // plan (Linux: the official installer in the built-in terminal; macOS and
  // Windows: the download page, then the app polls ollamaStatus). The command
  // always comes back so the renderer can show it as a copy block.

  async ollamaStatus(): Promise<OllamaStatus> {
    return probeOllama({ baseUrl: firstLocalBaseUrl() });
  }

  async ollamaStart(): Promise<boolean> {
    return startOllama({ baseUrl: firstLocalBaseUrl() });
  }

  async ollamaInstall(): Promise<
    OllamaInstallPlan & { started: boolean; termId?: string; detail?: string }
  > {
    const plan = ollamaInstallPlan(this.deps.platform);
    if (plan.mode !== 'terminal') {
      // main.ts opens the download page; "started" means the page opened.
      return { ...plan, started: true };
    }
    try {
      const info = await this.terminals.ensure({
        sessionId: 'ollama-install',
        cwd: homedir(),
        cols: 100,
        rows: 30,
      });
      this.terminals.write(info.termId, `${plan.command}\r`);
      return { ...plan, started: true, termId: info.termId };
    } catch (err) {
      const detail =
        err instanceof TerminalUnavailable
          ? 'The built-in terminal is not available on this machine. Run the command in any terminal.'
          : (err as Error).message;
      return { ...plan, started: false, detail };
    }
  }

  // ------------------------------------------------------------- marketplace

  async catalog() {
    const { config } = loadConfig();
    const loaded = await loadCatalog(config, new EgressPolicy(config.egress));
    return { catalog: loaded.catalog, note: loaded.note };
  }

  // -------------------------------------------------------------- stack health

  async stackHealth(range?: StackHealthRange): Promise<StackHealth> {
    return computeStackHealth(range ?? 'week');
  }

  async installModel(modelId: string): Promise<{ ok: boolean; detail: string }> {
    const { config } = loadConfig();
    const loaded = await loadCatalog(config, new EgressPolicy(config.egress));
    const model = findModel(loaded.catalog, modelId);
    if (!model) return { ok: false, detail: `Nothing in the catalog called "${modelId}".` };
    const baseUrl = firstLocalBaseUrl();
    return installModel(
      model,
      (p) =>
        this.forwardInstall({
          modelId,
          line: p.line,
          percent: p.percent,
          completed: p.completed,
          total: p.total,
        }),
      { baseUrl },
    );
  }

  // Pull any Ollama model by name, not just a catalog entry, so every model on
  // the Ollama library is installable without a catalog update. Progress is
  // forwarded keyed by the ref itself.
  async installOllamaRef(ref: string): Promise<{ ok: boolean; detail: string }> {
    const baseUrl = firstLocalBaseUrl();
    return installOllamaRef(
      ref,
      (p) =>
        this.forwardInstall({
          modelId: ref,
          line: p.line,
          percent: p.percent,
          completed: p.completed,
          total: p.total,
        }),
      { baseUrl },
    );
  }

  // ------------------------------------------------------------------- stack

  async setOrchestrator(model: string): Promise<{ ok: boolean; detail: string }> {
    saveGlobalConfig({ stack: { orchestrator: { provider: firstLocalProviderId(), model } } });
    return { ok: true, detail: `${model} is now the quarterback.` };
  }

  async enableSpecialist(role: string, model: string): Promise<{ ok: boolean; detail: string }> {
    saveGlobalConfig({
      stack: { specialists: { [role]: { provider: firstLocalProviderId(), model } } },
    });
    return { ok: true, detail: `${role} specialist enabled: ${model}.` };
  }

  async disableSpecialist(role: string): Promise<{ ok: boolean; detail: string }> {
    // Deep merge cannot delete a key; edit the raw global config.
    const { readFileSync, writeFileSync } = await import('node:fs');
    const { globalConfigPath } = await import('os-code/dist/src/config/load.js');
    try {
      const raw = JSON.parse(readFileSync(globalConfigPath(), 'utf8'));
      if (raw.stack?.specialists?.[role]) {
        delete raw.stack.specialists[role];
        writeFileSync(globalConfigPath(), `${JSON.stringify(raw, null, 2)}\n`);
      }
    } catch {}
    return { ok: true, detail: `${role} is off. The quarterback covers it.` };
  }

  // ------------------------------------------------------------- connections

  async setAnthropicKey(key: string, workspaceId?: string) {
    const result = await loginWithApiKey(key, undefined, workspaceId);
    if (result.ok) {
      const { config } = loadConfig();
      if (!Object.values(config.providers).some((p) => p.kind === 'anthropic')) {
        saveGlobalConfig({ providers: { anthropic: { kind: 'anthropic' } } });
      }
    }
    return { ok: result.ok, detail: result.detail, needsWorkspace: result.needsWorkspace };
  }

  async setOpenAIKey(key: string) {
    const trimmed = key.trim();
    if (!/^sk-/.test(trimmed)) {
      return {
        ok: false,
        detail: 'That does not look like an OpenAI API key (they start with sk-).',
      };
    }
    setCredential(OPENAI_KEY_NAME, trimmed);
    saveGlobalConfig({
      providers: {
        openai: {
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com',
          apiKeyEnv: 'OPENAI_API_KEY',
          label: 'ChatGPT (OpenAI API)',
        },
      },
    });
    process.env.OPENAI_API_KEY = trimmed;
    return {
      ok: true,
      detail: 'ChatGPT is connected. Point any stack slot at the openai provider to use it.',
    };
  }

  async setGithubToken(token: string) {
    const result = await loginWithPat(token);
    return { ok: result.ok, detail: result.detail };
  }

  async disconnect(connector: 'anthropic' | 'openai' | 'github') {
    if (connector === 'anthropic') logoutClaude();
    else if (connector === 'github') logoutGithub();
    else deleteCredential(OPENAI_KEY_NAME);
  }

  // ------------------------------------------------------------------- repos

  async cloneRepo(
    url: string,
    token?: string,
  ): Promise<{ cwd: string; name: string } | { error: string }> {
    if (!/^(https:\/\/|git@)/.test(url.trim())) {
      return { error: 'That does not look like a git URL.' };
    }
    const name = cloneFolderName(url);
    if (!name) return { error: 'The repository name in that url is not usable as a folder name.' };
    // The connected platform's token, for a private repository: one clone, a
    // header scoped to the platform's host, never stored (os-code git/index.ts).
    try {
      const cwd = await cloneIntoManaged(url.trim(), name, { token });
      return { cwd, name };
    } catch (err) {
      return { error: `Could not clone: ${redactToken((err as Error).message, token)}` };
    }
  }

  // Push each clone's unpushed commits to its remote (merging a moved-on remote
  // first), so a project's memory notes and code never linger only on this
  // device. Read the reconcile engine for the safety rails (never force-push,
  // never merge over uncommitted work, conflicts surfaced not clobbered). Only
  // real, existing directories are attempted.
  private reconcileInFlight = false;
  async reconcileRepos(roots: string[]): Promise<ReconcileResult[]> {
    // A project can opt out of auto-push in its os-code.config.json
    // (sync.autoPush:false), e.g. when its branch deploys on push. Honor that
    // per repo before any git runs.
    const real = roots.filter((r) => {
      if (!r || !existsSync(r)) return false;
      try {
        return loadConfig(r).config.sync?.autoPush !== false;
      } catch {
        return true; // no readable config means the default (auto-push on)
      }
    });
    if (!real.length) return [];
    // Serialize in the main process: two windows (or a rapid open + reconnect)
    // must not run git on the same clones at once. A concurrent call is a no-op,
    // never a queued double-push; the next open/reconnect picks up anything left.
    if (this.reconcileInFlight) return [];
    this.reconcileInFlight = true;
    try {
      return await reconcileRepos(real);
    } finally {
      this.reconcileInFlight = false;
    }
  }

  recentWorkspaces(): WorkspaceRow[] {
    return listWorkspaces(listSessions());
  }

  // ----------------------------------------------------------- crew routines
  // The same surface the daemon serves the phone, over IPC. Validation lives
  // in the shared model so the desktop and the daemon refuse the same shapes;
  // the workspace gate lives in the scheduler so it holds for every caller.

  routinesList(): { routines: RoutineView[]; runs: RoutineRun[] } {
    return { routines: this.scheduler.list(), runs: this.scheduler.runs(60) };
  }

  routineCreate(input: unknown): { routine: RoutineView } | { error: string } {
    const parsed = validateRoutineInput(input);
    if (!parsed.ok) return { error: parsed.error };
    const created = this.scheduler.create(parsed.value);
    return 'error' in created ? created : { routine: created };
  }

  routineUpdate(id: string, patch: unknown): { routine: RoutineView } | { error: string } {
    const existing = this.scheduler.get(id);
    if (!existing) return { error: 'No such routine.' };
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { error: 'Send the fields to change.' };
    }
    const body = patch as Record<string, unknown>;
    // Validated as the whole routine it would produce (same as the daemon).
    const parsed = validateRoutineInput({
      name: existing.name,
      agentId: existing.agentId,
      agentName: existing.agentName,
      persona: existing.persona,
      task: existing.task,
      cwd: existing.cwd,
      projectName: existing.projectName,
      schedule: existing.schedule,
      enabled: existing.enabled,
      access: existing.access,
      maxMinutes: existing.maxMinutes,
      ...body,
    });
    if (!parsed.ok) return { error: parsed.error };
    const narrowed: Partial<RoutineInput> = {};
    for (const key of Object.keys(body) as Array<keyof RoutineInput>) {
      if (key in parsed.value) (narrowed as Record<string, unknown>)[key] = parsed.value[key];
    }
    const updated = this.scheduler.update(id, narrowed);
    return 'error' in updated ? updated : { routine: updated };
  }

  routineDelete(id: string): { deleted: boolean } {
    return { deleted: this.scheduler.remove(id) };
  }

  routineRun(id: string): { queued: true; position: number } | { error: string } {
    return this.scheduler.runNow(id);
  }

  routineStop(id: string): { stopped: boolean } {
    return { stopped: this.scheduler.stopRun(id) };
  }

  routineNote(runId: string): { path: string; markdown: string } | null {
    return this.scheduler.readNote(runId) ?? null;
  }

  // -------------------------------------------------------- agentic currents
  // The same read-only surface the daemon serves the phone, over IPC: what this
  // computer can host, and the notes in a Hermes home. Jailed and markdown-only
  // in the engine; nothing here writes.

  currentsProbe(): CurrentsHostProbe {
    return probeCurrentsHost();
  }

  hermesNotes(): { home: string; notes: HermesNoteMeta[] } {
    const home = hermesHome();
    return { home, notes: listHermesNotes(home) };
  }

  hermesNote(path: string): HermesNote | null {
    return readHermesNote(hermesHome(), path) ?? null;
  }

  // ------------------------------------------------------------------ daemon

  // Tailscale detection shells out (up to a few seconds if tailscaled hangs).
  // The Pair screen polls daemonInfo every few seconds, so cache the result on
  // a short TTL to keep those spawns off the main process's hot path (TS-P2-9).
  private tsCache?: { at: number; running: boolean; ip: string | undefined };

  private tailscaleState(fresh = false): { running: boolean; ip: string | undefined } {
    const now = Date.now();
    if (!fresh && this.tsCache && now - this.tsCache.at < 3000) {
      return { running: this.tsCache.running, ip: this.tsCache.ip };
    }
    const { running, ip } = this.deps.tailscale();
    this.tsCache = { at: now, running, ip };
    return { running, ip };
  }

  // The claim on the QR right now. Held steady across the Pair screen's polls
  // (a fresh claim per poll would make the QR flicker every few seconds) and
  // rotated only once the daemon reports it spent or expired. The claim is a
  // pointer to a credential the phone has yet to mint, never a credential.
  private claim?: { claim: string; expiresAt: string };

  private currentClaim(): { claim: string; expiresAt: string } | undefined {
    if (!this.daemon) return undefined;
    if (this.claim && this.daemon.pairClaimStatus(this.claim.claim) === 'live') return this.claim;
    this.claim = this.daemon.mintPairClaim();
    return this.claim;
  }

  daemonInfo() {
    const { config } = loadConfig();
    const ts = this.tailscaleState();
    const running = Boolean(this.daemon);
    const claim = this.currentClaim();
    return {
      running,
      host: this.daemon?.host,
      port: this.daemon?.port ?? config.daemon.port,
      // The one-time pairing claim for the QR, only while the hub is up. The
      // paired-device list is always surfaced so the revoke UI stays available.
      claim: claim?.claim,
      claimExpiresAt: claim?.expiresAt,
      devices: listPairedDevices(),
      tailscaleIp: ts.ip,
      tailscaleUp: ts.running,
      // With dual-bind, a tailnet daemon's host is the 100.x address; only the
      // loopback fallback (Tailscale down) reports 127.0.0.1. The Pair screen
      // uses this to avoid publishing an unreachable QR with false copy.
      mode: (this.daemon?.host === '127.0.0.1' ? 'loopback' : 'tailscale') as
        'loopback' | 'tailscale',
    };
  }

  // Bind the tailnet when it is up, else loopback so the hub still serves this
  // machine (and moves onto the tailnet later, see daemonRebind). A shared
  // pairing credential from before per-device pairing is retired here.
  private async bindDaemon(): Promise<{ error?: string; host?: string }> {
    const { config } = loadConfig();
    // A bind is rare (a tap, a re-bind poll), so it looks at the tailnet
    // fresh; the cache serves the Pair screen's every-few-seconds poll.
    const ts = this.tailscaleState(true);
    let tailnetError: string | undefined;
    if (ts.running && ts.ip) {
      try {
        this.daemon = await this.deps.startDaemon({
          config,
          bind: 'tailscale',
          port: config.daemon.port,
        });
        return { host: this.daemon.host };
      } catch (err) {
        tailnetError = (err as Error).message;
      }
    }
    try {
      this.daemon = await this.deps.startDaemon({
        config,
        bind: 'loopback',
        port: config.daemon.port,
      });
      return { host: this.daemon.host };
    } catch (err) {
      return { error: tailnetError ?? (err as Error).message };
    }
  }

  async daemonStart() {
    retireSharedPairingCredential();
    if (this.daemon) {
      // Already up: the only thing a second start can improve is the bind.
      await this.daemonRebind();
      return this.daemonInfo();
    }
    const bound = await this.bindDaemon();
    if (bound.error) return { error: bound.error };
    return this.daemonInfo();
  }

  /** Move a loopback daemon onto the tailnet once Tailscale is up. Polled by
   *  the shell; a no-op when there is nothing to do. True when it moved. On a
   *  failed move the hub comes back on loopback rather than going dark. */
  async daemonRebind(): Promise<boolean> {
    // Cheap exit first: only a loopback daemon can move, so a tailnet daemon
    // or a paused hub never spawns the tailscale probe.
    if (!this.daemon || this.daemon.host !== '127.0.0.1') return false;
    const ts = this.tailscaleState(true);
    if (
      !shouldRebind({
        running: Boolean(this.daemon),
        host: this.daemon?.host,
        tailscaleUp: ts.running,
        ip: ts.ip,
      })
    ) {
      return false;
    }
    this.daemon?.close();
    this.daemon = undefined;
    this.claim = undefined;
    // Read the new host from bindDaemon's return, not from this.daemon: the
    // guard above narrowed this.daemon and that narrowing outlives the
    // reassignment inside bindDaemon, collapsing a bare re-read to never.
    const bound = await this.bindDaemon();
    return bound.host !== undefined && bound.host !== '127.0.0.1';
  }

  async daemonStop() {
    this.daemon?.close();
    this.daemon = undefined;
    this.claim = undefined;
  }

  daemonRunning(): boolean {
    return Boolean(this.daemon);
  }

  /** How many sessions are mid-run right now, for the power-save blocker. */
  activeRuns(): number {
    let n = 0;
    for (const driver of this.drivers.values()) if (driver.busy) n++;
    return n;
  }

  // Every paired device credential, for the desktop's revoke list.
  listDeviceCredentials(): PairedDeviceWire[] {
    return listPairedDevices();
  }

  // Cut off one device by its credential id (the token hash). A lost phone is
  // revoked on its own, leaving every other paired device connected.
  revokeDeviceCredential(id: string): { removed: number } {
    return { removed: revokeCredential(id) };
  }

  disposeAll(): void {
    for (const off of this.unsubs.values()) off();
    this.unsubs.clear();
    for (const off of this.termSubs.values()) off();
    this.termSubs.clear();
    this.daemon?.close();
    this.scheduler.stop();
  }
}

function firstLocalProviderId(): string {
  const { config } = loadConfig();
  for (const [id, endpoint] of Object.entries(config.providers)) {
    if (endpoint.kind === 'openai-compatible') return id;
  }
  return 'ollama';
}

function firstLocalBaseUrl(): string {
  const { config } = loadConfig();
  for (const endpoint of Object.values(config.providers)) {
    if (endpoint.kind === 'openai-compatible') return endpoint.baseUrl;
  }
  return 'http://localhost:11434';
}

function defaultWorkspace(): string {
  const dir = join(homedir(), 'OSCode', 'scratch');
  mkdirSync(dir, { recursive: true });
  return dir;
}
