// The store's chat files (folder and sync plan, M3): each chat mirrored as one
// markdown file in OpenShore/Chats, while Settings' Save chats as files is on
// (it is, unless turned off). Kept out of store.ts, which only wires it in:
// every conversation save calls `sync`, the launch calls `reconcile`, and the
// Settings switch's "remove the files" calls `removeAll`.
//
// The sealed store is the source of truth; these files are a mirror the app
// keeps and never reads back. So the rules are about never losing the
// person's chat on disk by accident:
// - a file is written once a turn settles (nothing busy or streaming), a short
//   wait after the last change, one chat at a time, never per token;
// - a rename writes the new file first, then removes the old one;
// - only a chat deleted in the app removes its file, and turning the switch
//   off removes files only when the person said so in its sheet;
// - a failure is one quiet log line, never a toast or a crash.
import { SNAPSHOT_ITEMS } from './transcript.js';
import type { Conversation } from './types.js';
import {
  chatFilePath,
  chatFilesOn,
  chatMonth,
  chatReadyToMirror,
  chatStamp,
  fileIsForChat,
  renderChatMarkdown,
} from '../lib/chatFiles.js';
import type { ChatFileWriter } from '../lib/chatFileWriters.js';

export interface ChatFileState {
  conversations: Record<string, Conversation>;
  order: string[];
  settings: { chatFiles?: boolean; projects?: Array<{ id: string; name: string }> };
}

export interface ChatFileMirrorOptions {
  /** The store's state, read when a write runs (never a stale copy). */
  getState: () => ChatFileState;
  /** This platform's writer, or undefined where no files are written. */
  writer: () => ChatFileWriter | undefined;
  /** How long a chat rests after its last change before it is written. */
  delayMs?: number;
  /** How many of the newest chats the launch pass looks at. */
  launchLimit?: number;
  log?: (line: string) => void;
}

export interface ChatFileMirror {
  /** After every conversation save: schedule writes, moves and removals. */
  sync(): void;
  /** Once at launch: write the newest chats whose file is missing or older
   *  than the chat, and move any whose title changed while the app was shut.
   *  Bounded to `launchLimit` chats. */
  reconcile(): Promise<void>;
  /** Remove every chat file this device wrote for the chats it has. */
  removeAll(): Promise<void>;
  /** Wait for every scheduled write to land (tests, and before removeAll). */
  flush(): Promise<void>;
}

function projectNameOf(state: ChatFileState, conv: Conversation): string | undefined {
  if (!conv.projectId) return undefined;
  return state.settings.projects?.find((p) => p.id === conv.projectId)?.name;
}

