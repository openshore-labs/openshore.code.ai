// The full OS Code configuration schema. Everything is optional with sensible
// defaults: an EMPTY config file is a valid, working, single-model setup.
// Complexity is opt-in, which is the accessibility promise in schema form.
import { z } from 'zod';
import { PROVIDER_KEY_REF_PATTERN } from './providerKeyRef.js';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** A credential name in the provider-key namespace, and nothing else. */
const ProviderKeyRefSchema = z
  .string()
  .regex(PROVIDER_KEY_REF_PATTERN, 'must be a provider-key:<id> name (osc key add writes it)');

export const OpenAICompatibleEndpointSchema = z.object({
  kind: z.literal('openai-compatible'),
  /** Ollama, LM Studio, llama.cpp server, vLLM. */
  baseUrl: z.string().default('http://localhost:11434'),
  /** Name of an environment variable holding an API key, if the server wants one. */
  apiKeyEnv: z.string().optional(),
  label: z.string().optional(),
  /**
   * The context window this server is asked to serve (Vault M4, tech review I1).
   * 'auto' sends Ollama's `num_ctx` on every request: the lower of the model's
   * own window and a per-class ceiling from this computer's memory
   * (`servedContextTokens` in harness/profile.ts). 'off' (the default while it
   * is unset) sends no `num_ctx`, so the request body is unchanged. Only an
   * Ollama backend reads it; llama.cpp and vLLM fix the window at start.
   * Machine config, as the whole providers tree is. The default flips to
   * 'auto' only on the eval record (I14).
   */
  numCtx: z.enum(['auto', 'off']).optional(),
  /**
   * Where this endpoint's key lives in the credential store, when it is not
   * in a variable (keys on your server, 2026-10-09): only a
   * `provider-key:<id>` name, so a config can never point a provider at the
   * Claude key, the GitHub token, the data key or a session's keys. Read
   * after `apiKeyEnv` (endpointApiKey). Machine config, as the whole
   * providers tree is.
   */
  apiKeyRef: ProviderKeyRefSchema.optional(),
  /**
   * The base already carries its version (https://openrouter.ai/api/v1), so
   * the engine adds /models, /chat/completions and /embeddings with no /v1 of
   * its own. Unset, the base excludes it (http://localhost:11434), as before.
   */
  versionedBase: z.boolean().optional(),
  /**
   * The window each model is served, in tokens, as the app knows it from the
   * provider's own list (POST /stack/orchestrator). Read only for an endpoint
   * off this network: a local server's window is the one it serves
   * (servedWindow.ts), never a listed one.
   */
  contextWindows: z.record(z.string(), z.number().int().min(1024).max(10_000_000)).optional(),
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
  /**
   * Anthropic prompt caching (Vault M5, tech review J17). 'auto' splits the system
   * prompt at the vault pack (`ChatMessage.cacheAt`), marks the stable head
   * with `cache_control`, and turns on automatic caching for the tool loop.
   * 'off' (the reading while it is unset, like `numCtx`) sends the request
   * byte-identical to before. Machine config, as the whole providers tree is.
   * The default flips only on the eval record (J19).
   */
  promptCache: z.enum(['auto', 'off']).optional(),
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
  /** Seconds a stream may go silent between tokens before the guard calls it a
   *  stall. */
  streamIdleSeconds: z.number().int().min(1).default(120),
  /** Seconds to wait for the FIRST token, which is prefill: a cold local model
   *  reading a large prompt on a modest box can take minutes before it speaks.
   *  Raise it on very slow hardware. Never shorter than streamIdleSeconds. */
  streamFirstByteSeconds: z.number().int().min(1).default(300),
});

// ---------------------------------------------------------------------------
// Web search
// ---------------------------------------------------------------------------

