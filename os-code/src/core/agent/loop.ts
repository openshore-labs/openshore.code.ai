// The agent loop. ReAct-style tool use with streaming: system prompt to the
// model, the model answers with text or tool calls, approved tools run, the
// observations feed back, repeat until the task is done or a guardrail says
// stop. Native tool calling and the JSON-in-text bridge both land here, with
// bounded repair, optional grammar-constrained retries, and cloud escalation
// as a last resort that always asks before spending.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import type { OscConfig } from '../../config/schema.js';
import type { ChatMessage, ContentPart, Provider, ToolCallRequest } from '../../providers/types.js';
import { leavesThisNetwork, ProviderError } from '../../providers/types.js';
import { adapterFor, type ModelAdapter } from '../../providers/adapters/index.js';
import type { DelegatedUsage, Router } from '../../router/router.js';
import {
  capContent,
  type ApprovedPreview,
  type ToolContext,
  type ToolDef,
  type ToolRegistry,
} from '../tools/index.js';
import { effectiveMode } from './modes.js';
import { uxStandardPrompt } from './uxStandard.js';
import { humanizerStandardPrompt } from './humanizerStandard.js';
import {
  ThinkTagSplitter,
  chainOfThoughtPrompt,
  reasonsNatively,
  splitThinkTags,
} from './chainOfThought.js';
import {
  CURRENT_STATE_FILE,
  PROJECT_MEMORY_WRITE_TOOL,
  isMemoryFilePath,
  memorySegment,
  projectMemoryPrompt,
} from './projectMemory.js';
import { HARNESS_LINE_MARK, appendLandedLine } from '../tools/projectMemory.js';
import {
  extractTextCalls,
  repairPrompt,
  textProtocolInstructions,
  toolCallJsonSchema,
  validateNativeCall,
  type ParsedToolCall,
} from '../tools/parser.js';
import { PermissionEngine, prefixGrantRefusal } from '../permissions/index.js';
import { Guardrails } from '../guardrails/index.js';
import { Jail, JailViolation, realRelativePath } from '../security/jail.js';
import { platformAndShell } from '../exec/shell.js';
import type { SecurityProfile } from '../security/profiles.js';
import { redactSecrets } from '../security/redaction.js';
import {
  compactHistory,
  estimateMessages,
  estimateTokens,
  estimateToolSpecs,
} from '../../context/compaction.js';
import { UsageTracker } from '../../auth/usage.js';
import type {
  AgentEvent,
  ApprovalAnswer,
  ApprovalRequest,
  Approver,
  CommitStage,
  EventSink,
  PermissionMode,
  TodoItem,
} from './types.js';
import { instructionsPrompt, type RepoInstructions } from './instructions.js';
import { verifyRetryPrompt } from '../../harness/verify.js';
import { runVerifyAsync } from './verifyRun.js';
import { pageCheck } from './pageCheck.js';
import { commandDigest, detectCheckCommand } from './checkDetect.js';
import { addVerifyGrant, hasVerifyGrant } from '../../config/trust.js';
import {
  deriveProfile,
  deriveModelClass,
  classBlurb,
  type ModelClassProfile,
} from '../../harness/profile.js';
import { vaultPackSize } from '../../harness/vault/settings.js';
import { withholdLocalOnly } from '../../harness/vault/privacy.js';
import {
  buildContextPack,
  packBudgetTokens,
  packModeFor,
  type ContextPack,
  type PreparedVaultContext,
  type VaultContextSource,
} from '../../harness/vaultContext.js';
import { JevAdvisor, type FetchLike } from '../../harness/jev.js';
import {
  HANDOFF_MAX_TOKENS,
  buildHandoff as coreBuildHandoff,
  handoffBudgetTokens,
} from '../../harness/handoff.js';
import { handoffTurnsFromHistory, type HandoffRecord } from './handoffStore.js';
import type { HarnessCurrentsHandle } from '../../currents/model.js';
import type { ToolSpec } from '../../providers/types.js';
import { MERGED_VAULT_TOOL, seatOffersVaultTool, withVaultLookupPriority } from './registry.js';
import { DEFAULT_VAULT_READ_CAP_CHARS } from '../tools/vaultFind.js';
import {
  OBSERVATION_SLACK_CHARS,
  WindowWatch,
  nextFailStreak,
  seatObservationCap,
  type CallOutcome,
} from './window.js';
import { logger } from '../../util/log.js';

const log = logger('agent');

export interface AgentDeps {
  config: OscConfig;
  router: Router;
  tools: ToolRegistry;
  toolContext: ToolContext;
  permissions: PermissionEngine;
  guardrails: Guardrails;
  usage: UsageTracker;
  profile: SecurityProfile;
  approver: Approver;
  onEvent: EventSink;
  /** Optional repo code map injected into the system prompt. */
  codeMap?: string;
  /** Standing instructions read from the repo (OSCODE.md, CLAUDE.md, AGENTS.md). */
  repoInstructions?: RepoInstructions;
  /** The person's standing instructions for this project (the app's Projects). */
  instructions?: string;
  /** The project's tokens and secrets, present ONLY for a local orchestrator
   *  (bootstrap drops it for a cloud one). When present, it rides into the
   *  system prompt and the session never escalates to the cloud. */
  projectSecrets?: string;
  /** The permission mode to start in. Defaults to asking for writes and shell. */
  permissionMode?: PermissionMode;
  /** The tools this session left out because it works offline (a Crew
   *  routine, CTO 3). A call the model makes to one anyway is refused by name,
   *  never asked, and never read as a malformed call. */
  offlineTools?: readonly string[];
  /** Persist an allow rule for this tool in the workspace ("don't ask again
   *  for this in this project"). Returns false when nothing could be written. */
  persistRule?: (rule: ProjectRule) => boolean;
  /** May this session's person grant a check command to run after changes
   *  (v1 Phase 1)? False for a member's session on a shared hub: the owner
   *  decides what runs on the computer. Undefined reads as yes. */
  canGrantVerify?: boolean;
  /** The Harness Current the person turned on, as a per-session handle (Jev is
   *  the first). A Harness Current layers a cheap decision method into the
   *  loop; the engine uses it here for the verify judge when there is no check
   *  command to run. Undefined leaves the harness current off for this session.
   *  Bootstrap drops it under egress lockdown, so it never fires while project
   *  secrets are present. */
  harnessCurrents?: HarnessCurrentsHandle;
  /** Injectable fetch for the Jev advisor, so tests drive it with no network.
   *  Defaults to the global fetch. */
  jevFetch?: FetchLike;
  /** Where this session's vault context pack comes from (Vault M4, CTO I8):
   *  prepared once per task, rendered per turn for the seat that answers.
   *  The engine's source is core/vault/contextSource.ts; undefined leaves the
   *  pack out. Memory off or `vault.context: 'off'` leaves it out too. */
  vaultContext?: VaultContextSource;
  /** The clock for the dated Current State line (tests pin it). */
  now?: () => Date;
  /** Where a handoff goes (Vault M5, CTO J13): called after a compaction,
   *  after each task that ends complete, and when the session is disposed,
   *  with a short extractive summary of the chat. Bootstrap wires the
   *  engine's store (core/agent/handoffStore.ts). Undefined, Memory off, or
   *  `vault.handoff: 'off'` writes none. */
  onHandoff?: (record: HandoffRecord) => void;
  /** The handoff builder (harness/handoff.ts `buildHandoff`), a seam so a
   *  test can stand it in. */
  buildHandoff?: typeof coreBuildHandoff;
}

/** Whether an absolute path lies inside the vault folder (or is it), with
 *  symlinks resolved through the vault's own jail. False with no vault. */
function insideVault(abs: string, vaultRoot: string | undefined): boolean {
  if (!vaultRoot) return false;
  try {
    new Jail(vaultRoot).resolve(abs);
    return true;
  } catch (err) {
    if (err instanceof JailViolation) return false;
    throw err;
  }
}

/** Capitalize a model-class name for a sentence ("small" -> "Small"). */
function cap(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** The first user turn's text, for the Jev judge's task side. */
function firstUserText(history: ChatMessage[]): string | undefined {
  const m = history.find((x) => x.role === 'user');
  return typeof m?.content === 'string' && m.content.trim() ? m.content : undefined;
}

/** The last assistant turn's text, for the Jev judge's result side. */
function lastAssistantText(history: ChatMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
      return m.content;
    }
  }
  return undefined;
}

/** The shape of a rule the loop asks to persist for a project. */
export interface ProjectRule {
  tool: string;
  pathGlob?: string;
  commandPrefix?: string;
}

/** Tools a plan may use: nothing that changes the workspace or runs a shell. */
const PLAN_SAFE_RISKS = new Set(['read', 'network']);

/** Why a call to a tool an offline run left out did not run (CTO 3). The
 *  scheduler reads the denial for the run's note. */
export const OFFLINE_DENIED = 'This routine works offline, so nothing here reaches the web.';
const OFFLINE_ADVICE =
  'Work only from the files in the workspace, and say in your report what you could not check.';

/** The local calendar date, YYYY-MM-DD, for a dated Current State line. */
function localDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The classes the harness runs a lean prompt for: a small seat gets the few
 *  tools the step calls for and a compact standards digest instead of the full
 *  multi-KB text, so its context goes to the task, not to instructions it cannot
 *  hold. mid and large get the full prompt. */
const LEAN_CLASSES = new Set<string>(['tiny', 'small']);

/** When a small seat can see only a handful of tools, these are the ones worth
 *  showing, most useful first: read, edit, search, then the rest. Tools not
 *  listed keep their registration order after these. The merged vault read
 *  slots in right after searchRepo (withVaultLookupPriority, CTO I11), so a
 *  small seat's ten see it and a tiny seat's six do not. */
const SMALL_MODEL_TOOL_PRIORITY = withVaultLookupPriority([
  'readFile',
  'editFile',
  'writeFile',
  'grep',
  'glob',
  'searchRepo',
  'runShell',
  'todoWrite',
  'gitDiff',
  'gitStatus',
  'webFetch',
  'webSearch',
  'readTerminal',
]);

/** Transient provider failures worth a bounded retry. */
const TRANSIENT =
  /\b(429|503|overloaded|rate.?limit|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed)\b/i;
const RETRY_DELAYS_MS = [2000, 6000];

interface ActiveModel {
  provider: Provider;
  model: string;
  adapter: ModelAdapter;
}