export function createChatFileMirror(opts: ChatFileMirrorOptions): ChatFileMirror {
  const delayMs = opts.delayMs ?? 1200;
  const launchLimit = opts.launchLimit ?? 50;
  const log =
    opts.log ??
    ((line: string) => {
      console.warn(line);
    });
  /** The path each chat's file is at (or would be), as last seen. */
  const paths = new Map<string, string>();
  /** What each chat's file last said, by stamp, once written. */
  const stamps = new Map<string, string>();
  /** Old paths to remove once the chat's new file is written. */
  const moved = new Map<string, Set<string>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let queue: Promise<void> = Promise.resolve();
  /** Writes wait for the launch pass, so a launch never writes every chat. */
  let armed = false;
  const loggedKinds = new Set<string>();

  function quiet(kind: string, err: unknown): void {
    if (loggedKinds.has(kind)) return;
    loggedKinds.add(kind);
    const why = err instanceof Error ? err.message : String(err);
    log(`[chat files] ${kind} failed: ${why.slice(0, 160)}`);
  }

  function enqueue(job: () => Promise<void>): Promise<void> {
    queue = queue.then(job, job);
    return queue;
  }

  function noteMove(id: string, from: string): void {
    const set = moved.get(id) ?? new Set<string>();
    set.add(from);
    moved.set(id, set);
  }

  async function writeNow(id: string): Promise<void> {
    const writer = opts.writer();
    const state = opts.getState();
    const conv = state.conversations[id];
    if (!writer || !conv || !chatFilesOn(state.settings)) return;
    if (!chatReadyToMirror(conv, SNAPSHOT_ITEMS)) return;
    const projectName = projectNameOf(state, conv);
    const path = chatFilePath(conv);
    try {
      await writer.write(path, renderChatMarkdown(conv, { projectName }));
      stamps.set(id, chatStamp(conv, projectName));
      paths.set(id, path);
    } catch (err) {
      quiet('write', err);
      return;
    }
    const old = moved.get(id);
    if (!old) return;
    moved.delete(id);
    for (const from of old) {
      if (from === path) continue;
      try {
        await writer.remove(from);
      } catch (err) {
        quiet('move', err);
      }
    }
  }

  function schedule(id: string): void {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void enqueue(() => writeNow(id));
      }, delayMs),
    );
  }

  function removeNow(id: string, path: string): Promise<void> {
    return enqueue(async () => {
      const writer = opts.writer();
      if (!writer) return;
      try {
        await writer.remove(path);
      } catch (err) {
        quiet('remove', err);
      }
    });
  }

  return {
    sync() {
      const state = opts.getState();
      // A deleted chat takes its file with it (and any old name not yet
      // cleared), whether or not the switch is on: the file is the chat's.
      for (const [id, path] of [...paths]) {
        if (state.conversations[id]) continue;
        const t = timers.get(id);
        if (t) clearTimeout(t);
        timers.delete(id);
        paths.delete(id);
        stamps.delete(id);
        const old = moved.get(id);
        moved.delete(id);
        void removeNow(id, path);
        for (const from of old ?? []) if (from !== path) void removeNow(id, from);
      }
      if (!chatFilesOn(state.settings) || !opts.writer()) {
        for (const t of timers.values()) clearTimeout(t);
        timers.clear();
        // Still remember where each chat's file is, so a delete while the
        // switch is off removes a file written while it was on.
        for (const conv of Object.values(state.conversations)) {
          if (!paths.has(conv.id)) paths.set(conv.id, chatFilePath(conv));
        }
        return;
      }
      for (const conv of Object.values(state.conversations)) {
        const path = chatFilePath(conv);
        const known = paths.get(conv.id);
        if (known && known !== path) noteMove(conv.id, known);
        paths.set(conv.id, path);
        if (!armed || !chatReadyToMirror(conv, SNAPSHOT_ITEMS)) continue;
        if (stamps.get(conv.id) === chatStamp(conv, projectNameOf(state, conv))) continue;
        schedule(conv.id);
      }
    },

    async reconcile() {
      const writer = opts.writer();
      const state = opts.getState();
      if (!writer || !chatFilesOn(state.settings)) return;
      const ids = state.order.filter((id) => state.conversations[id]).slice(0, launchLimit);
      const months = new Map<string, Promise<Array<{ name: string; mtimeMs: number }>>>();
      const listing = (month: string) => {
        let p = months.get(month);
        if (!p) {
          p = writer.list(month).catch((err) => {
            quiet('list', err);
            return [];
          });
          months.set(month, p);
        }
        return p;
      };
      const expected = new Set(ids.map((id) => chatFilePath(state.conversations[id]!)));
      for (const id of ids) {
        const conv = state.conversations[id]!;
        const month = chatMonth(conv.createdAt);
        const path = chatFilePath(conv);
        const name = path.slice(month.length + 1);
        const files = await listing(month);
        const mine = files.find((f) => f.name === name);
        // A file under this chat's old name (renamed while the app was shut)
        // moves once the new one is written. One that is another chat's
        // expected file is never touched.
        for (const f of files) {
          const other = `${month}/${f.name}`;
          if (f.name !== name && fileIsForChat(f.name, id) && !expected.has(other)) {
            noteMove(id, other);
          }
        }
        paths.set(id, path);
        const updated = Date.parse(conv.updatedAt) || 0;
        const fresh = mine && mine.mtimeMs >= updated && !moved.has(id);
        if (fresh) {
          stamps.set(id, chatStamp(conv, projectNameOf(state, conv)));
          continue;
        }
        if (chatReadyToMirror(conv, SNAPSHOT_ITEMS)) await enqueue(() => writeNow(id));
      }
      // The older chats past the launch window count as written as they
      // stand; they are written the next time they change.
      const inWindow = new Set(ids);
      for (const conv of Object.values(state.conversations)) {
        if (inWindow.has(conv.id)) continue;
        paths.set(conv.id, chatFilePath(conv));
        if (!stamps.has(conv.id)) stamps.set(conv.id, chatStamp(conv, projectNameOf(state, conv)));
      }
      armed = true;
    },

    async removeAll() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      await queue;
      const writer = opts.writer();
      const state = opts.getState();
      if (!writer) return;
      const targets = new Set<string>(paths.values());
      for (const set of moved.values()) for (const p of set) targets.add(p);
      for (const conv of Object.values(state.conversations)) targets.add(chatFilePath(conv));
      // Files under an older name of a chat this device still has.
      const months = new Set(Object.values(state.conversations).map((c) => chatMonth(c.createdAt)));
      for (const month of months) {
        let files: Array<{ name: string }> = [];
        try {
          files = await writer.list(month);
        } catch (err) {
          quiet('list', err);
        }
        for (const f of files) {
          if (Object.values(state.conversations).some((c) => fileIsForChat(f.name, c.id))) {
            targets.add(`${month}/${f.name}`);
          }
        }
      }
      for (const path of targets) {
        try {
          await writer.remove(path);
        } catch (err) {
          quiet('remove', err);
        }
      }
      stamps.clear();
      moved.clear();
    },

    async flush() {
      const pending = [...timers.keys()];
      for (const id of pending) {
        clearTimeout(timers.get(id));
        timers.delete(id);
        void enqueue(() => writeNow(id));
      }
      await queue;
    },
  };
}
