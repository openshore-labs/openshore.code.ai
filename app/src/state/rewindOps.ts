// Rewind (P2): the store logic for taking a chat back to one of the person's
// own messages (CTO ruling 9: a sibling module, store.ts only wires it in).
// A coding chat's brain is an engine session on the person's computer, which
// checkpoints every task, so the engine does the work there: the chat and,
// when asked, the folder's files. Its `rewound` marker cuts the transcript on
// every device, live or on replay. Any other chat's brain keeps its history
// in the app, so the app cuts the thread itself and the brain is rebuilt from
// what is left, the way a reopened chat's is.
import type { DriverEvent } from 'os-code/protocol';
import type { ChatDriver } from '../drivers/types.js';
import type { ConversationSource, ThreadItem, ThreadState } from './types.js';

type RewoundEvent = Extract<DriverEvent, { type: 'rewound' }>;

/** The quiet action on the person's own message. */
export const REWIND_ACTION = 'Rewind to here';
/** The sheet's title. */
export const REWIND_TITLE = 'Rewind to this message?';
/** What a rewind does to the chat, on every sheet. */
export const REWIND_BODY =
  'The chat goes back to just before this message, and your message returns to the box so you can change it.';
/** What going back with the files means, on a coding chat's sheet. */
export const REWIND_FILES_LINE =
  'Files in this folder go back. Commits, pushes, and changes outside this folder stay.';
/** The coding chat's two choices. */
export const REWIND_WITH_FILES = 'Rewind chat and files';
export const REWIND_CHAT_ONLY = 'Rewind chat only';
/** The one choice when there are no files to put back. */
export const REWIND_CHAT = 'Rewind chat';
/** The phone's long press keeps a way to copy the words (the hold replaces
 *  text selection on the bubble). */
export const REWIND_COPY = 'Copy message';
/** A coding chat whose computer is not connected right now. */
export const REWIND_NO_COMPUTER =
  'This chat is not connected to your computer right now, so it cannot rewind.';
/** Asked while the chat is working, or for a message it no longer holds. */
export const REWIND_NOT_NOW = 'Wait for the current step to finish, then rewind.';

/** Whether a rewind can take this chat's files back too: an engine session
 *  checkpoints each task in its folder. Any other chat has no folder. */
export function rewindsFiles(source: ConversationSource): boolean {
  return source.kind === 'desktop';
}

/**
 * Whether the sheet offers the files for this message: a coding chat whose
 * later tasks changed files the engine checkpointed (their card carries the
 * checkpoint). With nothing checkpointed since, there is nothing to put back,
 * so the one choice is the chat; a sheet never offers what cannot happen.
 */
export function rewindOffersFiles(
  thread: ThreadState,
  itemId: string,
  source: ConversationSource,
): boolean {
  if (!rewindsFiles(source)) return false;
  const at = thread.items.findIndex((item) => item.id === itemId);
  if (at === -1) return false;
  return thread.items
    .slice(at + 1)
    .some((item) => item.kind === 'changed' && Boolean(item.checkpointId));
}

/**
 * The person's messages this chat can rewind to right now, oldest first. None
 * while the chat works or waits on the person (the engine refuses then too),
 * and none in the guided setup's chat, whose walk is keyed to its lines. On a
 * coding chat only a message the engine journaled (it has a seq) counts: a
 * send still on its way, or one the ethics layer held back, never reached it.
 */
export function rewindableIds(
  thread: ThreadState,
  source: ConversationSource,
  opts: { guided?: boolean } = {},
): string[] {
  if (opts.guided || thread.busy || thread.pendingApprovals.length) return [];
  const engine = rewindsFiles(source);
  return thread.items.flatMap((item) =>
    item.kind === 'user' && (!engine || ((item.seq ?? 0) >= 1 && !item.withheld)) ? [item.id] : [],
  );
}

let noteSeq = 0;
function noteId(): string {
  return `rw${Date.now().toString(36)}_${noteSeq++}`;
}

/** The quiet line a rewind leaves in the chat on every device. */
export function rewoundLine(event: { paths: string[]; kept?: string[] }): string {
  if (event.paths.length) return `Rewound to an earlier message. ${wentBack(event.paths)}`;
  if (event.kept?.length) return 'Rewound to an earlier message. The files stayed as they are.';
  return 'Rewound to an earlier message.';
}

function wentBack(paths: string[]): string {
  if (paths.length === 1) return `${paths[0]} went back.`;
  const shown = paths.slice(0, 3);
  const more = paths.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more went back.`;
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)} went back.`;
}

/** A thread with everything from `index` on taken back, nothing left
 *  working, and the rewind's line at the foot. */
function cutAt(thread: ThreadState, index: number, line: string): ThreadState {
  const items: ThreadItem[] = [
    ...(index === -1 ? thread.items : thread.items.slice(0, index)),
    { kind: 'note', id: noteId(), text: line },
  ];
  return {
    ...thread,
    items,
    busy: false,
    busySince: undefined,
    stepNote: undefined,
    pendingApprovals: [],
    changedFiles: [],
    todos: [],
    citations: [],
  };
}

/**
 * The transcript a `rewound` marker leaves: from the first message journaled
 * at or after `toSeq` on, gone. The same fold live and on replay, so the
 * desktop, a paired phone, and a reopened chat show the same conversation
 * the engine's seed gives the model.
 */
export function rewindThread(thread: ThreadState, event: RewoundEvent): ThreadState {
  const at = thread.items.findIndex(
    (item) => item.kind === 'user' && item.seq !== undefined && item.seq >= event.toSeq,
  );
  return cutAt(thread, at, rewoundLine(event));
}

/** A chat the app rewinds itself: its thread cut before one message. */
export function cutThread(thread: ThreadState, index: number): ThreadState {
  return cutAt(thread, index, rewoundLine({ paths: [] }));
}

/** Ask the engine to rewind a coding chat. Its marker folds the transcript
 *  on every device; the answer says whether it happened. */
export async function rewindEngine(
  driver: ChatDriver | undefined,
  seq: number,
  files: boolean,
): Promise<{ ok: true; paths: string[] } | { error: string }> {
  if (!driver?.rewind) return { error: REWIND_NO_COMPUTER };
  try {
    return await driver.rewind(seq, { files });
  } catch {
    return { error: 'Could not reach your computer to rewind.' };
  }
}
