// Which chats the Chats room and the sidebar's Recents show, one rule so View
// all continues the same list: every chat (founder, 2026-10-27: there is no
// active project to narrow it to). A chat in a project names its project on
// its row; one in none says nothing more.
import type { Conversation } from '../state/types.js';

export function inChatScope(_conv: Conversation): boolean {
  return true;
}
