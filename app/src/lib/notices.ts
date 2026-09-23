// Notices: the banner that tells you something you walked away from is done.
// A finished model download, a reply that landed while the app was in the
// background, a chat that stopped to ask for your approval. Desktop sessions
// already push through the daemon (lib/push.ts); this is the phone's own half,
// and the tap routing both halves share.
//
// The baseline is the Claude app's notification pattern:
//   1. Only when you are not looking. A foreground app shows the result live,
//      so a notice then is noise; nothing is posted while the app is visible.
//   2. Asked for in context. The permission prompt comes the first time you
//      start something worth waiting for (a download, a first message), never
//      at launch, and a "no" is final until you change it in iOS Settings.
//   3. A tap opens the thing. Every notice carries a route: the chat, the
//      guide, the Stack.
//   4. Calm and private. One short title, one plain line, no reply text on the
//      lock screen. A newer notice for the same chat replaces the older one.
//   5. Yours to switch off, per kind, in Settings (both on by default).
//
// The policy and the copy are pure so the tests pin them; the effects at the
// bottom are thin, best-effort calls into the native plugin (a failure there
// never blocks a download or a chat, it only means no banner).
import type { StopReason } from 'os-code/protocol';
import { Llama, type DownloadNoticeCopy, type NoticePermission } from './llamaPlugin.js';
import { isPhone } from './platform.js';

export type NoticeKind = 'download' | 'reply' | 'approval';

/** The two per-kind toggles, as they sit on the app settings. Undefined means
 *  on. Approvals ride the Replies toggle: both are "a chat needs you". */
export interface NoticePrefs {
  noticeDownloads?: boolean;
  noticeReplies?: boolean;
}

export function noticeEnabled(kind: NoticeKind, prefs: NoticePrefs): boolean {
  return kind === 'download' ? prefs.noticeDownloads !== false : prefs.noticeReplies !== false;
}

/** The one gate for a JS-posted notice: the kind is on, the person granted
 *  permission, and the app is not in front of them. */
export function shouldNotice(
  kind: NoticeKind,
  ctx: { prefs: NoticePrefs; permission: NoticePermission; visible: boolean },
): boolean {
  return !ctx.visible && ctx.permission === 'granted' && noticeEnabled(kind, ctx.prefs);
}

/** Where a tap takes you. Serialized into the notice's payload. */
export type NoticeRoute =
  | { to: 'chat'; conversationId: string }
  | { to: 'guide'; modelId: string }
  | { to: 'view'; view: 'stack' };

export function encodeRoute(route: NoticeRoute): string {
  return JSON.stringify(route);
}

/** Read a tapped notice's payload back into a route. A local notice carries
 *  `route`; a desktop completion push carries the daemon's `sessionId`, which
 *  the caller resolves to a chat. Anything malformed opens nothing. */
export function decodeTap(data: {
  route?: string;
  sessionId?: string;
}): NoticeRoute | { to: 'session'; sessionId: string } | null {
  if (data.route) {
    try {
      const r = JSON.parse(data.route) as Partial<NoticeRoute> & Record<string, unknown>;
      if (r.to === 'chat' && typeof r.conversationId === 'string') {
        return { to: 'chat', conversationId: r.conversationId };
      }
      if (r.to === 'guide' && typeof r.modelId === 'string') {
        return { to: 'guide', modelId: r.modelId };
      }
      if (r.to === 'view' && r.view === 'stack') return { to: 'view', view: 'stack' };
    } catch {
      // fall through
    }
    return null;
  }
  if (data.sessionId) return { to: 'session', sessionId: data.sessionId };
  return null;
}

/** The finished and failed notice for a model download. `guide` routes a tap
 *  straight into that model's chat; otherwise it opens the Stack, where a new
 *  pocket model is seated. */
export function downloadNoticeCopy(name: string, guide?: string): DownloadNoticeCopy {
  return {
    doneTitle: `${name} is ready`,
    doneBody: guide
      ? 'Downloaded to this iPhone. Tap to start chatting.'
      : 'Downloaded to this iPhone. Tap to put it to work.',
    failTitle: `${name} did not finish downloading`,
    failBody: 'Open OpenShore to try again.',
    route: encodeRoute(guide ? { to: 'guide', modelId: guide } : { to: 'view', view: 'stack' }),
  };
}

export interface NoticeMessage {
  id: string;
  title: string;
  body: string;
  route: string;
  thread: string;
}

/** The notice for a finished turn, or null when the ending needs no banner
 *  (you stopped it yourself, or you declined an approval, so you already know). */
export function replyNotice(
  conversationId: string,
  chatTitle: string,
  reason: StopReason,
): NoticeMessage | null {
  const body =
    reason === 'complete'
      ? 'Your reply is ready.'
      : reason === 'error'
        ? 'The reply stopped before it finished. Tap to pick it back up.'
        : reason === 'guardrail'
          ? 'The reply was held back. Tap to see why.'
          : null;
  if (!body) return null;
  return chatNotice(conversationId, chatTitle, body);
}

/** The notice for a chat that stopped to ask before it acts. */
export function approvalNotice(conversationId: string, chatTitle: string): NoticeMessage {
  return chatNotice(conversationId, chatTitle, 'Needs your approval to keep going.');
}

function chatNotice(conversationId: string, chatTitle: string, body: string): NoticeMessage {
  const title = chatTitle.trim() && chatTitle !== 'New chat' ? chatTitle.trim() : 'OpenShore';
  return {
    // One live notice per chat: a newer one replaces the older.
    id: `chat.${conversationId}`,
    title: title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title,
    body,
    route: encodeRoute({ to: 'chat', conversationId }),
    thread: `chat.${conversationId}`,
  };
}

// ---------------------------------------------------------------- effects

/** Whether the person is looking at the app right now. */
export function appVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

let cachedPermission: NoticePermission | undefined;

/** Ask for notice permission at a worthwhile moment. iOS shows its prompt only
 *  once; after that this just reads the standing answer. Phone only. */
export async function askForNotices(): Promise<NoticePermission> {
  if (!isPhone()) return 'denied';
  if (cachedPermission && cachedPermission !== 'prompt') return cachedPermission;
  try {
    cachedPermission = (await Llama.requestNoticePermission()).status;
  } catch {
    cachedPermission = 'denied';
  }
  return cachedPermission;
}

/** The standing permission without prompting (Settings reads this). */
export async function noticePermission(): Promise<NoticePermission> {
  if (!isPhone()) return 'denied';
  try {
    cachedPermission = (await Llama.noticePermission()).status;
  } catch {
    cachedPermission = 'denied';
  }
  return cachedPermission;
}

/** Post a chat notice if the gate allows it. Best-effort. */
export async function postChatNotice(
  kind: 'reply' | 'approval',
  message: NoticeMessage | null,
  prefs: NoticePrefs,
): Promise<void> {
  if (!message || !isPhone()) return;
  // Read the standing answer fresh each time: the person may have turned
  // notices on or off in iOS Settings since the app last asked.
  const permission = await noticePermission();
  if (!shouldNotice(kind, { prefs, permission, visible: appVisible() })) return;
  await Llama.postNotice(message).catch(() => {});
}

/** Hand the Downloads toggle to the native side, which reads it on a
 *  background relaunch with no web layer. */
export async function syncNoticePrefs(prefs: NoticePrefs): Promise<void> {
  if (!isPhone()) return;
  await Llama.setNoticePrefs({ downloads: noticeEnabled('download', prefs) }).catch(() => {});
}

/** Test seam: forget the cached permission. */
export function resetNoticeCache(): void {
  cachedPermission = undefined;
}
