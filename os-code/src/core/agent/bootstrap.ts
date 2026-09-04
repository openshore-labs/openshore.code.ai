// Session bootstrap: one function turns (cwd, profile) into a live, wired
// LocalDriver + AgentSession. The run command, the daemon, and the eval
// harness all build sessions through here so wiring never drifts.
import type { OscConfig } from '../../config/schema.js';
import { addProjectPermissionRule, loadConfig } from '../../config/load.js';
import { ProviderRegistry } from '../../providers/registry.js';
import { getAnthropicKey } from '../../auth/claude.js';
import { resolveStack } from '../../router/stack.js';
import { Router } from '../../router/router.js';
import { buildToolContext, buildToolRegistry } from './registry.js';
import { AgentSession } from './loop.js';
import { seedHistoryFromEvents, unresolvedApprovalIds } from './seed.js';
import { PermissionEngine, type PermissionConfig } from '../permissions/index.js';
import { Guardrails } from '../guardrails/index.js';
import { profileFor, type SecurityProfileName } from '../security/profiles.js';
import { UsageTracker } from '../../auth/usage.js';
import { LocalDriver } from '../../daemon/session.js';
import { buildCodeMap } from '../../context/codeMap.js';
import { readRepoInstructions } from './instructions.js';
import { gateProjectSecrets } from './secretsGate.js';
import { humanizerEnabled } from './humanizerStandard.js';
import type { PermissionMode } from './types.js';
import { logger } from '../../util/log.js';

const log = logger('bootstrap');

export interface BootstrapOptions {
  cwd: string;
  profile: SecurityProfileName;
  sessionId?: string;
  persist?: boolean;
  /** Preloaded config (tests); defaults to loading from disk. */
  config?: OscConfig;
  /**
   * Read this session's live PTY terminal output (Phase 2 bridge). Wired only by
   * the daemon, which owns the TerminalManager. CLI and test bootstraps leave it
   * undefined, so the readTerminal tool degrades to "no terminal here".
   */
  terminalReader?: (sessionId: string, lines: number, termId?: string) => string | undefined;
  /** The person's standing instructions for the project this chat belongs to. */
  instructions?: string;
  /** The name of the project this chat belongs to, when it belongs to one. Used
   *  to place the project's memory notes under Projects/<project>/ in the vault.
   *  Undefined for a project-less chat or the bare CLI (the memory folder then
   *  falls back to the workspace basename). */
  projectName?: string;
  /** The project's tokens and secrets markdown, decrypted, passed only when the
   *  person has turned the feature on. It reaches the model ONLY when the
   *  orchestrator is local; a cloud orchestrator drops it. See the gate in
   *  bootstrapSession. */
  projectSecrets?: string;
  /** The permission mode to start in (default: ask for writes and shell). */
  permissionMode?: PermissionMode;
  /** The app's "Humanize Writing" setting for this session. Undefined leaves
   *  the project config in charge; false forces the humanizer off for this
   *  session (the override only ever turns it off, never on over a project that
   *  opted out). See humanizerEnabled in humanizerStandard.ts. */
  humanize?: boolean;
}

export interface BootstrapResult {
  driver: LocalDriver;
  agent: AgentSession;
  router: Router;
  config: OscConfig;
  toolContext: ReturnType<typeof buildToolContext>;
  warnings: string[];
}

