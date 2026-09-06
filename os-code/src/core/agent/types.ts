// Agent events and approval contracts. The TUI, the plain renderer, and the
// daemon all consume this one event stream; approvals flow the other way
// through the Approver callback.
import type { ToolRisk } from '../permissions/index.js';
import type { Citation, ToolOutput } from '../tools/index.js';
import type { ParsedToolCall } from '../tools/parser.js';

export interface ApprovalRequest {
  id: string;
  kind: 'tool' | 'cloud-spend';
  toolName: string;
  risk: ToolRisk;
  /** One line: the exact command, the file and diff stats, the spend estimate. */
  summary: string;
  /** Diff or detail block. */
  detail?: string;
}

export interface ApprovalAnswer {
  approve: boolean;
  /** Ask again next time, or allow this tool for the rest of the session. */
  alwaysThisSession?: boolean;
  /** Persist an allow rule for this tool, scoped to the path's directory (or
   *  the command's first word), in the project's os-code.config.json. The
   *  Claude Code "don't ask again for this in this project". */
  alwaysInProject?: boolean;
  /** On a denial, the reason the model should see and act on, in place of the
   *  generic "the user declined" line. The client uses it to explain a policy
   *  denial the model can do something about, e.g. Terminal Control being off,
   *  so the model tells the person how to change it rather than just retrying. */
  reason?: string;
}

export type Approver = (request: ApprovalRequest) => Promise<ApprovalAnswer>;

export type StopReason = 'complete' | 'guardrail' | 'aborted' | 'declined' | 'error';

/**
 * The permission mode, the same four Claude Code offers. `default` asks for
 * writes and shell; `acceptEdits` lets file edits flow and still asks for
 * shell; `plan` forbids every mutating tool and has the model propose a plan
 * first; `bypassPermissions` runs everything except cloud spend and the
 * always-ask tools without a prompt.
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
] as const;

/** One row of the agent's task list, mirrored to the UI as a checklist. */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  /** For a play (the app's plan-first flow): the model that owns this step, so
   *  the briefing and live status show who each handoff goes to. Absent for an
   *  ordinary agent todo list. */
  owner?: string;
}

export type AgentEvent =
  | { type: 'task-start'; input: string }
  | { type: 'turn-start'; turn: number; model: string; providerKind: 'local' | 'cloud' }
  | { type: 'text-delta'; text: string }
  | { type: 'text-final'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'tool-start'; call: ParsedToolCall }
  | { type: 'tool-end'; call: ParsedToolCall; result: ToolOutput; durationMs: number }
  | { type: 'tool-denied'; call: ParsedToolCall; reason: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'status'; message: string }
  | { type: 'note'; message: string }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      dollars: number;
      contextPercent: number;
    }
  | { type: 'model-switch'; model: string; providerKind: 'local' | 'cloud'; reason: string }
  | { type: 'task-done'; reason: StopReason; message?: string }
  // The agent's task list, replaced whole each time it calls todoWrite.
  | { type: 'todos'; items: TodoItem[] }
  // Plan mode: the model's proposed plan, awaiting the person's go-ahead.
  | { type: 'plan-proposed'; text: string }
  // The plan-first flow (app): the reasoning LLM needs the person to settle the
  // framing before it draws the play. Rendered as a picker; the reply is folded
  // back in and re-framed. Free text is always allowed alongside the options.
  | {
      type: 'clarify';
      summary: string;
      questions: Array<{ id: string; question: string; options?: string[] }>;
    }
  // The permission mode in force, so a reattaching client shows the truth.
  | { type: 'mode'; mode: PermissionMode }
  // Where the session works and the branch it is on; refreshed at the
  // bookends of each task so the chat can show it and mark uncommitted work.
  | { type: 'repo-info'; cwd: string; branch?: string; dirty?: boolean }
  // A short generated title after the first completed exchange.
  | { type: 'title'; title: string }
  // The always-on ethics layer stopped this request or this answer. Carried as
  // its own event, not folded into an error, so every client can show the
  // plain refusal and a reviewer can see that the layer acted. The category and
  // tier travel; the content never does.
  | {
      type: 'ethics-block';
      category: string;
      tier: 1 | 2 | 3;
      side: 'input' | 'output';
      message: string;
    };

export type EventSink = (event: AgentEvent) => void;

/**
 * The full driver-level event stream: agent events plus the approval
 * hand-off. This is the wire protocol between an engine session and any
 * renderer (the desktop app over IPC, the phone app over SSE), so it lives
 * here in a pure module both sides can import.
 */
export type DriverEvent =
  | AgentEvent
  | { type: 'approval-request'; request: ApprovalRequest }
  | { type: 'approval-resolved'; id: string; approved: boolean }
  // The user-initiated command lane (the chat-to-terminal bridge). Driver-level,
  // not agent-level: a command the user runs from the phone or desktop shell,
  // its live output, and its result. `source: 'user'` is the tapped-Run lane;
  // 'agent' is reserved for surfacing an agent runShell here in a later phase.
  | {
      type: 'command-start';
      runId: string;
      command: string;
      cwd: string;
      source: 'user' | 'agent';
    }
  | { type: 'command-output'; runId: string; chunk: string; stream: 'stdout' | 'stderr' }
  | {
      type: 'command-end';
      runId: string;
      exitCode: number | null;
      signal?: string;
      durationMs: number;
      truncated: boolean;
    }
  // The interactive PTY terminal (Phase 2). Content-free audit markers ONLY: a
  // terminal's raw ANSI bytes never enter the journal (they cannot be redacted
  // line-wise and ride their own offset-based stream). These record that a
  // terminal opened or closed, with its cwd, never its output and never stdin.
  | { type: 'terminal-opened'; termId: string; cwd: string }
  | { type: 'terminal-closed'; termId: string };
