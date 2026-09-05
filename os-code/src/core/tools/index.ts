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
}

export interface ToolPreview {
  /** One line for the approval prompt, e.g. the exact command. */
  summary: string;
  /** Optional diff or detail block rendered under the summary. */
  detail?: string;
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
   *  The project-memory tool derives its Projects/<project>/ folder from this
   *  (falling back to the workspace basename). Undefined for a project-less
   *  chat or the bare CLI. */
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
  execute: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolOutput>;
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
