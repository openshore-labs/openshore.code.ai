// One door to the coding agent, and the account gate's other seams (build
// 2026-09-29, package A1). The rules live here, apart from the store (CTO
// ruling 9), as plain functions a test reads without it; the store wires them
// into ensureDriver, buildDriver, attachDriver, failOpen, the sign-out, and
// the launch notice. Test: app/test/accounts.test.ts.
//
// The gate is a door, never a wipe (lib/accountGate.ts): signed out, a coding
// chat stays readable on its saved snapshot, and nothing reaches the engine.
import { SOURCE_ACCOUNT, roomAccountFeature } from '../lib/accountGate.js';
import { snapshotThread } from './transcript.js';
import type { AppSettings, ViewName } from './store.js';
import type { Conversation } from './types.js';

/** A coding session refused at the account door. Not a failure to show: a
 *  message waiting to go opens the sign-in sheet instead. */
export class CodingLockedError extends Error {
  constructor() {
    super('The coding agent needs an account.');
    this.name = 'CodingLockedError';
  }
}

/** Whether the door holds this chat shut: a coding session ('desktop', the
 *  one brain SOURCE_ACCOUNT puts behind a sign-in), and a sign-in is needed
 *  right now. */
export function codingLocked(
  conv: Pick<Conversation, 'source'> | undefined,
  needsAccount: boolean,
): boolean {
  return Boolean(conv && SOURCE_ACCOUNT[conv.source.kind] === 'coding') && needsAccount;
}

/** The attached coding chats let go at a sign-out: each falls back to its
 *  read-only snapshot, so no stale step or busy row is left to tap. `ids` are
 *  the chats whose drivers the store drops (and marks, so the replay after
 *  the next sign-in replaces the snapshot); `conversations` is the map to
 *  set, undefined when nothing was attached. */
export function detachCodingChats(
  conversations: Record<string, Conversation>,
  attached: Iterable<string>,
): { conversations?: Record<string, Conversation>; ids: string[] } {
  let next: Record<string, Conversation> | undefined;
  const ids: string[] = [];
  for (const id of attached) {
    const conv = conversations[id];
    if (conv?.source.kind !== 'desktop') continue;
    ids.push(id);
    next ??= { ...conversations };
    next[id] = { ...conv, thread: snapshotThread(conv.thread) };
  }
  return { conversations: next, ids };
}

/** Whether the room on screen gives way to chat, the free home, when the
 *  session ends (a sign-out or an expiry). */
export function leavesRoomAtSignOut(view: ViewName, configured: boolean): boolean {
  return configured && roomAccountFeature(view) !== undefined;
}

/** Whether someone who used OpenShore before the gate, signed out, hears the
 *  notice at this launch: once, never after a sign-in, and only with work the
 *  gate now covers (a pairing, a crew, any project, or a vault or repository
 *  resource). */
export function accountNoticeDue(
  settings: AppSettings,
  opts: { configured: boolean; signedIn: boolean },
): boolean {
  if (!opts.configured || opts.signedIn) return false;
  if (!settings.onboarded || settings.accountNoticeSeen) return false;
  return (
    Boolean(settings.daemon) ||
    Boolean(settings.crew?.length) ||
    Boolean(settings.projects?.length) ||
    Boolean(settings.gitosResources?.length)
  );
}
