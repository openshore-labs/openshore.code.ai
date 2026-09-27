// Wires the standard tool set into a registry and builds the ToolContext for
// a session. One place decides what the agent can touch.
import { VaultSchema, type OscConfig } from '../../config/schema.js';
import { EgressPolicy } from '../security/egress.js';
import { Jail } from '../security/jail.js';
import { ToolRegistry, type ToolContext } from '../tools/index.js';
import { readFileTool } from '../tools/readFile.js';
import { writeFileTool } from '../tools/writeFile.js';
import { editFileTool } from '../tools/editFile.js';
import { runShellTool } from '../tools/runShell.js';
import { readTerminalTool } from '../tools/readTerminal.js';
import { codemagicTool } from '../tools/codemagic.js';
import { askHermesTool } from '../tools/askHermes.js';
import { askAgentTool } from '../tools/askAgent.js';
import { cliAgentTool } from '../tools/cliAgent.js';
import type { CurrentsHandles } from '../../currents/model.js';
import { grepTool } from '../tools/grep.js';
import { globTool } from '../tools/glob.js';
import { gitCommitTool, gitDiffTool, gitLogTool, gitStatusTool } from '../tools/git.js';
import { webSearchTool } from '../tools/webSearch.js';
import { webFetchTool } from '../tools/webFetch.js';
import { generateImageTool } from '../tools/generateImage.js';
import { analyzeImageTool, delegateTool, searchRepoTool } from '../tools/specialist.js';
import { vaultWriteTool, vaultReadTool, vaultListTool } from '../tools/vault.js';
import {
  SEPARATE_VAULT_READ_TOOLS,
  vaultBacklinksTool,
  vaultLookupTool,
  vaultSearchTool,
} from '../tools/vaultFind.js';
import { compileVaultPrivacy } from '../../harness/vault/privacy.js';
import type {
  ResolvedVaultSettings,
  VaultPrivacy,
  VaultPrivacyConfig,
  VaultPrivacyNarrowing,
} from '../../harness/vault/types.js';
import { vaultSettingsFor } from '../vault/settingsFile.js';
import { logger } from '../../util/log.js';
import { projectMemoryWriteTool } from '../tools/projectMemory.js';
import { todoWriteTool } from '../tools/todoWrite.js';
import { loadVaultDir } from '../../config/load.js';
import type { Router } from '../../router/router.js';
import type { ProviderRegistry } from '../../providers/registry.js';
import { RepoIndex, keywordSearch } from '../../context/index.js';

export function buildToolRegistry(options: {
  stackHasVision: boolean;
  stackHasImageGen: boolean;
  stackHasSpecialists: boolean;
  // On when the session may hold the project's secrets (local model only): no
  // tool may send anything off the device. Web tools are dropped, and the
  // specialist/vision/image tools stay off regardless of the stack flags, so a
  // secret can never ride out to a cloud model or a web request.
  egressLockdown?: boolean;
  // On when the person connected Codemagic and turned Codemagic Access on, so a
  // token was delivered to this session. Registers the codemagic tool. Dropped
  // under egress lockdown, since it reaches the network like the web tools.
  hasCodemagic?: boolean;
  // The Agentic Current handed to this session, if any. Each registers its one
  // tool: askHermes for a Hermes box, askAgent for an A2A agent, cliAgent for a
  // paired coding CLI. The two network ones ride the egress gate with the web
  // tools; the CLI one is a shell run and stays out under lockdown too, since
  // a CLI on the box can reach the network on its own.
  currents?: CurrentsHandles;
  // Off leaves the three vault tools out. A member's session on a shared hub
  // runs without them: the vault is the machine owner's one folder, so until
  // each member has a root of their own, a member's agent gets no tool aimed
  // at it. The daemon also refuses a member a workspace that is the vault or
  // holds it (overlapsVault), so the file tools cannot reach it either.
  // Undefined means on.
  vault?: boolean;
  // Off leaves vaultWrite out while the vault reads stay: a headless routine
  // run has nobody to approve an always-ask write, and the scheduler's own
  // note already records the run. Undefined means on.
  vaultWrite?: boolean;
  // Off leaves projectMemoryWrite out (the Memory switch, config
  // memory.enabled). It must be unregistered, not merely left out of the
  // prompt, because the permission engine allows it by name. Undefined means
  // on.
  memory?: boolean;
}): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(editFileTool);
  registry.register(writeFileTool);
  registry.register(grepTool);
  registry.register(globTool);
  registry.register(runShellTool);
  // Read-only look at the user's live PTY terminal (Phase 2 bridge). The
  // accessor is wired only in the daemon bootstrap; elsewhere the tool degrades
  // to "no terminal here", so registering it unconditionally is safe.
  registry.register(readTerminalTool);
  // The agent's live task list (Claude Code's checklist). Read-risk: it
  // touches nothing but the transcript.
  registry.register(todoWriteTool);
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  registry.register(gitLogTool);
  registry.register(gitCommitTool);
  // Web tools reach the internet, so they are the one outbound path a secret
  // could leak through. Under egress lockdown they are not registered at all.
  if (!options.egressLockdown) {
    registry.register(webSearchTool);
    registry.register(webFetchTool);
    // Codemagic reaches the network too, so it rides with the web tools under
    // the egress gate. Present only when a token was delivered (Access on).
    if (options.hasCodemagic) registry.register(codemagicTool);
    if (options.currents?.hermes) registry.register(askHermesTool);
    if (options.currents?.a2a) registry.register(askAgentTool);
    if (options.currents?.cli) registry.register(cliAgentTool);
  }
  registry.register(searchRepoTool);
  // The agent's durable, on-device knowledge vault. Reads/lists flow; writes
  // always ask (vaultWriteTool.alwaysAsk). The reads teach search first, then
  // a section, then links (CTO I11). Both the separate reads and the merged
  // vaultLookup are registered; the loop offers one set per seat each turn
  // (seatOffersVaultTool), since an escalation changes the seat mid-task.
  if (options.vault !== false) {
    registry.register(vaultSearchTool);
    registry.register(vaultReadTool);
    registry.register(vaultBacklinksTool);
    registry.register(vaultListTool);
    registry.register(vaultLookupTool);
    if (options.vaultWrite !== false) registry.register(vaultWriteTool);
  }
  // The project-memory notes are the exception: hard-scoped to five files in
  // the project's repo ("OpenShore Project <name> MDs/"), so these writes land
  // without asking (the engine auto-allows this tool by name).
  if (options.memory !== false) registry.register(projectMemoryWriteTool);
  // Specialist-facing tools appear only when the stack can serve them, so a
  // single-model setup never tempts the model with tools that cannot work. They
  // delegate to other models (some of which may be cloud), so egress lockdown
  // drops them too: a secrets session does its own work, on-device.
  if (!options.egressLockdown) {
    if (options.stackHasVision) registry.register(analyzeImageTool);
    if (options.stackHasImageGen) registry.register(generateImageTool);
    if (options.stackHasSpecialists) registry.register(delegateTool);
  }
  return registry;
}