export const SearchSchema = z.object({
  backend: z.enum(['duckduckgo', 'brave', 'searxng', 'tavily', 'perplexity']).default('duckduckgo'),
  /** Base URL of a self-hosted SearXNG, the fully private path. */
  searxngUrl: z.string().optional(),
  /** Env var names for keyed backends, never the keys themselves. */
  braveKeyEnv: z.string().default('BRAVE_API_KEY'),
  tavilyKeyEnv: z.string().default('TAVILY_API_KEY'),
  /** Perplexity Sonar search grounding: the key stays on this machine, read
   *  from this env var, never carried into a remote-hub session. */
  perplexityKeyEnv: z.string().default('PERPLEXITY_API_KEY'),
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
  /** For shell rules: the command's first word, matched exactly on every
   *  segment of the command (see commandMatchesPrefix in the engine). */
  commandPrefix: z.string().optional(),
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
// Daemon, catalog, UI
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
  // Who on a shared hub may read Stack Health. 'admins' (the default) keeps the
  // machine-wide aggregate to admins only, since on a multi-user hub the fold
  // spans every member's sessions; 'everyone' opens it to any member. A personal
  // or legacy single-user hub authenticates as admin, so the default shows a solo
  // user everything. Admin-owned machine config, set through an admin-only route.
  stackHealthVisibility: z.enum(['everyone', 'admins']).default('admins'),
  // How many days an ordinary stored session may sit with no activity before
  // the daemon deletes it (its journal and info), checked at start and once a
  // day (H1). Generous by default; 0 keeps every session. A session that is
  // open is never deleted. Machine config (projectPolicy: daemon).
  sessionRetentionDays: z.number().int().min(0).default(90),
  // The host a phone's push-send URL must name, for an app whose Supabase
  // project lives on its own domain. Unset, the URL must be a Supabase
  // project's own functions address (daemon/push.ts pushSendUrlAllowed).
  pushHost: z.string().optional(),
});

export const CatalogSchema = z.object({
  url: z.string().default('https://openshore.ai/os-code/catalog.json'),
  refreshHours: z.number().min(1).default(24),
});

export const UiSchema = z.object({
  plain: z.boolean().default(false),
});

export const RoutinesSchema = z.object({
  // Crew routines may search the web, and only search: the person's "Let models
  // search the web" switch reaches this machine through the daemon (maintainer,
  // 2026-10-01, overriding tech review 3's "never"). Machine config: a repo never turns
  // it on. Off unless the person's switch says on.
  webSearch: z.boolean().default(false),
});

export const VaultSchema = z.object({
  // Where the agent's on-device knowledge vault lives on disk. Plain markdown
  // files, so Obsidian or any editor opens the folder directly. Machine config:
  // read from the global file alone (loadVaultDir in load.ts), never from a
  // project's os-code.config.json. A leading "~" expands to home and the path
  // must be absolute; unset means ~/OSCode/Vault. The agent reads and writes it
  // through the vault tools; every write asks first.
  dir: z.string().optional(),
  // Vault M4, tech review I3. Globs (`*`, `**`, `?`, a trailing `/`) matched on the
  // folded note path. An excluded note is invisible to every vault tool and to
  // the context pack. Machine config: a repo never names the person's folders.
  exclude: z.array(z.string()).default([]),
  // Notes that never leave this computer (D5): a local seat may read them, a
  // seat whose requests leave this network never sees their text. A tag
  // matches itself and anything under it (`private`, `private/x`). A person's
  // list replaces the default, per field. Machine config.
  localOnly: z
    .object({
      paths: z.array(z.string()).default(['Private/**', 'Journal/**']),
      tags: z.array(z.string()).default(['private']),
    })
    .prefault({}),
  // The context pack (Vault M4, I8 and I9). 'auto' follows the per-class
  // table (PACK_BY_CLASS in harness/vaultContext.ts); 'full' forces retrieval
  // (eval, or a person on their own machine); 'off' removes the pack. A
  // project may only turn it off (projectPolicy.ts).
  context: z.enum(['auto', 'full', 'off']).default('auto'),
  // The handoff (Vault M5, tech review J11 to J13). 'auto' writes a short extractive
  // handoff after a compaction and when a task completes, and a session's
  // first task reads one at most seven days old; 'off' writes and reads
  // none. Memory off stops both as well. A project may only turn it off.
  handoff: z.enum(['auto', 'off']).default('auto'),
  // Room for notes (Vault M7, tech review L13, L14): a factor on each class's pack
  // budget (small 0.5, normal 1, large 1.5), always capped by packMaxTokens.
  // The app may only lower it (settings.vaultPackSize). Machine config: a repo
  // and the in-vault file never widen what a model is sent.
  packSize: z.enum(['small', 'normal', 'large']).default('normal'),
  // The most tokens any pack may take, whatever the size and the served
  // window (VAULT_PACK_MAX_TOKENS in harness/profile.ts is the default).
  // Machine config.
  packMaxTokens: z.number().int().min(500).max(32000).default(4000),
  // Provenance on agent-written notes (Vault M7, tech review L9, L10): the flat
  // `oscode-*` frontmatter lines. 'off' hides who wrote a note, so it is for
  // eval only, and machine config.
  provenance: z.enum(['on', 'off']).default('on'),
});