export function bootstrapSession(options: BootstrapOptions): BootstrapResult {
  const warnings: string[] = [];
  let config = options.config;
  if (!config) {
    const loaded = loadConfig(options.cwd);
    config = loaded.config;
    warnings.push(...loaded.warnings);
  }

  // The app's Humanize Writing setting rides in as a per-session override. It
  // only ever turns the humanizer off (a project's config 'off' or notes always
  // hold); applied here so loop.ts keeps reading config.humanizer as its single
  // source. A fresh config object, never mutating a caller's (tests pass one in).
  if (!humanizerEnabled(config.humanizer?.standard, options.humanize)) {
    config = { ...config, humanizer: { ...config.humanizer, standard: 'off' } };
  }

  const providers = new ProviderRegistry(config, getAnthropicKey);
  const stack = resolveStack(config, providers);
  warnings.push(...stack.notes);
  const router = new Router(config, providers, stack);

  // The project's secrets reach the model ONLY when the orchestrator is a local
  // model (gateProjectSecrets). A cloud orchestrator never receives them (they
  // are dropped here, not merely hidden in the prompt), and a secrets-bearing
  // session runs under egress lockdown so no tool can send them off the device.
  // See loop.ts for the matching "no cloud escalation while secrets are present".
  const orchestratorKind = stack.orchestrator.provider.kind === 'cloud' ? 'cloud' : 'local';
  const { projectSecrets, egressLockdown } = gateProjectSecrets(
    orchestratorKind,
    options.projectSecrets,
  );

  const tools = buildToolRegistry({
    stackHasVision:
      Boolean(stack.specialists.vision) || stack.orchestrator.provider.kind === 'cloud',
    stackHasImageGen: stack.imageGen,
    stackHasSpecialists: Boolean(stack.specialists.coding || stack.specialists.fast),
    egressLockdown,
  });
  const toolContext = buildToolContext({
    cwd: options.cwd,
    config,
    router,
    providers,
    projectName: options.projectName,
    egressLockdown,
  });

  const profile = profileFor(options.profile);
  const permissions = new PermissionEngine(config.permissions as PermissionConfig, profile);
  const guardrails = new Guardrails(config.guardrails, profile.maxStepsCeiling);
  const usage = new UsageTracker();

  let codeMap: string | undefined;
  try {
    codeMap = buildCodeMap(options.cwd);
  } catch (err) {
    log.warn('code map failed', { err: String(err) });
  }

  // Standing instructions the repo carries (OSCODE.md, CLAUDE.md, AGENTS.md),
  // the way Claude Code reads CLAUDE.md. Missing is fine; unreadable is a warn.
  const repoInstructions = readRepoInstructions(options.cwd);
  if (repoInstructions) {
    log.info('repo instructions loaded', { file: repoInstructions.file });
  }

  const driver = new LocalDriver(options.cwd, { id: options.sessionId, persist: options.persist });

  // Wire the readTerminal accessor to this driver's id, if the daemon provided
  // a terminal reader. Keyed by session id so the tool only ever sees this
  // session's own terminals.
  if (options.terminalReader) {
    const reader = options.terminalReader;
    toolContext.terminal = (lines, termId) => reader(driver.id, lines, termId);
  }

  const agent = new AgentSession({
    config,
    router,
    tools,
    toolContext,
    permissions,
    guardrails,
    usage,
    profile,
    approver: driver.approver,
    onEvent: (event) => driver.emit(event),
    codeMap,
    repoInstructions,
    instructions: options.instructions,
    projectSecrets,
    permissionMode: options.permissionMode,
    persistRule: (rule) => {
      try {
        addProjectPermissionRule(options.cwd, rule);
        return true;
      } catch (err) {
        log.warn('could not persist permission rule', { err: String(err) });
        return false;
      }
    },
  });
  driver.attachAgent(agent);

  // Rehydrating a stored session (daemon restarted): the journal replayed into
  // the driver, but a fresh AgentSession has no memory. Seed its history from
  // the journaled turns so the next message continues the conversation instead
  // of answering with amnesia, and tell the client the session was restored.
  if (options.sessionId) {
    const journal = driver.replayEvents();
    const seeded = seedHistoryFromEvents(journal);
    if (seeded.length) {
      agent.history = seeded;
      driver.emit({ type: 'status', message: 'Reconnected to this session after a restart.' });
    }
    // Clear any approval the old process was waiting on: its resolver is gone,
    // so the client's sheet would otherwise block forever with a 404 Approve.
    for (const id of unresolvedApprovalIds(journal)) {
      driver.emit({ type: 'approval-resolved', id, approved: false });
    }
  }

  return { driver, agent, router, config, toolContext, warnings };
}
