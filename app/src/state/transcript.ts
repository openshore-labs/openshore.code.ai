// The transcript reducer: one pure function folds the engine's DriverEvent
// stream into the ThreadState the chat renders. Local model, desktop stack,
// cloud, replayed journal: same events, same reducer, same UI. Kept free of
// React so it is exhaustively testable.
import { chatTitle } from '../lib/chatTitle.js';
import type { DriverEvent } from 'os-code/protocol';
import type { ChangedFile, ConversationSource, ThreadItem, ThreadState } from './types.js';
import { providerInfo } from '../lib/providers.js';
import { categoryLabel, type StackCategory } from '../lib/stack.js';
import { isLocalOnlyFinal } from '../drivers/types.js';
import { windowCutItem } from './securityOps.js';
import { rewindThread } from './rewindOps.js';
import { retrievalItem, windowTightItem } from './harnessOps.js';

/** The go-ahead the app sends when a plan is approved. The reducer reads it
 *  back on replay: a task that starts with this line means the plan before
 *  it was accepted, so a reopened chat never revives a settled plan card. */
export const PLAN_APPROVAL_LINE = 'The plan is approved. Proceed with it.';

/** The working row's note while a send is on its way to a paired computer
 *  and the hub has not echoed it yet. Set by the store on an optimistic
 *  task-start; the hub's own task-start (folded into the same bubble below)
 *  turns it back into plain Thinking. */
export const REACHING_COMPUTER = 'Reaching your computer';

/** How many items of a desktop thread the phone keeps as a read-only tail, so
 *  a reopen with the computer off still shows what was said. */
