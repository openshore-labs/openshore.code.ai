// Session bootstrap: one function turns (cwd, profile) into a live, wired
// LocalDriver + AgentSession. The run command, the daemon, and the eval
// harness all build sessions through here so wiring never drifts.
import type { OscConfig } from '../../config/schema.js';
import {
  addProjectPermissionRule,
  cliFolderTrust,
  loadConfig,
  type ProjectTrust,
} from '../../config/load.js';
import { hasAgentCliSettings } from '../../config/trust.js';
import { ProviderRegistry } from '../../providers/registry.js';
import { leavesThisNetwork } from '../../providers/types.js';
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
import { LocalDriver, storedSessionProject } from '../../daemon/session.js';
import { buildCodeMap } from '../../context/codeMap.js';
import { readRepoInstructions } from './instructions.js';
import { gateProjectSecrets } from './secretsGate.js';
import { humanizerEnabled } from './humanizerStandard.js';
import { memoryEnabled } from './memorySwitch.js';
import { chainOfThoughtEnabled } from './chainOfThought.js';
import { engineEthicsContext } from '../ethics/host.js';
import { nextActionFor } from '../ethics/classify.js';
import { configureStreamIdle } from '../../providers/streamIdle.js';
import type { AgentEvent, PermissionMode } from './types.js';
import type { CurrentsHandles, HarnessCurrentsHandle } from '../../currents/model.js';
import type { VaultContextSource } from '../../harness/vaultContext.js';
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
   *  to place the project's memory notes in the repo, under "OpenShore Project
   *  <name> MDs/". Undefined for a project-less chat or the bare CLI (the memory
   *  folder then falls back to the workspace basename). */
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
  /** The app's Memory switch (Wayfinding) for this session. Undefined, or
   *  true, leaves the config in charge; false turns project memory off for
   *  this session (the override only ever turns it off, never on over a
   *  project that turned it off). Off removes the memory prompt block and the
   *  projectMemoryWrite tool. See memoryEnabled in memorySwitch.ts. */
  memory?: boolean;
  /** The app's "Chain of Thought" setting for this session. Undefined leaves
   *  the project config in charge (off by default); a boolean wins in either
   *  direction, since it is the person's display choice, not a project policy.
   *  See chainOfThoughtEnabled in chainOfThought.ts. */
  chainOfThought?: boolean;
  /** The person's Codemagic token, so the codemagic tool can drive App Launch
   *  builds. Delivered ONLY by the local, on-device engine and only when the
   *  person turned Codemagic Access on; the daemon path never forwards it, so
   *  the token never travels to another machine. Undefined leaves the codemagic
   *  tool out (and degraded if it is somehow reached). */
  codemagicToken?: string;
  /** The saved launch target (app id, workflow, branch), so a trigger uses it
   *  without the model guessing. Paired with codemagicToken. */
  codemagicTarget?: { appId: string; workflowId: string; branch: string; platform?: string };
  /** The Agentic Current the person turned on, as a per-session handle: a
   *  Hermes box, an A2A agent, or a paired coding CLI. One at a time. Unlike
   *  the Codemagic token this DOES travel over the daemon, because a current
   *  names a service the person chose to reach from the hub (a box on the
   *  tailnet, a CLI on the hub itself), not a secret that only lives on the
   *  phone. Undefined leaves every current tool out. */
  currents?: CurrentsHandles;
  /** The Harness Current the person turned on (Jev is the first), as a
   *  per-session handle. Like an Agentic Current it travels over the daemon,
   *  because it names a service the person chose to reach (a decision API), not
   *  a device secret. Dropped under egress lockdown below, so it never fires
   *  while project secrets are present. Undefined leaves the harness current
   *  off for this session. */
  harnessCurrents?: HarnessCurrentsHandle;
  /** Per-session guardrail caps, over the project config's. A routine passes
   *  its own time cap and step ceiling here so the engine's rails match what
   *  the person set. Only tightening is honored: the profile's hard step
   *  ceiling still applies on top. */
  caps?: { wallClockSeconds?: number; maxSteps?: number };
  /** Whether this session gets the vault tools. The daemon turns it off for a
   *  member's session on a shared hub: the vault is the machine owner's one
   *  folder, so a member's agent gets no tool aimed at it until each member
   *  has a root of their own. (The daemon also keeps a member's workspace off
   *  the vault, so the file tools cannot reach it.) Undefined means on. */
  vault?: boolean;
  /** Where this session's vault context pack comes from (Vault M4, CTO I7,
   *  I8): the engine's source prepares Current State, the index and the
   *  planned note bodies once per task, and the loop renders the pack per
   *  turn for the seat that answers. Undefined leaves the pack out. The loop
   *  also leaves it out with Memory off (the switch folded in above) or
   *  `vault.context: 'off'`, so a caller need not gate it. */
  vaultContext?: VaultContextSource;
}

