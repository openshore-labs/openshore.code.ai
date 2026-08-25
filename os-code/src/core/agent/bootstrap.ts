// Session bootstrap: one function turns (cwd, profile) into a live, wired
// LocalDriver + AgentSession. The run command, the daemon, and the eval
// harness all build sessions through here so wiring never drifts.
import type { OscConfig } from '../../config/schema.js';
import { loadConfig } from '../../config/load.js';
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
import { logger } from '../../util/log.js';

const log = logger('bootstrap');

export interface BootstrapOptions {
  cwd: string;
  profile: SecurityProfileName;
  sessionId?: string;
  persist?: boolean;
  /** Preloaded config (tests); defaults to loading from disk. */
  config?: OscConfig;
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

  const providers = new ProviderRegistry(config, getAnthropicKey);
  const stack = resolveStack(config, providers);
  warnings.push(...stack.notes);
  const router = new Router(config, providers, stack);

  const tools = buildToolRegistry({
    stackHasVision:
      Boolean(stack.specialists.vision) || stack.orchestrator.provider.kind === 'cloud',
    stackHasImageGen: stack.imageGen,
    stackHasSpecialists: Boolean(stack.specialists.coding || stack.specialists.fast),
  });
  const toolContext = buildToolContext({ cwd: options.cwd, config, router, providers });

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

  const driver = new LocalDriver(options.cwd, { id: options.sessionId, persist: options.persist });
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