export const SNAPSHOT_ITEMS = 50;

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
    case 'task-start': {
      // The hub's echo of a send the phone already painted (the store adds
      // the user bubble the moment the text leaves, so the first turn is
      // visible before the computer answers): the same text, while that
      // local task is still open with nothing after it, is one bubble.
      // The echo carries the journal's seq, which a rewind names (P2).
      const journaled = atSeq !== undefined && atSeq >= 1 ? { seq: atSeq } : {};
      const last = next.items[next.items.length - 1];
      if (next.busy && last && last.kind === 'user' && last.text === event.input) {
        const items = atSeq ? [...next.items.slice(0, -1), { ...last, ...journaled }] : next.items;
        return { ...next, items, stepNote: 'Thinking' };
      }
      // The go-ahead line settles the plan it answers, live or on replay.
      const items =
        event.input === PLAN_APPROVAL_LINE
          ? next.items.map((i) =>
              i.kind === 'plan' && i.status === 'proposed'
                ? { ...i, status: 'approved' as const }
                : i,
            )
          : next.items;
      return push(
        {
          ...next,
          items,
          busy: true,
          busySince: Date.now(),
          stepNote: 'Thinking',
          citations: [],
          changedFiles: [],
          // The last task's list is done with; the new task writes its own.
          todos: [],
        },
        { kind: 'user', text: event.input, ...journaled },
      );
    }

    case 'turn-start':
      return { ...next, model: { name: event.model, kind: event.providerKind } };

    case 'reach':
      // A handoff is about to go to a model off this network (UX and copy review,
      // 2026-10-08, D): the turn reads cloud from here, under the turn's own
      // model name, the way a cloud turn-start would set it.
      return {
        ...next,
        model: { name: next.model?.name ?? event.model, kind: event.providerKind },
      };

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
      // The reply followed a local-only read (I5): the bubble keeps the mark,
      // so a switch seeds the stub to a leaving seat and a handoff drops it.
      const mark = isLocalOnlyFinal(event) ? { localOnly: true as const } : {};
      if (idx === -1) {
        return event.text
          ? push(settled, {
              kind: 'assistant',
              text: event.text,
              streaming: false,
              model: settled.model?.name,
              ...mark,
            })
          : settled;
      }
      const items = [...settled.items];
      const bubble = items[idx] as Extract<ThreadItem, { kind: 'assistant' }>;
      if (event.text) {
        items[idx] = { ...bubble, text: event.text, streaming: false, ...mark };
      } else {
        items.splice(idx, 1);
      }
      return { ...settled, items };
    }

    case 'tool-start': {
      const settled = settleAll(next);
      // A handoff names the model it goes to, and one off this network wears
      // the Cloud chip (D); an older engine sends no handoff field.
      const handoff = event.handoff;
      const summary = describeCall(event.call.name, event.call.args, handoff);
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
          ...(handoff ? { handoff: { model: handoff.model, leaves: handoff.leaves } } : {}),
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
              summary: describeResult(event.call.name, event.call.args, event.result, item.handoff),
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

    case 'repo-info': {
      // The person's commands ride only when their list changed, so a
      // repo-info without them keeps the last list this chat saw.
      const commands = event.commands ?? next.repo?.commands;
      const commandsNotLoaded = event.commands
        ? event.commandsNotLoaded
        : next.repo?.commandsNotLoaded;
      return {
        ...next,
        repo: {
          cwd: event.cwd,
          branch: event.branch,
          dirty: event.dirty,
          ...(commands ? { commands } : {}),
          ...(commandsNotLoaded ? { commandsNotLoaded } : {}),
        },
      };
    }

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

    case 'status': {
      // While the thread waits on a first token (nothing writing, no tool
      // running, no question pending) a status names the wait, so the working
      // row reads "Warming up Harbor on this device" rather than a generic
      // word. The line still lands in the transcript as the durable record.
      const waiting =
        next.busy &&
        next.stepNote !== 'Writing' &&
        next.pendingApprovals.length === 0 &&
        !next.items.some((i) => i.kind === 'tool' && i.state === 'running');
      return push(waiting ? { ...next, stepNote: waitNote(event.message) } : next, {
        kind: 'status',
        text: event.message,
      });
    }

    case 'note':
      return push(next, { kind: 'note', text: event.message });

    case 'verify':
      // The harness checked the task's work: the project's own tests, or the
      // page check that runs nothing (v1 Phase 1). One plain pill; a failure
      // going back to the model says so, so the last pill is the verdict.
      return push(next, {
        kind: 'verify',
        passed: event.passed,
        check: event.check ?? 'tests',
        summary: event.summary,
        ...(event.detail ? { detail: event.detail } : {}),
        retrying: Boolean(event.willRetry),
      });

    case 'checkpoint': {
      // The engine's record of every file the task changed (shell writes
      // included). It joins the task's changed-files card, or makes one when
      // the task changed files only through commands or stopped early.
      const since = lastUserIndex(next.items);
      let at = -1;
      for (let i = next.items.length - 1; i > since; i--) {
        if (next.items[i]!.kind === 'changed') {
          at = i;
          break;
        }
      }
      const ranCommands = next.items
        .slice(since + 1)
        .some((i) => i.kind === 'tool' && (i.name === 'runShell' || i.name === 'startProcess'));
      if (at === -1) {
        return push(next, {
          kind: 'changed',
          files: event.files.map((f) => ({ path: f.path, added: 0, removed: 0, status: f.status })),
          checkpointId: event.id,
          ...(ranCommands ? { ranCommands } : {}),
        });
      }
      const items = next.items.map((item, i) => {
        if (i !== at || item.kind !== 'changed') return item;
        const files = [...item.files];
        for (const f of event.files) {
          const existing = files.findIndex((row) => row.path === f.path);
          if (existing === -1) files.push({ path: f.path, added: 0, removed: 0, status: f.status });
          else files[existing] = { ...files[existing]!, status: f.status };
        }
        return { ...item, files, checkpointId: event.id, ...(ranCommands ? { ranCommands } : {}) };
      });
      return { ...next, items };
    }

    case 'checkpoint-restored': {
      // An undo or redo landed (from this device or another): the card with
      // that checkpoint marks the files put back, or clears them on redo.
      const items = next.items.map((item) => {
        if (item.kind !== 'changed' || item.checkpointId !== event.id) return item;
        const undone = new Set(item.undone ?? []);
        for (const p of event.paths) {
          if (event.direction === 'undo') undone.add(p);
          else undone.delete(p);
        }
        return { ...item, undone: [...undone], restoring: false, error: undefined };
      });
      return { ...next, items };
    }

    case 'rewound':
      // A rewind (P2): the turns from the rewound message up to this marker
      // are taken back, live or on replay, on every device, and a quiet line
      // says what happened to the files (state/rewindOps.ts).
      return rewindThread(next, event);

    case 'project-trust': {
      if (event.state === 'trusted') {
        const has = next.items.some((i) => i.kind === 'trust');
        if (!has) {
          return push(next, {
            kind: 'note',
            text: 'This folder is trusted on this computer. Its own settings apply from your next chat here.',
          });
        }
        const items = next.items.map((i) =>
          i.kind === 'trust' ? { ...i, state: 'trusted' as const, error: undefined } : i,
        );
        return { ...next, items };
      }
      return push(next, {
        kind: 'trust',
        folder: event.folder,
        waiting: event.waiting,
        state: event.state,
      });
    }

    case 'window-cut':
      // The server cut the chat to fit (C1): a teal card once per chat per
      // model, mapped in the security package's module (tech review 9).
      return push(next, windowCutItem(event));

    case 'window-tight':
      // Even the lean prompt fills most of the window (tech review 6): the same card
      // family, once per chat per model, mapped in the harness's module.
      return push(next, windowTightItem(event));

    case 'retrieval':
      // The places in the code a local seat was given before its first turn.
      return push(next, retrievalItem(event));

    case 'harness-current':
      // A Harness Current (Jev) made a cheap decision this turn. Shown as a
      // note carrying the honest line; a client may style it as spend when
      // `spend` is true. A dedicated card is a fast follow.
      return push(next, { kind: 'note', text: event.line });

    case 'context-pack': {
      // The Vault context this task's seat was given. The engine sends it at
      // the task's first render and again only when the sources change (an
      // escalation to another seat), so the task keeps one card: a repeat
      // within the same task updates it in place.
      const card = {
        kind: 'context-pack' as const,
        seat: event.seat,
        mode: event.mode,
        sources: event.sources.map((s) => ({ layer: s.layer, path: s.path, title: s.title })),
        withheld: event.withheld,
        cold: event.cold,
      };
      for (let i = next.items.length - 1; i >= 0; i--) {
        const item = next.items[i]!;
        if (item.kind === 'user') break;
        if (item.kind === 'context-pack') {
          const items = [...next.items];
          items[i] = { ...card, id: item.id };
          return { ...next, items };
        }
      }
      // An empty pack (nothing used, nothing held back) has nothing to say.
      if (!card.sources.length && !card.withheld) return next;
      return push(settleAll(next), card);
    }

    case 'image-reader-offer':
      // Nothing here can read images (2026-10-07): a calm card with
      // two doors, after whatever answer the turn gave.
      return push(settleAll(next), {
        kind: 'image-offer',
        from: event.from,
        cloud: event.cloud,
        ...(event.placed ? { placed: { ...event.placed } } : {}),
        ...(event.status ? { status: event.status } : {}),
      });

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
        totalTokens: {
          promptTokens: (next.totalTokens?.promptTokens ?? 0) + event.promptTokens,
          completionTokens: (next.totalTokens?.completionTokens ?? 0) + event.completionTokens,
        },
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
      // The person's own Stop (UX review ruling 5): the partial answer stays where it
      // is, and a muted marker says who stopped it and whether any of the
      // answer had arrived. Every driver's stop reads the same.
      if (event.reason === 'aborted') {
        return push(done, {
          kind: 'stopped',
          message: answeredThisTurn(done) ? STOPPED_BY_YOU : STOPPED_BEFORE_ANSWER,
          byYou: true,
        });
      }
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
        ...(event.source === 'agent' ? { source: 'agent' as const } : {}),
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

    case 'ethics-block': {
      // An input block: the message never reached a model, so its bubble is
      // marked and a reseed leaves it (and the refusal answering it) out.
      if (event.side !== 'input') return next;
      let at = -1;
      for (let i = next.items.length - 1; i >= 0; i--) {
        if (next.items[i]!.kind === 'user') {
          at = i;
          break;
        }
      }
      if (at === -1) return next;
      const items = [...next.items];
      items[at] = { ...(items[at] as Extract<ThreadItem, { kind: 'user' }>), withheld: true };
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

/** A chat's name from its first user message (lib/chatTitle.ts), for
 *  auto-titling a conversation. */
export function titleFrom(state: ThreadState): string | undefined {
  if (state.title) return state.title;
  const user = state.items.find((i) => i.kind === 'user');
  return user && user.kind === 'user' ? chatTitle(user.text) : undefined;
}

/** The name the old rule gave (the first 48 characters, cut anywhere), so a
 *  launch can tell an untouched auto-name from one the person chose. */
export function legacyTitleFrom(state: ThreadState): string | undefined {
  const user = state.items.find((i) => i.kind === 'user');
  return user && user.kind === 'user' ? user.text.slice(0, 48) : undefined;
}

/** A status line as a working-row note: the sentence without its full stop. */
/** The marker under a turn the person stopped once some of it arrived. */
export const STOPPED_BY_YOU = 'Stopped by you.';
/** The marker when the person stopped a turn before any of it arrived. */
export const STOPPED_BEFORE_ANSWER = 'Stopped before it answered.';

/** Whether any words of an answer arrived since the person's last message. */
function answeredThisTurn(thread: ThreadState): boolean {
  for (let i = thread.items.length - 1; i >= 0; i--) {
    const item = thread.items[i]!;
    if (item.kind === 'user') return false;
    if (item.kind === 'assistant' && item.text.trim()) return true;
  }
  return false;
}

function waitNote(message: string): string {
  return message.trim().replace(/\.$/, '');
}

/** The /cost line. A chat on the person's own cloud key is billed by that
 *  provider, and OpenShore prices nothing, so it names the account and the
 *  tokens instead of inventing a dollar figure. A chat that runs on the
 *  person's own hardware says it is free. An engine session that reports real
 *  spend (a cloud orchestrator) prints it. */
export function costSummary(thread: ThreadState, source: ConversationSource): string {
  const context = `Context ${thread.contextPercent}% full.`;
  const turn = thread.lastTurn
    ? ` Last turn: ${thread.lastTurn.promptTokens.toLocaleString()} in, ${thread.lastTurn.completionTokens.toLocaleString()} out.`
    : '';
  if (source.kind === 'cloud') {
    const name =
      source.provider === 'anthropic'
        ? 'Claude'
        : (providerInfo(source.provider)?.name ?? source.provider);
    const total = thread.totalTokens ?? { promptTokens: 0, completionTokens: 0 };
    return `Billed to your ${name} account. ${total.promptTokens.toLocaleString()} in, ${total.completionTokens.toLocaleString()} out this chat. ${context}`;
  }
  if (thread.dollars > 0) return `$${thread.dollars.toFixed(2)} this chat. ${context}${turn}`;
  return `Free: this chat runs on your own hardware. ${context}${turn}`;
}

/** The bounded, read-only tail of a desktop thread the phone keeps on disk
 *  and shows on reopen until the journal replays over it. Nothing in it is
 *  live: no busy state, no open question, no streaming caret, no counter on
 *  a tool that was mid-flight when the snapshot was taken. */
export function snapshotThread(thread: ThreadState): ThreadState {
  const items = thread.items.slice(-SNAPSHOT_ITEMS).map((item): ThreadItem => {
    if ((item.kind === 'assistant' || item.kind === 'thinking') && item.streaming) {
      return { ...item, streaming: false };
    }
    if (item.kind === 'tool' && item.state === 'running') {
      const { startedAt: _live, ...rest } = item;
      return rest;
    }
    return item;
  });
  return {
    items,
    citations: [],
    busy: false,
    contextPercent: thread.contextPercent,
    dollars: thread.dollars,
    lastTurn: thread.lastTurn,
    totalTokens: thread.totalTokens,
    pendingApprovals: [],
    todos: [],
    queued: [],
    changedFiles: [],
    repo: thread.repo,
    mode: thread.mode,
    model: thread.model,
    title: thread.title,
    lastSeq: 0,
  };
}

// ---------------------------------------------------------------- summaries
// Per-tool one-liners, the way Claude Code names each step ("Read src/x.ts
// (lines 1-120)", "Edit src/x.ts (+12 -3)") instead of dumping the args.

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

function pathOf(args: Record<string, unknown>): string | undefined {
  return str(args.path);
}

/** A delegate role as the Stack names it, lowercased ("coding", "fast"). */
function roleWord(role: string): string {
  return categoryLabel(role as StackCategory).toLowerCase();
}

/** Where a handoff goes (the engine's tool-start `handoff`, D): the model the
 *  step goes to and whether it leaves this network. */
export interface CallHandoff {
  model: string;
  leaves: boolean;
}

export function describeCall(
  name: string,
  args: Record<string, unknown>,
  handoff?: CallHandoff,
): string {
  const path = str(args.path);
  // A handoff names the model it goes to (UX and copy review, 2026-10-08, D); an
  // older engine, and a role the Reasoning model took itself, keep the words
  // below.
  if (handoff) {
    if (name === 'delegate') {
      return `Ask ${handoff.model}, your ${roleWord(str(args.role) ?? 'specialist')} model`;
    }
    if (name === 'analyzeImage') {
      return `Look at the image with ${handoff.model}: ${(str(args.question) ?? '').slice(0, 60)}`;
    }
    if (name === 'generateImage') {
      return `Generate an image with ${handoff.model}: ${(str(args.prompt) ?? '').slice(0, 60)}`;
    }
  }
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
    case 'startProcess':
      return `Start: ${(str(args.command) ?? '').slice(0, 84)}`;
    case 'readProcess':
      return "Read a program's output";
    case 'stopProcess':
      return 'Stop a program';
    case 'webSearch':
      return `Search the web: ${(str(args.query) ?? '').slice(0, 70)}`;
    case 'webFetch':
      return `Fetch ${(str(args.url) ?? '').slice(0, 80)}`;
    case 'searchRepo':
      return `Search the repository for ${(str(args.query) ?? '').slice(0, 60)}`;
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
  handoff?: CallHandoff,
): string {
  const base = describeCall(name, args, handoff);
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

/** The index of the last message the person sent (-1 when none): the start of
 *  the task a late event belongs to. */
function lastUserIndex(items: ThreadItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.kind === 'user') return i;
  return -1;
}
