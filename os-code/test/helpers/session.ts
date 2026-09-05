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
import { profileFor } from '../../src/core/security/profiles.js';
import { UsageTracker } from '../../src/auth/usage.js';
import { EgressPolicy } from '../../src/core/security/egress.js';
import { Jail } from '../../src/core/security/jail.js';
import type { AgentEvent, ApprovalAnswer, ApprovalRequest } from '../../src/core/agent/types.js';
import type { MockProvider } from './mockProvider.js';
import type { ConsentAssertion } from '../../src/core/ethics/classify.js';

export interface TestSession {
  agent: AgentSession;
  events: AgentEvent[];
  approvals: ApprovalRequest[];
  cwd: string;
  config: OscConfig;
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

  const stack = resolveStack(config, registry);
  const router = new Router(config, registry, stack);
  const tools = buildToolRegistry({
    stackHasVision: false,
    stackHasImageGen: false,
    stackHasSpecialists: false,
  });

  const agent = new AgentSession({
    config,
    router,
    tools,
    toolContext: {
      cwd,
      jail: new Jail(cwd),
      egress: new EgressPolicy(config.egress),
      config,
      projectName: options.projectName,
      vaultRoot: options.vaultRoot,
    },
    permissions: new PermissionEngine(
      config.permissions as PermissionConfig,
      profileFor('local-interactive'),
    ),
    guardrails: new Guardrails(config.guardrails),
    usage: new UsageTracker(),
    profile: profileFor('local-interactive'),
    projectSecrets: options.projectSecrets,
    approver: async (request) => {
      approvals.push(request);
      return options.approve ? options.approve(request) : { approve: true };
    },
    onEvent: (event) => events.push(event),
  });

  return { agent, events, approvals, cwd, config };
}