/** The merged vault tool a lean seat sees in place of the separate reads. */
export const MERGED_VAULT_TOOL = vaultLookupTool.name;

/**
 * Whether a seat is offered a vault tool, by the class policy's
 * `mergedVaultTool` (CTO I11): a merged seat sees vaultLookup and not the four
 * separate reads; any other seat sees the separate reads and not vaultLookup.
 * Every other tool passes. The loop applies it before the small-seat cut.
 */
export function seatOffersVaultTool(name: string, mergedVaultTool: boolean): boolean {
  if (name === MERGED_VAULT_TOOL) return mergedVaultTool;
  if (SEPARATE_VAULT_READ_TOOLS.includes(name)) return !mergedVaultTool;
  return true;
}

/**
 * The small-seat tool priority with vaultLookup placed right after
 * searchRepo (CTO I11): a small seat's ten see it, a tiny seat's six do not
 * (tiny leans on the pack). Without searchRepo in the list it goes last.
 */
export function withVaultLookupPriority(priority: readonly string[]): string[] {
  const out = priority.filter((n) => n !== MERGED_VAULT_TOOL);
  const at = out.indexOf('searchRepo');
  out.splice(at === -1 ? out.length : at + 1, 0, MERGED_VAULT_TOOL);
  return out;
}

/**
 * The vault's privacy rules, compiled on first use and kept (CTO I4). Lazy so
 * a session that never touches a note never pays for it, and so a config the
 * compiler refuses fails the vault tools that need it, loudly, never by
 * opening every note.
 */
export function lazyVaultPrivacy(cfg: VaultPrivacyConfig): VaultPrivacy {
  let compiled: VaultPrivacy | undefined;
  return {
    visibility(note) {
      compiled ??= compileVaultPrivacy(cfg);
      return compiled.visibility(note);
    },
  };
}

/** The vault's privacy for one session (Vault M7, CTO L4, L5): the machine's
 *  rules unioned with the vault's own file (`.oscode/vault.json`), which can
 *  only hide more or keep more on this computer. `visibility` stays sync;
 *  `refresh` re-reads the settings (kept 2 s, `force` at a task start) and
 *  recompiles only when the file's narrowing changed. */
export interface VaultPrivacyHolder extends VaultPrivacy {
  refresh(options?: { force?: boolean }): Promise<void>;
  /** The last settings read that could be trusted, or undefined before the
   *  first refresh. */
  settings(): ResolvedVaultSettings | undefined;
}

const holderLog = logger('vault-settings');

/**
 * Build the holder for the vault at `root` (a path, or a getter so a caller
 * that repoints the context's root is followed). Like lazyVaultPrivacy it
 * compiles on first use, so a machine config the compiler refuses fails the
 * vault tools loudly, never by opening every note.
 *
 * The last good narrowing (L4): a file that read `ok` sets it, no file clears
 * it, and a file that is `unreadable` or `unavailable` (or a read that threw)
 * keeps the one before, so a sync client mid-download never opens a note the
 * file keeps local. The engine keeps it in memory for the process.
 */
