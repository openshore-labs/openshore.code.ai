// Rebuild a coarse chat history from a session's journaled events, so a session
// rehydrated after a daemon restart continues the conversation instead of
// answering the next message with amnesia. It pairs each task-start (the user's
// message) with the text-final that followed (the assistant's reply). Tool
// calls and their results are omitted: the model does not need the tool
// transcript to keep the thread, and reconstructing it faithfully is not worth
// the risk of a malformed history. The system prompt is injected fresh on each
// run, so it is not seeded here.
//
// Privacy survives the restart (Vault M4, CTO I5): the tool results are not
// seeded, but a reply written after a tool read a local-only vault note (its
// journaled tool-end carries `localOnly`) may quote that note, so the reply
// comes back marked `localOnly` and a later turn on a seat that leaves this
// network gets the stub in its place, the same as the tool result would.
import type { ChatMessage } from '../../providers/types.js';
import type { DriverEvent } from './types.js';

export function seedHistoryFromEvents(events: DriverEvent[]): ChatMessage[] {
  const history: ChatMessage[] = [];
  let pendingUser: string | undefined;
  // This task has read a local-only note, so what it says next may quote one.
  let readLocalOnly = false;
  for (const event of events) {
    if (event.type === 'task-start') {
      // A new user turn. If a prior user turn never got a final answer (an
      // aborted or errored run), keep it: the user still said it.
      if (pendingUser !== undefined) history.push({ role: 'user', content: pendingUser });
      pendingUser = event.input;
      readLocalOnly = false;
    } else if (event.type === 'tool-end') {
      if (event.result.localOnly) readLocalOnly = true;
    } else if (event.type === 'text-final') {
      if (pendingUser !== undefined) {
        history.push({ role: 'user', content: pendingUser });
        pendingUser = undefined;
      }
      if (event.text.trim()) {
        history.push({
          role: 'assistant',
          content: event.text,
          ...(readLocalOnly ? { localOnly: true as const } : {}),
        });
      }
    }
  }
  if (pendingUser !== undefined) history.push({ role: 'user', content: pendingUser });
  return history;
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