// ---------------------------------------------------------------------------
// The whole config
// ---------------------------------------------------------------------------

// Premium UX out of the box (2026-09-02): the twenty laws of UX plus
// the house bar ride into the coding agent's system prompt by default. A
// project turns it off here, or adds its own rules in `notes`.
const UxSchema = z.object({
  standard: z.enum(['premium', 'off']).default('premium'),
  notes: z.string().optional(),
});

// Humanizer out of the box (2026-09-04): any written output OpenShore
// produces runs to a plain, specific, honest voice that avoids AI writing
// tells, distilled from Wikipedia's "Signs of AI writing" and injected into the
// writing agent's system prompt by default. A project turns it off here, or
// adds its own voice rules in `notes`. See core/agent/humanizerStandard.ts.
const HumanizerSchema = z.object({
  standard: z.enum(['on', 'off']).default('on'),
  notes: z.string().optional(),
});

// Chain of Thought (2026-09-25): off by default. On, every model shows
// its reasoning above the answer (native reasoners through their own API, the
// rest prompted to think in <think> tags); off, no model is asked to think out
// loud and any reasoning it sends is kept out of the transcript. The app's
// setting overrides this per session. See core/agent/chainOfThought.ts.
const ChainOfThoughtSchema = z.object({
  enabled: z.boolean().default(false),
});

// Project memory (Vault v1, 1.5): on by default, the agent reads this repo's
// five memory notes and keeps them current through projectMemoryWrite, whose
// writes land without asking. Off removes the prompt block and the tool, not
// just the prompt, since the permission engine allows the tool by name. A
// project may turn it off from any folder; turning it on over a machine that
// has it off waits for trust (projectPolicy.ts). The app's Memory switch can
// only turn it off (memoryEnabled in core/agent/memorySwitch.ts).
const MemorySchema = z.object({
  enabled: z.boolean().default(true),
});

// Offline reconcile: the app pushes this repo's unpushed commits (the project's
// memory notes ride with the code) to its tracking upstream on app open and on
// reconnect, so nothing important lingers only on the device. A project that
// does not want its commits auto-pushed (e.g. its branch deploys on push) sets
// autoPush:false here and pushes on its own schedule.
const SyncSchema = z.object({
  autoPush: z.boolean().default(true),
  // The repository's default branch (origin/HEAD, else main, else master) is
  // never auto-pushed unless the project opts in here (board call 5,
  // 2026-09-16): a branch whose push deploys stays the person's to push.
  autoPushDefaultBranch: z.boolean().default(false),
});

// The agent's tools beyond the core set. `processes` lets it start a command
// that keeps running (a dev server, a watcher) and read or stop it later
// (startProcess, readProcess, stopProcess; build 2026-09-29, P1), where
// runShell would wait out its timeout and kill it. Unset reads on (the schema
// fills 'on'); a project may only turn it off (projectPolicy.ts).
const ToolsSchema = z.object({
  processes: z.enum(['on', 'off']).default('on'),
  // Opening a web page (webFetch), the person's own choice on this machine
  // (2026-10-02, the tech review's H3): `ask` before each page (the
  // default), `allow` without asking (a blanket yes), or `off` (no webFetch
  // tool). Machine config: a repo never loosens it. A page on this computer's
  // own network asks every time whatever this says (D3).
  webFetch: z.enum(['ask', 'allow', 'off']).default('ask'),
});

// The premium harness (2026-09-14; see CLAUDE.md "The premium harness"). The
// discipline seam that makes the smallest models capable: a model-class profile
// per seat, and constrained decoding to the tool-or-answer union schema for
// small local models. On by default, tunable or off per project. An empty
// config stays a valid, working setup. Code in os-code/src/harness/.
const HarnessProfileOverrideSchema = z.object({
  maxToolsShown: z.number().int().min(1).optional(),
  maxCallsPerTurn: z.number().int().min(1).optional(),
  constrainedDecoding: z.boolean().optional(),
  subagents: z.enum(['no', 'worker', 'yes']).optional(),
  plans: z.boolean().optional(),
  codeMapContextFraction: z.number().min(0).max(1).optional(),
  compactAtContextFraction: z.number().min(0).max(1).optional(),
  verifyRetries: z.number().int().min(0).max(10).optional(),
  bestOfAttempts: z.number().int().min(1).max(5).optional(),
  // Vault M4, tech review I2: lean seats get one merged vault tool (vaultLookup) in
  // place of the separate reads. It only shapes the tool menu, so a project may
  // set it. The pack and read budgets stay out on purpose: a repo raising them
  // would widen how much of the person's notes reaches a seat.
  mergedVaultTool: z.boolean().optional(),
});

