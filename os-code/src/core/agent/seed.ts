// Rebuild a coarse chat history from a session's journaled events, so a session
// rehydrated after a daemon restart continues the conversation instead of
// answering the next message with amnesia. It pairs each task-start (the user's
// message) with the text-final that followed (the assistant's reply). Tool
// calls and their results are omitted: the model does not need the tool
// transcript to keep the thread, and reconstructing it faithfully is not worth
// the risk of a malformed history. The system prompt is injected fresh on each
// run, so it is not seeded here.
//
// Privacy survives the restart (Vault M4, tech review I5): the tool results are not
// seeded, but a reply written after a tool read a local-only vault note (its
// journaled tool-end carries `localOnly`) may quote that note, so the reply
// comes back marked `localOnly` and a later turn on a seat that leaves this
// network gets the stub in its place, the same as the tool result would. So
// does a reply grounded in a pack that carried such a note, and one a seat on
// this network wrote while the chat already held a marked reply (D5). A task
// that came in marked local-only (its task-start says so, J) is seeded marked,
// and so is its reply.
//
// A rewind (P2) takes turns back: its `rewound` marker names the task-start it
// went back to, and everything journaled from there up to the marker is left
// out here, exactly as the app's transcript leaves it out, so a rehydrated
// session and a paired phone see the same conversation.
import type { ChatMessage } from '../../providers/types.js';
import type { DriverEvent } from './types.js';

/** One journaled event with its sequence number, as the driver keeps it. */
export interface JournalEntry {
  seq: number;
  event: DriverEvent;
}

/**
 * The journal as the chat now stands: every stretch a rewind took back (from
 * the rewound message's task-start up to its marker) is left out. The markers
 * themselves stay, since they say what the rewind did. A later rewind to an
 * earlier message takes an earlier marker back with the rest.
 */
export function liveJournal(entries: JournalEntry[]): JournalEntry[] {
  const cuts: Array<{ from: number; to: number }> = [];
  for (const { seq, event } of entries) {
    if (event.type === 'rewound') cuts.push({ from: event.toSeq, to: seq });
  }
  if (!cuts.length) return entries;
  return entries.filter(({ seq }) => !cuts.some((c) => seq >= c.from && seq < c.to));
}

/** Plain events carry no sequence numbers; read them as the journal numbers
 *  them (1 to N, in order). */
function asEntries(events: DriverEvent[] | JournalEntry[]): JournalEntry[] {
  return (events as Array<DriverEvent | JournalEntry>).map((e, i) =>
    'event' in e && 'seq' in e ? e : { seq: i + 1, event: e },
  );
}

export function seedHistoryFromEvents(journal: DriverEvent[] | JournalEntry[]): ChatMessage[] {
  const history: ChatMessage[] = [];
  let pendingUser: string | undefined;
  // The pending user turn came in marked local-only (a private plan's step,
  // J): it is seeded marked, and the chat holds a private note's text.
  let pendingLocal = false;
  const pushUser = (content: string): void => {
    history.push({ role: 'user', content, ...(pendingLocal ? { localOnly: true as const } : {}) });
  };
  // This task has read a local-only note (a tool, or a pack that carried
  // one), so what it says next may quote one.
  let readLocalOnly = false;
  // The chat holds a local-only note's text as the loop keeps it: a tool
  // result that read one, a turn on a pack that carried one (both stay in its
  // history even when that task wrote no reply), or a marked reply. A seat on
  // this network that replies after that was sent it, so its reply is marked:
  // the loop's own rule (loop.ts localOnlyMark).
  let holdsLocalOnly = false;
  let turnStays = false;
  for (const { event } of liveJournal(asEntries(journal))) {
    if (event.type === 'task-start') {
      // A new user turn. If a prior user turn never got a final answer (an
      // aborted or errored run), keep it: the user still said it.
      if (pendingUser !== undefined) pushUser(pendingUser);
      pendingUser = event.input;
      pendingLocal = event.localOnly === true;
      readLocalOnly = pendingLocal;
      if (pendingLocal) holdsLocalOnly = true;
    } else if (event.type === 'turn-start') {
      turnStays = event.providerKind === 'local';
    } else if (event.type === 'context-pack') {
      if (event.localOnly) readLocalOnly = holdsLocalOnly = true;
    } else if (event.type === 'tool-end') {
      if (event.result.localOnly) readLocalOnly = holdsLocalOnly = true;
    } else if (event.type === 'verify') {
      // A check's failure handed back near the vault (D5).
      if (event.localOnly) readLocalOnly = holdsLocalOnly = true;
    } else if (event.type === 'text-final') {
      if (pendingUser !== undefined) {
        pushUser(pendingUser);
        pendingUser = undefined;
      }
      if (event.text.trim()) {
        const marked = readLocalOnly || (turnStays && holdsLocalOnly);
        history.push({
          role: 'assistant',
          content: event.text,
          ...(marked ? { localOnly: true as const } : {}),
        });
      }
    }
  }
  if (pendingUser !== undefined) pushUser(pendingUser);
  return history;
}

