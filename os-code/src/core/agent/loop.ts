// The agent loop. ReAct-style tool use with streaming: system prompt to the
// model, the model answers with text or tool calls, approved tools run, the
// observations feed back, repeat until the task is done or a guardrail says
// stop. Native tool calling and the JSON-in-text bridge both land here, with
// bounded repair, optional grammar-constrained retries, and cloud escalation
// as a last resort that always asks before spending.
import { randomUUID } from 'node:crypto';
import type { OscConfig } from '../../config/schema.js';
import type { ChatMessage, ContentPart, Provider, ToolCallRequest } from '../../providers/types.js';
import { ProviderError } from '../../providers/types.js';
import { adapterFor, type ModelAdapter } from '../../providers/adapters/index.js';
import type { Router } from '../../router/router.js';
import type { ToolContext, ToolRegistry } from '../tools/index.js';
import { uxStandardPrompt } from './uxStandard.js';
import {
  extractTextCalls,
  repairPrompt,
  textProtocolInstructions,
  toolCallJsonSchema,
  validateNativeCall,
  type ParsedToolCall,
} from '../tools/parser.js';
import { PermissionEngine } from '../permissions/index.js';
import { Guardrails } from '../guardrails/index.js';
import type { SecurityProfile } from '../security/profiles.js';
import { redactSecrets } from '../security/redaction.js';
import { compactHistory } from '../../context/compaction.js';
import { estimateMessages } from '../../context/compaction.js';
import { UsageTracker } from '../../auth/usage.js';
import type {
  AgentEvent,
  ApprovalAnswer,
  ApprovalRequest,
  Approver,
  EventSink,
  PermissionMode,
  TodoItem,
} from './types.js';
import { instructionsPrompt, type RepoInstructions } from './instructions.js';
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
  /** The permission mode to start in. Defaults to asking for writes and shell. */
  permissionMode?: PermissionMode;
  /** Persist an allow rule for this tool in the workspace ("don't ask again
   *  for this in this project"). Returns false when nothing could be written. */
  persistRule?: (rule: { tool: string; pathGlob?: string }) => boolean;
}

