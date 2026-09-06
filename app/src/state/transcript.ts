// The transcript reducer: one pure function folds the engine's DriverEvent
// stream into the ThreadState the chat renders. Local model, desktop stack,
// cloud, replayed journal: same events, same reducer, same UI. Kept free of
// React so it is exhaustively testable.
import type { DriverEvent } from 'os-code/protocol';
import type { ChangedFile, ThreadItem, ThreadState } from './types.js';

let seq = 0;
function uid(): string {
  return `t${Date.now().toString(36)}_${seq++}`;
}

/** Omit that distributes over each member of the ThreadItem union. */
type ItemDraft = ThreadItem extends infer T
  ? T extends ThreadItem
    ? Omit<T, 'id'> & { id?: string }
    : never
  : never;

// The in-memory ceiling on a thread's items. A long desktop session's journal
// replays in full; past this many rows the oldest fall away from memory (the
// engine journal keeps the whole record), so a marathon session never grows
// the renderable state without bound. Above the persisted trim (200) so a
// reopened chat still shows generous history.
const MAX_ITEMS = 600;

function push(state: ThreadState, item: ItemDraft): ThreadState {
  const items = [...state.items, { id: uid(), ...item } as ThreadItem];
  return { ...state, items: items.length > MAX_ITEMS ? items.slice(-MAX_ITEMS) : items };
}

function currentStreaming(state: ThreadState): number {
  const last = state.items[state.items.length - 1];
  return last && last.kind === 'assistant' && last.streaming ? state.items.length - 1 : -1;
}

function currentThinking(state: ThreadState): number {
  const last = state.items[state.items.length - 1];
  return last && last.kind === 'thinking' && last.streaming ? state.items.length - 1 : -1;
}

/** Close any open streaming bubble (keep its text as final). */
function settleStreaming(state: ThreadState): ThreadState {
  const idx = currentStreaming(state);
  if (idx === -1) return state;
  const items = [...state.items];
  const bubble = items[idx] as Extract<ThreadItem, { kind: 'assistant' }>;
  if (!bubble.text.trim()) {
    items.splice(idx, 1);
  } else {
    items[idx] = { ...bubble, streaming: false };
  }
  return { ...state, items };
}

/** Close an open thinking block (the model moved on to text or a tool). */
function settleThinking(state: ThreadState): ThreadState {
  const idx = currentThinking(state);
  if (idx === -1) return state;
  const items = [...state.items];
  const block = items[idx] as Extract<ThreadItem, { kind: 'thinking' }>;
  if (!block.text.trim()) {
    items.splice(idx, 1);
  } else {
    items[idx] = { ...block, streaming: false, endedAt: Date.now() };
  }
  return { ...state, items };
}

function settleAll(state: ThreadState): ThreadState {
  return settleThinking(settleStreaming(state));
}

