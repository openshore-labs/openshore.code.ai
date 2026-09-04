// Wires the standard tool set into a registry and builds the ToolContext for
// a session. One place decides what the agent can touch.
import type { OscConfig } from '../../config/schema.js';
import { EgressPolicy } from '../security/egress.js';
import { Jail } from '../security/jail.js';
import { ToolRegistry, type ToolContext } from '../tools/index.js';
import { readFileTool } from '../tools/readFile.js';
import { writeFileTool } from '../tools/writeFile.js';
import { editFileTool } from '../tools/editFile.js';
import { runShellTool } from '../tools/runShell.js';
import { readTerminalTool } from '../tools/readTerminal.js';
import { grepTool } from '../tools/grep.js';
import { globTool } from '../tools/glob.js';
import { gitCommitTool, gitDiffTool, gitStatusTool } from '../tools/git.js';
import { webSearchTool } from '../tools/webSearch.js';
import { webFetchTool } from '../tools/webFetch.js';
import { generateImageTool } from '../tools/generateImage.js';
import { analyzeImageTool, delegateTool, searchRepoTool } from '../tools/specialist.js';
import { vaultWriteTool, vaultReadTool, vaultListTool } from '../tools/vault.js';
import { projectMemoryWriteTool } from '../tools/projectMemory.js';
import { todoWriteTool } from '../tools/todoWrite.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  registry.register(gitCommitTool);
  // Web tools reach the internet, so they are the one outbound path a secret
  // could leak through. Under egress lockdown they are not registered at all.
  if (!options.egressLockdown) {
    registry.register(webSearchTool);
    registry.register(webFetchTool);
  }
  registry.register(searchRepoTool);
  // The agent's durable, on-device knowledge vault. Reads/lists flow; writes
  // always ask (vaultWriteTool.alwaysAsk).
  registry.register(vaultReadTool);
  registry.register(vaultListTool);
  registry.register(vaultWriteTool);
  // The project-memory notes are the exception: hard-scoped to five files under
  // Projects/<project>/, so these writes land without asking (the engine
  // auto-allows this tool by name).
  registry.register(projectMemoryWriteTool);
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

export function buildToolContext(options: {
  cwd: string;
  config: OscConfig;
  router: Router;
  providers: ProviderRegistry;
  /** The project this session belongs to, when it belongs to one. */
  projectName?: string;
}): ToolContext {
  const { cwd, config, router, providers, projectName } = options;
  const egress = new EgressPolicy(config.egress);
  const jail = new Jail(cwd);

  // Semantic retrieval when an embedder is enabled, keyword ranking when not.
  const embeddingRole = router.embeddingRole();
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
  // absolute root, not the workspace jail. Config can point it anywhere; unset
  // means ~/OSCode/Vault (alongside the OSCode clones the daemon makes).
  const vaultRoot = config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault');

  return {
    cwd,
    jail,
    egress,
    config,
    imageProvider: providers.imageProvider(),
    delegate: (role, task, images) => router.delegate(role, task, images),
    searchRepo,
    vaultRoot,
    projectName,
  };
}
