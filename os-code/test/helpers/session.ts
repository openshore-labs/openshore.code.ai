// Build a fully wired AgentSession around a MockProvider and a temp
// workspace, without touching the user's config or disk outside the sandbox.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema, type OscConfig } from '../../src/config/schema.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { resolveStack } from '../../src/router/stack.js';
import { Router } from '../../src/router/router.js';
import {
  buildToolRegistry,
  networkToolsLeftOut,
  offlineCut,
} from '../../src/core/agent/registry.js';
import type { MachineOffline } from '../../src/core/agent/offline.js';
import { AgentSession, type AgentDeps } from '../../src/core/agent/loop.js';
import { PermissionEngine, type PermissionConfig } from '../../src/core/permissions/index.js';
import { Guardrails } from '../../src/core/guardrails/index.js';
import { profileFor, type SecurityProfileName } from '../../src/core/security/profiles.js';
import { UsageTracker } from '../../src/auth/usage.js';
import { EgressPolicy } from '../../src/core/security/egress.js';
import { Jail } from '../../src/core/security/jail.js';
import type { ToolContext, ToolRegistry } from '../../src/core/tools/index.js';
import type { AgentEvent, ApprovalAnswer, ApprovalRequest } from '../../src/core/agent/types.js';
import type { MockProvider } from './mockProvider.js';
import type { ConsentAssertion } from '../../src/core/ethics/classify.js';
import type { VaultContextSource } from '../../src/harness/vaultContext.js';

export interface TestSession {
  agent: AgentSession;
  events: AgentEvent[];
  approvals: ApprovalRequest[];
  cwd: string;
  config: OscConfig;
  /** The wired pieces, so a test can read counters or register a tool. */
  tools: ToolRegistry;
  toolContext: ToolContext;
  guardrails: Guardrails;
  usage: UsageTracker;
  /** Every rule the session asked to persist ("always allow in this project"). */
  persistedRules: Array<{ tool: string; pathGlob?: string }>;
}

export interface TestSessionOptions {
  files?: Record<string, string>;
  approve?: (request: ApprovalRequest) => ApprovalAnswer | Promise<ApprovalAnswer>;
  configOverrides?: Record<string, unknown>;
  escalation?: MockProvider;
  /** The project this session belongs to, for the project-memory folder. */
  projectName?: string;
  /** The on-device vault root, when a test exercises the vault tools. */
  vaultRoot?: string;
  /** The project's secrets, for tests of the local-only secrets path. */
  projectSecrets?: string;
  /** Authorization assertions on file, for the ethics layer's consent gate. */
  consents?: ConsentAssertion[];
  /** The security profile to run under (default: sitting at the desk). */
  profile?: SecurityProfileName;
  /** Run in this workspace instead of a fresh temp dir. Eval v2 prepares a
   *  fixture workspace and drives the loop inside it. */
  cwd?: string;
  /** The vault context pack's source (Vault M4), for tests of the pack. */
  vaultContext?: VaultContextSource;
  /** The clock for the harness's dated Current State line. */
  now?: () => Date;
  /** A repository code map for the system prompt, as bootstrap builds one. */
  codeMap?: string;
  /** Where the loop's handoffs go (Vault M5, J13), and a builder standing in
   *  for the pure core's. */
  onHandoff?: AgentDeps['onHandoff'];
  buildHandoff?: AgentDeps['buildHandoff'];
  /** False for a member's session on a shared hub (v1 Phase 1 verify grant). */
  canGrantVerify?: boolean;
  /** Build the session offline, as bootstrap builds a headless one (CTO 3):
   *  no network tool registered, each refused by name. */
  offline?: boolean;
  /** With `offline`, keep webSearch as a routine does when the person's
   *  switch is on (founder, 2026-10-01). */
  offlineSearch?: boolean;
  /** The permission mode to start in. */
  permissionMode?: AgentDeps['permissionMode'];
  /** Also hand every event here (a LocalDriver's emit, when a test drives the
   *  session through the driver the way the daemon does). */
  onEvent?: (event: AgentEvent) => void;
  /** Register the process tools (P1) as bootstrap does for a host that can
   *  keep a program running: off the menu in plan mode. The test sets
   *  `toolContext.processes` itself when it runs one. */
  processes?: boolean;
  /** Register the tools a stack with a specialist, a vision seat and an image
   *  maker gets (delegate, analyzeImage, generateImage), as bootstrap does. */
  specialists?: boolean;
  /** This computer's offline state, read before every turn, wired to the
   *  router and the loop as bootstrap wires the machine flag (Desktop
   *  Offline). Unset reads as online. */
  offlineState?: () => MachineOffline;
  /** More model servers in the registry (a local one beside a cloud
   *  orchestrator). */
  providers?: MockProvider[];
}