export class AgentSession {
  readonly id = randomUUID();
  history: ChatMessage[] = [];
  private active: ActiveModel;
  private escalated = false;
  private cloudApprovedForSession = false;
  private cloudApprovedForTask = false;
  private abortController?: AbortController;
  private mode: PermissionMode;
  private instructions?: string;
  private todos: TodoItem[] = [];
  private transientRetries = 0;
  /** Set when a write-risk tool succeeded this task, so verify runs only when
   *  there is something to verify. */
  private wroteThisTask = false;
  /** This task has read a local-only vault note, so what the model says next
   *  may quote it: its replies are marked `localOnly` too (CTO I5), the same
   *  rule seed.ts applies to a journaled reply. */
  private readLocalOnlyThisTask = false;
  /** The active model's window, from the last turn's capabilities; 0 until then. */
  private contextTokens = 0;
  /** The model-class profile for the active model this turn (the discipline
   *  seam). Undefined when harness.profiles is off, so the full prompt and every
   *  tool reach the model exactly as before. Recomputed each turn since the
   *  active model can switch (a cloud escalation becomes the large class). */
  private modelProfile?: ModelClassProfile;
  /** So the lean-seat note is said once per session, not every turn. */
  private profileNoteEmitted = false;
  /** A lean seat that answers with code but changes no file is nudged to make
   *  the change, once per task; this flag keeps it to once. */
  private noWriteNudged = false;
  /** Set when a write-risk tool was tried this task, whether or not it landed.
   *  Distinguishes "this task never needed an edit" (a plain question) from
   *  "it tried to edit and every attempt failed", which the no-write nudge
   *  below also catches even when the final answer shows no code at all. */
  private attemptedWriteThisTask = false;
  /** Per task: how many times each exact (tool, args) call has been made and
   *  the step it last ran at, so a repeat with nothing changed in between is
   *  answered from the record instead of run again. */
  private repeatLog = new Map<string, { count: number; lastStep: number }>();
  /** The step of the last successful call that could have changed the
   *  workspace (anything but a read); a repeat after it is a fresh question. */
  private lastChangeStep = 0;
  private callStep = 0;
  /** Set when the model has repeated one exact call three times: the next turn
   *  runs with no tools so the only thing it can do is answer. */
  private answerOnly = false;
  /** Best-of-N judged by the project's check. The minimal checkpoint: each
   *  workspace file a write tool touched this task, keyed by absolute path,
   *  with its content before the first touch (null when it did not exist), so
   *  a fresh attempt can put every one of them back. */
  private touched = new Map<string, string | null>();
  /** Which attempt this task is on, 1-based. */
  private attempt = 1;
  /** The task's own first message, kept so a fresh attempt starts from it
   *  with a clean history, the way the eval's independent tries do. */
  private taskMessage: ChatMessage | undefined;
  /** The active Harness Current's Jev advisor, built lazily from the handle,
   *  or undefined when no harness current is on. Cached across a task. */
  private jev: JevAdvisor | undefined | null = null;
  /** This task's vault context, prepared once per `run()` (CTO I8). */
  private prepared?: PreparedVaultContext;
  /** The task's own words, the pack's retrieval query. */
  private taskQuery = '';
  /** The last rendered pack and the seat it was rendered for, so a turn on
   *  the same seat reuses it byte for byte (the KV cache keeps its prefix). */
  private packCache?: { key: string; pack: ContextPack | undefined };
  /** The pack this turn's system prompt carries, when it has any text. */
  private currentPack?: ContextPack;
  /** What the last context-pack card said, so it is shown again only when
   *  the pack changed (an escalation re-renders for the cloud seat). */
  private packCardShown?: string;
  /** A write this task landed in a note: the vault (vaultWrite, or a file
   *  tool inside the vault) or the project's memory notes. A note is not
   *  code: it never triggers verify or the judge. */
  private noteWroteThisTask = false;
  /** The seat wrote Current State itself this task, so the harness does not
   *  add its own line on top (CTO I12). */
  private seatWroteCurrentState = false;
  /** The harness's Current State line is written at most once per task. */
  private landedNoted = false;
  /** The tools this offline session left out, refused by name. */
  private get offlineTools(): ReadonlySet<string> {
    this.offlineSet ??= new Set(this.deps.offlineTools ?? []);
    return this.offlineSet;
  }
  private offlineSet?: ReadonlySet<string>;
  /** What the last handoff was built from, so an unchanged chat (a dispose
   *  right after a completed task) is not written again. */
  private handoffSignature?: string;
  /** Says once per chat per model when a server cut the prompt (C1). */
  private windowWatch = new WindowWatch();
  /** What the last turn's native tool specs cost in the prompt, so the
   *  context meter counts them as the budget does. */
  private toolTokens = 0;

  constructor(private readonly deps: AgentDeps) {
    const orchestrator = deps.router.orchestrator();
    this.active = {
      provider: orchestrator.provider,
      model: orchestrator.ref.model,
      adapter: adapterFor(orchestrator.ref.model),
    };
    // The requested mode passes through the profile (ENG-1): a phone or
    // headless session never starts in bypassPermissions, and the downgrade is
    // said out loud.
    const requested = effectiveMode(deps.profile, deps.permissionMode ?? 'default');
    this.mode = requested.mode;
    if (requested.note) {
      this.emit({ type: 'mode', mode: this.mode });
      this.emit({ type: 'note', message: requested.note });
    }
    this.instructions = deps.instructions;
    // A tool that runs a model of its own (a delegated subtask) reports its
    // usage here, so its tokens hit the rails and its dollars are visible.
    // A vault tool asks whether the seat answering now leaves this network, so
    // a local-only note is read only by a seat that stays (CTO I5). Judged by
    // address, live, since an escalation switches the seat mid-task.
    deps.toolContext.seatLeavesNetwork = () => leavesThisNetwork(this.active.provider);
    // The seat answering now, for the provenance lines on a note the agent
    // writes (Vault M7, CTO L9): its model, its class, and a cloud seat's
    // provider. Where it ran is `seatLeavesNetwork`, judged by address.
    deps.toolContext.vaultSeat = () => ({
      model: this.active.model,
      size:
        this.modelProfile?.modelClass ??
        deriveModelClass({ model: this.active.model, kind: this.active.provider.kind }),
      ...(leavesThisNetwork(this.active.provider) ? { provider: this.active.provider.label } : {}),
    });
    // A vault read is capped per class (the seat answering now), past which it
    // returns the outline and asks for a section (CTO I11), and never past
    // what one observation may carry in the seat's served window (C1).
    deps.toolContext.vaultReadCapChars = () =>
      Math.min(
        this.modelProfile?.vaultReadCapChars ?? DEFAULT_VAULT_READ_CAP_CHARS,
        this.observationCap(),
      );
    // One observation is capped by the seat's share of its served window, so a
    // single file read never outgrows the window it lands in (C1).
    deps.toolContext.observationCapChars = () => this.observationCap();
    deps.toolContext.noteUsage = (usage: DelegatedUsage) => {
      this.recordUsage(usage.model, usage.kind, usage.promptTokens, usage.completionTokens);
    };
    // A web tool's fetch into this computer's own network (loopback, the LAN,
    // the tailnet) asks the person first, once per chat for each host (D3).
    deps.toolContext.egress.setLocalGate?.((url, host, purpose) =>
      this.confirmOwnNetwork(url, host, purpose === 'web-search' ? 'webSearch' : 'webFetch'),
    );
    // A tool that lists (vaultList) hides what the person's policy denies, so
    // the model never sees the names inside a fenced-off folder.
    deps.toolContext.denies = (toolName: string, path: string) => {
      const tool = deps.tools.get(toolName);
      return (
        deps.permissions.decide({
          toolName,
          risk: tool?.risk ?? 'read',
          path,
          cwd: deps.toolContext.cwd,
          alwaysAsk: tool?.alwaysAsk,
        }).decision === 'deny'
      );
    };
  }

  get activeModel(): { model: string; kind: 'local' | 'cloud' } {
    return { model: this.active.model, kind: this.active.provider.kind };
  }

  get permissionMode(): PermissionMode {
    return this.mode;
  }

  /** Change the permission mode between (or during) tasks. Announced as an
   *  event so every attached client shows the truth. */
  setMode(mode: PermissionMode): void {
    const { mode: next, note } = effectiveMode(this.deps.profile, mode);
    if (this.mode !== next) {
      this.mode = next;
      this.emit({ type: 'mode', mode: next });
    }
    if (note) this.emit({ type: 'note', message: note });
  }

  /** Replace the person's standing instructions for this project. */
  setInstructions(text: string | undefined): void {
    this.instructions = text?.trim() ? text : undefined;
  }

  get taskList(): TodoItem[] {
    return this.todos;
  }

  abort(): void {
    this.abortController?.abort();
  }

  /**
   * Manual compaction (/compact): summarize the older turns now, whatever the
   * window, and say what was folded. Idle only; the loop compacts on its own
   * mid-task.
   */
  async compactNow(focus?: string): Promise<{ before: number; after: number }> {
    const before = this.history.length;
    const budget = Math.max(1, Math.floor(estimateMessages(this.history) * 0.5));
    const full = this.history;
    const result = await compactHistory(this.history, budget, (text) =>
      this.summarize(focus ? `${text}\n\nWhen summarizing, keep everything about: ${focus}` : text),
    );
    if (result.compacted) {
      this.history = result.messages;
      this.writeHandoff(full);
    }
    const after = this.history.length;
    this.emit({
      type: 'status',
      message: result.compacted
        ? `Compacted the conversation: ${before} messages folded into ${after}.`
        : 'Nothing to compact yet.',
    });
    return { before, after };
  }