const HarnessSchema = z.object({
  profiles: z
    .object({
      // Apply model-class discipline so a small seat gets the harness's help.
      enabled: z.boolean().default(true),
      // Per-class tweaks, keyed by "tiny" | "small" | "mid" | "large".
      overrides: z.record(z.string(), HarnessProfileOverrideSchema).default({}),
    })
    .prefault({}),
  decoding: z
    .object({
      // The repair pass: after a reply whose tool call could not be parsed,
      // the retry on the JSON text bridge is held to the tool-call grammar
      // where the backend supports one. False sends the retry unconstrained.
      constrainForSmallModels: z.boolean().default(true),
      // Union decoding (tech review 6): 'on' holds every reply of a tiny or small
      // seat on the text bridge to the tool-or-answer schema
      // (harness/decoding.ts) through the server's JSON schema (Ollama's
      // `format`), streaming the answer as it arrives. Grammar sampling
      // slows decoding on a CPU, so unset reads 'off' until
      // `osc eval --deep --union-decoding on|off` shows a lift (tenet 2).
      union: z.enum(['on', 'off']).optional(),
    })
    .prefault({}),
  retrieval: z
    .object({
      // Retrieval before turn one (tech review 6): 'on' searches the workspace for
      // the task's words and puts the best excerpts, by file and line, at the
      // head of the task, on a seat that stays on this network only, within
      // the lesser of 1,500 tokens and a tenth of the served window. It adds
      // prefill, so unset reads 'off' until `osc eval --deep --retrieval
      // on|off` shows a lift (tenet 2).
      firstTurn: z.enum(['on', 'off']).optional(),
    })
    .prefault({}),
  verify: z
    .object({
      // The project's check command, run after the agent finishes a task that
      // changed files, so it reports verified / not verified rather than
      // claiming done blind. Unset means verify is off. Runs without a prompt,
      // so the loop only invokes it where shell may auto-run (the
      // local-interactive profile); see maybeVerify in loop.ts.
      command: z.string().optional(),
      timeoutSeconds: z.number().int().min(1).default(120),
      // Verify in the loop: when the check fails, the failure tail goes back to
      // the model as an observation and it gets another go, this many times at
      // most, before the task reports not verified. Zero means one shot: report
      // the result, never retry. The step and dollar rails still apply.
      maxRetries: z.number().int().min(0).max(10).default(2),
      // Zero-setup verify (v1 Phase 1). With no command set, 'on' finds the
      // project's own test script (package.json, a Makefile test target,
      // pytest) and asks once before running it; "always" becomes a grant on
      // this machine. Unset reads 'off' until the floor run measures it.
      detect: z.enum(['on', 'off']).optional(),
      // The page check: with no command to run, look at the pages and scripts
      // the task changed the way a browser would (missing files, scripts that
      // do not parse, ids a script looks for that no page has) and hand any
      // problem back to the model. Runs nothing the project wrote. Unset reads
      // 'off' until the floor run's with and without pair (tenet 2).
      pageCheck: z.enum(['on', 'off']).optional(),
    })
    .prefault({}),
});

// Unknown keys are stripped, so an old config's `license` section (the key
// client removed when OpenShore went open source, 2026-10-11) still loads.
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
  ui: UiSchema.prefault({}),
  routines: RoutinesSchema.prefault({}),
  vault: VaultSchema.prefault({}),
  ux: UxSchema.prefault({}),
  humanizer: HumanizerSchema.prefault({}),
  chainOfThought: ChainOfThoughtSchema.prefault({}),
  memory: MemorySchema.prefault({}),
  sync: SyncSchema.prefault({}),
  harness: HarnessSchema.prefault({}),
  tools: ToolsSchema.prefault({}),
});

export type OscConfig = z.infer<typeof ConfigSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
export type ProviderEndpoint = z.infer<typeof ProviderEndpointSchema>;
export type AnthropicEndpoint = z.infer<typeof AnthropicEndpointSchema>;
export type OpenAICompatibleEndpoint = z.infer<typeof OpenAICompatibleEndpointSchema>;
export type ImageGenEndpoint = z.infer<typeof ImageGenEndpointSchema>;
export type StackConfig = z.infer<typeof StackSchema>;
export type SpecialistsConfig = z.infer<typeof SpecialistsSchema>;
