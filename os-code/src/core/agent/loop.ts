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
import type { AgentEvent, ApprovalAnswer, Approver, EventSink } from './types.js';
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
}

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

  constructor(private readonly deps: AgentDeps) {
    const orchestrator = deps.router.orchestrator();
    this.active = {
      provider: orchestrator.provider,
      model: orchestrator.ref.model,
      adapter: adapterFor(orchestrator.ref.model),
    };
  }

  get activeModel(): { model: string; kind: 'local' | 'cloud' } {
    return { model: this.active.model, kind: this.active.provider.kind };
  }

  abort(): void {
    this.abortController?.abort();
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
      'Never use em dashes in your replies. Use a period or a comma instead.',
    ];
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

  async run(input: string, images?: Array<{ base64: string; mediaType: string }>): Promise<void> {
    const { config, guardrails } = this.deps;
    guardrails.startTask();
    this.cloudApprovedForTask = false;
    this.abortController = new AbortController();
    this.emit({ type: 'task-start', input });

    const content: string | ContentPart[] = images?.length
      ? [
          { type: 'text', text: input },
          ...images.map((i): ContentPart => ({
            type: 'image',
            imageBase64: i.base64,
            mediaType: i.mediaType,
          })),
        ]
      : input;
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
            tools: toolMode === 'native' ? this.deps.tools.specs() : undefined,
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
              promptTokens += event.promptTokens;
              completionTokens += event.completionTokens;
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
        // A plain text answer: the task is done.
        const finalText = displayText.trim();
        this.history.push({ role: 'assistant', content: streamedText });
        this.emit({ type: 'text-final', text: finalText });
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
      for (const call of calls) {
        const observation = await this.executeCall(call, toolMode);
        if (observation === 'aborted') return;
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
    const decision = permissions.decide({
      toolName: call.name,
      risk: tool.risk,
      path,
      cwd: toolContext.cwd,
    });

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
      const answer = await this.deps.approver({
        id: call.id,
        kind: 'tool',
        toolName: call.name,
        risk: tool.risk,
        summary,
        detail,
      });
      if (answer.alwaysThisSession && answer.approve) {
        if (!permissions.allowForSession(call.name)) {
          this.emit({
            type: 'note',
            message: `Session-wide approval is not available on the ${profile.name} profile; each ${call.name} will ask.`,
          });
        }
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

  private async handleProviderFailure(err: unknown, turn: number): Promise<'retry' | 'fail'> {
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
