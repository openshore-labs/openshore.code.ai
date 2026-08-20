// The transcript reducer: one pure function folds the engine's DriverEvent
// stream into the ThreadState the chat renders. Local model, desktop stack,
// cloud, replayed journal: same events, same reducer, same UI. Kept free of
// React so it is exhaustively testable.
import type { DriverEvent } from 'os-code/protocol';
import type { ThreadItem, ThreadState } from './types.js';

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

function push(state: ThreadState, item: ItemDraft): ThreadState {
  return { ...state, items: [...state.items, { id: uid(), ...item } as ThreadItem] };
}

function currentStreaming(state: ThreadState): number {
  const last = state.items[state.items.length - 1];
  return last && last.kind === 'assistant' && last.streaming ? state.items.length - 1 : -1;
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

export function reduceEvent(state: ThreadState, event: DriverEvent, atSeq?: number): ThreadState {
  const next = atSeq !== undefined ? { ...state, lastSeq: Math.max(state.lastSeq, atSeq) } : state;

  switch (event.type) {
    case 'task-start':
      return push({ ...next, busy: true, citations: [] }, { kind: 'user', text: event.input });

    case 'turn-start':
      return { ...next, model: { name: event.model, kind: event.providerKind } };

    case 'text-delta': {
      const idx = currentStreaming(next);
      if (idx === -1) {
        return push(next, { kind: 'assistant', text: event.text, streaming: true });
      }
      const items = [...next.items];
      const bubble = items[idx] as Extract<ThreadItem, { kind: 'assistant' }>;
      items[idx] = { ...bubble, text: bubble.text + event.text };
      return { ...next, items };
    }

    case 'thinking-delta':
      return next; // shown via the busy indicator, not the transcript

    case 'text-final': {
      // Replace the streamed bubble with the final text (the engine may have
      // cleaned tool-call JSON out of it).
      const idx = currentStreaming(next);
      if (idx === -1) {
        return event.text
          ? push(next, { kind: 'assistant', text: event.text, streaming: false })
          : next;
      }
      const items = [...next.items];
      if (event.text) {
        items[idx] = { kind: 'assistant', id: items[idx]!.id, text: event.text, streaming: false };
      } else {
        items.splice(idx, 1);
      }
      return { ...next, items };
    }

    case 'tool-start': {
      const settled = settleStreaming(next);
      return push(settled, {
        kind: 'tool',
        id: `tool_${event.call.id}`,
        name: event.call.name,
        summary: summarizeArgs(event.call.args),
        state: 'running',
      });
    }

    case 'tool-end': {
      const items = next.items.map((item) =>
        item.kind === 'tool' && item.id === `tool_${event.call.id}`
          ? {
              ...item,
              state: (event.result.ok ? 'ok' : 'fail') as 'ok' | 'fail',
              durationMs: event.durationMs,
              summary: firstLine(event.result.content) || item.summary,
              detail: event.result.diffText,
            }
          : item,
      );
      return { ...next, items };
    }

    case 'tool-denied': {
      const items = next.items.map((item) =>
        item.kind === 'tool' && item.id === `tool_${event.call.id}`
          ? { ...item, state: 'denied' as const, summary: event.reason }
          : item,
      );
      // The denial may arrive before a tool-start rendered (permission deny).
      if (!items.some((i) => i.kind === 'tool' && i.id === `tool_${event.call.id}`)) {
        return push(next, {
          kind: 'tool',
          id: `tool_${event.call.id}`,
          name: event.call.name,
          summary: event.reason,
          state: 'denied',
        });
      }
      return { ...next, items };
    }

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

    case 'usage':
      return {
        ...next,
        dollars: next.dollars + event.dollars,
        contextPercent: event.contextPercent,
      };

    case 'model-switch':
      return push(
        { ...next, model: { name: event.model, kind: event.providerKind } },
        { kind: 'note', text: `Switched to ${event.model}: ${event.reason}` },
      );

    case 'task-done': {
      const settled = settleStreaming(next);
      const done: ThreadState = { ...settled, busy: false, pendingApprovals: [] };
      if (event.reason !== 'complete') {
        return push(done, {
          kind: 'stopped',
          message: event.message ?? `Stopped: ${event.reason}`,
        });
      }
      return done;
    }

    case 'approval-request':
      return { ...next, pendingApprovals: [...next.pendingApprovals, event.request] };

    case 'approval-resolved':
      return {
        ...next,
        pendingApprovals: next.pendingApprovals.filter((a) => a.id !== event.id),
      };

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
  const user = state.items.find((i) => i.kind === 'user');
  return user && user.kind === 'user' ? user.text.slice(0, 48) : undefined;
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

function dedupeCitations(citations: Array<{ title: string; url: string }>) {
  const seen = new Set<string>();
  return citations.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}
