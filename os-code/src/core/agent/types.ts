// Agent events and approval contracts. The TUI, the plain renderer, and the
// daemon all consume this one event stream; approvals flow the other way
// through the Approver callback.
import type { ToolRisk } from '../permissions/index.js';
import type { Citation, ToolOutput } from '../tools/index.js';
import type { ParsedToolCall } from '../tools/parser.js';
import type { PackMode, PackSource } from '../../harness/vaultContext.js';
import type { RepoCommand, RepoCommandNotLoaded } from './commandText.js';

export interface ApprovalRequest {
  id: string;
  kind: 'tool' | 'cloud-spend';
  toolName: string;
  risk: ToolRisk;
  /** One line: the exact command, the file and diff stats, the spend estimate. */
  summary: string;
  /** Diff or detail block. */
  detail?: string;
  /** True for a tool that asks every time (vaultWrite): an allow for the
   *  session or the project never takes effect on it, so a client offers
   *  only approve and decline. Absent for every other tool. */
  alwaysAsk?: boolean;
  /** True while the session holds the project's secrets (the egress
   *  lockdown), so a client says why it is asking on every card (CX 7).
   *  Additive: absent on every other session. */
  lockdown?: boolean;
  /** For a commit: every file it would stage, each flagged when it may hold a
   *  secret, and where the app's sync sends it afterward (D3). A flagged file
   *  is left out unless the answer's `files` names it. Additive. */
  commit?: CommitStage;
}

/** Why a file in a commit may hold a secret: a settings file that often holds
 *  keys (.env), a certificate or private key (*.pem), a private login key
 *  (id_*), or text in it that looks like a key or a password. */
export type StageSecret = 'env' | 'pem' | 'login-key' | 'detected';

/** One file a commit would stage, repo-relative with forward slashes. */
export interface StageFile {
  path: string;
  secret?: StageSecret;
}

