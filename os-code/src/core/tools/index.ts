// Tool registry and contracts. Every tool validates its arguments with zod at
// the boundary, declares a risk class for the permission engine, and can
// produce a preview (a diff, a command line) for the approval prompt.
import { z } from 'zod';
import type { EgressPolicy } from '../security/egress.js';
import type { Jail } from '../security/jail.js';
import type { ToolRisk } from '../permissions/index.js';
import type { OscConfig } from '../../config/schema.js';
import type { ImageProvider } from '../../providers/types.js';
import type { ToolSpec } from '../../providers/types.js';
import type { DelegatedUsage, DelegateOptions } from '../../router/router.js';
import type { CurrentsHandles } from '../../currents/model.js';
import type { ProvSize, ResolvedVaultSettings, VaultPrivacy } from '../../harness/vault/types.js';

export interface Citation {
  title: string;
  url: string;
  snippet?: string;
}

export interface ToolOutput {
  ok: boolean;
  /** What the model sees as the observation. */
  content: string;
  /** Sources for web-derived answers; the TUI renders these. */
  citations?: Citation[];
  /** Unified diff for edits, shown in transcripts after approval. */
  diffText?: string;
  /** The content came from a local-only vault note (Vault M4, CTO I5). The
   *  loop carries it onto the tool message (`ChatMessage.localOnly`), so a
   *  later turn on a seat that leaves this network sends a stub instead. */
  localOnly?: true;
}

export interface ToolPreview {
  /** One line for the approval prompt, e.g. the exact command. */
  summary: string;
  /** Optional diff or detail block rendered under the summary. */
  detail?: string;
  /** What the preview was built against (vaultWrite: a hash of the note's
   *  bytes, or "absent"). The loop hands it to execute once the person
   *  approves, so the tool can refuse when it changed while the approval sat.
   *  Every other tool leaves it unset. */
  basis?: string;
}

/** What the person approved, passed to execute after an ask. */
export interface ApprovedPreview {
  /** The preview's basis, when it returned one. */
  basis?: string;
}

