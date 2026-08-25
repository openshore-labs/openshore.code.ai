// Rebuild a coarse chat history from a session's journaled events, so a session
// rehydrated after a daemon restart continues the conversation instead of
// answering the next message with amnesia. It pairs each task-start (the user's
// message) with the text-final that followed (the assistant's reply). Tool
// calls and their results are omitted: the model does not need the tool
// transcript to keep the thread, and reconstructing it faithfully is not worth
// the risk of a malformed history. The system prompt is injected fresh on each
// run, so it is not seeded here.
import type { ChatMessage } from '../../providers/types.js';
import type { DriverEvent } from './types.js';

export function seedHistoryFromEvents(events: DriverEvent[]): ChatMessage[] {
  const history: ChatMessage[] = [];
  let pendingUser: string | undefined;
  for (const event of events) {
    if (event.type === 'task-start') {
      // A new user turn. If a prior user turn never got a final answer (an
      // aborted or errored run), keep it: the user still said it.
      if (pendingUser !== undefined) history.push({ role: 'user', content: pendingUser });
      pendingUser = event.input;
    } else if (event.type === 'text-final') {
      if (pendingUser !== undefined) {
        history.push({ role: 'user', content: pendingUser });
        pendingUser = undefined;
      }
      if (event.text.trim()) history.push({ role: 'assistant', content: event.text });
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
