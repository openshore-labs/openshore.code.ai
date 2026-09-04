// The full OS Code configuration schema. Everything is optional with sensible
// defaults: an EMPTY config file is a valid, working, single-model setup.
// Complexity is opt-in, which is the accessibility promise in schema form.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export const OpenAICompatibleEndpointSchema = z.object({
  kind: z.literal('openai-compatible'),
  /** Ollama, LM Studio, llama.cpp server, vLLM. */
  baseUrl: z.string().default('http://localhost:11434'),
  /** Name of an environment variable holding an API key, if the server wants one. */
  apiKeyEnv: z.string().optional(),
  label: z.string().optional(),
});

export const AnthropicEndpointSchema = z.object({
  kind: z.literal('anthropic'),
  baseUrl: z.string().default('https://api.anthropic.com'),
  /**
   * 'api-key' is the dependable, documented path (osc login).
   * 'subscription' is an experimental stub and appears on no marketing surface.
   */
  auth: z.enum(['api-key', 'subscription']).default('api-key'),
  /** Default model when this endpoint serves the orchestrator or an escalation. */
  model: z.string().default('claude-sonnet-5'),
  label: z.string().optional(),
});

export const ImageGenEndpointSchema = z.object({
  kind: z.enum(['openai-images', 'a1111', 'comfyui']).default('a1111'),
  baseUrl: z.string().default('http://localhost:7860'),
  model: z.string().optional(),
  label: z.string().optional(),
});

export const ProviderEndpointSchema = z.discriminatedUnion('kind', [
  OpenAICompatibleEndpointSchema,
  AnthropicEndpointSchema,
]);

// ---------------------------------------------------------------------------
// The stack: one mandatory reasoning orchestrator, optional specialists.
// ---------------------------------------------------------------------------

export const ModelRefSchema = z.object({
  /** Key into `providers`, e.g. "ollama" or "anthropic". */
  provider: z.string(),
  /** Model name as the provider knows it, e.g. "qwen2.5-coder:14b". */
  model: z.string(),
});

export const SpecialistsSchema = z.object({
  coding: ModelRefSchema.optional(),
  writing: ModelRefSchema.optional(),
  analysis: ModelRefSchema.optional(),
  vision: ModelRefSchema.optional(),
  embedding: ModelRefSchema.optional(),
  fast: ModelRefSchema.optional(),
  /** Image generation runs through the imageGen endpoint, not a chat provider. */
  imageGen: z
    .object({ endpoint: z.literal('imageGen').prefault('imageGen'), model: z.string().optional() })
    .optional(),
});

export const StackSchema = z.object({
  /** The one required role. When it is the only model, it does everything. */
  orchestrator: ModelRefSchema.optional(),
  specialists: SpecialistsSchema.prefault({}),
});

// ---------------------------------------------------------------------------
// Routing and escalation
// ---------------------------------------------------------------------------

export const EscalationSchema = z.object({
  /** Escalation to cloud never happens unless this is on AND an account is connected. */
  enabled: z.boolean().default(false),
  /** Escalate after this many consecutive tool-call parse failures. */
  afterToolFailures: z.number().int().min(1).default(3),
  /** Escalate when the local model reports it is stuck or low confidence. */
  onModelRequest: z.boolean().default(true),
});

export const RoutingSchema = z.object({
  /** 'auto' delegates to specialists by capability; 'orchestrator-only' never delegates. */
  mode: z.enum(['auto', 'orchestrator-only']).default('auto'),
  escalation: EscalationSchema.prefault({}),
});

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export const ResourceBudgetSchema = z.object({
  /** 'auto' detects VRAM at startup and picks a profile. */
  vramProfile: z.enum(['auto', 'single', 'dual', 'fleet']).default('auto'),
  /** Ollama keep_alive for the orchestrator (specialists unload sooner). */
  keepAlive: z.string().default('10m'),
  /** How many large models may be resident at once. */
  maxResidentModels: z.number().int().min(1).default(1),
  /** Override detected VRAM in GB (for headless boxes and tests). */
  vramOverrideGB: z.number().positive().optional(),
});

// ---------------------------------------------------------------------------
// Web search
// ---------------------------------------------------------------------------