/** Everything a tool may touch. Built once per session. */
export interface ToolContext {
  cwd: string;
  jail: Jail;
  egress: EgressPolicy;
  config: OscConfig;
  imageProvider?: ImageProvider;
  /** One-shot delegation to a specialist chat model, provided by the router. */
  delegate?: (
    role: 'coding' | 'writing' | 'analysis' | 'fast' | 'vision',
    task: string,
    images?: Array<{ base64: string; mediaType: string }>,
    options?: DelegateOptions,
  ) => Promise<string>;
  /** The running task's abort signal, set by the loop at every task start.
   *  Slow tool work (a delegated generation, a long fetch) honors it so Stop
   *  stops the whole task, not just the orchestrator's own stream (DAE-4). */
  signal?: AbortSignal;
  /** Report a model call a tool made on its own (a delegated subtask), so the
   *  loop can count its tokens, price cloud spend, and show it. Set by the loop. */
  noteUsage?: (usage: DelegatedUsage) => void;
  /** Semantic repo retrieval, provided by the context layer when enabled. */
  searchRepo?: (query: string, k: number) => Promise<string>;
  /** Absolute path to the on-device knowledge vault (markdown files). The vault
   *  tools resolve note paths under here, jailed to it. */
  vaultRoot?: string;
  /** The name of the project this session belongs to, when it belongs to one.
   *  The project-memory tool derives its folder in the repo, "OpenShore Project
   *  <name> MDs/", from this (falling back to the workspace basename). Undefined
   *  for a project-less chat or the bare CLI. */
  projectName?: string;
  /**
   * Read the recent raw output of this session's interactive terminal (Phase 2
   * PTY bridge), so the agent can look at the user's terminal with no
   * screenshot. Returns the last `lines` lines with ANSI still intact (the
   * readTerminal tool strips, redacts, and caps them), or undefined when there
   * is no terminal. Wired only by the daemon bootstrap; CLI/test bootstraps
   * leave it undefined and the tool degrades to "no terminal here".
   */
  terminal?: (lines: number, termId?: string) => string | undefined;
  /**
   * The person's Codemagic token and saved launch target, so the codemagic tool
   * can trigger and read App Launch builds. Injected per session ONLY on the
   * local, on-device engine and only when the person turned Codemagic Access on;
   * never delivered to a remote hub (same stance as project secrets). Undefined
   * leaves the codemagic tool degraded to "not connected here".
   */
  codemagic?: {
    token: string;
    target?: { appId: string; workflowId: string; branch: string; platform?: string };
  };
  /**
   * The Agentic Current the person turned on for this session, as a handle the
   * matching tool uses (a Hermes box, an A2A agent, a paired coding CLI). One
   * current at a time, so at most one field is set. Undefined leaves every
   * current tool out of the registry (and degraded if somehow reached).
   */
  currents?: CurrentsHandles;
  /** This session's id, so a tool that keeps per-session state on another
   *  service (Hermes session continuity) can key it without a global. */
  sessionId?: string;
  /** Whether the person's permission policy denies `toolName` at this path (a
   *  deny rule's glob, a deny default). Set by the loop from the session's
   *  permission engine, so a listing can hide what a read there would refuse.
   *  Unset (a bare test context) denies nothing. */
  denies?: (toolName: string, path: string) => boolean;
  /** Which vault notes are hidden and which stay on this computer (Vault M4,
   *  CTO I4, I5), compiled once at bootstrap from the machine's vault config
   *  (`compileVaultPrivacy`). Every vault tool consults it. Unset (a bare test
   *  context) leaves every note open. */
  vaultPrivacy?: VaultPrivacy;
  /** Read the vault's own settings again (Vault M7, CTO L5, L6), so the sync
   *  `vaultPrivacy` holds the union with the vault's file. Kept 2 s; `force`
   *  reads now (a task start, a pack prepare). Every vault tool awaits it at
   *  entry. Never throws: a read that fails keeps the last good settings.
   *  Unset (a bare test context) reads nothing. */
  vaultRefresh?: (options?: { force?: boolean }) => Promise<void>;
  /** The vault's resolved settings as last refreshed (the agent folder, L2),
   *  or undefined before the first refresh or with no vault. */
  vaultSettings?: () => ResolvedVaultSettings | undefined;
  /** The seat answering now, for the provenance lines on a note the agent
   *  writes (Vault M7, CTO L9): its model, class and, for a cloud seat, the
   *  provider. Where it runs is `seatLeavesNetwork`. Set by the loop each
   *  turn; unset writes the lines it can without them. */
  vaultSeat?: () => { model?: string; size?: ProvSize; provider?: string };
  /** Whether the seat answering right now sends its requests off this network
   *  (`leavesThisNetwork`, judged by address). Set by the loop each turn, so a
   *  read of a local-only note says it stays on this computer, and search and
   *  backlinks leave such notes out. Unset reads as a seat that leaves (the
   *  safe reading); the loop always sets it. */
  seatLeavesNetwork?: () => boolean;
  /** The most characters one vault read returns for the seat answering now
   *  (the class policy's `vaultReadCapChars`, CTO I11). Set by the loop each
   *  turn, like `seatLeavesNetwork`; past it a read returns the note's outline
   *  and asks for a section. Unset uses capContent's own cap. */
  vaultReadCapChars?: () => number;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  risk: ToolRisk;
  /** When true, this tool ALWAYS prompts for approval, before any auto-allow
   *  path (session grant, permission rule, trusted repo). Used for actions that
   *  must never happen silently, e.g. the agent writing to the user's vault. */
  alwaysAsk?: boolean;
  /** Primary path argument, for glob-scoped permission rules. Receives the
   *  session context so a tool whose path is derived from context (not from its
   *  arguments) can still report it; context-free tools ignore the second arg. */
  pathOf?: (args: z.infer<S>, ctx?: ToolContext) => string | undefined;
  /** Which root pathOf's path is relative to. 'workspace' (the default) has
   *  the loop resolve it through the workspace jail before any permission
   *  rule sees it, and deny outright when it leaves the jail; 'own' is for
   *  tools with their own root (the vault), whose pathOf returns a path that is
   *  already normalized against that root. */
  pathJail?: 'workspace' | 'own';
  /** The shell command a tool runs, for prefix-scoped permission rules. */
  commandOf?: (args: z.infer<S>) => string | undefined;
  /** Build the approval preview. Called only when the decision is 'ask'. */
  preview?: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolPreview>;
  /** Run the tool. `approved` is set only after an ask whose preview
   *  succeeded, carrying that preview's basis; every other path omits it. */
  execute: (args: z.infer<S>, ctx: ToolContext, approved?: ApprovedPreview) => Promise<ToolOutput>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef<any>>();

  register(tool: ToolDef<any>): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDef<any> | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  all(): ToolDef<any>[] {
    return [...this.tools.values()];
  }

  /** OpenAI/Anthropic-shaped tool specs from the zod schemas. */
  specs(): ToolSpec[] {
    return this.all().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema) as Record<string, unknown>,
    }));
  }

  /**
   * Plain-text tool documentation for the JSON-in-text bridge, used when a
   * model has no native tool support.
   */
  textDocs(): string {
    const lines: string[] = [];
    for (const tool of this.all()) {
      const schema = JSON.stringify(z.toJSONSchema(tool.schema));
      lines.push(`- ${tool.name}: ${tool.description}\n  args schema: ${schema}`);
    }
    return lines.join('\n');
  }
}

/** Truncate observations so a small local context is never flooded. */
export function capContent(text: string, maxChars = 24_000): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars * 0.75);
  const tail = text.slice(-Math.floor(maxChars * 0.15));
  return `${head}\n... [${text.length - maxChars} characters trimmed; re-run with a narrower target to see more] ...\n${tail}`;
}