export function reduceEvent(state: ThreadState, event: DriverEvent, atSeq?: number): ThreadState {
  const next = atSeq !== undefined ? { ...state, lastSeq: Math.max(state.lastSeq, atSeq) } : state;

  switch (event.type) {
    case 'task-start':
      return push(
        {
          ...next,
          busy: true,
          busySince: Date.now(),
          stepNote: 'Thinking',
          citations: [],
          changedFiles: [],
        },
        { kind: 'user', text: event.input },
      );

    case 'turn-start':
      return { ...next, model: { name: event.model, kind: event.providerKind } };

    case 'text-delta': {
      const idx = currentStreaming(next);
      if (idx === -1) {
        return push(
          { ...settleThinking(next), stepNote: 'Writing' },
          { kind: 'assistant', text: event.text, streaming: true, model: next.model?.name },
        );
      }
      const items = [...next.items];
      const bubble = items[idx] as Extract<ThreadItem, { kind: 'assistant' }>;
      items[idx] = { ...bubble, text: bubble.text + event.text };
      return { ...next, items };
    }

    case 'thinking-delta': {
      const idx = currentThinking(next);
      if (idx === -1) {
        return push(
          { ...settleStreaming(next), stepNote: 'Thinking' },
          { kind: 'thinking', text: event.text, streaming: true, startedAt: Date.now() },
        );
      }
      const items = [...next.items];
      const block = items[idx] as Extract<ThreadItem, { kind: 'thinking' }>;
      items[idx] = { ...block, text: block.text + event.text };
      return { ...next, items };
    }

    case 'text-final': {
      // Replace the streamed bubble with the final text (the engine may have
      // cleaned tool-call JSON out of it).
      const settled = settleThinking(next);
      const idx = currentStreaming(settled);
      if (idx === -1) {
        return event.text
          ? push(settled, {
              kind: 'assistant',
              text: event.text,
              streaming: false,
              model: settled.model?.name,
            })
          : settled;
      }
      const items = [...settled.items];
      const bubble = items[idx] as Extract<ThreadItem, { kind: 'assistant' }>;
      if (event.text) {
        items[idx] = { ...bubble, text: event.text, streaming: false };
      } else {
        items.splice(idx, 1);
      }
      return { ...settled, items };
    }

    case 'tool-start': {
      const settled = settleAll(next);
      const summary = describeCall(event.call.name, event.call.args);
      return push(
        { ...settled, stepNote: summary },
        {
          kind: 'tool',
          id: `tool_${event.call.id}`,
          name: event.call.name,
          summary,
          path: pathOf(event.call.args),
          state: 'running',
          startedAt: Date.now(),
        },
      );
    }

    case 'tool-end': {
      const id = `tool_${event.call.id}`;
      const stats = statsFrom(event.result.content, event.result.diffText);
      const items = next.items.map((item) =>
        item.kind === 'tool' && item.id === id
          ? {
              ...item,
              state: (event.result.ok ? 'ok' : 'fail') as 'ok' | 'fail',
              durationMs: event.durationMs,
              summary: describeResult(event.call.name, event.call.args, event.result),
              ...(stats ? { stats } : {}),
              // An edit tool carries a unified diff; every other tool (shell
              // above all) carries plain content. Keep the full content as the
              // expandable detail so the phone can actually read a command's
              // output, and mark which renderer it wants.
              detail: event.result.diffText ?? event.result.content ?? undefined,
              detailKind: (event.result.diffText ? 'diff' : 'output') as 'diff' | 'output',
            }
          : item,
      );
      // A successful edit or write joins the task's changed-files record.
      let changedFiles = next.changedFiles;
      const path = pathOf(event.call.args);
      if (event.result.ok && path && /^(editFile|writeFile)$/.test(event.call.name)) {
        changedFiles = mergeChanged(changedFiles, {
          path,
          added: stats?.added ?? 0,
          removed: stats?.removed ?? 0,
          toolItemId: id,
        });
      }
      return { ...next, items, changedFiles, stepNote: 'Thinking' };
    }

    case 'tool-denied': {
      const items = next.items.map((item) =>
        item.kind === 'tool' && item.id === `tool_${event.call.id}`
          ? { ...item, state: 'denied' as const, summary: event.reason }
          : item,
      );
      // The denial may arrive before a tool-start rendered (permission deny).
      if (!items.some((i) => i.kind === 'tool' && i.id === `tool_${event.call.id}`)) {
        return push(settleAll(next), {
          kind: 'tool',
          id: `tool_${event.call.id}`,
          name: event.call.name,
          summary: event.reason,
          state: 'denied',
        });
      }
      return { ...next, items };
    }

    case 'todos':
      return {
        ...next,
        todos: event.items.map((i) => ({ content: i.content, status: i.status, owner: i.owner })),
      };

    case 'plan-proposed': {
      // The plan is the final text of the turn. Turn that bubble into the plan
      // card (with its buttons) rather than showing the same words twice.
      const items = [...next.items];
      const last = items[items.length - 1];
      if (last && last.kind === 'assistant' && last.text.trim() === event.text.trim()) {
        items[items.length - 1] = {
          kind: 'plan',
          id: last.id,
          text: event.text,
          status: 'proposed',
        };
        return { ...next, items };
      }
      return push(next, { kind: 'plan', text: event.text, status: 'proposed' });
    }

    case 'mode':
      return { ...next, mode: event.mode };

    case 'repo-info':
      return { ...next, repo: { cwd: event.cwd, branch: event.branch, dirty: event.dirty } };

    case 'title':
      return { ...next, title: event.title };

    case 'citations':
      return {
        ...next,
        citations: dedupeCitations([
          ...next.citations,
          ...event.citations.map((c) => ({ title: c.title, url: c.url })),
        ]),
      };

    case 'status':
      return push(next, { kind: 'status', text: event.message });

    case 'note':
      return push(next, { kind: 'note', text: event.message });

    case 'clarify':
      return push(next, {
        kind: 'clarify',
        summary: event.summary,
        questions: event.questions,
      });

    case 'usage':
      return {
        ...next,
        dollars: next.dollars + event.dollars,
        contextPercent: event.contextPercent,
        lastTurn: { promptTokens: event.promptTokens, completionTokens: event.completionTokens },
      };

    case 'model-switch':
      return push(
        { ...next, model: { name: event.model, kind: event.providerKind } },
        { kind: 'note', text: `Switched to ${event.model}: ${event.reason}` },
      );

    case 'task-done': {
      const settled = settleAll(next);
      let done: ThreadState = {
        ...settled,
        busy: false,
        busySince: undefined,
        stepNote: undefined,
        pendingApprovals: [],
      };
      if (event.reason !== 'complete') {
        return push(done, {
          kind: 'stopped',
          message: event.message ?? `Stopped: ${event.reason}`,
        });
      }
      if (done.changedFiles.length) {
        done = push({ ...done, changedFiles: [] }, { kind: 'changed', files: done.changedFiles });
      }
      return done;
    }

    case 'approval-request':
      return {
        ...next,
        stepNote: 'Waiting for your approval',
        pendingApprovals: [...next.pendingApprovals, event.request],
      };

    case 'approval-resolved':
      return {
        ...next,
        pendingApprovals: next.pendingApprovals.filter((a) => a.id !== event.id),
      };

    case 'command-start': {
      const settled = settleAll(next);
      return push(settled, {
        kind: 'command',
        id: `cmd_${event.runId}`,
        runId: event.runId,
        command: event.command,
        output: '',
        state: 'running',
      });
    }

    case 'command-output': {
      const items = next.items.map((item) =>
        item.kind === 'command' && item.runId === event.runId
          ? { ...item, output: capOutput(item.output + event.chunk) }
          : item,
      );
      return { ...next, items };
    }

    case 'command-end': {
      const items = next.items.map((item) =>
        item.kind === 'command' && item.runId === event.runId
          ? {
              ...item,
              // A kill lands as a null exit code or a signal; anything else is a
              // normal finish (exit 0 or not).
              state: (event.exitCode === null ? 'killed' : 'done') as 'done' | 'killed',
              exitCode: event.exitCode,
              durationMs: event.durationMs,
              truncated: event.truncated,
            }
          : item,
      );
      return { ...next, items };
    }

    default:
      return next;
  }
}