  /** A short title for the conversation, from its first exchange. */
  async generateTitle(): Promise<string | undefined> {
    const user = this.history.find((m) => m.role === 'user');
    const assistant = this.history.find((m) => m.role === 'assistant');
    const userText = typeof user?.content === 'string' ? user.content : '';
    const reply = typeof assistant?.content === 'string' ? assistant.content : '';
    if (!userText.trim()) return undefined;
    try {
      const raw = await this.summarize(
        `Write a title for this conversation: three to six words, plain, specific, no quotes, no trailing period, no em dashes. Answer with the title only.\n\nPerson: ${userText.slice(0, 600)}\n\nAssistant: ${reply.slice(0, 600)}`,
      );
      const title = raw
        .split('\n')[0]!
        .replace(/^["'\s]+|["'\s.]+$/g, '')
        .slice(0, 60);
      return title || undefined;
    } catch {
      return undefined;
    }
  }

  private emit(event: AgentEvent): void {
    this.deps.onEvent(event);
  }

  // Verify, then report plainly (tenet 3). After a task that changed files, run
  // the project's configured check command and emit the result. Gated to the
  // profile where shell may auto-run, since it runs a configured command with
  // no prompt: a project-config command never fires on a remote or headless
  // session, the same containment hooks get.
  //
  // Verify in the loop: a failing check is not the end of the task while a
  // retry remains. The failure tail goes back to the model as an observation
  // and the loop continues, so the model fixes against the real error instead
  // of its own guess. Returns 'retry' when the loop should continue, 'done'
  // otherwise. Bounded by harness.verify.maxRetries on top of the step rails,
  // and a retry only counts once the check has actually failed.
  //
  // Which check runs (v1 Phase 1): a configured command runs as before on the
  // desktop; on a paired phone (or any profile where shell cannot auto-run)
  // it runs once the owner has let it, a verify grant on this machine keyed
  // by the folder and the command. With no command, a found test script
  // (`harness.verify.detect: 'on'`) always asks first, being the project's
  // own code. With neither, the page check (`harness.verify.pageCheck: 'on'`)
  // reads the pages and scripts the task changed and runs nothing.
  private async maybeVerify(
    verifyRounds: number,
  ): Promise<'retry' | 'passed' | 'failed' | 'skipped'> {
    const verifyConfig = this.deps.config.harness?.verify;
    if (!this.wroteThisTask) return 'skipped';
    const plan = await this.resolveCheck();
    if (!plan) return 'skipped';
    const { cwd } = this.deps.toolContext;
    const result =
      plan.kind === 'command'
        ? await runVerifyAsync(cwd, {
            command: plan.command,
            timeoutSeconds: verifyConfig?.timeoutSeconds,
          })
        : pageCheck(cwd, this.changedFiles());
    if (!result.ran) return 'skipped';
    // A lean seat gets at least its class's allowance of goes; a project's
    // own setting can only raise it.
    const maxRetries = Math.max(
      verifyConfig?.maxRetries ?? 0,
      this.modelProfile?.verifyRetries ?? 0,
    );
    const round = verifyRounds + 1;
    const willRetry = !result.passed && verifyRounds < maxRetries;
    this.emit({
      type: 'verify',
      passed: result.passed,
      summary: result.summary,
      detail: result.detail,
      round,
      willRetry,
      check: plan.kind === 'command' ? 'tests' : 'page',
    });
    if (!willRetry) return result.passed ? 'passed' : 'failed';
    this.emit({
      type: 'status',
      message: `The check did not pass; handing the failure back to the model (retry ${round} of ${maxRetries}).`,
    });
    this.history.push({
      role: 'user',
      content: verifyRetryPrompt(result, round, maxRetries),
    });
    // The model is asked to fix the cause, which takes tools: an answer-only
    // turn left over from repeats before the check would withhold them for
    // every retry, and the calls before it are no longer stale.
    this.clearRepeatState();
    return 'retry';
  }

  /** The check this task's result gets, or undefined for none (see
   *  maybeVerify). */
  private async resolveCheck(): Promise<
    { kind: 'command'; command: string } | { kind: 'page' } | undefined
  > {
    const verifyConfig = this.deps.config.harness?.verify;
    const { cwd } = this.deps.toolContext;
    const configured = verifyConfig?.command?.trim();
    if (configured) {
      if (this.deps.profile.allowShellAutoApprove) return { kind: 'command', command: configured };
      const ok = await this.mayRunCheck(configured, commandDigest(configured), 'configured');
      if (ok) return { kind: 'command', command: configured };
    } else if (verifyConfig?.detect === 'on') {
      const found = detectCheckCommand(cwd);
      if (found && (await this.mayRunCheck(found.command, found.digest, found.source))) {
        return { kind: 'command', command: found.command };
      }
    }
    if (verifyConfig?.pageCheck === 'on') return { kind: 'page' };
    return undefined;
  }

  /** Checks the person already allowed or declined this session, by command
   *  and digest, so the card asks once. */
  private verifyAllowed = new Set<string>();
  private verifyDeclined = new Set<string>();

  /**
   * May this check command run now? Yes with a verify grant on this machine or
   * an allow earlier this session; otherwise the person is asked once, through
   * the same approval card as any command, where "always in this project"
   * becomes the grant. A session that cannot grant (a member's on a shared
   * hub) or has nobody to ask (a routine) never runs an ungranted check.
   */
  private async mayRunCheck(command: string, digest: string, source: string): Promise<boolean> {
    const { cwd } = this.deps.toolContext;
    const key = `${command}\0${digest}`;
    // Under the secrets lockdown every command asks, the check included: the
    // card promises "asks before every command and commit" (CX 7), so a saved
    // grant, an earlier yes, and bypass mode all wait for this one answer.
    const lockdown = this.lockdown;
    if (!lockdown) {
      try {
        if (hasVerifyGrant(cwd, command, digest)) return true;
      } catch {
        // An unreadable trust store grants nothing.
      }
      if (this.verifyAllowed.has(key)) return true;
    }
    if (this.verifyDeclined.has(key)) return false;
    if (this.deps.canGrantVerify === false || this.deps.profile.name === 'headless') return false;
    if (this.mode === 'bypassPermissions' && !lockdown) return true;
    const answer = await this.awaitApprovalOrAbort({
      id: `verify_${Date.now().toString(36)}`,
      kind: 'tool',
      toolName: 'verify',
      risk: 'shell',
      summary: `Check the work: run \`${command}\``,
      detail:
        source === 'configured'
          ? `This project's own check command. It runs on this computer, in ${cwd}, after each change, and any failure goes back to the model to fix.`
          : `Found ${source}. It runs on this computer, in ${cwd}, after each change, and any failure goes back to the model to fix. Allow it always for this project to stop this question.`,
      ...(lockdown ? { alwaysAsk: true, lockdown: true } : {}),
    });
    if (answer === 'aborted') return false;
    if (!answer.approve) {
      this.verifyDeclined.add(key);
      return false;
    }
    if (answer.alwaysInProject && !lockdown) {
      try {
        addVerifyGrant(cwd, command, digest);
      } catch {
        // The grant could not be saved; the allow still holds this session.
      }
    }
    if (!lockdown) this.verifyAllowed.add(key);
    return true;
  }

  /** On when this session holds the project's secrets, which only a local
   *  orchestrator is ever given (gateProjectSecrets): the egress lockdown. No
   *  tool may send anything off the device, and every command and commit asks
   *  (D3, CX 7). */
  private get lockdown(): boolean {
    return Boolean(this.deps.projectSecrets?.trim());
  }

  // A Harness Current (Jev) layers a cheap decision method into the loop. The
  // engine uses it here for the verify JUDGE: when there is no check command to
  // run (no oracle), and the seat is a paid cloud model (scoped to where there
  // is spend to steer, founder 2026-09-23), ask Jev cheaply whether the result
  // satisfies the task and show the answer as a card. This never overrides a
  // real check (that path returns a verdict other than 'skipped'), and it never
  // blocks the task: the card is advisory. Off leaves no trace, so with no
  // harness current on `jevAdvisor()` is undefined and nothing fires.
  private jevAdvisor(): JevAdvisor | undefined {
    if (this.jev === null) {
      const fetchImpl =
        this.deps.jevFetch ??
        (typeof fetch === 'function'
          ? (((url, init) => fetch(url, init as RequestInit)) as FetchLike)
          : undefined);
      this.jev = JevAdvisor.from(this.deps.harnessCurrents, fetchImpl);
    }
    return this.jev ?? undefined;
  }

  private async maybeJevJudge(verdict: 'retry' | 'passed' | 'failed' | 'skipped'): Promise<void> {
    if (verdict !== 'skipped') return; // A real check already spoke.
    if (!this.wroteThisTask) return;
    if (this.active.provider.kind !== 'cloud') return; // Only where spend is steered.
    const advisor = this.jevAdvisor();
    if (!advisor) return;
    const task = firstUserText(this.history);
    const result = lastAssistantText(this.history);
    if (!task || !result) return;
    const judged = await advisor.judge(task, result);
    if (!judged) return;
    this.emit({
      type: 'harness-current',
      current: 'jev',
      label: 'Jev',
      job: 'judge',
      line: judged.line,
      spend: true,
    });
  }

  // -------------------------------------------------------------------------
  // The vault context pack (Vault M4, 4.4, CTO I8 to I10)
  // -------------------------------------------------------------------------

  /** Whether this session carries a pack at all: a source, Memory on (F6),
   *  and `vault.context` not off. */
  private get packEnabled(): boolean {
    return (
      this.deps.vaultContext !== undefined &&
      this.deps.config.memory?.enabled !== false &&
      this.deps.config.vault?.context !== 'off'
    );
  }

  /** Prepare this task's vault context once, before the first turn. A source
   *  that fails leaves the task without a pack, never without an answer. */
  private async prepareVaultContext(task: string, signal: AbortSignal): Promise<void> {
    if (!this.packEnabled) {
      // No pack, but the vault tools still judge notes by the vault's own
      // settings: read them fresh at the task start (the pack's prepare
      // does this when it runs), so a change is in force from this task.
      try {
        await this.deps.toolContext.vaultRefresh?.({ force: true });
      } catch {
        // The holder keeps its last good settings.
      }
      return;
    }
    try {
      this.prepared = await this.deps.vaultContext!.prepare(task, signal);
    } catch (err) {
      log.warn('vault context unavailable for this task', { err: String(err) });
    }
  }

  /**
   * Render the pack for this turn's seat: its class's mode (`packModeFor`,
   * Current State only until the eval, I9), its budget (a fraction of the
   * served window, I2), and its network side, so a leaving seat gets no
   * local-only note. The same seat reuses the same bytes; an escalation
   * renders again. The card is emitted on the first render and again only
   * when what the pack used changed (I10).
   */
  private renderPack(
    caps: { contextTokens: number; supportsGrammar: boolean },
    leaves: boolean,
  ): void {
    this.currentPack = undefined;
    const prepared = this.prepared;
    if (!prepared || !this.packEnabled) return;
    // The class decides the mode even with harness profiles off, so the pack
    // follows the same table on every seat.
    const profile =
      this.modelProfile ??
      deriveProfile({
        model: this.active.model,
        kind: this.active.provider.kind,
        caps: { contextTokens: caps.contextTokens, supportsGrammar: caps.supportsGrammar },
      });
    let mode = packModeFor(this.deps.config.vault?.context ?? 'auto', profile.modelClass);
    if (!mode) return;
    // Vault layers need a vault; without one the pack is Current State only.
    const hasVault = Boolean(this.deps.toolContext.vaultRoot);
    if (!hasVault) mode = 'current-state';
    // Room for notes (Vault M7, CTO L13): the machine's size, lowered by
    // the app's switch (folded into this config at open), always capped by
    // the machine's `packMaxTokens`.
    const vaultCfg = this.deps.config.vault;
    const budgetTokens = packBudgetTokens(
      profile,
      caps.contextTokens,
      vaultPackSize(vaultCfg?.packSize, undefined),
      vaultCfg?.packMaxTokens,
    );
    const secrets = Boolean(this.deps.projectSecrets?.trim());
    const key = JSON.stringify([mode, budgetTokens, profile.modelClass, leaves]);
    if (this.packCache?.key !== key) {
      let pack: ContextPack | undefined;
      try {
        pack = buildContextPack({
          mode,
          index: hasVault ? prepared.index : null,
          query: this.taskQuery,
          currentState: prepared.currentState,
          pins: prepared.pins,
          ...(hasVault && prepared.projectPins?.length
            ? { projectPins: prepared.projectPins }
            : {}),
          handoff: prepared.handoff,
          budgetTokens,
          privacy: prepared.privacy,
          seat: { modelClass: profile.modelClass, leavesNetwork: leaves },
          // A secrets session runs under egress lockdown (gateProjectSecrets),
          // so the two travel together here.
          lockdown: { egress: secrets, secrets },
          bodies: prepared.bodies,
        });
      } catch (err) {
        log.warn('vault context pack failed to render', { err: String(err) });
      }
      this.packCache = { key, pack };
    }
    const pack = this.packCache.pack;
    if (!pack) return;
    if (pack.text) this.currentPack = pack;
    if (!pack.text && !pack.withheld) return;
    const seat = leaves ? 'cloud' : 'local';
    const card = JSON.stringify([seat, pack.used, pack.withheld]);
    if (card === this.packCardShown) return;
    this.packCardShown = card;
    this.emit({
      type: 'context-pack',
      seat,
      mode,
      tokens: pack.tokens,
      budgetTokens,
      sources: pack.used,
      withheld: pack.withheld,
      cold: pack.cold,
      ...(pack.localOnly ? { localOnly: true as const } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // The handoff (Vault M5, 5.4, CTO J13)
  // -------------------------------------------------------------------------

  /** A handoff is written when a sink is wired, Memory is on (F6), and
   *  `vault.handoff` is not off. */
  private get handoffEnabled(): boolean {
    return (
      this.deps.onHandoff !== undefined &&
      this.deps.config.memory?.enabled !== false &&
      this.deps.config.vault?.handoff !== 'off'
    );
  }

  /**
   * Build a handoff from `source` (the history as it stood, before a
   * compaction folded it) and hand it to the sink. Extractive and offline;
   * never thinking, never a local-only message (the adapter drops both).
   * Sized for the seat that held the chat, capped at HANDOFF_MAX_TOKENS.
   * Best effort: a failure costs the summary, never the task.
   */
  private writeHandoff(source: readonly ChatMessage[]): void {
    if (!this.handoffEnabled) return;
    try {
      const turns = handoffTurnsFromHistory(source);
      if (!turns.some((t) => t.role === 'user')) return;
      const last = turns[turns.length - 1]!;
      const signature = JSON.stringify([turns.length, last.role, last.text, last.tool]);
      if (signature === this.handoffSignature) return;
      const budget = handoffBudgetTokens(this.contextTokens) || HANDOFF_MAX_TOKENS;
      const now = this.deps.now?.() ?? new Date();
      const build = this.deps.buildHandoff ?? coreBuildHandoff;
      const handoff = build(turns, budget, { from: this.active.model, date: localDate(now) });
      if (!handoff.text.trim()) return;
      this.handoffSignature = signature;
      this.deps.onHandoff!({
        text: handoff.text,
        at: now.toISOString(),
        model: this.active.model,
        turns: handoff.turns,
      });
    } catch (err) {
      log.warn('could not write a handoff', { err: String(err) });
    }
  }

  /** The session is ending (the daemon evicts or disposes it): write the
   *  latest handoff unless nothing changed since the last one. */
  flushHandoff(): void {
    this.writeHandoff(this.history);
  }

  /** The code map cut to its class's share of the served window (I2), at a
   *  line boundary. No profile, or a map that fits, is left whole. */
  private fitCodeMap(codeMap: string): string {
    const fraction = this.modelProfile?.codeMapContextFraction;
    if (!fraction || !this.contextTokens) return codeMap;
    const maxChars = Math.floor(this.contextTokens * fraction * 4);
    if (codeMap.length <= maxChars) return codeMap;
    const cut = codeMap.lastIndexOf('\n', maxChars);
    return `${cut > 0 ? codeMap.slice(0, cut) : ''}\n(the map stops here to fit this model's window)`;
  }

  // -------------------------------------------------------------------------
  // Current State kept current for lean seats (Vault M4, 4.7, CTO I12)
  // -------------------------------------------------------------------------

  /**
   * After a change verifies on a lean seat, the harness records one dated
   * line in the project's Current State itself (tenet 3), built from the
   * files this task changed and the check that passed, never from model text.
   * Only with Memory on and a memory folder, outside plan mode, once per
   * task, and not when the seat already wrote Current State itself. Written
   * directly, never through a tool call, so it cannot count as a write, rerun
   * verify, or ask.
   */
  private maybeNoteLanded(): void {
    if (this.landedNoted || !this.leanSeat || this.mode === 'plan') return;
    if (this.seatWroteCurrentState || this.deps.config.memory?.enabled === false) return;
    const { toolContext } = this.deps;
    if (!memorySegment(toolContext.projectName, toolContext.cwd)) return;
    const command = this.deps.config.harness?.verify?.command;
    if (!command) return;
    this.landedNoted = true;
    const changed = this.changedFiles();
    const what =
      changed.length === 0
        ? 'a change landed'
        : changed.length === 1
          ? `changed ${changed[0]}`
          : `changed ${changed[0]} and ${changed.length - 1} more`;
    const check = command.replace(/\s+/g, ' ').replace(/`/g, "'").trim().slice(0, 80);
    const date = localDate(this.deps.now?.() ?? new Date());
    const line = `- ${date}: ${what}, \`${check}\` passed ${HARNESS_LINE_MARK}`;
    try {
      const { written, path } = appendLandedLine(toolContext, line);
      if (written) this.emit({ type: 'note', message: `Noted in ${path}: ${line.slice(2)}` });
    } catch (err) {
      log.warn('could not note the change in Current State', { err: String(err) });
    }
  }

  /** The workspace files this task left changed, repo-relative and sorted:
   *  every file a write touched whose content now differs from before, less
   *  the memory notes themselves. */
  private changedFiles(): string[] {
    const { cwd } = this.deps.toolContext;
    const out: string[] = [];
    for (const [abs, original] of this.touched) {
      const rel = relative(cwd, abs).split('\\').join('/');
      if (isMemoryFilePath(rel)) continue;
      let now: string | null;
      try {
        now = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
      } catch {
        continue;
      }
      if (now !== original) out.push(rel);
    }
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  // -------------------------------------------------------------------------
  // The discipline seam (harness profiles)
  // -------------------------------------------------------------------------

  /** The model-class profile for the active model, or undefined when profiles
   *  are off in config (the full prompt and every tool then reach the model,
   *  exactly as before the harness). */
  private deriveModelProfile(caps: {
    contextTokens: number;
    supportsGrammar: boolean;
  }): ModelClassProfile | undefined {
    const cfg = this.deps.config.harness?.profiles;
    if (!cfg?.enabled) return undefined;
    return deriveProfile(
      {
        model: this.active.model,
        kind: this.active.provider.kind,
        caps: { contextTokens: caps.contextTokens, supportsGrammar: caps.supportsGrammar },
      },
      cfg.overrides as Parameters<typeof deriveProfile>[1],
    );
  }

  /** True when the active seat runs the lean prompt (a small or tiny class). */
  /** Chain of Thought is on for this session (the app setting, else config). */
  private get chainOfThought(): boolean {
    return this.deps.config.chainOfThought?.enabled === true;
  }

  private get leanSeat(): boolean {
    return this.modelProfile ? LEAN_CLASSES.has(this.modelProfile.modelClass) : false;
  }

  /** Say once, plainly, that a small seat is running with the harness's help
   *  (tenet 3: the harness raises the floor and says so). */
  private announceLeanSeat(): void {
    if (this.profileNoteEmitted || !this.leanSeat || !this.modelProfile) return;
    this.profileNoteEmitted = true;
    const total = this.deps.tools.specs().length;
    const shown = Math.min(total, this.modelProfile.maxToolsShown);
    this.emit({
      type: 'note',
      message: `${cap(this.modelProfile.modelClass)} model seat: ${classBlurb(
        this.modelProfile.modelClass,
      )} The harness shows it ${shown} of ${total} tools and carries the checklist.`,
    });
  }

  // -------------------------------------------------------------------------
  // System prompt
  // -------------------------------------------------------------------------

  /**
   * The system prompt, with the offset where the vault pack begins (CTO
   * J17): everything before it is stable across turns of one seat, so the
   * Anthropic provider can cache that head when prompt caching is on. The
   * adapters only append to the prompt, so the offset holds after them. No
   * pack, no offset.
   */
  private systemPrompt(toolMode: 'native' | 'text'): { content: string; cacheAt?: number[] } {
    const { toolContext, codeMap } = this.deps;
    // The prompt names only tools this seat is offered, so a lean seat is never
    // told to reach for one it cannot see.
    const offered = this.offeredToolNames();
    const webTools = ['webSearch', 'webFetch'].filter((name) => offered.has(name));
    // A lean seat (a small or tiny class) gets a short, direct core. The full
    // core below is written for a capable model working with a person: report
    // like a colleague, ask before touching something that works, open with a
    // todo list. Read by a 3B those lines become the task: it explains and asks
    // instead of editing, or spends its first turn on todoWrite. The deep eval
    // showed both. The harness carries that etiquette for a lean seat (tenet
    // 3); the seat is told to do the work and answer.
    const parts = this.leanSeat
      ? [
          "You are OS Code, a careful coding agent running on the user's own machine.",
          `Workspace root: ${toolContext.cwd} (platform: ${platformAndShell()}). All file paths are relative to it.`,
          'Do the task yourself with the tools. Read a file with readFile. Change part of a file with editFile: give path, search (exact lines copied from the file) and replace (their replacement). Write a whole file with writeFile. Never ask for permission or confirmation; make the change.',
          `A tool result is shown to you once; do not repeat a call whose result you already have. Do not check git status or use any git tool unless the task itself is about version control or commits, most tasks need none of that.${
            offered.has('runShell')
              ? ' When asked what some code returns or prints, run it with runShell (for example: node -e "import(\'./file.mjs\').then(m => console.log(m.fn()))") and reply with the real output instead of working it out in your head.'
              : ''
          } When the change is made, or the question is answered, reply in plain text, briefly. When asked for a value, reply with the value only.`,
          'Never use em dashes in your replies. Use a period or a comma instead.',
        ]
      : [
          "You are OS Code, a careful, capable coding agent running on the user's own machine.",
          `Workspace root: ${toolContext.cwd} (platform: ${platformAndShell()}). All file paths are relative to it.`,
          'Work step by step: inspect before you change, prefer small precise edits (editFile), and verify with the available tools.',
          // Only the web tools this session has: an offline run (a routine) or
          // a secrets session has none, and must not be told to reach for them.
          webTools.length
            ? `Use ${webTools.join(' and ')} for anything after your knowledge cutoff or specific to a library version.`
            : 'This session has no web access: work from the files and what you already know.',
          'When the task is complete, answer with plain text: what you did, what you verified, and anything the user should know. Be concise and concrete.',
          // How the person works with a coding agent (docs/interaction-model.md):
          // lead with the answer, one step at a time when they must act, never
          // claim what was not verified, and end on the next action.
          'Report the way a careful colleague does: lead with the outcome, then the evidence. One idea per sentence. Before a change that touches something working, say what you would change and its blast radius, and ask.',
          'When the user has to do something themselves (paste a key, run a command, allow a permission), give exactly one step, then stop and wait for the result before the next.',
          'Never claim a result you did not verify. If you cannot do something, say so plainly and name the next action. End every report with the single next step.',
          'Whenever the user must paste something themselves (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
          'Never use em dashes in your replies. Use a period or a comma instead.',
          'For any task with three or more steps, call todoWrite first with the whole plan, mark one item in_progress as you start it, and completed the moment it lands. Keep the list current; the person watches it.',
          'When you correct something the person told you twice, or learn a durable fact about how they work, propose one line for their standing instructions rather than silently adapting.',
        ];
    if (this.mode === 'plan') {
      // The vault reads this seat is offered are plan-safe too, so the plan
      // names them (Vault M4, 4.5); a note is often where the plan starts.
      const vaultReads = [...offered].filter(
        (name) =>
          name.startsWith('vault') && PLAN_SAFE_RISKS.has(this.deps.tools.get(name)?.risk ?? ''),
      );
      const readable = `${['readFile', 'grep', 'glob', 'gitStatus', 'gitDiff', 'searchRepo', ...webTools, 'todoWrite'].join(', ')}${
        vaultReads.length ? `, and the vault reads ${vaultReads.join(', ')}` : ''
      }`;
      parts.push(
        [
          `PLAN MODE. You may only read: ${readable}. Every editing, writing, and shell tool is unavailable until the person approves your plan.`,
          'Investigate as much as you need, then answer with a plan: a short numbered list of the concrete changes you would make, each naming the files it touches, plus what you would verify and any risk. End with one question only if a decision is genuinely theirs.',
          'Do not start building. The person will say when.',
        ].join(' '),
      );
    }
    const standing = instructionsPrompt(this.deps.repoInstructions, this.instructions);
    if (standing) parts.push(standing);
    // Project memory: read the Current State top sheet first, dig page by page
    // only as needed, and keep the five notes current as work lands
    // (projectMemory.ts). Engages whenever the session has a memory folder,
    // which is any real workspace, and the seat can read files. The write half
    // goes only to a seat offered projectMemoryWrite: a lean seat whose cut
    // drops it is still pointed at the top sheet, never told to use the tool.
    // The Memory switch off (config memory.enabled, the app's override folded
    // in at bootstrap) leaves the whole block out.
    // With the top sheet inlined by the context pack, the seat is told it
    // already has it instead of being sent to readFile for it (CTO I8).
    const memorySeg = memorySegment(toolContext.projectName, toolContext.cwd);
    const inlined = this.currentPack?.used.some((s) => s.layer === 'current-state') ?? false;
    if (
      memorySeg &&
      (offered.has('readFile') || inlined) &&
      this.deps.config.memory?.enabled !== false
    ) {
      parts.push(
        projectMemoryPrompt(memorySeg, {
          write: offered.has(PROJECT_MEMORY_WRITE_TOOL),
          inlined,
        }),
      );
    }
    // Project secrets, present only for a local orchestrator (bootstrap drops
    // them for a cloud one). They ride in so the model can use the project's
    // credentials without asking for a paste; the session runs under egress
    // lockdown and never escalates to the cloud, so they cannot leave the device.
    if (this.deps.projectSecrets?.trim()) {
      parts.push(
        [
          "PROJECT SECRETS (the person's own tokens and secrets, from their encrypted on-device store).",
          'These are provided so you can run commands and call APIs for this project without asking the person to paste a credential again. Use them only for this project, and never repeat a secret back in full in your visible reply.',
          'You are running as a local, on-device model. Web tools and cloud escalation are turned off for this session, so nothing you do here leaves the machine; keep it that way.',
          this.deps.projectSecrets.trim(),
        ].join('\n'),
      );
    }
    // Premium UX and the humanizer, out of the box, unless a project turns them
    // off in config or the user says to skip. A full seat gets the complete
    // standards (uxStandard.ts, humanizerStandard.ts). A lean seat (a small or
    // tiny class) gets a compact digest instead: the full multi-KB text would
    // eat the context a small model needs for the task, and on modest hardware
    // it makes prefill so slow the model never gets to answer. The harness still
    // holds the premium bar mechanically (verify, structure); tenet 3.
    const ux = this.deps.config.ux;
    const humanizer = this.deps.config.humanizer;
    if (this.leanSeat) {
      const bar: string[] = [];
      if (ux?.standard !== 'off') bar.push('a clear, accessible, calm UX');
      if (humanizer?.standard !== 'off') bar.push('plain, human prose, not chatbot patterns');
      if (bar.length) {
        parts.push(
          `Build to OpenShore's premium bar: ${bar.join(
            ', and ',
          )}. Keep each change small and correct; the harness runs the checks.`,
        );
      }
      if (ux?.standard !== 'off' && ux?.notes) parts.push(`This project adds: ${ux.notes}`);
      if (humanizer?.standard !== 'off' && humanizer?.notes)
        parts.push(`Voice notes: ${humanizer.notes}`);
    } else {
      if (ux?.standard !== 'off') parts.push(uxStandardPrompt(ux?.notes));
      if (humanizer?.standard !== 'off') parts.push(humanizerStandardPrompt(humanizer?.notes));
    }
    // Chain of Thought, when the person turned it on: a model that does not
    // reason through its own API is asked to think in <think> tags, which the
    // stream splitter folds into the thinking block (chainOfThought.ts).
    if (this.chainOfThought && !reasonsNatively(this.active.model)) {
      parts.push(chainOfThoughtPrompt());
    }
    if (codeMap) {
      parts.push(`Repository map (files and symbols):\n${this.fitCodeMap(codeMap)}`);
    }
    // The vault context pack, after the code map and before the tool protocol:
    // stable to volatile, so the multi-KB standards above keep their KV reuse
    // across tasks, and the protocol keeps its recency for a small seat (I8).
    let packAt: number | undefined;
    if (this.currentPack) {
      packAt = parts.length ? parts.join('\n\n').length + 2 : 0;
      parts.push(this.currentPack.text);
    }
    // The text bridge lists the same menu native tools get (a lean seat's
    // few, plan mode's read side), in terse lines for a lean seat, rather
    // than every schema in the registry (C1).
    if (toolMode === 'text') {
      parts.push(textProtocolInstructions(this.toolSpecs(), { terse: this.leanSeat }));
    }
    const content = this.active.adapter.systemPreamble(parts.join('\n\n'));
    return packAt !== undefined && packAt > 0 && packAt < content.length
      ? { content, cacheAt: [packAt] }
      : { content };
  }

  // -------------------------------------------------------------------------
  // The task loop
  // -------------------------------------------------------------------------

  async run(
    input: string,
    images?: Array<{ base64: string; mediaType: string }>,
    contextPreamble?: string,
  ): Promise<void> {
    const { config, guardrails } = this.deps;
    guardrails.startTask();
    this.cloudApprovedForTask = false;
    this.wroteThisTask = false;
    this.readLocalOnlyThisTask = false;
    this.noWriteNudged = false;
    this.attemptedWriteThisTask = false;
    this.clearRepeatState();
    this.lastChangeStep = 0;
    this.callStep = 0;
    this.touched.clear();
    this.attempt = 1;
    this.transientRetries = 0;
    this.noteWroteThisTask = false;
    this.seatWroteCurrentState = false;
    this.landedNoted = false;
    this.prepared = undefined;
    this.packCache = undefined;
    this.currentPack = undefined;
    this.packCardShown = undefined;
    this.taskQuery = input;
    this.abortController = new AbortController();
    // Tools see the task's signal, so Stop reaches a delegated generation or
    // a long fetch as well as the orchestrator's own stream (DAE-4).
    this.deps.toolContext.signal = this.abortController.signal;
    // The visible task-start is the user's own words. A context preamble (the
    // results of commands the user ran between turns) rides into the model's
    // message so it sees them, but never shows in the transcript as user text.
    this.emit({ type: 'task-start', input });
    const modelText = contextPreamble ? `${contextPreamble}\n\n${input}` : input;

    const content: string | ContentPart[] = images?.length
      ? [
          { type: 'text', text: modelText },
          ...images.map((i): ContentPart => ({
            type: 'image',
            imageBase64: i.base64,
            mediaType: i.mediaType,
          })),
        ]
      : modelText;
    this.taskMessage = { role: 'user', content };
    this.history.push(this.taskMessage);
    await this.prepareVaultContext(input, this.abortController.signal);

    let parseFailStreak = 0;
    let repairAttempts = 0;
    let turn = 0;
    // Failing verify checks handed back to the model this task (verify in the loop).
    let verifyRounds = 0;

    for (;;) {
      if (this.abortController.signal.aborted) {
        this.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped at your request.' });
        return;
      }
      const violation = guardrails.check();
      if (violation) {
        this.emit({ type: 'task-done', reason: 'guardrail', message: violation.message });
        return;
      }

      // Cloud confirm-before-spend, once per session (or per profile rules).
      // Anything off this computer's network asks, judged by address: an
      // OpenAI-compatible server on the internet gets the same card as Claude.
      if (leavesThisNetwork(this.active.provider) && !this.cloudApprovedForSession) {
        const approved = await this.confirmCloudSpend(...this.offNetworkReason());
        if (!approved) {
          this.emit({
            type: 'task-done',
            reason: 'declined',
            message:
              'Cloud use was declined. Configure a local orchestrator (osc init) or approve the cloud step to continue.',
          });
          return;
        }
      }

      turn += 1;
      // Whether this turn's seat sends its requests off this network (judged
      // by address). A leaving turn never sees a local-only note's text: the
      // pack withholds it and the history it is sent carries a stub (CTO I5).
      const leaves = leavesThisNetwork(this.active.provider);
      const caps = await this.active.provider.capabilities(this.active.model);
      this.contextTokens = caps.contextTokens;
      const toolMode: 'native' | 'text' =
        caps.supportsTools && this.active.adapter.toolFormat() === 'native' ? 'native' : 'text';

      // The discipline seam: derive the model-class profile for the active model
      // (the small seat gets fewer tools and a lean prompt). Recomputed each
      // turn because the active model can switch mid-task (a cloud escalation
      // moves to the large class, which gets the full prompt back).
      this.modelProfile = this.deriveModelProfile(caps);
      this.announceLeanSeat();
      this.renderPack(caps, leaves);

      // Refresh the system prompt each turn (tool mode and model can change).
      // An answer-only turn carries no tools and no text protocol, so the
      // model's only move is to answer.
      const system = this.systemPrompt(this.answerOnly ? 'native' : toolMode);
      this.history = [
        { role: 'system', ...system },
        ...this.history.filter((m) => m.role !== 'system'),
      ];

      // Compaction keeps small local windows honest. Mid-task, the summary
      // rides the task's signal so Stop cancels it too; the idle paths
      // (compactNow, generateTitle) deliberately pass none (ENG-7).
      // The class sets how full the window gets before this runs (I2). On a
      // leaving seat the summary itself is a request off this network, so it
      // is built from the stubbed history, never from a local-only note.
      // The native tool specs ride in the prompt too, so they count against
      // the same budget (C1); an answer-only turn sends none.
      const offeredTools = toolMode === 'native' && !this.answerOnly ? this.toolSpecs() : undefined;
      const toolTokens = estimateToolSpecs(offeredTools);
      this.toolTokens = toolTokens;
      const beforeCompaction = this.history;
      const compacted = await compactHistory(
        leaves ? withholdLocalOnly(this.history) : this.history,
        caps.contextTokens,
        (text) => this.summarize(text, this.abortController?.signal),
        this.modelProfile?.compactAtContextFraction,
        toolTokens,
      );
      if (compacted.compacted) {
        this.history = compacted.messages;
        this.emit({ type: 'status', message: 'Compacted older turns to fit the context window.' });
        // What was folded is kept as a handoff (J13), built from the history
        // as it stood, so the summary the model reads never has to carry it.
        this.writeHandoff(beforeCompaction);
      }

      this.emit({
        type: 'turn-start',
        turn,
        model: this.active.model,
        // The pill's color: amber for anything off this computer's network.
        providerKind: leavesThisNetwork(this.active.provider) ? 'cloud' : 'local',
      });

      // Grammar-constrained retry: only after a failed parse, and only where
      // the backend supports it. A permanent constraint would forbid final
      // text answers, so it is a repair tool, not a default.
      const useGrammar = toolMode === 'text' && repairAttempts > 0 && caps.supportsGrammar;

      let streamedText = '';
      const nativeCalls: ToolCallRequest[] = [];
      // Claude's signed thinking blocks from this turn, replayed with its tool
      // calls. The splitter routes <think> text out of the answer: to the
      // thinking block while Chain of Thought is on, and nowhere while it is off.
      let thinkingBlocks: unknown[] | undefined;
      const cot = this.chainOfThought;
      const splitter = new ThinkTagSplitter();
      const route = (pieces: Array<{ kind: 'text' | 'thinking'; text: string }>) => {
        for (const piece of pieces) {
          if (piece.kind === 'text') {
            streamedText += piece.text;
            this.emit({ type: 'text-delta', text: piece.text });
          } else if (cot) this.emit({ type: 'thinking-delta', text: piece.text });
        }
      };
      let promptTokens = 0;
      let completionTokens = 0;
      // The Anthropic prompt cache's reads and writes (CTO J17), last seen
      // wins like the counts; undefined when the provider reports none.
      let cacheReadTokens: number | undefined;
      let cacheWriteTokens: number | undefined;
      // What this turn sends, and the loop's estimate of it (messages, tool
      // specs, template), to hold against what the server says it read.
      const sent = leaves ? withholdLocalOnly(this.history) : this.history;
      const estimatedPromptTokens = estimateMessages(sent) + toolTokens;

      try {
        const stream = this.active.provider.chat(
          {
            model: this.active.model,
            messages: sent,
            tools: offeredTools,
            temperature: this.active.adapter.temperature(),
            maxTokens: 8192,
            stop: this.active.adapter.stopTokens().length
              ? this.active.adapter.stopTokens()
              : undefined,
            jsonSchema: useGrammar ? toolCallJsonSchema(this.deps.tools) : undefined,
            keepAlive: config.resourceBudget.keepAlive,
            reasoning: cot ? 'on' : 'off',
          },
          this.abortController.signal,
        );
        for await (const event of stream) {
          switch (event.type) {
            case 'text':
              route(splitter.push(event.delta));
              break;
            case 'thinking':
              if (cot) this.emit({ type: 'thinking-delta', text: event.delta });
              break;
            case 'thinking-blocks':
              thinkingBlocks = event.blocks;
              break;
            case 'tool-call':
              nativeCalls.push(event.call);
              break;
            case 'usage':
              // Last-seen-wins per field. Providers report a running snapshot,
              // not per-chunk increments: Anthropic sends the prompt count once
              // at message_start and a cumulative completion count on each
              // message_delta, so summing double-counts (badly with a vLLM that
              // emits continuous usage stats). Ignore zeros so a completion-only
              // delta does not wipe out the prompt count.
              if (event.promptTokens) promptTokens = event.promptTokens;
              if (event.completionTokens) completionTokens = event.completionTokens;
              if (event.cacheReadTokens !== undefined) cacheReadTokens = event.cacheReadTokens;
              if (event.cacheWriteTokens !== undefined) cacheWriteTokens = event.cacheWriteTokens;
              break;
            case 'done':
              break;
          }
        }
        route(splitter.end());
      } catch (err) {
        const handled = await this.handleProviderFailure(err, turn);
        if (handled === 'retry') continue;
        this.emit({
          type: 'task-done',
          reason: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      // C3: an abort during streaming ends the provider stream cleanly (the
      // provider yields done:'aborted' and skips its truncated tool-call
      // flush). Treat that as an abort, not a complete answer with truncated
      // text, and stop before feeding the fragment back.
      if (this.abortController.signal.aborted) {
        this.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped at your request.' });
        return;
      }

      // Account usage and surface the context meter.
      this.recordUsage(
        this.active.model,
        this.active.provider.kind,
        promptTokens,
        completionTokens,
        { cacheReadTokens, cacheWriteTokens, estimatedPromptTokens },
      );
      // A server that read back far less than was sent cut the chat to fit a
      // smaller window, without a word: say so, once per chat per model.
      const cut = await this.windowWatch.check(
        this.active.provider,
        this.active.model,
        promptTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
        estimatedPromptTokens,
      );
      if (cut) this.emit(cut);

      // ------------------------------------------------------------------
      // Turn resolution: tool calls, a final answer, or a repair pass.
      // ------------------------------------------------------------------
      let calls: ParsedToolCall[] = [];
      const problems: string[] = [];
      // Native calls that failed validation. When the batch also carries a
      // valid call, each of these gets its own observation instead of being
      // dropped on the floor, so the model does not retry it verbatim (ENG-11).
      const rejected: Array<{ raw: ToolCallRequest; problem: string }> = [];

      // An answer-only turn: whatever came back is the answer. A model that
      // was stuck repeating one call was told to answer and given no tools, so
      // a call it writes anyway is not run; the text stands as the reply.
      if (this.answerOnly) nativeCalls.length = 0;

      if (nativeCalls.length) {
        for (const raw of nativeCalls) {
          const validated = validateNativeCall(raw, this.deps.tools, this.offlineTools);
          if (validated.ok) calls.push(validated.call);
          else {
            problems.push(validated.problem);
            rejected.push({ raw, problem: validated.problem });
          }
        }
      }
      let displayText = streamedText;
      // How this turn's calls are recorded in history. Native calls record as
      // tool_use blocks; calls the model wrote as JSON text record the text way
      // (assistant text, then "[tool result]" observations), whatever the tool
      // mode, so we never fabricate a tool_use block the model did not emit.
      let recordMode: 'native' | 'text' = toolMode;
      if (!nativeCalls.length && streamedText.trim() && !this.answerOnly) {
        // Text extraction runs in text mode by design, and in native mode as a
        // fallback. A small local model offered native tools often writes the
        // call as JSON in its text anyway (ollama hands it back as content, not
        // tool_calls). Before this, native mode read that JSON as a final
        // answer and marked the task complete with nothing run; the deep eval's
        // "1 turn; no tools called; done: complete" on a 3B was exactly that.
        // The extractor is conservative (a known tool with valid args; prose
        // that quotes JSON is left alone), so a real answer still reads as one.
        const extraction = extractTextCalls(streamedText, this.deps.tools, this.offlineTools);
        const found = extraction.calls.length > 0 || extraction.problems.length > 0;
        if (toolMode === 'text' || found) {
          calls = extraction.calls;
          problems.push(...extraction.problems);
          displayText = extraction.remainder;
          if (found) recordMode = 'text';
        }
      }

      if (!calls.length && problems.length) {
        // Malformed call: bounded repair, then escalation, then stop.
        parseFailStreak += 1;
        repairAttempts += 1;
        this.history.push({ role: 'assistant', content: streamedText, ...this.localOnlyMark() });
        this.history.push({ role: 'user', content: repairPrompt(problems) });
        if (repairAttempts <= 2) {
          this.emit({
            type: 'status',
            message: 'The model sent a malformed tool call; asking it to fix the format.',
          });
          continue;
        }
        const escalated = await this.maybeEscalate(parseFailStreak);
        if (escalated) {
          repairAttempts = 0;
          continue;
        }
        // The eval's 3B run hit exactly this with "no tools called; done:
        // error", the generic sentence and no way to tell what the model
        // actually sent without a second run under a debugger. The last
        // turn's own problem (a schema mismatch, an unknown tool name) is the
        // real cause; folding it in here makes it ride the trace's message
        // field for free, no new plumbing.
        this.emit({
          type: 'task-done',
          reason: 'error',
          message: `The model kept producing tool calls that could not be parsed: ${problems[0]}. Try a stronger orchestrator (osc market), or connect cloud escalation (osc login).`,
        });
        return;
      }

      if (!calls.length) {
        // A plain text answer: the task is done. In plan mode the answer IS the
        // plan, so it is also raised as a proposal the person can approve.
        const finalText = displayText.trim();
        this.history.push({ role: 'assistant', content: streamedText, ...this.localOnlyMark() });
        this.emit({ type: 'text-final', text: finalText });
        if (this.mode === 'plan' && finalText)
          this.emit({ type: 'plan-proposed', text: finalText });
        // A lean seat that answers as if done with no write landed gets one
        // plain nudge, then the task continues. Two tells, either is enough:
        // a fenced code block in the final answer (the deep eval's "1 turn;
        // no tools called; done: complete" on a create task, the code written
        // into the reply instead of the file), or a write it actually
        // attempted and failed every time (fix-bug's "editFile x3; no write
        // landed; done: complete", where the final answer was plain prose
        // with no code shown at all, so the code-fence tell alone missed it).
        // A task that never needed an edit (a plain question) trips neither.
        // Never fires in plan mode or twice in one task.
        const hasCode = /```/.test(finalText);
        if (
          this.leanSeat &&
          this.mode !== 'plan' &&
          !this.wroteThisTask &&
          !this.noteWroteThisTask &&
          !this.noWriteNudged &&
          !this.answerOnly &&
          (hasCode || this.attemptedWriteThisTask)
        ) {
          this.noWriteNudged = true;
          this.emit({
            type: 'status',
            message: hasCode
              ? 'The seat answered with code but changed no file; asking it to make the change.'
              : 'The seat answered as done but its edit never applied; asking it to try again.',
          });
          this.history.push({
            role: 'user',
            content: hasCode
              ? 'You wrote code in your reply but changed no file. Make the change with editFile (give the path, search, and replace) or writeFile, then answer briefly.'
              : 'Your edit did not apply and nothing changed, but you answered as if done. Read the file again, copy the exact lines into search, and make the change before answering.',
          });
          continue;
        }
        const verdict = await this.maybeVerify(verifyRounds);
        if (verdict === 'retry') {
          verifyRounds += 1;
          continue;
        }
        // Best-of-N judged by the check: the retries are spent and it still
        // does not pass. While the class allows another attempt, put every
        // touched file back, wipe the history to the original ask, and go
        // again as an independent try; the first attempt that verifies wins.
        // The step and wall-clock rails keep counting across attempts.
        if (verdict === 'failed' && this.startFreshAttempt()) {
          verifyRounds = 0;
          continue;
        }
        if (verdict === 'passed') this.maybeNoteLanded();
        await this.maybeJevJudge(verdict);
        // A clean session end is rare, so each completed task leaves the
        // latest handoff; the last one standing is the session's (J13).
        this.writeHandoff(this.history);
        this.emit({ type: 'task-done', reason: 'complete' });
        return;
      }

      // Successful parse: reset the repair counters.
      repairAttempts = 0;

      // Record the assistant turn (with its calls) before observations. A
      // rejected call is recorded as the model made it, so the observation
      // that refuses it has a tool_use to answer.
      if (recordMode === 'native') {
        this.history.push({
          role: 'assistant',
          content: streamedText,
          ...(thinkingBlocks?.length ? { thinkingBlocks } : {}),
          ...this.localOnlyMark(),
          toolCalls: [
            ...calls.map((c) => ({
              id: c.id,
              name: c.name,
              argsText: JSON.stringify(c.args),
              args: c.args,
            })),
            ...rejected.map((r) => r.raw),
          ],
        });
        if (displayText.trim()) this.emit({ type: 'text-final', text: displayText.trim() });
        for (const { raw, problem } of rejected) {
          this.pushObservation(
            { id: raw.id, name: raw.name, args: raw.args ?? {} },
            `Not run: ${problem}`,
            recordMode,
          );
        }
      } else {
        this.history.push({ role: 'assistant', content: streamedText, ...this.localOnlyMark() });
        if (displayText.trim()) this.emit({ type: 'text-final', text: displayText.trim() });
        if (problems.length) {
          this.history.push({
            role: 'user',
            content: `[tool-call problems]\nSome of your calls were not run:\n${problems.map((p) => `- ${p}`).join('\n')}`,
          });
        }
      }

      // Execute the calls in order.
      const outcomes: CallOutcome[] = [];
      const answered = new Set<string>();
      for (const call of calls) {
        const observation = await this.executeCall(call, recordMode);
        if (observation === 'aborted') {
          // C2: an early exit mid-batch (a guardrail trip or a user abort)
          // leaves the just-recorded tool_use blocks with no tool_result, and
          // every subsequent Anthropic turn 400s. Pair each recorded call with
          // a synthetic observation. executeCall already emitted the guardrail
          // task-done; a user abort has not, so emit that here (C1/C3).
          this.fillUnansweredCalls(calls, answered, recordMode);
          if (this.abortController.signal.aborted) {
            this.emit({
              type: 'task-done',
              reason: 'aborted',
              message: 'Stopped at your request.',
            });
          }
          return;
        }
        answered.add(call.id);
        outcomes.push(observation);
      }
      // Only a call that ran and failed, or one the model could not form,
      // says the model is struggling; a decline, a plan-mode or policy
      // refusal, and a repeat answered from the record do not (C1).
      const struggling = outcomes.includes('failed') || problems.length > 0;
      parseFailStreak = nextFailStreak(parseFailStreak, outcomes, problems.length);
      if (struggling && (await this.maybeEscalate(parseFailStreak))) {
        continue;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tool execution with the permission rhythm
  // -------------------------------------------------------------------------

  private async executeCall(
    call: ParsedToolCall,
    toolMode: 'native' | 'text',
  ): Promise<CallOutcome | 'aborted'> {
    const { tools, permissions, guardrails, toolContext, profile } = this.deps;
    const tool = tools.get(call.name);

    guardrails.noteStep();
    const repeats = guardrails.noteToolCall(call.name, call.args);
    const violation = guardrails.check({ toolName: call.name, args: call.args, repeats });
    if (violation) {
      this.emit({ type: 'task-done', reason: 'guardrail', message: violation.message });
      return 'aborted';
    }

    // A tool this run left out because it works offline (a Crew routine, CTO
    // 3). The model reached for it anyway: refused, never asked, with a line
    // it can act on. The scheduler reads the denial for the run's note.
    if (!tool) {
      this.emit({ type: 'tool-denied', call, reason: OFFLINE_DENIED });
      this.pushObservation(call, `Not run: ${OFFLINE_DENIED} ${OFFLINE_ADVICE}`, toolMode);
      return 'refused';
    }

    // The same exact call again, with nothing changed in the workspace since
    // it last ran, would only return the same result. The deep eval's 3B seat
    // did this on the answer task: readFile on the same file three times, then
    // the repeat rail. Answering the repeat from the record costs no turn on a
    // slow box and tells the model what to do instead; the third repeat makes
    // the next turn answer-only. The rail stays as the last stop behind both.
    const stale = this.noteRepeat(call);
    if (stale) {
      if (tool.risk === 'write') this.attemptedWriteThisTask = true;
      const advice =
        tool.risk === 'read' || tool.risk === 'network'
          ? 'Nothing has changed since, so do not call it again. Use that result. If you have what you need, reply now with your final answer in plain text.'
          : 'Nothing has changed since, so it would end the same way. Change the arguments (for editFile, copy the exact lines from the file contents shown in that result into search), or reply with your answer.';
      const note = `You already made this exact ${call.name} call; its result is above. ${advice}`;
      this.emit({ type: 'tool-start', call });
      this.emit({ type: 'tool-end', call, result: { ok: false, content: note }, durationMs: 0 });
      this.pushObservation(call, note, toolMode);
      if (stale === 'answer-only') {
        this.answerOnly = true;
        this.emit({
          type: 'status',
          message: `The model repeated the same ${call.name} call three times; the next turn is answer-only.`,
        });
        this.history.push({
          role: 'user',
          content:
            'Stop calling tools. Reply now with your final answer in plain text, using what you already have.',
        });
      }
      return 'refused';
    }

    // The path a permission rule sees is the workspace-relative one the jail
    // agrees on, never the model's raw spelling (`./secrets/k`,
    // `src/../secrets/k`, an absolute path), so a glob cannot be dodged. A path
    // that leaves the jail is denied here, before any approval (ENG-3). Tools
    // with their own root (the vault) hand over a path already normalized
    // against it.
    const rawPath = tool.pathOf?.(call.args, toolContext);
    let path: string | undefined;
    if (rawPath !== undefined) {
      if (tool.pathJail === 'own') {
        path = rawPath;
      } else {
        try {
          // Judged where the path really lands (D3): an in-tree link by its
          // target, a backslash as a separator, relative to the real root.
          path = realRelativePath(toolContext.jail.resolve(rawPath), toolContext.jail.root);
        } catch (err) {
          if (!(err instanceof JailViolation)) throw err;
          this.emit({ type: 'tool-denied', call, reason: err.message });
          this.pushObservation(
            call,
            `Denied: ${err.message} Use a path inside the workspace.`,
            toolMode,
          );
          return 'refused';
        }
      }
    }
    // A workspace write that lands inside the vault asks every time, the way
    // vaultWrite does: a picked vault can sit inside a project, and the coding
    // tools must not edit its notes quietly (review M1-4). Judged by the
    // jailed absolute path against the vault root, symlinks resolved.
    const writesInsideVault =
      tool.risk === 'write' &&
      tool.pathJail !== 'own' &&
      rawPath !== undefined &&
      insideVault(toolContext.jail.resolve(rawPath), toolContext.vaultRoot);
    // Under the secrets lockdown every command and every commit asks, whatever
    // was saved, granted, or set as the mode (D3): the one execution seam, so
    // no rule, bypass, or default can make them quiet while the chat can see
    // the project's secrets.
    const lockdownAsks = this.lockdown && (tool.risk === 'shell' || call.name === 'gitCommit');
    const alwaysAsk = tool.alwaysAsk === true || writesInsideVault || lockdownAsks;
    // A write to a note (vaultWrite, or a file tool aimed inside the vault) is
    // not a code change: it never counts toward verify or the Jev judge (4.5).
    const writesVault = tool.risk === 'write' && (tool.pathJail === 'own' || writesInsideVault);
    // A write to one of the project's memory notes (projectMemoryWrite, or a
    // file tool aimed at one) is a note too: the same predicate changedFiles
    // uses, so a memory-only task runs no check and no judge (C1).
    const writesMemory =
      tool.risk === 'write' &&
      !writesVault &&
      path !== undefined &&
      isMemoryFilePath(path.split('\\').join('/'));
    const command = tool.commandOf?.(call.args);
    let decision = permissions.decide({
      toolName: call.name,
      risk: tool.risk,
      path,
      command,
      cwd: toolContext.cwd,
      alwaysAsk,
    });

    // The permission mode sits on top of the policy, the way Claude Code's
    // does. Plan mode never mutates. Bypass and acceptEdits turn an "ask" into
    // an allow for their class, but never for cloud spend, never for an
    // always-ask tool, and never for a sticky ask (a write to a file that
    // decides what runs); those stay loud in every mode. Bypass also never
    // makes shell silent on a profile that forbids it (ENG-1, belt and braces
    // under the setMode downgrade).
    if (this.mode === 'plan' && !PLAN_SAFE_RISKS.has(tool.risk)) {
      const reason = 'Plan mode: read only until the plan is approved.';
      this.emit({ type: 'tool-denied', call, reason });
      this.pushObservation(
        call,
        'Not run: plan mode is read only. Finish investigating and answer with the plan; the person approves it before anything is changed.',
        toolMode,
      );
      return 'refused';
    }
    if (
      decision.decision === 'ask' &&
      !decision.sticky &&
      !alwaysAsk &&
      tool.risk !== 'cloud-spend'
    ) {
      const shellStaysLoud = tool.risk === 'shell' && !profile.allowShellAutoApprove;
      if (this.mode === 'bypassPermissions' && !shellStaysLoud) {
        decision = { decision: 'allow', reason: 'bypass permissions mode' };
      } else if (this.mode === 'acceptEdits' && tool.risk === 'write') {
        decision = { decision: 'allow', reason: 'accept edits mode' };
      }
    }

    if (decision.decision === 'deny') {
      const reason = `${call.name} is denied by your permission policy (${decision.reason}).`;
      this.emit({ type: 'tool-denied', call, reason });
      this.pushObservation(call, `Denied: ${reason} Choose a different approach.`, toolMode);
      return 'refused';
    }

    // What the person approves, kept for execute: a tool whose preview names
    // its basis (vaultWrite, the note's bytes) refuses when that changed while
    // the approval sat. Set only after an ask whose preview succeeded.
    let approved: ApprovedPreview | undefined;
    if (decision.decision === 'ask') {
      let summary = `${call.name}`;
      let detail: string | undefined;
      let commit: CommitStage | undefined;
      try {
        if (tool.preview) {
          const preview = await tool.preview(call.args, toolContext);
          summary = preview.summary;
          detail = preview.detail;
          commit = preview.commit;
          approved = { basis: preview.basis };
        } else {
          summary = `${call.name} ${JSON.stringify(call.args).slice(0, 120)}`;
        }
      } catch (err) {
        detail = `Preview failed: ${(err as Error).message}`;
      }
      const answer = await this.awaitApprovalOrAbort({
        id: call.id,
        kind: 'tool',
        toolName: call.name,
        risk: tool.risk,
        summary,
        detail,
        // An always-ask tool can never be allowed for the session or the
        // project, so the sheet shows only the choices that take effect.
        ...(alwaysAsk ? { alwaysAsk: true } : {}),
        ...(this.lockdown ? { lockdown: true } : {}),
        ...(commit ? { commit } : {}),
      });
      // C1: the session was aborted while this approval was pending. Do not run
      // the tool; report an abort so run() settles instead of wedging.
      if (answer === 'aborted') return 'aborted';
      if (answer.alwaysThisSession && answer.approve) {
        if (alwaysAsk) {
          // An always-ask tool cannot be granted for the session, by design.
          this.emit({
            type: 'note',
            message: `${call.name} always asks before it runs, so it will prompt again next time.`,
          });
        } else if (!permissions.allowForSession(call.name)) {
          this.emit({
            type: 'note',
            message: `Session-wide approval is not available on the ${profile.name} profile; each ${call.name} will ask.`,
          });
        }
      }
      if (answer.alwaysInProject && answer.approve && !alwaysAsk) {
        this.persistProjectAllow(call, tool, path, command);
      }
      // The files the person left ticked on a commit card ride to execute.
      if (commit && answer.approve && Array.isArray(answer.files)) {
        approved = { ...approved, files: answer.files.filter((f) => typeof f === 'string') };
      }
      if (!answer.approve) {
        // A caller-supplied reason (e.g. Terminal Control is off) tells the
        // model what to do about the denial; otherwise it is a plain decline.
        const denied = answer.reason?.trim();
        this.emit({ type: 'tool-denied', call, reason: denied || 'You declined this step.' });
        this.pushObservation(
          call,
          denied ||
            'The user declined this action. Do not retry it as-is; adjust the approach or ask what they would prefer.',
          toolMode,
        );
        return 'refused';
      }
    }

    if (tool.risk === 'write' && !writesVault) {
      if (!writesMemory) this.attemptedWriteThisTask = true;
      if (rawPath !== undefined && tool.pathJail !== 'own') this.recordOriginal(rawPath);
    }
    this.emit({ type: 'tool-start', call });
    const startedAt = Date.now();
    let result;
    try {
      result = approved
        ? await tool.execute(call.args, toolContext, approved)
        : await tool.execute(call.args, toolContext);
    } catch (err) {
      result = {
        ok: false,
        content: `${call.name} crashed: ${(err as Error).message}`,
      };
    }
    const durationMs = Date.now() - startedAt;
    this.emit({ type: 'tool-end', call, result, durationMs });
    // Remember that this task changed files, so the verify phase runs only when
    // there is something to verify. Any successful call that is not a read may
    // have changed the workspace (a write, a shell command), so a repeat of an
    // earlier call after it is a fresh question, not a stale one.
    if (result.ok && (writesVault || writesMemory)) this.noteWroteThisTask = true;
    else if (result.ok && tool.risk === 'write') this.wroteThisTask = true;
    if (
      result.ok &&
      call.name === PROJECT_MEMORY_WRITE_TOOL &&
      call.args.file === CURRENT_STATE_FILE
    ) {
      this.seatWroteCurrentState = true;
    }
    if (result.ok && tool.risk !== 'read' && tool.risk !== 'network') {
      this.lastChangeStep = this.callStep;
    }
    // The task list rides its own event so every client renders it live.
    if (call.name === 'todoWrite' && result.ok && Array.isArray(call.args.items)) {
      this.todos = call.args.items as TodoItem[];
      this.emit({ type: 'todos', items: this.todos });
    }
    if (result.citations?.length) this.emit({ type: 'citations', citations: result.citations });
    this.pushObservation(
      call,
      this.fitObservation(redactSecrets(result.content)),
      toolMode,
      result.localOnly,
    );
    return result.ok ? 'ok' : 'failed';
  }

  /**
   * "Always allow in this project" (ENG-3, ENG-4). The saved rule is scoped as
   * narrowly as the tool allows: a path tool to its directory (`**` at the
   * root, never the dead `/**`), a shell tool to the command's first word, and
   * anything else to the tool itself, said plainly. A shell wrapper (sudo,
   * env, bash, ...) would allow anything, so it is refused; cloud spend is
   * never saved. The same rule applies for the rest of this session.
   */
  private persistProjectAllow(
    call: ParsedToolCall,
    tool: ToolDef,
    path: string | undefined,
    command: string | undefined,
  ): void {
    if (tool.risk === 'cloud-spend') {
      this.emit({
        type: 'note',
        message: `${call.name} spends cloud quota, so it asks every time; that cannot be saved for the project.`,
      });
      return;
    }
    const rule: ProjectRule = { tool: call.name };
    let scope = ' for every call';
    if (path !== undefined) {
      const dir = dirnameOf(path);
      rule.pathGlob = dir ? `${dir}/**` : '**';
      scope = ` under ${dir || '.'}`;
    } else if (command !== undefined) {
      // A wrapper or interpreter by any spelling, code on the command line,
      // `git -c`, or PowerShell: the saved first word would reach commands
      // it never named, so it is not saved, and the note says why (D3).
      const refusal = prefixGrantRefusal(command);
      if (refusal) {
        this.emit({ type: 'note', message: refusal });
        return;
      }
      const first = command.trim().split(/\s+/)[0] ?? '';
      rule.commandPrefix = first;
      scope = ` for commands starting with ${first}`;
    }
    const saved = this.deps.persistRule?.(rule) ?? false;
    this.emit({
      type: 'note',
      message: saved
        ? `${call.name} is allowed from now on${scope} in this project. Change it in os-code.config.json.`
        : `Could not save that rule for this project; ${call.name} will ask again.`,
    });
    if (saved) this.deps.permissions.addSessionRule({ ...rule, decision: 'allow' });
  }

  /** Remember a workspace file's content before the first write touches it
   *  this task (null when it does not exist yet), so a fresh attempt can put
   *  it back. Only the first touch counts; later writes leave the record. */
  private recordOriginal(rawPath: string): void {
    let abs: string;
    try {
      abs = this.deps.toolContext.jail.resolve(rawPath);
    } catch {
      return;
    }
    if (this.touched.has(abs)) return;
    try {
      this.touched.set(abs, existsSync(abs) ? readFileSync(abs, 'utf8') : null);
    } catch {
      // unreadable (a directory, a permission): nothing to restore later
    }
  }

  /** Put every touched file back to how it was before this task, and forget
   *  nothing: the originals stay the originals across attempts. */
  private restoreTouched(): void {
    for (const [abs, original] of this.touched) {
      try {
        if (original === null) {
          rmSync(abs, { force: true });
        } else {
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, original);
        }
      } catch (err) {
        log.warn(`could not restore ${abs}: ${(err as Error).message}`);
      }
    }
  }

  /** Begin the next independent attempt when the class allows one: restore
   *  the workspace, reset the per-attempt state, and rebuild the history as
   *  just the original ask. Returns false when the allowance is spent (or
   *  there is no profile, no task message, or plan mode). */
  private startFreshAttempt(): boolean {
    const allowance = this.modelProfile?.bestOfAttempts ?? 1;
    if (this.mode === 'plan' || !this.taskMessage || this.attempt >= allowance) return false;
    this.restoreTouched();
    this.attempt += 1;
    this.wroteThisTask = false;
    this.attemptedWriteThisTask = false;
    this.noWriteNudged = false;
    this.clearRepeatState();
    this.lastChangeStep = this.callStep;
    this.todos = [];
    this.history = [this.taskMessage];
    this.emit({ type: 'attempt', number: this.attempt, of: allowance });
    this.emit({
      type: 'status',
      message: `The check did not pass and the retries are spent. Restored the ${this.touched.size} file${this.touched.size === 1 ? '' : 's'} this attempt touched and starting attempt ${this.attempt} of ${allowance} from the original task.`,
    });
    return true;
  }

  /** Forget the repeats seen so far and give tools back: at a task's start, a
   *  fresh attempt, and a verify retry, where the model is asked to change
   *  something and the calls before are no longer stale. Every piece of
   *  repeat state is cleared here, so a new detector adds its own line. */
  private clearRepeatState(): void {
    this.answerOnly = false;
    this.repeatLog.clear();
  }

  /** Record this call for repeat detection. Returns false when it should run,
   *  'stale' when it is an exact repeat with nothing changed since (answer it
   *  from the record), and 'answer-only' on the third such repeat. */
  private noteRepeat(call: ParsedToolCall): false | 'stale' | 'answer-only' {
    this.callStep += 1;
    const key = `${call.name} ${JSON.stringify(call.args ?? {})}`;
    const prior = this.repeatLog.get(key);
    const count = (prior?.count ?? 0) + 1;
    this.repeatLog.set(key, { count, lastStep: this.callStep });
    if (!prior || prior.lastStep <= this.lastChangeStep) return false;
    return count >= 3 ? 'answer-only' : 'stale';
  }

  /** The mark an assistant turn carries once this task has read a
   *  local-only note (CTO I5). */
  private localOnlyMark(): { localOnly?: true } {
    return this.readLocalOnlyThisTask ? { localOnly: true } : {};
  }

  /** Record a tool's observation. `localOnly` (a local-only vault note's
   *  text) rides onto the message, so a later leaving turn sends a stub in
   *  its place while the kept history holds the note (CTO I5). */
  private pushObservation(
    call: ParsedToolCall,
    content: string,
    toolMode: 'native' | 'text',
    localOnly?: boolean,
  ): void {
    if (localOnly) this.readLocalOnlyThisTask = true;
    const mark = localOnly ? { localOnly: true as const } : {};
    if (toolMode === 'native') {
      this.history.push({ role: 'tool', content, toolCallId: call.id, name: call.name, ...mark });
    } else {
      this.history.push({ role: 'user', content: `[${call.name} result]\n${content}`, ...mark });
    }
  }

  /**
   * C2: after an early exit mid tool-batch, every tool_use recorded on the
   * assistant turn still needs a matching tool_result, or `toAnthropicMessages`
   * emits a dangling tool_use and the next cloud turn 400s. Push a synthetic
   * observation for any call that never produced one.
   */
  private fillUnansweredCalls(
    calls: ParsedToolCall[],
    answered: Set<string>,
    toolMode: 'native' | 'text',
  ): void {
    for (const call of calls) {
      if (answered.has(call.id)) continue;
      this.pushObservation(
        call,
        'This step did not run because the task stopped before reaching it.',
        toolMode,
      );
    }
  }

  /**
   * C1: await a tool approval, but resolve to 'aborted' the instant the session
   * is aborted. Without the race a never-answered approval leaves run() hanging
   * forever; with it, abort() settles the promise and the tool never runs.
   */
  private awaitApprovalOrAbort(request: ApprovalRequest): Promise<ApprovalAnswer | 'aborted'> {
    const signal = this.abortController?.signal;
    if (signal?.aborted) return Promise.resolve('aborted');
    return new Promise<ApprovalAnswer | 'aborted'>((resolve, reject) => {
      let settled = false;
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        resolve('aborted');
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(this.deps.approver(request)).then(
        (answer) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(answer);
        },
        (err) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }

  // -------------------------------------------------------------------------
  // Escalation and failure handling
  // -------------------------------------------------------------------------

  private async maybeEscalate(failStreak: number): Promise<boolean> {
    const { config, router } = this.deps;
    // Never escalate a session that holds the project's secrets: cloud
    // escalation would send the local model's history (which may carry a secret
    // it used) to a cloud provider. Secrets sessions stay local, always.
    if (this.deps.projectSecrets?.trim()) return false;
    if (this.escalated) return false;
    if (!router.escalationEnabled()) return false;
    if (failStreak < config.routing.escalation.afterToolFailures) return false;
    const target = router.escalationTarget();
    if (!target) return false;

    const approved = await this.confirmCloudSpend(
      `The local model is struggling (${failStreak} failed attempts). Escalate this task to ${target.model}?`,
    );
    if (!approved) return false;

    this.escalated = true;
    this.active = {
      provider: target.provider,
      model: target.model,
      adapter: adapterFor(target.model),
    };
    this.emit({
      type: 'model-switch',
      model: target.model,
      providerKind: 'cloud',
      reason: 'local model was struggling; escalated with your approval',
    });
    return true;
  }

  /** The card's words for the active seat when it is off this network: cloud
   *  Claude is priced; a remote OpenAI-compatible server is named by host. */
  private offNetworkReason(): [string, string?] {
    const provider = this.active.provider;
    if (provider.kind === 'cloud') return ['This step runs on cloud Claude.'];
    const endpoint = this.deps.config.providers[provider.id];
    let host = provider.label;
    if (endpoint && 'baseUrl' in endpoint) {
      try {
        host = new URL(endpoint.baseUrl).host;
      } catch {
        // Keep the label.
      }
    }
    return [
      `This step runs on ${provider.label}, a model server off this computer's network.`,
      `Your messages and the code the agent reads go to ${host}. Nothing is sent without this approval.`,
    ];
  }

  /** Hosts on this computer's own network the person let a web tool open
   *  this session. */
  private ownNetworkAllowed = new Set<string>();

  /**
   * May a web tool open an address on this computer's own network (D3)? A
   * page there is not the public web: it is this computer's own apps, the
   * router's settings, the person's other devices, a cloud machine's
   * metadata. Asked once per chat for each host, in every mode, since the
   * model chose the address; a profile with nobody to ask refuses.
   */
  private async confirmOwnNetwork(url: string, host: string, toolName: string): Promise<boolean> {
    if (this.ownNetworkAllowed.has(host)) return true;
    if (!this.deps.profile.allowNetworkAutoApprove) return false;
    const answer = await this.awaitApprovalOrAbort({
      id: `network_${randomUUID()}`,
      kind: 'tool',
      toolName,
      risk: 'network',
      summary: `Open ${host}, an address on your own network`,
      detail: `The agent wants to open ${url}. An address on your own network is not the public web: it reaches apps on this computer, your router, and your other devices. OpenShore asks once per chat for each one.`,
      alwaysAsk: true,
      ...(this.lockdown ? { lockdown: true } : {}),
    });
    if (answer === 'aborted' || !answer.approve) return false;
    this.ownNetworkAllowed.add(host);
    return true;
  }

  private async confirmCloudSpend(reason: string, detailOverride?: string): Promise<boolean> {
    if (this.cloudApprovedForSession || this.cloudApprovedForTask) return true;
    const { usage, approver, permissions, profile } = this.deps;
    const model = this.deps.router.escalationTarget()?.model ?? this.active.model;
    const promptGuess = estimateMessages(this.history) + 2000;
    const estimate = usage.estimate(model, promptGuess);
    const spent = usage.session.dollars;
    const answer: ApprovalAnswer = await approver({
      id: randomUUID(),
      kind: 'cloud-spend',
      toolName: 'cloud',
      risk: 'cloud-spend',
      summary: reason,
      detail:
        detailOverride ??
        `Estimated cost: about $${estimate.toFixed(3)} per call on ${model}. Spent this session: $${spent.toFixed(2)}. Nothing is sent without this approval.`,
    });
    if (answer.approve) this.cloudApprovedForTask = true;
    if (answer.approve && answer.alwaysThisSession && profile.allowCloudAutoApprove) {
      this.cloudApprovedForSession = true;
      permissions.allowForSession('cloud');
    }
    return answer.approve;
  }

  /** The tool specs the model may see this turn: everything, in plan mode only
   *  the read-side tools, and for a lean seat only the few the profile allows
   *  (core-first, so read/edit/search survive the cut). A tool that is not shown
   *  is simply not offered; the registry still executes it if a call arrives, so
   *  nothing breaks, the model just sees a shorter, cheaper menu. */
  private toolSpecs(): ToolSpec[] {
    let specs = this.vaultMenu(this.deps.tools.specs());
    if (this.mode === 'plan') {
      specs = specs.filter((spec) => {
        const tool = this.deps.tools.get(spec.name);
        return tool ? PLAN_SAFE_RISKS.has(tool.risk) : false;
      });
    }
    return this.limitToolSpecs(specs);
  }

  /** The tools this seat is offered, by name, for the system prompt: what
   *  survives the seat's cut, in either tool mode (the text bridge lists the
   *  same menu). Plan mode is left out on purpose: its own block tells the
   *  model the write tools wait for an approved plan. */
  private offeredToolNames(): Set<string> {
    return new Set(this.limitToolSpecs(this.vaultMenu(this.deps.tools.specs())).map((s) => s.name));
  }

  /** One way into the vault per seat (CTO I11): a class with
   *  `mergedVaultTool` sees the merged vault read and not the separate reads,
   *  any other seat the separate reads and not the merged one. The rule is the
   *  registry's seatOffersVaultTool, read per turn since an escalation changes
   *  the seat. With no merged tool registered the menu is left as it is, so a
   *  seat never loses its only way in. */
  private vaultMenu(specs: ToolSpec[]): ToolSpec[] {
    if (!specs.some((s) => s.name === MERGED_VAULT_TOOL)) return specs;
    const merged = this.modelProfile?.mergedVaultTool ?? false;
    return specs.filter((s) => seatOffersVaultTool(s.name, merged));
  }

  /** The most characters one observation carries for the seat answering
   *  now: its class's share of the served window (C1). */
  private observationCap(): number {
    return seatObservationCap(this.modelProfile, this.contextTokens);
  }

  /** An observation cut to the seat's cap when a tool did not size its own
   *  output to it (a shell's stdout, a grep), keeping its head and tail with
   *  a plain note of what was left out. The tool-end event keeps it whole. */
  private fitObservation(content: string): string {
    const cap = this.observationCap();
    return content.length > cap + OBSERVATION_SLACK_CHARS ? capContent(content, cap) : content;
  }

  /** Keep at most `maxToolsShown` specs for the active profile, most useful
   *  first. No profile, or an unbounded one, returns the list unchanged. */
  private limitToolSpecs(specs: ToolSpec[]): ToolSpec[] {
    const max = this.modelProfile?.maxToolsShown ?? Infinity;
    if (!Number.isFinite(max) || specs.length <= max) return specs;
    const rank = (name: string): number => {
      const i = SMALL_MODEL_TOOL_PRIORITY.indexOf(name);
      return i === -1 ? SMALL_MODEL_TOOL_PRIORITY.length : i;
    };
    // Stable sort (V8): priority tools first in priority order, the rest keep
    // their registration order behind them. Then take the top `max`.
    return [...specs].sort((a, b) => rank(a.name) - rank(b.name)).slice(0, max);
  }

  private async handleProviderFailure(err: unknown, turn: number): Promise<'retry' | 'fail'> {
    // A rate limit or an overloaded upstream is worth a short, bounded wait:
    // two retries with a growing pause, announced, then an honest failure.
    const message = err instanceof Error ? err.message : String(err);
    if (TRANSIENT.test(message) && this.transientRetries < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[this.transientRetries]!;
      this.transientRetries += 1;
      this.emit({
        type: 'status',
        message: `The model's server is busy (${message.slice(0, 80)}). Retrying in ${Math.round(delay / 1000)}s.`,
      });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        this.abortController?.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (this.abortController?.signal.aborted) return 'fail';
      return 'retry';
    }
    if (err instanceof ProviderError && err.message.startsWith('TOOLS_UNSUPPORTED')) {
      // The backend told us native tools are off the table; the capability
      // cache now knows, so the next turn uses the text bridge.
      this.emit({
        type: 'status',
        message: 'This model has no native tool support; switching to the JSON text bridge.',
      });
      log.info('switching to text bridge', { model: this.active.model, turn });
      return 'retry';
    }
    return 'fail';
  }

  /**
   * Count a model call against the rails and show it (ENG-14, DAE-4). Every
   * call lands here: the turn itself, a compaction summary, a delegated
   * subtask. Cloud calls are priced and hit the dollar rail; local ones cost
   * nothing but still count toward the token rail.
   */
  private recordUsage(
    model: string,
    kind: 'local' | 'cloud',
    promptTokens: number,
    completionTokens: number,
    cache: {
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      estimatedPromptTokens?: number;
    } = {},
  ): number {
    this.deps.guardrails.noteTokens(promptTokens + completionTokens);
    let dollars = 0;
    if (kind === 'cloud') {
      dollars = this.deps.usage.noteCloud(model, promptTokens, completionTokens);
      this.deps.guardrails.noteDollars(dollars);
    }
    const contextPercent = this.contextTokens
      ? Math.min(
          100,
          Math.round(
            ((estimateMessages(this.history) + this.toolTokens) / this.contextTokens) * 100,
          ),
        )
      : 0;
    // The cache fields ride only when the provider reported them (additive,
    // CTO J17), so the eval's DriveTrace can sum reads and writes per task.
    this.emit({
      type: 'usage',
      promptTokens,
      completionTokens,
      dollars,
      contextPercent,
      ...(cache.cacheReadTokens !== undefined ? { cacheReadTokens: cache.cacheReadTokens } : {}),
      ...(cache.cacheWriteTokens !== undefined ? { cacheWriteTokens: cache.cacheWriteTokens } : {}),
      ...(cache.estimatedPromptTokens !== undefined
        ? { estimatedPromptTokens: cache.estimatedPromptTokens }
        : {}),
    });
    return dollars;
  }

  /**
   * Cheap one-shot completion on the active model (compaction and titles use
   * this). The signal is the caller's: a mid-task summary rides the task's,
   * idle work passes none, so a Stop from the last task never turns a later
   * /compact into a silent drop (ENG-7). Usage is read from the stream, with
   * a 4-chars-per-token estimate only when the backend reports nothing, so
   * the spend reaches the dollar rail and the transcript (ENG-14).
   */
  private async summarize(text: string, signal?: AbortSignal): Promise<string> {
    let out = '';
    let promptTokens = 0;
    let completionTokens = 0;
    for await (const event of this.active.provider.chat(
      {
        model: this.active.model,
        messages: [{ role: 'user', content: text }],
        maxTokens: 600,
        temperature: 0.1,
        reasoning: 'off',
      },
      signal,
    )) {
      if (event.type === 'text') out += event.delta;
      else if (event.type === 'usage') {
        if (event.promptTokens) promptTokens = event.promptTokens;
        if (event.completionTokens) completionTokens = event.completionTokens;
      }
    }
    if (!this.contextTokens) {
      const caps = await this.active.provider.capabilities(this.active.model);
      this.contextTokens = caps.contextTokens;
    }
    this.recordUsage(
      this.active.model,
      this.active.provider.kind,
      promptTokens || estimateTokens(text),
      completionTokens || estimateTokens(out),
    );
    // A model that thinks in <think> tags on its own never leaks them here.
    return splitThinkTags(out).text.trim();
  }
}

/** The directory part of a workspace-relative path, '' at the root. */
function dirnameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}