export function vaultPrivacyHolder(
  cfg: VaultPrivacyConfig,
  root: string | (() => string | undefined),
): VaultPrivacyHolder {
  let narrowing: VaultPrivacyNarrowing | undefined;
  let narrowingKey = '';
  let settings: ResolvedVaultSettings | undefined;
  let compiled: VaultPrivacy | undefined;
  let lastRoot: string | undefined;
  const rootNow = (): string | undefined => (typeof root === 'string' ? root : root());
  return {
    visibility(note) {
      compiled ??= compileVaultPrivacy(cfg, narrowing);
      return compiled.visibility(note);
    },
    settings: () => settings,
    async refresh(options) {
      const dir = rootNow();
      if (!dir) return;
      if (lastRoot !== undefined && lastRoot !== dir) {
        // A repointed root starts from nothing of the old one's.
        narrowing = undefined;
        narrowingKey = '';
        settings = undefined;
        compiled = undefined;
      }
      lastRoot = dir;
      let next: ResolvedVaultSettings;
      try {
        next = await vaultSettingsFor(dir, options);
      } catch (err) {
        holderLog.warn('vault settings unavailable; keeping the last good', { err: String(err) });
        return;
      }
      if (next.fileState === 'unreadable' || next.fileState === 'unavailable') {
        settings ??= next;
        return;
      }
      settings = next;
      const fresh = next.fileState === 'ok' ? next.narrowing : undefined;
      const key = JSON.stringify(fresh ?? null);
      if (key !== narrowingKey) {
        narrowing = fresh;
        narrowingKey = key;
        compiled = undefined;
      }
    },
  };
}

/** The machine's vault privacy config, schema defaults filling what a bare
 *  config leaves out. */
export function vaultPrivacyConfig(config: OscConfig): VaultPrivacyConfig {
  const vault = config.vault ?? VaultSchema.parse({});
  return {
    exclude: vault.exclude ?? [],
    localOnly: vault.localOnly ?? VaultSchema.parse({}).localOnly,
  };
}

export function buildToolContext(options: {
  cwd: string;
  config: OscConfig;
  router: Router;
  providers: ProviderRegistry;
  /** The project this session belongs to, when it belongs to one. */
  projectName?: string;
  /** On when the session holds the project's secrets (local model only): no
   *  work may reach an off-device service. Forces repo search to the local
   *  keyword index, so a cloud embedder is never called (it would send repo
   *  chunks and the query, which could carry a secret, off the machine). */
  egressLockdown?: boolean;
  /** Off leaves the vault root unset, so no vault tool can reach the folder
   *  (a member's session on a shared hub). Undefined means on. */
  vault?: boolean;
  /** This session's own vault root in place of the machine's (a member's on
   *  a shared hub, CTO J8). Ignored when `vault` is off. */
  vaultRoot?: string;
}): ToolContext {
  const { cwd, config, router, providers, projectName, egressLockdown } = options;
  const egress = new EgressPolicy(config.egress);
  const jail = new Jail(cwd);

  // Semantic retrieval when an embedder is enabled, keyword ranking when not.
  // Under egress lockdown the embedder is never used, even when configured: it
  // can point at a cloud endpoint, and repo search must stay on the device.
  const embeddingRole = egressLockdown ? undefined : router.embeddingRole();
  let searchRepo: ToolContext['searchRepo'];
  if (embeddingRole) {
    const index = new RepoIndex(
      cwd,
      providers.embedder(embeddingRole.ref.provider),
      embeddingRole.ref.model,
    );
    searchRepo = async (query, k) => {
      await index.refresh();
      const hits = await index.search(query, k);
      return hits || keywordSearch(cwd, query, k);
    };
  } else {
    searchRepo = async (query, k) => keywordSearch(cwd, query, k);
  }

  // The on-device vault lives outside the repo, so it is addressed by its own
  // absolute root, not the workspace jail. The machine config places it (never
  // a project file, which could steer what the agent reads without a prompt);
  // unset means ~/OSCode/Vault, alongside the OSCode clones the daemon makes. A
  // session without the vault (a member's, on a shared hub) gets no root.
  const vaultRoot = options.vault === false ? undefined : (options.vaultRoot ?? loadVaultDir().dir);

  const ctx: ToolContext = {
    cwd,
    jail,
    egress,
    config,
    imageProvider: providers.imageProvider(),
    delegate: (role, task, images, options) => router.delegate(role, task, images, options),
    searchRepo,
    vaultRoot,
    projectName,
  };
  // Which notes are hidden and which stay on this computer: the machine's
  // vault config (projectPolicy classes these keys machine) unioned with the
  // vault's own file, which only narrows (Vault M7, CTO L4). The holder follows
  // the context's root, so a caller that repoints it is followed.
  if (vaultRoot) {
    const holder = vaultPrivacyHolder(vaultPrivacyConfig(config), () => ctx.vaultRoot);
    ctx.vaultPrivacy = holder;
    ctx.vaultRefresh = (opts) => holder.refresh(opts);
    ctx.vaultSettings = () => holder.settings();
  }
  return ctx;
}