export function reduceEvents(
  state: ThreadState,
  events: Array<{ event: DriverEvent; seq?: number }>,
): ThreadState {
  return events.reduce((acc, { event, seq: s }) => reduceEvent(acc, event, s), state);
}

/** First user message, trimmed, for auto-titling a conversation. */
export function titleFrom(state: ThreadState): string | undefined {
  if (state.title) return state.title;
  const user = state.items.find((i) => i.kind === 'user');
  return user && user.kind === 'user' ? user.text.slice(0, 48) : undefined;
}

// ---------------------------------------------------------------- summaries
// Per-tool one-liners, the way Claude Code names each step ("Read src/x.ts
// (lines 1-120)", "Edit src/x.ts (+12 -3)") instead of dumping the args.

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

function pathOf(args: Record<string, unknown>): string | undefined {
  return str(args.path);
}

export function describeCall(name: string, args: Record<string, unknown>): string {
  const path = str(args.path);
  switch (name) {
    case 'readFile': {
      const a = num(args.startLine);
      const b = num(args.endLine);
      return `Read ${path ?? ''}${a || b ? ` (lines ${a ?? 1}-${b ?? 'end'})` : ''}`.trim();
    }
    case 'editFile':
      return `Edit ${path ?? ''}`.trim();
    case 'writeFile':
      return `Write ${path ?? ''}`.trim();
    case 'grep': {
      const scope = str(args.glob);
      return `Search /${str(args.pattern) ?? ''}/${scope ? ` in ${scope}` : ''}`;
    }
    case 'glob':
      return `Find ${str(args.pattern) ?? ''}`;
    case 'runShell':
      return `$ ${(str(args.command) ?? '').slice(0, 90)}`;
    case 'webSearch':
      return `Search the web: ${(str(args.query) ?? '').slice(0, 70)}`;
    case 'webFetch':
      return `Fetch ${(str(args.url) ?? '').slice(0, 80)}`;
    case 'searchRepo':
      return `Search the repo for ${(str(args.query) ?? '').slice(0, 60)}`;
    case 'gitStatus':
      return 'Git status';
    case 'gitDiff':
      return `Git diff${path ? ` ${path}` : ''}${args.staged ? ' (staged)' : ''}`;
    case 'gitCommit':
      return `Commit: ${(str(args.message) ?? '').split('\n')[0]!.slice(0, 70)}`;
    case 'delegate':
      return `Ask the ${str(args.role) ?? 'specialist'} specialist`;
    case 'todoWrite': {
      const items = Array.isArray(args.items) ? args.items : [];
      const done = items.filter(
        (i) => typeof i === 'object' && i && (i as { status?: string }).status === 'completed',
      ).length;
      return `Update task list (${done}/${items.length} done)`;
    }
    case 'readTerminal':
      return 'Read the terminal';
    case 'vaultRead':
      return `Read vault note ${path ?? ''}`.trim();
    case 'vaultWrite':
      return `Write vault note ${path ?? ''}`.trim();
    case 'vaultList':
      return 'List vault notes';
    case 'analyzeImage':
      return `Look at the image: ${(str(args.question) ?? '').slice(0, 60)}`;
    case 'generateImage':
      return `Generate an image: ${(str(args.prompt) ?? '').slice(0, 60)}`;
    default:
      return summarizeArgs(args);
  }
}