export const SearchSchema = z.object({
  backend: z.enum(['duckduckgo', 'brave', 'searxng', 'tavily']).default('duckduckgo'),
  /** Base URL of a self-hosted SearXNG, the fully private path. */
  searxngUrl: z.string().optional(),
  /** Env var names for keyed backends, never the keys themselves. */
  braveKeyEnv: z.string().default('BRAVE_API_KEY'),
  tavilyKeyEnv: z.string().default('TAVILY_API_KEY'),
  resultCount: z.number().int().min(1).max(20).default(5),
  /** Max characters of markdown webFetch returns (small local contexts). */
  fetchMaxChars: z.number().int().min(1000).default(18000),
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export const EgressSchema = z.object({
  webEnabled: z.boolean().default(true),
  allowlist: z.array(z.string()).default([]),
  blocklist: z.array(z.string()).default([]),
});

export const PermissionRuleSchema = z.object({
  tool: z.string(),
  decision: z.enum(['allow', 'ask', 'deny']),
  pathGlob: z.string().optional(),
});

export const PermissionsSchema = z.object({
  defaults: z
    .object({
      read: z.enum(['allow', 'ask', 'deny']).default('allow'),
      network: z.enum(['allow', 'ask', 'deny']).default('allow'),
      write: z.enum(['allow', 'ask', 'deny']).default('ask'),
      shell: z.enum(['allow', 'ask', 'deny']).default('ask'),
      push: z.enum(['allow', 'ask', 'deny']).default('ask'),
      'cloud-spend': z.enum(['allow', 'ask', 'deny']).default('ask'),
    })
    .prefault({}),
  rules: z.array(PermissionRuleSchema).default([]),
  trustedRepos: z.array(z.string()).default([]),
});

export const GuardrailsSchema = z.object({
  maxSteps: z.number().int().min(1).default(40),
  maxRepeats: z.number().int().min(1).default(3),
  wallClockSeconds: z.number().int().min(10).default(900),
  maxTokens: z.number().int().min(1000).default(400_000),
  maxDollars: z.number().min(0).default(2.0),
});

// ---------------------------------------------------------------------------
// Daemon, catalog, license, UI
// ---------------------------------------------------------------------------

export const DaemonSchema = z.object({
  bind: z.enum(['loopback', 'tailscale']).default('loopback'),
  port: z.number().int().min(1).max(65535).default(4816),
  // Repos the outbox apply/verify endpoints may touch, in addition to the
  // admin-provisioned workspaces under ~/OSCode. Admin-owned config, so a home
  // repo living outside ~/OSCode can still receive buffered commits. A request
  // cwd outside every allowed root is rejected 403 for every caller, admins
  // included: there is no reason apply/verify should reach an arbitrary repo,
  // and the ambient-credential push path makes it a real escalation surface.
  outboxAllowedRoots: z.array(z.string()).default([]),
});

export const CatalogSchema = z.object({
  url: z.string().default('https://openshore.ai/os-code/catalog.json'),
  refreshHours: z.number().min(1).default(24),
});

export const LicenseSchema = z.object({
  verifyUrl: z.string().default('https://openshore.ai/api/os-code/license/verify'),
  /** Days a cached entitlement keeps working with no network. */
  graceDays: z.number().int().min(1).default(14),
});

export const UiSchema = z.object({
  plain: z.boolean().default(false),
});

export const VaultSchema = z.object({
  // Where the agent's on-device knowledge vault lives on disk. Plain markdown
  // files, so Obsidian or any editor opens the folder directly. Unset means
  // ~/OSCode/Vault (resolved in buildToolContext, since the schema has no home
  // dir). The agent reads and writes it through the vault tools; every write
  // asks first.
  dir: z.string().optional(),
});

// ---------------------------------------------------------------------------
// The whole config
// ---------------------------------------------------------------------------

// Premium UX out of the box (founder, 2026-09-02): the twenty laws of UX plus
// the house bar ride into the coding agent's system prompt by default. A
// project turns it off here, or adds its own rules in `notes`.
const UxSchema = z.object({
  standard: z.enum(['premium', 'off']).default('premium'),
  notes: z.string().optional(),
});

// Offline reconcile: the app pushes this repo's unpushed commits (the project's
// memory notes ride with the code) to its tracking upstream on app open and on
// reconnect, so nothing important lingers only on the device. A project that
// does not want its commits auto-pushed (e.g. its branch deploys on push) sets
// autoPush:false here and pushes on its own schedule.
const SyncSchema = z.object({
  autoPush: z.boolean().default(true),
});

export const ConfigSchema = z.object({
  providers: z
    .record(z.string(), ProviderEndpointSchema)
    .default({ ollama: { kind: 'openai-compatible', baseUrl: 'http://localhost:11434' } }),
  imageGen: ImageGenEndpointSchema.optional(),
  stack: StackSchema.prefault({}),
  routing: RoutingSchema.prefault({}),
  resourceBudget: ResourceBudgetSchema.prefault({}),
  search: SearchSchema.prefault({}),
  egress: EgressSchema.prefault({}),
  permissions: PermissionsSchema.prefault({}),
  guardrails: GuardrailsSchema.prefault({}),
  daemon: DaemonSchema.prefault({}),
  catalog: CatalogSchema.prefault({}),
  license: LicenseSchema.prefault({}),
  ui: UiSchema.prefault({}),
  vault: VaultSchema.prefault({}),
  ux: UxSchema.prefault({}),
  sync: SyncSchema.prefault({}),
});

export type OscConfig = z.infer<typeof ConfigSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
export type ProviderEndpoint = z.infer<typeof ProviderEndpointSchema>;
export type AnthropicEndpoint = z.infer<typeof AnthropicEndpointSchema>;
export type OpenAICompatibleEndpoint = z.infer<typeof OpenAICompatibleEndpointSchema>;
export type ImageGenEndpoint = z.infer<typeof ImageGenEndpointSchema>;
export type StackConfig = z.infer<typeof StackSchema>;
export type SpecialistsConfig = z.infer<typeof SpecialistsSchema>;
