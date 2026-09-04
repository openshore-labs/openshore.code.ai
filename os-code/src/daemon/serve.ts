// The daemon. It owns the generation: sessions live here, phones attach and
// detach freely, and a dropped connection costs nothing because every event
// is journaled and replayable from any sequence number.
//
// Security posture (see src/core/security/):
//   - Binds loopback or the Tailscale interface. Never 0.0.0.0, no override.
//   - Every request authenticates with the daemon bearer token, independent
//     of network reachability.
//   - Sessions run on the remote-attached profile: stricter than sitting at
//     the desk, never looser.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import {
  assertSafeBind,
  bearerFrom,
  hasRole,
  loadOrCreateToken,
  resolveAuth,
} from '../core/security/daemonAuth.js';
import { oscHome, loadConfig } from '../config/load.js';
import type { OscConfig } from '../config/schema.js';
import { tailscaleIp } from '../connect/tailscale.js';
import { PERMISSION_MODES, type PermissionMode } from '../core/agent/types.js';
import { bootstrapSession } from '../core/agent/bootstrap.js';
import { LocalDriver, listSessions, sealSessionsAtRest } from './session.js';
import { TerminalManager, TerminalUnavailable } from './terminal.js';
import { PushNotifier, savePushConfig } from './push.js';
import { clone } from '../git/index.js';
import { applyOutboxItem, verifyCommit, type OutboxApplyRequest } from '../git/outbox.js';
import { withKeyLock } from '../git/applyQueue.js';
import { loadCatalog, findModel } from '../market/catalog.js';
import { installModel, type InstallProgress } from '../market/install.js';
import { ProviderRegistry } from '../providers/registry.js';
import { resolveStack } from '../router/stack.js';
import { computeStackHealth } from '../insights/stackHealth.js';
import type { StackHealthRange } from '../insights/stackHealthTypes.js';
import { getAnthropicKey } from '../auth/claude.js';
import type { ChatMessage } from '../providers/types.js';
import { EgressPolicy } from '../core/security/egress.js';
import { logger } from '../util/log.js';

// The phone app runs in a WebView, so the daemon must speak CORS: a
// capacitor://localhost origin preflights every authorized request. The
// bearer token still gates everything; CORS is transport manners, not auth.
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};

const log = logger('daemon');

// The free desktop-chat surface: read-only conversation with the user's own
// LOCAL models, no tools and no acting machinery (CTO ruling). The system line
// makes the model own that it is chat, not the coding agent.
const CHAT_SYSTEM = [
  'You are OpenShore, a warm, capable companion running as read-only chat over a phone-to-desktop link.',
  'Answer directly and concretely. Use markdown, and fence code with a language tag.',
  'You have no tools here: you cannot read or edit files, run commands, or commit. When a task needs that, say so and point the user to opening a repo on their desktop (the coding agent).',
  'Lead with the answer. When the person has to do something, give one step at a time and wait. If you cannot help with something here, say so and name where in the app it lives.',
  'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
  'Never use em dashes. Use a period or a comma instead.',
].join('\n');

export interface DaemonOptions {
  config: OscConfig;
  bind: 'loopback' | 'tailscale';
  port: number;
  /** The PTY host to use. Defaults to a real TerminalManager (node-pty). Tests
   *  pass one with an injected spawn so "node-pty not installed" and fake
   *  terminals are reproducible on any machine, built natives or not. */
  terminals?: TerminalManager;
}

export interface RunningDaemon {
  host: string;
  port: number;
  close(): void;
}

export function resolveBindHost(bind: 'loopback' | 'tailscale'): string {
  if (bind === 'tailscale') {
    const ip = tailscaleIp();
    if (!ip) {
      throw new Error(
        'No Tailscale interface found. Bring the tailnet up (sudo tailscale up) or use --bind loopback.',
      );
    }
    return ip;
  }
  return '127.0.0.1';
}