/** How many file names a note spells out before "and N more". */
const NOTE_FILES = 40;

function fileList(paths: string[]): string {
  const shown = paths.slice(0, NOTE_FILES).join(', ');
  const more = paths.length - NOTE_FILES;
  return more > 0 ? `${shown}, and ${more} more` : shown;
}

/**
 * What the model must hear, before its next task, about files that changed
 * under it since the person's last message (P2): an Undo or a Redo on a
 * changed-files card, or a rewind. Without it the next turn builds on edits
 * that are gone. Read from the journal after the last live task-start, so each
 * note rides exactly one task's preamble (that task's own task-start closes
 * the stretch), and a session revived after a restart still says it.
 */
export function restoreNotes(journal: JournalEntry[]): string[] {
  const live = liveJournal(journal);
  let from = 0;
  for (let i = live.length - 1; i >= 0; i--) {
    if (live[i]!.event.type === 'task-start') {
      from = i + 1;
      break;
    }
  }
  const notes: string[] = [];
  for (const { event } of live.slice(from)) {
    if (event.type === 'checkpoint-restored' && event.paths.length) {
      notes.push(
        event.direction === 'undo'
          ? `[undo] The person undid changes, so these files are back to how they were before them: ${fileList(event.paths)}. Your earlier edits to them are gone; read a file again before you build on it.`
          : `[redo] The person redid changes, so your edits to these files are back: ${fileList(event.paths)}.`,
      );
    } else if (event.type === 'rewound') {
      const lines: string[] = [];
      if (event.paths.length) {
        lines.push(
          `These files went back to how they were then: ${fileList(event.paths)}. Commits, pushes, and changes outside this folder stayed as they were.`,
        );
      }
      if (event.kept?.length) {
        lines.push(
          `These files changed after that message and stayed as they are: ${fileList(event.kept)}. Read a file again before you edit it.`,
        );
      }
      if (lines.length) {
        notes.push(
          `[rewind] The person rewound this chat to an earlier message. ${lines.join(' ')}`,
        );
      }
    }
  }
  return notes;
}

/**
 * The files a rewind leaves changed (P2): what the journal saw change on disk
 * after the rewound message that the rewind did not put back. When only the
 * chat goes back, that is every file a later task changed and every file an
 * Undo or a Redo touched since. When the files go back too, the later tasks'
 * own changes are undone, so only an Undo or a Redo of an earlier task's
 * change, made after that message, can leave a file behind.
 */
export function rewindKept(
  journal: JournalEntry[],
  toSeq: number,
  withFiles: boolean,
  putBack: string[],
): string[] {
  const later = new Set<string>();
  const kept = new Set<string>();
  for (const { seq, event } of journal) {
    if (seq <= toSeq) continue;
    if (event.type === 'checkpoint') {
      later.add(event.id);
      if (!withFiles) for (const f of event.files) kept.add(f.path);
    } else if (event.type === 'checkpoint-restored') {
      if (!withFiles || !later.has(event.id)) for (const p of event.paths) kept.add(p);
    }
  }
  const back = new Set(putBack);
  return [...kept].filter((p) => !back.has(p));
}

/**
 * Approval requests in the journal that never got a matching resolution: a
 * daemon restart with a run parked on an approval leaves the client showing a
 * sheet whose Approve button now 404s. On rehydrate these are resolved as
 * declined so the zombie sheet clears (TS-P2-6).
 */
export function unresolvedApprovalIds(events: DriverEvent[]): string[] {
  const open = new Set<string>();
  for (const event of events) {
    if (event.type === 'approval-request') open.add(event.request.id);
    else if (event.type === 'approval-resolved') open.delete(event.id);
  }
  return [...open];
}
