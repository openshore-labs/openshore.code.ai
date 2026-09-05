// Build a fully wired AgentSession around a MockProvider and a temp
// workspace, without touching the user's config or disk outside the sandbox.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema, type OscConfig } from '../../src/config/schema.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { resolveStack } from '../../src/router/stack.js';
import { Router } from '../../src/router/router.js';
import { buildToolRegistry } from '../../src/core/agent/registry.js';
import { AgentSession } from '../../src/core/agent/loop.js';
import { PermissionEngine, type PermissionConfig } from '../../src/core/permissions/index.js';
import { Guardrails } from '../../src/core/guardrails/index.js';
import { profileFor, type SecurityProfileName } from '../../src/core/security/profiles.js';
import { UsageTracker } from '../../src/auth/usage.js';
import { EgressPolicy } from '../../src/core/security/egress.js';
import { Jail } from '../../src/core/security/jail.js';
import type { ToolContext, ToolRegistry } from '../../src/core/tools/index.js';
import type { AgentEvent, ApprovalAnswer, ApprovalRequest } from '../../src/core/agent/types.js';
import type { MockProvider } from './mockProvider.js';

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
  /** The security profile to run under (default: sitting at the desk). */
  profile?: SecurityProfileName;
}

export function makeTestSession(
  provider: MockProvider,
  options: TestSessionOptions = {},
): TestSession {
  const cwd = mkdtempSync(join(tmpdir(), 'osc-test-'));
  for (const [rel, content] of Object.entries(options.files ?? {})) {
    writeFileSync(join(cwd, rel), content);
  }

  const config = ConfigSchema.parse({
    stack: { orchestrator: { provider: provider.id, model: 'mock-model' } },
    permissions: { defaults: { write: 'allow', shell: 'ask' } },
    ...options.configOverrides,
  });

  const registry = new ProviderRegistry(config, () => undefined);
  registry.register(provider.id, provider);
  if (options.escalation) registry.register(options.escalation.id, options.escalation);

  const stack = resolveStack(config, registry);
  const router = new Router(config, registry, stack);
  const tools = buildToolRegistry({
    stackHasVision: false,
    stackHasImageGen: false,
    stackHasSpecialists: false,
  });

  const events: AgentEvent[] = [];
  const approvals: ApprovalRequest[] = [];
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
    permissions: new PermissionEngine(config.permissions as PermissionConfig, profile),
    guardrails,
    usage,
    profile,
    projectSecrets: options.projectSecrets,
    approver: async (request) => {
      approvals.push(request);
      return options.approve ? options.approve(request) : { approve: true };
    },
    onEvent: (event) => events.push(event),
    persistRule: (rule) => {
      persistedRules.push(rule);
      return true;
    },
  });

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