export function describeResult(
  name: string,
  args: Record<string, unknown>,
  result: { ok: boolean; content: string; diffText?: string },
): string {
  const base = describeCall(name, args);
  if (!result.ok) return `${base}: ${firstLine(result.content)}`;
  const stats = statsFrom(result.content, result.diffText);
  switch (name) {
    case 'editFile':
    case 'writeFile':
      return stats ? `${base} (+${stats.added} -${stats.removed})` : base;
    case 'readFile': {
      const m = /lines\s+(\d+)-(\d+)\s+of\s+(\d+)/i.exec(result.content);
      return m ? `Read ${str(args.path) ?? ''} (lines ${m[1]}-${m[2]} of ${m[3]})` : base;
    }
    case 'grep':
    case 'glob':
    case 'searchRepo': {
      const lines = result.content.split('\n').filter((l) => l.trim()).length;
      return `${base}: ${lines} ${lines === 1 ? 'match' : 'matches'}`;
    }
    case 'runShell': {
      const m = /exit(?:ed)?\s*(?:code\s*)?(\d+)/i.exec(result.content);
      return m && m[1] !== '0' ? `${base} (exit ${m[1]})` : base;
    }
    default:
      return base;
  }
}

/** "+N -M" from an edit result line or a unified diff. */
export function statsFrom(
  content: string,
  diffText?: string,
): { added: number; removed: number } | undefined {
  const m = /\(\+(\d+)\s+-(\d+)\)/.exec(content);
  if (m) return { added: Number(m[1]), removed: Number(m[2]) };
  if (!diffText) return undefined;
  let added = 0;
  let removed = 0;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return added || removed ? { added, removed } : undefined;
}

function mergeChanged(list: ChangedFile[], file: ChangedFile): ChangedFile[] {
  const idx = list.findIndex((f) => f.path === file.path);
  if (idx === -1) return [...list, file];
  const prev = list[idx]!;
  const merged: ChangedFile = {
    path: prev.path,
    added: prev.added + file.added,
    removed: prev.removed + file.removed,
    toolItemId: file.toolItemId ?? prev.toolItemId,
  };
  return [...list.slice(0, idx), merged, ...list.slice(idx + 1)];
}

function summarizeArgs(args: Record<string, unknown>): string {
  if (typeof args.path === 'string') return args.path;
  if (typeof args.command === 'string') return args.command.slice(0, 80);
  if (typeof args.query === 'string') return args.query.slice(0, 80);
  if (typeof args.url === 'string') return args.url.slice(0, 80);
  const text = JSON.stringify(args);
  return text === '{}' ? '' : text.slice(0, 80);
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').slice(0, 100);
}

// Client-side cap on a command card's live output, matching the daemon's own
// per-run emit cap: keep the tail, so a flood never grows the transcript state
// without bound.
const COMMAND_OUTPUT_CAP = 200_000;
function capOutput(text: string): string {
  return text.length > COMMAND_OUTPUT_CAP ? text.slice(text.length - COMMAND_OUTPUT_CAP) : text;
}

function dedupeCitations(citations: Array<{ title: string; url: string }>) {
  const seen = new Set<string>();
  return citations.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}