export function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const host = resolveBindHost(options.bind);
  assertSafeBind(host);
  const token = loadOrCreateToken(join(oscHome(), 'daemon.token'));
  const drivers = new Map<string, LocalDriver>();
  // Model installs kicked off from a paired phone (MP-F2). Progress is buffered
  // per model id so the phone can poll it, the same shape the Electron bridge
  // streams to the desktop app.
  type InstallState = InstallProgress & { done: boolean; ok?: boolean; detail?: string };
  const installs = new Map<string, InstallState>();
  // One egress policy for every outbound call (catalog refresh, completion push),
  // and the notifier that fires a content-free push when a run needs the user and
  // no phone is watching.
  const egress = new EgressPolicy(options.config.egress);
  const notifier = new PushNotifier(egress);
  // The interactive PTY host (Phase 2 bridge). Terminals live here, outliving
  // phone connections; their raw bytes never enter a session journal. Its
  // readForSession backs the agent's readTerminal tool, wired into every
  // bootstrapped session below.
  const terminals = options.terminals ?? new TerminalManager();
  const terminalReader = (sessionId: string, lines: number, termId?: string): string | undefined =>
    terminals.readForSession(sessionId, lines, termId);

  // Register a driver and attach the push watcher exactly once, wherever a
  // driver is created or rehydrated.
  const trackDriver = (driver: LocalDriver): void => {
    drivers.set(driver.id, driver);
    notifier.watch(driver);
  };

  // Reseal any pre-encryption sessions before serving. Off the startup path
  // (setImmediate) and failure-tolerant: sealing is protection, never an
  // availability risk.
  setImmediate(() => {
    try {
      const sealed = sealSessionsAtRest({ skipNewerThanMs: 60_000 });
      if (sealed.sealedLines > 0) {
        log.info('sealed legacy sessions at rest', sealed);
      }
    } catch {}
  });

  const requestListener = (req: IncomingMessage, res: ServerResponse): void => {
    void handle(req, res).catch((err) => {
      log.error('request failed', { err: String(err) });
      sendJson(res, 500, { error: 'Something went wrong in the daemon; check its logs.' });
    });
  };
  const server = createServer(requestListener);
  // When bound to the tailnet, also listen on loopback. `osc attach` (and any
  // same-machine tool) defaults to 127.0.0.1, so a tailscale-only bind left the
  // pair wizard's own `osc attach` step refused on the desktop. Loopback is
  // never less safe than the tailnet bind it accompanies.
  const loopbackServer = host !== '127.0.0.1' ? createServer(requestListener) : undefined;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await route(req, res);
    } catch (err) {
      if (err instanceof BadJson) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      throw err;
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS preflights carry no Authorization header by design; answer them
    // before the auth gate so the WebView can proceed to the real request.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    const presented = bearerFrom(req.headers.authorization);
    const auth = resolveAuth(presented, token);
    if (!auth) {
      sendJson(res, 401, {
        error:
          'Missing or wrong daemon credential. The shared token lives in ~/.os-code/daemon.token; per-user tokens come from `osc token mint`.',
      });
      return;
    }
    // requireAdmin gates a mutating admin route (403 for a member). Read routes
    // and a member's own session/outbox actions stay open to any valid member.
    // Wired here so an admin-only route (stack config, home-repo/storage config)
    // enforces server-side the moment it moves off the app and onto the daemon.
    const requireAdmin = (): boolean => {
      if (hasRole(auth, 'admin')) return true;
      sendJson(res, 403, { error: 'This needs an admin credential. Ask a company admin.' });
      return false;
    };

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'daemon'}`);
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        sessions: drivers.size,
        version: '0.1.0',
        role: auth.role,
        user: auth.userId,
      });
      return;
    }

    // ---- Completion push. ----
    // The phone hands the daemon an opaque grant (minted server-side for the
    // signed-in user) plus the push-send URL. The daemon holds it sealed at rest
    // and uses it only to fire content-free "session needs you" pushes.
    if (req.method === 'POST' && url.pathname === '/push/register') {
      const body = await readJson(req);
      const grant = typeof body.grant === 'string' ? body.grant : '';
      const sendUrl = typeof body.sendUrl === 'string' ? body.sendUrl : '';
      let parsed: URL | undefined;
      try {
        parsed = new URL(sendUrl);
      } catch {
        parsed = undefined;
      }
      if (!grant || !parsed || parsed.protocol !== 'https:') {
        sendJson(res, 400, { error: 'Send {"grant": "...", "sendUrl": "https://..."}.' });
        return;
      }
      savePushConfig(auth.userId, { grant, sendUrl });
      sendJson(res, 200, { registered: true });
      return;
    }
    // The phone beats while it is foreground on a session, so the daemon can tell
    // the user is watching and hold the push back. A live socket is NOT trusted
    // for this: a backgrounded iOS socket lingers half-open long after the app is
    // gone, which would suppress exactly the push the user needs.
    if (req.method === 'POST' && url.pathname === '/push/beat') {
      const body = await readJson(req);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      if (!sessionId) {
        sendJson(res, 400, { error: 'Send {"sessionId": "..."}.' });
        return;
      }
      notifier.recordBeat(sessionId);
      sendJson(res, 200, { ok: true });
      return;
    }

    // ---- Phone-app surfaces: workspaces, the stack, the catalog. ----
    if (req.method === 'GET' && url.pathname === '/workspaces') {
      sendJson(res, 200, { workspaces: recentWorkspaces() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/workspaces/clone') {
      // Cloning a repo onto the home machine provisions shared storage: an admin
      // action. A personal account authenticates with the legacy token as admin,
      // so solo users are unaffected.
      if (!requireAdmin()) return;
      const body = await readJson(req);
      const gitUrl = typeof body.url === 'string' ? body.url.trim() : '';
      if (!/^(https:\/\/|git@)/.test(gitUrl)) {
        sendJson(res, 400, { error: 'Send {"url": "https://github.com/owner/repo"}.' });
        return;
      }
      const name = basename(gitUrl.replace(/\.git$/, '')) || 'repo';
      const parent = join(homedir(), 'OSCode');
      mkdirSync(parent, { recursive: true });
      const target = join(parent, name);
      try {
        if (!existsSync(target)) await clone(gitUrl, target);
        sendJson(res, 200, { cwd: target, name });
      } catch (err) {
        sendJson(res, 400, { error: `Could not clone: ${(err as Error).message}` });
      }
      return;
    }

    // Install a catalog model onto this machine from a paired phone (MP-F2).
    // Admin-gated like clone: pulling weights provisions shared machine state.
    if (req.method === 'POST' && url.pathname === '/models/install') {
      if (!requireAdmin()) return;
      const body = await readJson(req);
      const modelId = typeof body.modelId === 'string' ? body.modelId : '';
      if (!modelId) {
        sendJson(res, 400, { error: 'Send {"modelId": "..."}.' });
        return;
      }
      let model;
      try {
        const loaded = await loadCatalog(options.config, egress);
        model = findModel(loaded.catalog, modelId);
      } catch (err) {
        sendJson(res, 502, { error: `Could not load the catalog: ${(err as Error).message}` });
        return;
      }
      if (!model) {
        sendJson(res, 404, { error: `No catalog model "${modelId}".` });
        return;
      }
      const running = installs.get(modelId);
      if (running && !running.done) {
        sendJson(res, 202, { modelId, alreadyRunning: true });
        return;
      }
      installs.set(modelId, { line: 'starting', done: false });
      void installModel(model, (p) => {
        installs.set(modelId, { ...p, done: false });
      })
        .then((result) => {
          const prev = installs.get(modelId);
          installs.set(modelId, {
            line: result.detail,
            percent: prev?.percent,
            completed: prev?.completed,
            total: prev?.total,
            done: true,
            ok: result.ok,
            detail: result.detail,
          });
        })
        .catch((err) => {
          installs.set(modelId, { line: String(err), done: true, ok: false, detail: String(err) });
        });
      sendJson(res, 202, { modelId });
      return;
    }
    if (
      req.method === 'GET' &&
      parts[0] === 'models' &&
      parts[1] === 'install' &&
      parts[2] &&
      parts[3] === 'progress'
    ) {
      const state = installs.get(decodeURIComponent(parts[2]));
      if (!state) {
        sendJson(res, 404, { error: 'No install in progress for that model.' });
        return;
      }
      sendJson(res, 200, state);
      return;
    }
    // Apply a buffered commit-intent from a phone into a real commit + push.
    // Serialized per repo so the temp-index build is atomic; idempotent on
    // clientOpId; a conflict lands on a rescue branch (never a force-push).
    if (req.method === 'POST' && url.pathname === '/outbox/apply') {
      const body = await readJson(req);
      const cwd = typeof body.cwd === 'string' ? body.cwd : '';
      if (!cwd || !existsSync(cwd)) {
        sendJson(res, 400, { ok: false, error: 'Send a valid repo cwd.' });
        return;
      }
      // An apply creates a commit and pushes it with the desktop's credentials,
      // a stronger capability than opening a session, so it is gated to an
      // allowed outbox target on this machine, never an arbitrary repo path.
      if (!isOutboxAllowedPath(cwd, options.config)) {
        sendJson(res, 403, {
          ok: false,
          error: 'This repo is not an allowed outbox target on this machine.',
        });
        return;
      }
      const request = body as unknown as OutboxApplyRequest;
      if (
        !request.clientOpId ||
        !request.itemId ||
        !request.branch ||
        !request.baseCommit ||
        !Array.isArray(request.files)
      ) {
        sendJson(res, 400, {
          ok: false,
          error: 'Missing clientOpId, itemId, branch, baseCommit, or files.',
        });
        return;
      }
      try {
        const result = await withKeyLock(cwd, () => applyOutboxItem(request));
        const status = result.ok ? 200 : 'conflict' in result && result.conflict ? 409 : 400;
        sendJson(res, status, result);
      } catch (err) {
        sendJson(res, 500, { ok: false, error: (err as Error).message });
      }
      return;
    }

    // Independent confirmation: does a committed result exist and sit on the
    // branch? The phone calls this after an apply, before clearing its buffer.
    if (req.method === 'GET' && url.pathname === '/outbox/verify') {
      const cwd = url.searchParams.get('cwd') ?? '';
      const commit = url.searchParams.get('commit') ?? '';
      const branch = url.searchParams.get('branch') ?? undefined;
      if (!cwd || !existsSync(cwd) || !commit) {
        sendJson(res, 400, { error: 'Send cwd and commit.' });
        return;
      }
      // Same allowlist gate as apply: never probe an arbitrary repo path.
      if (!isOutboxAllowedPath(cwd, options.config)) {
        sendJson(res, 403, { error: 'This repo is not an allowed outbox target on this machine.' });
        return;
      }
      try {
        sendJson(res, 200, await verifyCommit({ cwd, commit, branch }));
      } catch (err) {
        // R-15: a thrown lookup error is not proof the commit is missing.
        // Returning {exists:false} makes a landed commit look failed and the
        // phone marks its buffered item failed. Surface a 500 so the client
        // keeps the item and retries, instead of a false negative.
        sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/stack') {
      const stack = options.config.stack;
      const orchestrator = stack.orchestrator
        ? {
            model: stack.orchestrator.model,
            provider: stack.orchestrator.provider,
            kind: (options.config.providers[stack.orchestrator.provider]?.kind === 'anthropic'
              ? 'cloud'
              : 'local') as 'local' | 'cloud',
          }
        : undefined;
      const specialists = Object.entries(stack.specialists)
        .filter(([role]) => role !== 'imageGen')
        .map(([role, ref]) => ({ role, model: (ref as { model?: string }).model ?? '' }));
      sendJson(res, 200, {
        description: orchestrator
          ? `${orchestrator.model}${specialists.length ? ` + ${specialists.map((s) => s.role).join(', ')}` : ', solo'}`
          : 'not set up yet',
        orchestrator,
        specialists,
      });
      return;
    }
    // Stack Health, folded on this machine from the sessions already on disk and
    // served to a paired phone so the dashboard reaches every device without a
    // copy leaving the hub. The phone is a window onto this machine: the numbers
    // are computed here, on the local journals, and only the aggregate payload
    // crosses the tailnet. Member-auth, the same gate as /stack and /catalog.
    if (req.method === 'GET' && url.pathname === '/stack-health') {
      const raw = url.searchParams.get('range') ?? 'week';
      const allowed: StackHealthRange[] = ['day', 'week', 'month', 'year', 'all'];
      const range = (allowed as string[]).includes(raw) ? (raw as StackHealthRange) : 'week';
      try {
        sendJson(res, 200, computeStackHealth(range));
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/catalog') {
      try {
        const loaded = await loadCatalog(options.config, egress);
        sendJson(res, 200, { catalog: loaded.catalog, source: loaded.source, note: loaded.note });
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }
    // Free, read-only chat with the desktop's LOCAL models (the free tier the
    // C-suite approved). This path instantiates NONE of the acting machinery:
    // no AgentSession, no LocalDriver, no ToolRegistry, no command lane, no
    // outbox, no journal, no cloud escalation. It builds only a provider and
    // streams one completion, so it physically cannot read, edit, run, or
    // commit. Member-auth, same bearer gate as everything else.
    if (req.method === 'POST' && url.pathname === '/chat') {
      const body = await readJson(req);
      const rawMessages = Array.isArray(body.messages) ? body.messages : undefined;
      if (!rawMessages) {
        sendJson(res, 400, { error: 'Send {"messages": [{"role","content"}, ...]}.' });
        return;
      }
      // Load the config fresh (like bootstrapSession) so this reflects the
      // user's actual stack, not the snapshot the daemon started with.
      const chatConfig = loadConfig().config;
      const providers = new ProviderRegistry(chatConfig, getAnthropicKey);
      let orchestrator;
      try {
        orchestrator = resolveStack(chatConfig, providers).orchestrator;
      } catch (err) {
        sendJson(res, 400, {
          error: `No local model to chat with: ${(err as Error).message}`,
        });
        return;
      }
      // Pin to local: a free surface never spends the user's cloud budget.
      if (orchestrator.provider.kind !== 'local') {
        sendJson(res, 400, {
          error:
            'Free desktop chat runs your local models. Set a local orchestrator in your stack.',
        });
        return;
      }
      const model =
        typeof body.model === 'string' && body.model ? body.model : orchestrator.ref.model;
      const messages: ChatMessage[] = [
        { role: 'system', content: CHAT_SYSTEM },
        ...rawMessages
          .filter(
            (m: unknown): m is { role: string; content: string } =>
              Boolean(m) &&
              typeof (m as { content?: unknown }).content === 'string' &&
              ['user', 'assistant'].includes((m as { role?: unknown }).role as string),
          )
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        ...CORS_HEADERS,
      });
      const controller = new AbortController();
      req.on('close', () => controller.abort());
      try {
        for await (const ev of orchestrator.provider.chat({ model, messages }, controller.signal)) {
          // Tools are never sent, so a tool-call event cannot occur; only text
          // is streamed. Anything else is ignored, keeping the surface inert.
          if (ev.type === 'text' && ev.delta) {
            res.write(`data: ${JSON.stringify({ type: 'text', delta: ev.delta })}\n\n`);
          }
        }
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      } catch (err) {
        res.write(
          `data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`,
        );
      }
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/sessions') {
      const live = [...drivers.values()].map((d) => ({
        id: d.id,
        cwd: d.cwd,
        busy: d.busy,
        model: d.describeModel(),
      }));
      sendJson(res, 200, { live, stored: listSessions() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/sessions') {
      const body = await readJson(req);
      const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : process.cwd();
      const instructions = typeof body.instructions === 'string' ? body.instructions : undefined;
      const projectName = typeof body.projectName === 'string' ? body.projectName : undefined;
      const permissionMode = isPermissionMode(body.permissionMode)
        ? body.permissionMode
        : undefined;
      // The app's Humanize Writing setting for this session (only ever an off).
      const humanize = typeof body.humanize === 'boolean' ? body.humanize : undefined;
      if (!hasRole(auth, 'admin') && !isAdminProvisionedWorkspace(cwd)) {
        sendJson(res, 403, {
          error:
            'Members can only open a session in a workspace an admin has provisioned. Ask a company admin to clone the repo.',
        });
        return;
      }
      try {
        const { driver, warnings } = bootstrapSession({
          cwd,
          profile: 'remote-attached',
          terminalReader,
          instructions,
          projectName,
          permissionMode,
          humanize,
        });
        trackDriver(driver);
        driver.setOwner(auth.userId);
        sendJson(res, 201, { id: driver.id, cwd, warnings });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    if (parts[0] === 'sessions' && parts[1]) {
      const id = parts[1];
      // A member may only touch their own session, across input/abort/
      // approvals/events and rehydrate (D1). Admins (and the legacy shared
      // token) are unrestricted; a session with no recorded owner is treated as
      // admin-only, so a member cannot reach a legacy or another user's session.
      const ownedBy = (owner: string | undefined): boolean =>
        hasRole(auth, 'admin') || owner === auth.userId;
      let driver = drivers.get(id);
      if (!driver) {
        const stored = listSessions().find((s) => s.id === id);
        if (stored) {
          if (!ownedBy(stored.ownerUserId)) {
            sendJson(res, 403, { error: `Session ${id} belongs to another user.` });
            return;
          }
          // Rehydrate a stored session: the journal replays, a fresh agent continues.
          try {
            const { driver: revived } = bootstrapSession({
              cwd: stored.cwd,
              profile: 'remote-attached',
              sessionId: id,
              terminalReader,
            });
            trackDriver(revived);
            driver = revived;
          } catch (err) {
            sendJson(res, 400, { error: (err as Error).message });
            return;
          }
        }
      }
      if (!driver) {
        sendJson(res, 404, { error: `No session ${id}. GET /sessions lists what exists.` });
        return;
      }
      if (!ownedBy(driver.owner)) {
        sendJson(res, 403, { error: `Session ${id} belongs to another user.` });
        return;
      }

      if (req.method === 'POST' && parts[2] === 'input') {
        const body = await readJson(req);
        if (typeof body.text !== 'string' || !body.text.trim()) {
          sendJson(res, 400, { error: 'Send {"text": "..."}.' });
          return;
        }
        driver.send(body.text);
        sendJson(res, 202, { queued: true, busy: driver.busy });
        return;
      }
      if (req.method === 'POST' && parts[2] === 'abort') {
        driver.abort();
        sendJson(res, 200, { aborted: true });
        return;
      }
      // ---- the person's controls: mode, instructions, compaction, files ----
      if (req.method === 'POST' && parts[2] === 'mode') {
        const body = await readJson(req);
        if (!isPermissionMode(body.mode)) {
          sendJson(res, 400, {
            error: 'Send {"mode": "default" | "acceptEdits" | "plan" | "bypassPermissions"}.',
          });
          return;
        }
        driver.setMode(body.mode);
        sendJson(res, 200, { mode: driver.mode });
        return;
      }
      if (req.method === 'POST' && parts[2] === 'instructions') {
        const body = await readJson(req);
        driver.setInstructions(typeof body.text === 'string' ? body.text : undefined);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && parts[2] === 'compact') {
        const body = await readJson(req);
        const result = await driver.compact(
          typeof body.focus === 'string' ? body.focus : undefined,
        );
        sendJson(res, 'error' in result ? 409 : 200, result);
        return;
      }
      if (req.method === 'GET' && parts[2] === 'files') {
        const q = url.searchParams.get('q') ?? '';
        sendJson(res, 200, { files: driver.listFiles(q) });
        return;
      }
      // ---- user-initiated command lane (chat-to-terminal bridge) ----
      // The owner is already established above (ownedBy). Their explicit tap is
      // the approval, so no model approval is raised; the run is audited in the
      // sealed journal (command-start records the exact command and cwd).
      if (req.method === 'POST' && parts[2] === 'commands' && !parts[3]) {
        const body = await readJson(req);
        if (typeof body.command !== 'string' || !body.command.trim()) {
          sendJson(res, 400, { error: 'Send {"command": "..."}.' });
          return;
        }
        const { runId } = driver.runCommand(body.command);
        sendJson(res, 202, { runId });
        return;
      }
      if (req.method === 'POST' && parts[2] === 'commands' && parts[3] && parts[4] === 'stdin') {
        const body = await readJson(req);
        if (typeof body.data !== 'string') {
          sendJson(res, 400, { error: 'Send {"data": "..."}.' });
          return;
        }
        const ok = driver.writeCommandStdin(parts[3], body.data);
        if (!ok) {
          sendJson(res, 404, { error: `No running command ${parts[3]} on session ${id}.` });
          return;
        }
        sendJson(res, 200, { wrote: true });
        return;
      }
      if (req.method === 'POST' && parts[2] === 'commands' && parts[3] && parts[4] === 'kill') {
        const ok = driver.killCommand(parts[3]);
        if (!ok) {
          sendJson(res, 404, { error: `No running command ${parts[3]} on session ${id}.` });
          return;
        }
        sendJson(res, 200, { killed: true });
        return;
      }

      // ---- interactive PTY terminal (Phase 2 chat-to-terminal bridge) ----
      // A PTY is an UNJAILED interactive shell (unlike the command lane, which
      // is still a shell but every run is journaled and content-capped). So the
      // whole terminal surface is ADMIN-only, owner already established above via
      // ownedBy. Members keep the approval-gated agent lane and the user command
      // lane; they never get a raw shell. The raw byte stream rides its OWN SSE
      // endpoint with offset replay, entirely separate from the event journal:
      // only content-free terminal-opened/terminal-closed markers are journaled,
      // and stdin (where sudo passwords live) is never journaled or logged.
      if (parts[2] === 'term') {
        if (!requireAdmin()) return;

        // POST /sessions/:id/term  -> ensure/create, returns {termId, cols, rows}.
        if (req.method === 'POST' && !parts[3]) {
          const body = await readJson(req);
          const cols = typeof body.cols === 'number' ? body.cols : undefined;
          const rows = typeof body.rows === 'number' ? body.rows : undefined;
          try {
            const info = await terminals.ensure({ sessionId: id, cwd: driver.cwd, cols, rows });
            // Content-free audit marker only (cwd allowed, never output/stdin).
            driver.emit({ type: 'terminal-opened', termId: info.termId, cwd: driver.cwd });
            sendJson(res, 201, info);
          } catch (err) {
            if (err instanceof TerminalUnavailable) {
              sendJson(res, 503, { error: err.message });
              return;
            }
            sendJson(res, 500, { error: (err as Error).message });
          }
          return;
        }

        const termId = parts[3];
        if (termId) {
          // GET /sessions/:id/term/:termId/stream?since=<byteOffset>  -> SSE of
          // base64 output chunks, each frame carrying its END offset; replay
          // from the ring buffer then live. Same backpressure/cleanup discipline
          // as the /events route.
          if (req.method === 'GET' && parts[4] === 'stream') {
            if (!terminals.has(termId)) {
              sendJson(res, 404, { error: `No terminal ${termId} on session ${id}.` });
              return;
            }
            const sinceRaw = Number(url.searchParams.get('since') ?? 0);
            const since = Number.isFinite(sinceRaw) && sinceRaw >= 0 ? sinceRaw : 0;
            res.writeHead(200, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
              ...CORS_HEADERS,
            });
            res.write(':ok\n\n');
            let closed = false;
            let backpressure = 0;
            const teardown: Array<() => void> = [];
            const cleanup = (): void => {
              if (closed) return;
              closed = true;
              for (const fn of teardown.splice(0)) fn();
            };
            const safeWrite = (chunk: string): void => {
              if (closed || res.writableEnded) return;
              if (res.write(chunk)) {
                backpressure = 0;
                return;
              }
              backpressure += 1;
              if (backpressure >= 5 || res.writableLength > 1_000_000) {
                cleanup();
                res.destroy();
              }
            };
            const unsubscribe = terminals.subscribe(termId, since, (data, endOffset) => {
              safeWrite(
                `data: ${JSON.stringify({ b64: data.toString('base64'), offset: endOffset })}\n\n`,
              );
            });
            // has() passed with no await since, so subscribe finds it; guard
            // regardless, and stop if the synchronous replay tripped teardown.
            if (!unsubscribe || closed) {
              unsubscribe?.();
              cleanup();
              return;
            }
            teardown.push(unsubscribe);
            const keepalive = setInterval(() => safeWrite(':ka\n\n'), 15_000);
            teardown.push(() => clearInterval(keepalive));
            res.socket?.setTimeout(120_000, () => {
              cleanup();
              res.destroy();
            });
            req.on('close', cleanup);
            res.on('error', cleanup);
            return;
          }

          // POST /sessions/:id/term/:termId/stdin  -> {dataBase64}. NEVER
          // journaled or logged: keystrokes carry sudo passwords.
          if (req.method === 'POST' && parts[4] === 'stdin') {
            const body = await readJson(req);
            if (typeof body.dataBase64 !== 'string') {
              sendJson(res, 400, { error: 'Send {"dataBase64": "..."}.' });
              return;
            }
            const data = Buffer.from(body.dataBase64, 'base64').toString('utf8');
            const ok = terminals.write(termId, data);
            if (!ok) {
              sendJson(res, 404, { error: `No terminal ${termId} on session ${id}.` });
              return;
            }
            sendJson(res, 200, { wrote: true });
            return;
          }

          // POST /sessions/:id/term/:termId/resize -> {cols, rows}.
          if (req.method === 'POST' && parts[4] === 'resize') {
            const body = await readJson(req);
            const cols = typeof body.cols === 'number' ? body.cols : 0;
            const rows = typeof body.rows === 'number' ? body.rows : 0;
            if (!cols || !rows) {
              sendJson(res, 400, { error: 'Send {"cols": N, "rows": N}.' });
              return;
            }
            const ok = terminals.resize(termId, cols, rows);
            if (!ok) {
              sendJson(res, 404, { error: `No terminal ${termId} on session ${id}.` });
              return;
            }
            sendJson(res, 200, { resized: true });
            return;
          }

          // DELETE /sessions/:id/term/:termId -> kill.
          if (req.method === 'DELETE' && !parts[4]) {
            const ok = terminals.kill(termId);
            if (!ok) {
              sendJson(res, 404, { error: `No terminal ${termId} on session ${id}.` });
              return;
            }
            driver.emit({ type: 'terminal-closed', termId });
            sendJson(res, 200, { killed: true });
            return;
          }
        }
      }
      if (req.method === 'POST' && parts[2] === 'approvals' && parts[3]) {
        const body = await readJson(req);
        // Require an explicit boolean: a missing/garbled field must 400, never
        // silently resolve as a denial (P2-7).
        if (typeof body.approve !== 'boolean') {
          sendJson(res, 400, { error: 'Send {"approve": true} or {"approve": false}.' });
          return;
        }
        // An unknown/already-answered approval id is a 404, not a 200 no-op.
        if (!driver.pendingApprovalIds().includes(parts[3])) {
          sendJson(res, 404, { error: `No pending approval ${parts[3]} on session ${id}.` });
          return;
        }
        driver.answerApproval(parts[3], {
          approve: body.approve,
          alwaysThisSession: Boolean(body.alwaysThisSession),
          alwaysInProject: Boolean(body.alwaysInProject),
          reason: typeof body.reason === 'string' ? body.reason : undefined,
        });
        sendJson(res, 200, { resolved: true });
        return;
      }
      if (req.method === 'GET' && parts[2] === 'events') {
        const sinceRaw = Number(url.searchParams.get('since') ?? 0);
        // Garbage (NaN) or a negative would otherwise skip the replay silently.
        const since = Number.isFinite(sinceRaw) && sinceRaw >= 0 ? sinceRaw : 0;
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          ...CORS_HEADERS,
        });
        res.write(':ok\n\n');
        // A phone that roams networks can leave this socket half-open for
        // minutes. Guard the writes (TS-P2-7): stop and tear down once the peer
        // stops draining (backpressure) or the socket errors or idles, instead
        // of buffering every event into a dead response forever.
        let closed = false;
        let backpressure = 0;
        const teardown: Array<() => void> = [];
        const cleanup = (): void => {
          if (closed) return;
          closed = true;
          for (const fn of teardown.splice(0)) fn();
        };
        const safeWrite = (chunk: string): void => {
          if (closed || res.writableEnded) return;
          if (res.write(chunk)) {
            backpressure = 0;
            return;
          }
          backpressure += 1;
          if (backpressure >= 5 || res.writableLength > 1_000_000) {
            cleanup();
            res.destroy();
          }
        };
        // subscribe replays journaled events synchronously; if that replay
        // already tripped the backpressure teardown, unsubscribe and stop before
        // arming the keepalive.
        const unsubscribe = driver.subscribe((event, seq) => {
          safeWrite(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
        }, since);
        if (closed) {
          unsubscribe();
          return;
        }
        teardown.push(unsubscribe);
        const keepalive = setInterval(() => safeWrite(':ka\n\n'), 15_000);
        teardown.push(() => clearInterval(keepalive));
        res.socket?.setTimeout(120_000, () => {
          cleanup();
          res.destroy();
        });
        req.on('close', cleanup);
        res.on('error', cleanup);
        return;
      }
    }

    sendJson(res, 404, { error: `No route ${req.method} ${url.pathname}.` });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    const closeAll = (): void => {
      server.close();
      loopbackServer?.close();
    };
    server.listen(options.port, host, () => {
      log.info('daemon up', { host, port: options.port });
      if (loopbackServer) {
        loopbackServer.once('error', (err) => {
          // A loopback conflict must not take the tailnet listener down (or hang
          // startup): the primary bind is what the phone uses. Log, resolve with
          // the tailnet-only daemon, and carry on. resolve() is idempotent, so
          // the success path below is harmless if it also fires.
          log.warn('loopback listener failed', { err: String(err) });
          resolve({ host, port: options.port, close: closeAll });
        });
        loopbackServer.listen(options.port, '127.0.0.1', () => {
          log.info('daemon also on loopback', { port: options.port });
          resolve({ host, port: options.port, close: closeAll });
        });
      } else {
        resolve({ host, port: options.port, close: closeAll });
      }
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    ...CORS_HEADERS,
  });
  res.end(text);
}

/**
 * Admin-provisioned workspaces are the repos an admin cloned onto the home
 * machine (under ~/OSCode, via POST /workspaces/clone). A member may only open
 * sessions inside one of these: without this a member token could point a
 * session at any path on disk as its jail root and drive it (D1). Admins (and
 * the legacy shared token, which resolves as admin) are unrestricted.
 */
export function isAdminProvisionedWorkspace(cwd: string): boolean {
  const managed = resolve(join(homedir(), 'OSCode'));
  const target = resolve(cwd);
  return target === managed || target.startsWith(managed + sep);
}

/**
 * The outbox apply/verify endpoints take a repo path from the request body.
 * Without a gate, any member token can commit and push to ANY repo on the
 * admin's machine using the admin's ambient git credentials (a cross-repo
 * escalation and an exfil path). Restrict both endpoints to the same
 * admin-provisioned workspaces sessions use, plus any explicit
 * daemon.outboxAllowedRoots (for a home repo outside ~/OSCode). Enforced for
 * every caller, admins included: there is no legitimate apply/verify to a repo
 * outside the configured set.
 */
export function isOutboxAllowedPath(cwd: string, config: OscConfig): boolean {
  if (isAdminProvisionedWorkspace(cwd)) return true;
  const target = resolve(cwd);
  for (const root of config.daemon.outboxAllowedRoots ?? []) {
    const allowed = resolve(root);
    if (target === allowed || target.startsWith(allowed + sep)) return true;
  }
  return false;
}

/** Recent workspaces: session cwds, newest first, deduped, existing only. */
function recentWorkspaces(): Array<{ cwd: string; name: string; lastUsed?: string }> {
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

/** A request body that was present but not a JSON object. Caught centrally and
 *  answered 400, so a malformed POST can never silently read as an empty {}
 *  (which, on an approval, resolved as a denial and returned 200) (P2-7). */
class BadJson extends Error {}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BadJson('The request body is not valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadJson('The request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function isPermissionMode(v: unknown): v is PermissionMode {
  return typeof v === 'string' && (PERMISSION_MODES as readonly string[]).includes(v);
}