export function makeTestSession(
  provider: MockProvider,
  options: TestSessionOptions = {},
): TestSession {
  const cwd = options.cwd ?? mkdtempSync(join(tmpdir(), 'osc-test-'));
  for (const [rel, content] of Object.entries(options.files ?? {})) {
    writeFileSync(join(cwd, rel), content);
  }

  const config = ConfigSchema.parse({
    stack: { orchestrator: { provider: provider.id, model: 'mock-model' } },
    permissions: { defaults: { write: 'allow', shell: 'ask' } },
    ...options.configOverrides,
  });
  // The harness discipline seam (model-class profiles) defaults ON in the real
  // engine, but a test carries the full prompt and every tool unless it opts in,
  // so existing behavior is the baseline and lean-seat tests turn it on
  // explicitly. A test that sets harness.profiles itself keeps its own choice.
  const setProfiles = (options.configOverrides as { harness?: { profiles?: unknown } } | undefined)
    ?.harness?.profiles;
  if (setProfiles === undefined) config.harness.profiles.enabled = false;

  const events: AgentEvent[] = [];
  const approvals: ApprovalRequest[] = [];

  // The ethics layer is wired exactly as bootstrapSession wires it, so a test
  // session behaves like the real thing: every provider is guarded, and a block
  // surfaces as an ethics-block event in the transcript.
  const registry = new ProviderRegistry(config, () => undefined, {
    consents: () => options.consents,
    onBlock: (result) => {
      events.push({
        type: 'ethics-block',
        category: result.decision.category,
        tier: result.decision.tier,
        side: result.record?.side ?? 'input',
        message: result.decision.message ?? 'This request was not sent.',
      });
    },
  });
  registry.register(provider.id, provider);
  if (options.escalation) registry.register(options.escalation.id, options.escalation);
  for (const extra of options.providers ?? []) registry.register(extra.id, extra);

  const stack = resolveStack(config, registry);
  const offlineState = options.offlineState;
  const router = new Router(
    config,
    registry,
    stack,
    offlineState ? { offline: () => offlineState().offline } : {},
  );
  const agentRef: { current?: AgentSession } = {};
  const registryOptions = {
    stackHasVision: options.specialists === true,
    stackHasImageGen: options.specialists === true,
    stackHasSpecialists: options.specialists === true,
    // As bootstrap does: the Memory switch off leaves the tool out.
    memory: config.memory.enabled,
    ...(options.offline ? { offline: true } : {}),
    ...(options.offlineSearch ? { offlineSearch: true } : {}),
    ...(options.processes
      ? { processes: true, processesOffered: () => agentRef.current?.permissionMode !== 'plan' }
      : {}),
  };
  const tools = buildToolRegistry(registryOptions);
  const offlineTools = networkToolsLeftOut(registryOptions);
  const cutWhenOffline = offlineCut(registryOptions);

  // events and approvals are declared above, because the ethics onBlock closure
  // handed to the provider registry pushes into events before this point.
  const persistedRules: Array<{ tool: string; pathGlob?: string }> = [];
  const toolContext: ToolContext = {
    cwd,
    jail: new Jail(cwd),
    egress: new EgressPolicy(config.egress),
    config,
    projectName: options.projectName,
    vaultRoot: options.vaultRoot,
  };
  const guardrails = new Guardrails(config.guardrails);
  const usage = new UsageTracker();
  const profile = profileFor(options.profile ?? 'local-interactive');

  const agent = new AgentSession({
    config,
    router,
    tools,
    toolContext,
    permissions: new PermissionEngine(
      config.permissions as PermissionConfig,
      profile,
      options.offlineSearch === true,
    ),
    guardrails,
    usage,
    profile,
    projectSecrets: options.projectSecrets,
    vaultContext: options.vaultContext,
    now: options.now,
    codeMap: options.codeMap,
    onHandoff: options.onHandoff,
    buildHandoff: options.buildHandoff,
    ...(options.canGrantVerify === false ? { canGrantVerify: false } : {}),
    ...(offlineTools.length ? { offlineTools } : {}),
    ...(offlineState ? { offline: offlineState, offlineCut: cutWhenOffline } : {}),
    ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    approver: async (request) => {
      approvals.push(request);
      return options.approve ? options.approve(request) : { approve: true };
    },
    onEvent: (event) => {
      events.push(event);
      options.onEvent?.(event);
    },
    persistRule: (rule) => {
      persistedRules.push(rule);
      return true;
    },
  });
  agentRef.current = agent;

  return {
    agent,
    events,
    approvals,
    cwd,
    config,
    tools,
    toolContext,
    guardrails,
    usage,
    persistedRules,
  };
}