/** Tools a plan may use: nothing that changes the workspace or runs a shell. */
const PLAN_SAFE_RISKS = new Set(['read', 'network']);

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

  constructor(private readonly deps: AgentDeps) {
    const orchestrator = deps.router.orchestrator();
    this.active = {
      provider: orchestrator.provider,
      model: orchestrator.ref.model,
      adapter: adapterFor(orchestrator.ref.model),
    };
    this.mode = deps.permissionMode ?? 'default';
    this.instructions = deps.instructions;
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
    if (this.mode === mode) return;
    this.mode = mode;
    this.emit({ type: 'mode', mode });
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
    const result = await compactHistory(this.history, budget, (text) =>
      this.summarize(focus ? `${text}\n\nWhen summarizing, keep everything about: ${focus}` : text),
    );
    if (result.compacted) this.history = result.messages;
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

  // -------------------------------------------------------------------------
  // System prompt
  // -------------------------------------------------------------------------

  private systemPrompt(toolMode: 'native' | 'text'): string {
    const { toolContext, codeMap } = this.deps;
    const parts = [
      "You are OS Code, a careful, capable coding agent running on the user's own machine.",
      `Workspace root: ${toolContext.cwd} (platform: linux). All file paths are relative to it.`,
      'Work step by step: inspect before you change, prefer small precise edits (editFile), and verify with the available tools.',
      'Use webSearch and webFetch for anything after your knowledge cutoff or specific to a library version.',
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
      parts.push(
        [
          'PLAN MODE. You may only read: readFile, grep, glob, gitStatus, gitDiff, searchRepo, webSearch, webFetch, todoWrite. Every editing, writing, and shell tool is unavailable until the person approves your plan.',
          'Investigate as much as you need, then answer with a plan: a short numbered list of the concrete changes you would make, each naming the files it touches, plus what you would verify and any risk. End with one question only if a decision is genuinely theirs.',
          'Do not start building. The person will say when.',
        ].join(' '),
      );
    }
    const standing = instructionsPrompt(this.deps.repoInstructions, this.instructions);
    if (standing) parts.push(standing);
    // Premium UX out of the box: everything with a screen is built to the
    // twenty laws plus the house bar unless a project turns it off in config
    // or the user says to skip it (uxStandard.ts).
    const ux = this.deps.config.ux;
    if (ux?.standard !== 'off') parts.push(uxStandardPrompt(ux?.notes));
    if (codeMap) {
      parts.push(`Repository map (files and symbols):\n${codeMap}`);
    }
    if (toolMode === 'text') {
      parts.push(textProtocolInstructions(this.deps.tools));
    }
    return this.active.adapter.systemPreamble(parts.join('\n\n'));
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
    this.transientRetries = 0;
    this.abortController = new AbortController();
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
    this.history.push({ role: 'user', content });

    let parseFailStreak = 0;
    let repairAttempts = 0;
    let turn = 0;

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
      if (this.active.provider.kind === 'cloud' && !this.cloudApprovedForSession) {
        const approved = await this.confirmCloudSpend('This step runs on cloud Claude.');
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
      const caps = await this.active.provider.capabilities(this.active.model);
      const toolMode: 'native' | 'text' =
        caps.supportsTools && this.active.adapter.toolFormat() === 'native' ? 'native' : 'text';

      // Refresh the system prompt each turn (tool mode and model can change).
      this.history = [
        { role: 'system', content: this.systemPrompt(toolMode) },
        ...this.history.filter((m) => m.role !== 'system'),
      ];

      // Compaction keeps small local windows honest.
      const compacted = await compactHistory(this.history, caps.contextTokens, (text) =>
        this.summarize(text),
      );
      if (compacted.compacted) {
        this.history = compacted.messages;
        this.emit({ type: 'status', message: 'Compacted older turns to fit the context window.' });
      }

      this.emit({
        type: 'turn-start',
        turn,
        model: this.active.model,
        providerKind: this.active.provider.kind,
      });

      // Grammar-constrained retry: only after a failed parse, and only where
      // the backend supports it. A permanent constraint would forbid final
      // text answers, so it is a repair tool, not a default.
      const useGrammar = toolMode === 'text' && repairAttempts > 0 && caps.supportsGrammar;

      let streamedText = '';
      const nativeCalls: ToolCallRequest[] = [];
      let promptTokens = 0;
      let completionTokens = 0;

      try {
        const stream = this.active.provider.chat(
          {
            model: this.active.model,
            messages: this.history,
            tools: toolMode === 'native' ? this.toolSpecs() : undefined,
            temperature: this.active.adapter.temperature(),
            maxTokens: 8192,
            stop: this.active.adapter.stopTokens().length
              ? this.active.adapter.stopTokens()
              : undefined,
            jsonSchema: useGrammar ? toolCallJsonSchema(this.deps.tools) : undefined,
            keepAlive: config.resourceBudget.keepAlive,
          },
          this.abortController.signal,
        );
        for await (const event of stream) {
          switch (event.type) {
            case 'text':
              streamedText += event.delta;
              this.emit({ type: 'text-delta', text: event.delta });
              break;
            case 'thinking':
              this.emit({ type: 'thinking-delta', text: event.delta });
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
              break;
            case 'done':
              break;
          }
        }
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
      guardrails.noteTokens(promptTokens + completionTokens);
      let dollars = 0;
      if (this.active.provider.kind === 'cloud') {
        dollars = this.deps.usage.noteCloud(this.active.model, promptTokens, completionTokens);
        guardrails.noteDollars(dollars);
      }
      this.emit({
        type: 'usage',
        promptTokens,
        completionTokens,
        dollars,
        contextPercent: Math.min(
          100,
          Math.round((estimateMessages(this.history) / caps.contextTokens) * 100),
        ),
      });

      // ------------------------------------------------------------------
      // Turn resolution: tool calls, a final answer, or a repair pass.
      // ------------------------------------------------------------------
      let calls: ParsedToolCall[] = [];
      const problems: string[] = [];

      if (nativeCalls.length) {
        for (const raw of nativeCalls) {
          const validated = validateNativeCall(raw, this.deps.tools);
          if (validated.ok) calls.push(validated.call);
          else problems.push(validated.problem);
        }
      }
      let displayText = streamedText;
      if (!nativeCalls.length && toolMode === 'text' && streamedText.trim()) {
        const extraction = extractTextCalls(streamedText, this.deps.tools);
        calls = extraction.calls;
        problems.push(...extraction.problems);
        displayText = extraction.remainder;
      }

      if (!calls.length && problems.length) {
        // Malformed call: bounded repair, then escalation, then stop.
        parseFailStreak += 1;
        repairAttempts += 1;
        this.history.push({ role: 'assistant', content: streamedText });
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
        this.emit({
          type: 'task-done',
          reason: 'error',
          message:
            'The model kept producing tool calls that could not be parsed. Try a stronger orchestrator (osc market), or connect cloud escalation (osc login).',
        });
        return;
      }

      if (!calls.length) {
        // A plain text answer: the task is done. In plan mode the answer IS the
        // plan, so it is also raised as a proposal the person can approve.
        const finalText = displayText.trim();
        this.history.push({ role: 'assistant', content: streamedText });
        this.emit({ type: 'text-final', text: finalText });
        if (this.mode === 'plan' && finalText)
          this.emit({ type: 'plan-proposed', text: finalText });
        this.emit({ type: 'task-done', reason: 'complete' });
        return;
      }

      // Successful parse: reset the repair counters.
      repairAttempts = 0;

      // Record the assistant turn (with its calls) before observations.
      if (toolMode === 'native') {
        this.history.push({
          role: 'assistant',
          content: streamedText,
          toolCalls: calls.map((c) => ({
            id: c.id,
            name: c.name,
            argsText: JSON.stringify(c.args),
            args: c.args,
          })),
        });
        if (displayText.trim()) this.emit({ type: 'text-final', text: displayText.trim() });
      } else {
        this.history.push({ role: 'assistant', content: streamedText });
        if (displayText.trim()) this.emit({ type: 'text-final', text: displayText.trim() });
      }

      // Execute the calls in order.
      let sawFailure = false;
      const answered = new Set<string>();
      for (const call of calls) {
        const observation = await this.executeCall(call, toolMode);
        if (observation === 'aborted') {
          // C2: an early exit mid-batch (a guardrail trip or a user abort)
          // leaves the just-recorded tool_use blocks with no tool_result, and
          // every subsequent Anthropic turn 400s. Pair each recorded call with
          // a synthetic observation. executeCall already emitted the guardrail
          // task-done; a user abort has not, so emit that here (C1/C3).
          this.fillUnansweredCalls(calls, answered, toolMode);
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
        if (observation === 'failed') sawFailure = true;
      }
      parseFailStreak = sawFailure ? parseFailStreak + 1 : 0;
      if (sawFailure && (await this.maybeEscalate(parseFailStreak))) {
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
  ): Promise<'ok' | 'failed' | 'aborted'> {
    const { tools, permissions, guardrails, toolContext, profile } = this.deps;
    const tool = tools.get(call.name)!;

    guardrails.noteStep();
    const repeats = guardrails.noteToolCall(call.name, call.args);
    const violation = guardrails.check({ toolName: call.name, args: call.args, repeats });
    if (violation) {
      this.emit({ type: 'task-done', reason: 'guardrail', message: violation.message });
      return 'aborted';
    }

    const path = tool.pathOf?.(call.args);
    let decision = permissions.decide({
      toolName: call.name,
      risk: tool.risk,
      path,
      cwd: toolContext.cwd,
      alwaysAsk: tool.alwaysAsk,
    });

    // The permission mode sits on top of the policy, the way Claude Code's
    // does. Plan mode never mutates. Bypass and acceptEdits turn an "ask" into
    // an allow for their class, but never for cloud spend and never for an
    // always-ask tool (those two stay loud in every mode).
    if (this.mode === 'plan' && !PLAN_SAFE_RISKS.has(tool.risk)) {
      const reason = 'Plan mode: read only until the plan is approved.';
      this.emit({ type: 'tool-denied', call, reason });
      this.pushObservation(
        call,
        'Not run: plan mode is read only. Finish investigating and answer with the plan; the person approves it before anything is changed.',
        toolMode,
      );
      return 'failed';
    }
    if (decision.decision === 'ask' && !tool.alwaysAsk && tool.risk !== 'cloud-spend') {
      if (this.mode === 'bypassPermissions') {
        decision = { decision: 'allow', reason: 'bypass permissions mode' };
      } else if (this.mode === 'acceptEdits' && tool.risk === 'write') {
        decision = { decision: 'allow', reason: 'accept edits mode' };
      }
    }

    if (decision.decision === 'deny') {
      const reason = `${call.name} is denied by your permission policy (${decision.reason}).`;
      this.emit({ type: 'tool-denied', call, reason });
      this.pushObservation(call, `Denied: ${reason} Choose a different approach.`, toolMode);
      return 'failed';
    }

    if (decision.decision === 'ask') {
      let summary = `${call.name}`;
      let detail: string | undefined;
      try {
        if (tool.preview) {
          const preview = await tool.preview(call.args, toolContext);
          summary = preview.summary;
          detail = preview.detail;
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
      });
      // C1: the session was aborted while this approval was pending. Do not run
      // the tool; report an abort so run() settles instead of wedging.
      if (answer === 'aborted') return 'aborted';
      if (answer.alwaysThisSession && answer.approve) {
        if (tool.alwaysAsk) {
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
      if (answer.alwaysInProject && answer.approve && !tool.alwaysAsk) {
        const pathGlob = path ? `${dirnameOf(path)}/**` : undefined;
        const saved = this.deps.persistRule?.({ tool: call.name, pathGlob }) ?? false;
        this.emit({
          type: 'note',
          message: saved
            ? `${call.name} is allowed from now on${pathGlob ? ` under ${dirnameOf(path!) || '.'}` : ''} in this project. Change it in os-code.config.json.`
            : `Could not save that rule for this project; ${call.name} will ask again.`,
        });
        if (saved) permissions.allowForSession(call.name);
      }
      if (!answer.approve) {
        this.emit({ type: 'tool-denied', call, reason: 'You declined this step.' });
        this.pushObservation(
          call,
          'The user declined this action. Do not retry it as-is; adjust the approach or ask what they would prefer.',
          toolMode,
        );
        return 'failed';
      }
    }

    this.emit({ type: 'tool-start', call });
    const startedAt = Date.now();
    let result;
    try {
      result = await tool.execute(call.args, toolContext);
    } catch (err) {
      result = {
        ok: false,
        content: `${call.name} crashed: ${(err as Error).message}`,
      };
    }
    const durationMs = Date.now() - startedAt;
    this.emit({ type: 'tool-end', call, result, durationMs });
    // The task list rides its own event so every client renders it live.
    if (call.name === 'todoWrite' && result.ok && Array.isArray(call.args.items)) {
      this.todos = call.args.items as TodoItem[];
      this.emit({ type: 'todos', items: this.todos });
    }
    if (result.citations?.length) this.emit({ type: 'citations', citations: result.citations });
    this.pushObservation(call, redactSecrets(result.content), toolMode);
    return result.ok ? 'ok' : 'failed';
  }

  private pushObservation(
    call: ParsedToolCall,
    content: string,
    toolMode: 'native' | 'text',
  ): void {
    if (toolMode === 'native') {
      this.history.push({ role: 'tool', content, toolCallId: call.id, name: call.name });
    } else {
      this.history.push({ role: 'user', content: `[${call.name} result]\n${content}` });
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

  private async confirmCloudSpend(reason: string): Promise<boolean> {
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
      detail: `Estimated cost: about $${estimate.toFixed(3)} per call on ${model}. Spent this session: $${spent.toFixed(2)}. Nothing is sent without this approval.`,
    });
    if (answer.approve) this.cloudApprovedForTask = true;
    if (answer.approve && answer.alwaysThisSession && profile.allowCloudAutoApprove) {
      this.cloudApprovedForSession = true;
      permissions.allowForSession('cloud');
    }
    return answer.approve;
  }

  /** The tool specs the model may see this turn: everything, or in plan mode
   *  only the read-side tools. */
  private toolSpecs() {
    const specs = this.deps.tools.specs();
    if (this.mode !== 'plan') return specs;
    return specs.filter((spec) => {
      const tool = this.deps.tools.get(spec.name);
      return tool ? PLAN_SAFE_RISKS.has(tool.risk) : false;
    });
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

  /** Cheap one-shot completion on the active model (compaction uses this). */
  private async summarize(text: string): Promise<string> {
    let out = '';
    for await (const event of this.active.provider.chat(
      {
        model: this.active.model,
        messages: [{ role: 'user', content: text }],
        maxTokens: 600,
        temperature: 0.1,
      },
      this.abortController?.signal,
    )) {
      if (event.type === 'text') out += event.delta;
    }
    if (this.active.provider.kind === 'cloud') {
      this.deps.usage.noteCloud(this.active.model, Math.ceil(text.length / 4), 600);
    }
    return out.trim();
  }
}

/** The directory part of a workspace-relative path, '' at the root. */
function dirnameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}