export interface BootstrapResult {
  driver: LocalDriver;
  agent: AgentSession;
  router: Router;
  config: OscConfig;
  toolContext: ReturnType<typeof buildToolContext>;
  /** The tools this session registered, before any per-seat trim. */
  tools: ReturnType<typeof buildToolRegistry>;
  warnings: string[];
  /** Where the orchestrator runs. An unattended host reads this before it
   *  sends a task: a cloud orchestrator under a profile that cannot auto-
   *  approve spend can never finish a turn. */
  orchestratorKind: 'local' | 'cloud';
}

export function bootstrapSession(options: BootstrapOptions): BootstrapResult {
  const warnings: string[] = [];
  // A revived session (the daemon's rehydrate, the desktop's resume) works to
  // the project it was opened for, kept in its info.json: without the name the
  // memory notes fall back to the workspace's folder, a second folder for the
  // same project, and the standing instructions drop. A caller's own wins.
  const stored = options.sessionId ? storedSessionProject(options.sessionId) : {};
  const projectName = options.projectName ?? stored.projectName;
  const instructions = options.instructions ?? stored.instructions;
  let config = options.config;
  let projectTrust: ProjectTrust | undefined;
  if (!config) {
    const loaded = loadConfig(options.cwd);
    config = loaded.config;
    projectTrust = loaded.projectTrust;
    warnings.push(...loaded.warnings);
  }

  // Apply the stream idle windows from config once, before any provider streams.
  // The first-byte window matters most on modest local hardware, where a cold
  // model reading a large prompt can take minutes to emit its first token.
  configureStreamIdle({
    idleSeconds: config.resourceBudget.streamIdleSeconds,
    firstByteSeconds: config.resourceBudget.streamFirstByteSeconds,
  });

  // The app's Humanize Writing setting rides in as a per-session override. It
  // only ever turns the humanizer off (a project's config 'off' or notes always
  // hold); applied here so loop.ts keeps reading config.humanizer as its single
  // source. A fresh config object, never mutating a caller's (tests pass one in).
  if (!humanizerEnabled(config.humanizer?.standard, options.humanize)) {
    config = { ...config, humanizer: { ...config.humanizer, standard: 'off' } };
  }

  // The app's Memory switch, the same way: it only ever turns project memory
  // off, and folding it into config here means the registry, the loop, and
  // (when they land) the pack and the handoff read one value.
  if (!memoryEnabled(config.memory?.enabled, options.memory)) {
    config = { ...config, memory: { ...config.memory, enabled: false } };
  }

  // The app's Chain of Thought setting, the same way: applied here so loop.ts
  // reads config.chainOfThought as its single source.
  const cot = chainOfThoughtEnabled(config.chainOfThought?.enabled, options.chainOfThought);
  if (cot !== (config.chainOfThought?.enabled === true)) {
    config = { ...config, chainOfThought: { ...config.chainOfThought, enabled: cot } };
  }

  // The ethics layer, wired before any provider exists. Every provider the
  // registry hands out is guarded by it, so the agent loop, the router's
  // specialist delegation, and the summarizer are covered by construction. The
  // driver does not exist yet, so blocks land in a holder the driver drains
  // once it is built (a block during construction is impossible: nothing has
  // run a prompt yet).
  const ethicsSink: { emit?: (event: AgentEvent) => void } = {};
  const ethics = engineEthicsContext({
    onBlock: (result) => {
      // The block carries its next action (the appeal path on a hard block),
      // so a transcript never ends a refusal with nowhere to go.
      const refusal = result.decision.message ?? 'This request was not sent.';
      const next = nextActionFor(result.decision.category);
      ethicsSink.emit?.({
        type: 'ethics-block',
        category: result.decision.category,
        tier: result.decision.tier,
        side: result.record?.side ?? 'input',
        message: next ? `${refusal} ${next}` : refusal,
      });
    },
  });

  const providers = new ProviderRegistry(config, getAnthropicKey, ethics);
  const stack = resolveStack(config, providers);
  warnings.push(...stack.notes);
  const router = new Router(config, providers, stack);

  // The project's secrets reach the model ONLY when the orchestrator is a local
  // model (gateProjectSecrets). A cloud orchestrator never receives them (they
  // are dropped here, not merely hidden in the prompt), and a secrets-bearing
  // session runs under egress lockdown so no tool can send them off the device.
  // See loop.ts for the matching "no cloud escalation while secrets are present".
  //
  // "Local" is judged by where the orchestrator's requests go (loopback, the
  // LAN, the person's own tailnet), never by a config label: an OpenAI-
  // compatible server on the internet is as far off the device as a cloud API.
  const orchestratorKind = leavesThisNetwork(stack.orchestrator.provider) ? 'cloud' : 'local';
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
    hasCodemagic: Boolean(options.codemagicToken),
    currents: options.currents,
    vault: options.vault,
    // A headless run (a Crew routine) has nobody at the desk to approve an
    // always-ask vault write, and the scheduler's own note already records
    // the run, so it keeps the vault reads and drops the write.
    vaultWrite: options.profile !== 'headless',
    memory: config.memory?.enabled !== false,
  });
  const toolContext = buildToolContext({
    cwd: options.cwd,
    config,
    router,
    providers,
    projectName,
    egressLockdown,
    vault: options.vault,
  });

  const profile = profileFor(options.profile);
  const permissions = new PermissionEngine(config.permissions as PermissionConfig, profile);
  const guardrails = new Guardrails(
    options.caps
      ? {
          ...config.guardrails,
          ...(options.caps.wallClockSeconds
            ? { wallClockSeconds: options.caps.wallClockSeconds }
            : {}),
          ...(options.caps.maxSteps ? { maxSteps: options.caps.maxSteps } : {}),
        }
      : config.guardrails,
    profile.maxStepsCeiling,
  );
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

  const driver = new LocalDriver(options.cwd, {
    id: options.sessionId,
    persist: options.persist,
    project: { projectName, instructions },
  });
  // From here on, an ethics block shows up in the transcript of this session.
  ethicsSink.emit = (event) => driver.emit(event);

  // Project trust: say what this folder asks for that stays off until the
  // person trusts it, once, at the start of a fresh session (a revived one
  // already carries it in its journal). CLI Pairing adds its own line when the
  // folder carries a coding CLI's settings, since that tool refuses there.
  if (!options.sessionId) {
    const waiting = [...(projectTrust?.waiting ?? [])];
    let state = projectTrust?.state;
    if (options.currents?.cli && hasAgentCliSettings(options.cwd)) {
      const cli = cliFolderTrust(options.cwd);
      if (cli.state !== 'trusted') {
        const name = options.currents.cli.command === 'claude' ? 'Claude Code' : 'Codex';
        waiting.push(`lets ${name} run with this folder's own settings`);
        if (state !== 'changed') state = cli.state === 'changed' ? 'changed' : 'untrusted';
      }
    }
    if (waiting.length && (state === 'untrusted' || state === 'changed')) {
      driver.emit({
        type: 'project-trust',
        state,
        folder: projectTrust?.folder ?? options.cwd,
        waiting,
      });
    }
  }

  // Wire the readTerminal accessor to this driver's id, if the daemon provided
  // a terminal reader. Keyed by session id so the tool only ever sees this
  // session's own terminals.
  if (options.terminalReader) {
    const reader = options.terminalReader;
    toolContext.terminal = (lines, termId) => reader(driver.id, lines, termId);
  }

  // The person's Codemagic token and saved target, so the codemagic tool can
  // drive App Launch builds. Set only on this local engine; the daemon never
  // forwards a token, so it never leaves the device.
  if (options.codemagicToken) {
    toolContext.codemagic = { token: options.codemagicToken, target: options.codemagicTarget };
  }
  // The Agentic Current's handle, and this session's id so the Hermes tool can
  // keep one Hermes session per OpenShore session.
  if (options.currents) toolContext.currents = options.currents;
  toolContext.sessionId = driver.id;

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
    instructions,
    projectSecrets,
    // A Harness Current makes a cloud decision call, so it is dropped under
    // egress lockdown exactly like cloud escalation and the currents tools.
    harnessCurrents: egressLockdown ? undefined : options.harnessCurrents,
    permissionMode: options.permissionMode,
    vaultContext: options.vaultContext,
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

  return { driver, agent, router, config, toolContext, tools, warnings, orchestratorKind };
}