/** What a commit would record, for its approval card. */
export interface CommitStage {
  /** The commit message the model wrote. */
  message: string;
  files: StageFile[];
  /** The platform the app's sync pushes this branch to after the commit
   *  ("GitHub"), when it will. Absent when the commit stays on this
   *  computer. */
  pushesTo?: string;
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
  /** For a commit card (`request.commit`): the files the person left ticked,
   *  flagged ones included only when ticked. Absent, a commit stages every
   *  file it listed except the flagged ones. */
  files?: string[];
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
      /** Prompt tokens read from the provider's prompt cache this turn (Vault
       *  M5, CTO J17). Additive: absent when the provider reports none. */
      cacheReadTokens?: number;
      /** Prompt tokens written to the provider's prompt cache this turn. */
      cacheWriteTokens?: number;
      /** The loop's own estimate of the prompt this turn sent (messages, tool
       *  specs and template), on a turn's usage only (C1). Beside the three
       *  counts above it shows whether the server read the prompt whole, so
       *  the eval can close the served-window gate on data. Additive. */
      estimatedPromptTokens?: number;
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
  // `commands` are the person's own slash commands found for this folder
  // (P3: the repository's .claude/commands and their own), names and words
  // only; `commandsNotLoaded` says which files were found and left out, and
  // why. Both ride only when the list changed since this session last said
  // it, so a client keeps the last list it saw while they are absent.
  | {
      type: 'repo-info';
      cwd: string;
      branch?: string;
      dirty?: boolean;
      commands?: RepoCommand[];
      commandsNotLoaded?: RepoCommandNotLoaded[];
    }
  // A short generated title after the first completed exchange.
  | { type: 'title'; title: string }
  // The harness ran the project's check command after a task that changed files
  // (verify, tenet 3), so a client shows verified / not verified without anyone
  // reading the transcript. `detail` is a tail of the command output.
  // `round` counts the checks this task (1 is the first); `willRetry` is true
  // when the failure is going back to the model for another go, so a client
  // can say "trying again" instead of "not verified" and the final verdict is
  // the last verify event of the task.
  | {
      type: 'verify';
      passed: boolean;
      summary: string;
      detail?: string;
      round?: number;
      willRetry?: boolean;
      /** Which check spoke: the project's own tests (a configured or found
       *  command) or the page check that runs nothing (v1 Phase 1). Absent
       *  reads as tests. */
      check?: 'tests' | 'page';
    }
  // Best-of-N judged by the project's own check: the previous attempt spent
  // its verify retries without passing, the files it touched are restored to
  // how they were, and the task starts again from the original ask with a
  // clean history. `number` is the attempt now starting, `of` the allowance.
  | { type: 'attempt'; number: number; of: number }
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
    }
  // A Harness Current made a decision this task. Harness Currents (Jev is the
  // first) layer a cheap decision method INTO the harness: they do not answer
  // for a seat, they steer which seat answers or whether a step is needed.
  // Additive and advisory, and off leaves no trace: with no harness current on
  // this never fires. `job` names which mechanical decision it did, `line` is
  // the honest one-liner for the card, and `spend` is true when a cloud call
  // was made so a client can render it amber (tenet 4: cloud is amber spend).
  // Project trust: this folder's own os-code.config.json asks for settings
  // that stay off until the person trusts the folder on this machine (or the
  // folder carries a coding CLI's own settings and CLI Pairing is on). Emitted
  // once when a session starts with something waiting, and again with state
  // 'trusted' when the person trusts it, so every client can fold the card.
  // `waiting` is plain words, one phrase per setting; it names what the file
  // asks for, never a secret.
  | {
      type: 'project-trust';
      state: 'untrusted' | 'changed' | 'trusted';
      folder: string;
      waiting: string[];
    }
  // The model's server read back far less of a turn's prompt than was sent
  // (`looksTruncated` in context/compaction.ts): it cut the chat to fit a
  // window smaller than the prompt, without saying so (C1). Once per chat per
  // model, rendered as a teal card. `room` says what the card may offer:
  // 'more' when serving the model a larger window fits this computer's memory
  // (the "Give it more room" action, which writes `numCtx: 'auto'` for
  // `provider`; `gb` is about what it costs, when the model says enough),
  // 'full' when none does, absent when the window is not the harness's to set
  // (a server other than Ollama). `read` is what the server took in, cache
  // included; `estimated` the loop's estimate of what it sent. Additive.
  | {
      type: 'window-cut';
      model: string;
      provider: string;
      read: number;
      estimated: number;
      room?: 'more' | 'full';
      gb?: number;
    }
  | {
      type: 'harness-current';
      current: string;
      label: string;
      job: 'gate' | 'classify' | 'judge';
      line: string;
      spend: boolean;
    }
  // The vault context pack this task's seat was given (Vault M4, CTO I10).
  // Emitted at the task's first render and again only when the sources change
  // (an escalation re-renders for the new seat). `seat` is 'cloud' when the
  // seat's requests leave this network (amber), else 'local' (teal).
  // `withheld` counts local-only notes left out for a leaving seat; `cold` is
  // true when the index was not ready, so the pack is Current State only.
  // `localOnly` (Vault M5) is set when the pack carries a note that stays on
  // this computer (only ever on a 'local' seat), so a client marks the reply
  // it grounds local-only (I5). Additive: an older client ignores it.
  | {
      type: 'context-pack';
      seat: 'local' | 'cloud';
      mode: PackMode;
      tokens: number;
      budgetTokens: number;
      sources: PackSource[];
      withheld: number;
      cold: boolean;
      localOnly?: true;
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
  // The command lane (the chat-to-terminal bridge). Driver-level, not
  // agent-level: a command runs from the phone or desktop shell, with its live
  // output and its result. `source: 'user'` is the tapped-Run lane; 'agent' is
  // a program the agent started and left running (startProcess, P1), which a
  // client labels "Started by OpenShore".
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
  | { type: 'terminal-closed'; termId: string }
  // Undo (v1 Phase 1). A checkpoint after a task that changed files: every
  // file it changed, including ones a shell command wrote, so the chat can
  // offer "Undo these changes" and per-file undo. A restore echoes back so
  // every attached device folds the same card.
  | { type: 'checkpoint'; id: string; files: CheckpointFileChange[] }
  | { type: 'checkpoint-restored'; id: string; direction: 'undo' | 'redo'; paths: string[] };

/** One file a task changed, as a checkpoint records it. */
export interface CheckpointFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}
