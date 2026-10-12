// Which chats the Chats room and the sidebar's Recents show, one rule so View
// all continues the same list (2026-10-01): the active project's
// chats, plus any chat whose project was deleted (unfiled), which belongs to
// no project and would otherwise vanish. With no project at all, every chat
// without one.
import type { Conversation } from '../state/types.js';

export function inChatScope(conv: Conversation, projectId: string | undefined): boolean {
  if (!projectId) return !conv.projectId;
  return conv.projectId === projectId || (!conv.projectId && conv.unfiled === true);
}
