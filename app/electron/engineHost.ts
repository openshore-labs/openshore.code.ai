// The engine host: everything the renderer reaches through IPC, implemented
// against the os-code engine in the Electron main process. One place, typed,
// no Node in the renderer, keys never leave the machine.
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { loadConfig, saveGlobalConfig } from 'os-code/dist/src/config/load.js';
import { bootstrapSession } from 'os-code/dist/src/core/agent/bootstrap.js';
import {
  listSessions,
  sealSessionsAtRest,
  type LocalDriver,
} from 'os-code/dist/src/daemon/session.js';
import { startDaemon, type RunningDaemon } from 'os-code/dist/src/daemon/serve.js';
import { ProviderRegistry } from 'os-code/dist/src/providers/registry.js';
import { getAnthropicKey, loginWithApiKey, logoutClaude } from 'os-code/dist/src/auth/claude.js';
import { loginWithPat, logoutGithub, isGithubConnected } from 'os-code/dist/src/auth/github.js';
import { getCredential, setCredential, deleteCredential } from 'os-code/dist/src/auth/store.js';
import { detectHardware, budgetFor } from 'os-code/dist/src/router/resourceBudget.js';
import { loadCatalog, findModel } from 'os-code/dist/src/market/catalog.js';
import { installModel } from 'os-code/dist/src/market/install.js';
import { computeStackHealth } from 'os-code/dist/src/insights/stackHealth.js';
import { EgressPolicy } from 'os-code/dist/src/core/security/egress.js';
import { clone } from 'os-code/dist/src/git/index.js';
import { detectTailscale, tailscaleIp } from 'os-code/dist/src/connect/tailscale.js';
import { loadOrCreateToken } from 'os-code/dist/src/core/security/daemonAuth.js';
import { oscHome } from 'os-code/dist/src/config/load.js';
import type { DriverEvent, StackHealth, StackHealthRange } from 'os-code/protocol';

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

const OPENAI_KEY_NAME = 'openai-api-key';

export class EngineHost {
  private drivers = new Map<string, LocalDriver>();
  private unsubs = new Map<string, () => void>();
  private daemon?: RunningDaemon;

  constructor(
    private readonly forwardEvent: EventForward,
    private readonly forwardInstall: InstallForward,
  ) {
    // Reseal any pre-encryption sessions once the host is up. Off the launch
    // path and failure-tolerant: sealing protects data, it never blocks the app.
    setImmediate(() => {
      try {
        sealSessionsAtRest({ skipNewerThanMs: 60_000 });
      } catch {}
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

  async createSession(cwd?: string): Promise<{ id: string; cwd: string; warnings: string[] }> {
    const workDir = cwd ?? defaultWorkspace();
    const { driver, warnings } = bootstrapSession({ cwd: workDir, profile: 'local-interactive' });
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
    answer: { approve: boolean; alwaysThisSession?: boolean },
  ): void {
    this.drivers.get(sessionId)?.answerApproval(approvalId, answer);
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

  async setAnthropicKey(key: string) {
    const result = await loginWithApiKey(key);
    if (result.ok) {
      const { config } = loadConfig();
      if (!Object.values(config.providers).some((p) => p.kind === 'anthropic')) {
        saveGlobalConfig({ providers: { anthropic: { kind: 'anthropic' } } });
      }
    }
    return { ok: result.ok, detail: result.detail };
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

  async cloneRepo(url: string): Promise<{ cwd: string; name: string } | { error: string }> {
    if (!/^(https:\/\/|git@)/.test(url.trim())) {
      return { error: 'That does not look like a git URL.' };
    }
    const name = basename(url.trim().replace(/\.git$/, '')) || 'repo';
    const parent = join(homedir(), 'OSCode');
    mkdirSync(parent, { recursive: true });
    const target = join(parent, name);
    try {
      if (!existsSync(target)) await clone(url.trim(), target);
      return { cwd: target, name };
    } catch (err) {
      return { error: `Could not clone: ${(err as Error).message}` };
    }
  }

  recentWorkspaces() {
    const seen = new Set<string>();
    const out: Array<{ cwd: string; name: string; lastUsed?: string }> = [];
    for (const session of listSessions()) {
      if (seen.has(session.cwd) || !existsSync(session.cwd)) continue;
      seen.add(session.cwd);
      out.push({ cwd: session.cwd, name: basename(session.cwd), lastUsed: session.updatedAt });
      if (out.length >= 12) break;
    }
    return out;
  }

  // ------------------------------------------------------------------ daemon

  // Tailscale detection shells out (up to a few seconds if tailscaled hangs).
  // The Pair screen polls daemonInfo every few seconds, so cache the result on
  // a short TTL to keep those spawns off the main process's hot path (TS-P2-9).
  private tsCache?: { at: number; running: boolean; ip: string | undefined };

  private tailscaleState(): { running: boolean; ip: string | undefined } {
    const now = Date.now();
    if (this.tsCache && now - this.tsCache.at < 3000) {
      return { running: this.tsCache.running, ip: this.tsCache.ip };
    }
    const running = detectTailscale().running;
    const ip = tailscaleIp();
    this.tsCache = { at: now, running, ip };
    return { running, ip };
  }

  daemonInfo() {
    const { config } = loadConfig();
    const ts = this.tailscaleState();
    return {
      running: Boolean(this.daemon),
      host: this.daemon?.host,
      port: this.daemon?.port ?? config.daemon.port,
      token: loadOrCreateToken(join(oscHome(), 'daemon.token')),
      tailscaleIp: ts.ip,
      tailscaleUp: ts.running,
      // With dual-bind, a tailnet daemon's host is the 100.x address; only the
      // loopback fallback (Tailscale down) reports 127.0.0.1. The Pair screen
      // uses this to avoid publishing an unreachable QR with false copy.
      mode: (this.daemon?.host === '127.0.0.1' ? 'loopback' : 'tailscale') as
        'loopback' | 'tailscale',
    };
  }

  async daemonStart() {
    if (this.daemon) return this.daemonInfo();
    const { config } = loadConfig();
    try {
      this.daemon = await startDaemon({ config, bind: 'tailscale', port: config.daemon.port });
      return this.daemonInfo();
    } catch (err) {
      // Fall back to loopback so pairing on one machine still demos.
      try {
        this.daemon = await startDaemon({ config, bind: 'loopback', port: config.daemon.port });
        return this.daemonInfo();
      } catch {
        return { error: (err as Error).message };
      }
    }
  }

  async daemonStop() {
    this.daemon?.close();
    this.daemon = undefined;
  }

  disposeAll(): void {
    for (const off of this.unsubs.values()) off();
    this.unsubs.clear();
    this.daemon?.close();
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
