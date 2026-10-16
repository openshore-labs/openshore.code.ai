// The store's chat file mirror (state/chatFileOps.ts), against a fake writer:
// a write lands once a turn settles and the chat rests, never per change; a
// rename writes the new file before removing the old; a deleted chat takes
// its file; the switch off writes nothing and removes nothing unless asked;
// the launch pass is bounded and writes only what is missing or stale; a
// failure is one quiet log line.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatFileMirror, type ChatFileState } from '../src/state/chatFileOps.js';
import type { ChatFileWriter } from '../src/lib/chatFileWriters.js';
import { chatFilePath } from '../src/lib/chatFiles.js';
import { emptyThread, type Conversation, type ThreadItem } from '../src/state/types.js';

class FakeWriter implements ChatFileWriter {
  files = new Map<string, { text: string; mtimeMs: number }>();
  ops: string[] = [];
  fail = false;
  async write(path: string, text: string) {
    this.ops.push(`write ${path}`);
    if (this.fail) throw new Error('disk full');
    this.files.set(path, { text, mtimeMs: Date.now() });
  }
  async remove(path: string) {
    this.ops.push(`remove ${path}`);
    this.files.delete(path);
  }
  async list(month: string) {
    return [...this.files]
      .filter(([p]) => p.startsWith(`${month}/`))
      .map(([p, f]) => ({ name: p.slice(month.length + 1), mtimeMs: f.mtimeMs }));
  }
}

function chat(id: string, over: Partial<Conversation> = {}, items?: ThreadItem[]): Conversation {
  return {
    id,
    title: `Chat ${id}`,
    source: { kind: 'stack' },
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:05:00.000Z',
    thread: {
      ...emptyThread(),
      items: items ?? [
        { kind: 'user', id: `${id}u`, text: 'hello' },
        { kind: 'assistant', id: `${id}a`, text: 'hi', streaming: false },
      ],
    },
    ...over,
  };
}

let state: ChatFileState;
let writer: FakeWriter;
let logs: string[];

function mirror(opts: { launchLimit?: number; noWriter?: boolean } = {}) {
  return createChatFileMirror({
    getState: () => state,
    writer: () => (opts.noWriter ? undefined : writer),
    delayMs: 1000,
    launchLimit: opts.launchLimit,
    log: (l) => logs.push(l),
  });
}

function setChats(chats: Conversation[], settings: ChatFileState['settings'] = {}) {
  state = {
    conversations: Object.fromEntries(chats.map((c) => [c.id, c])),
    order: chats.map((c) => c.id),
    settings,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
  writer = new FakeWriter();
  logs = [];
  setChats([]);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('writing as turns settle', () => {
  it('waits for the chat to rest, then writes it once', async () => {
    const m = mirror();
    await m.reconcile();
    setChats([chat('c1')]);
    m.sync();
    m.sync();
    await vi.advanceTimersByTimeAsync(500);
    m.sync();
    await vi.advanceTimersByTimeAsync(999);
    expect(writer.ops).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await m.flush();
    expect(writer.ops).toEqual([`write ${chatFilePath(state.conversations.c1!)}`]);
    // Nothing changed: no second write.
    m.sync();
    await vi.advanceTimersByTimeAsync(2000);
    await m.flush();
    expect(writer.ops).toHaveLength(1);
  });

  it('never writes while a turn is in flight or streaming', async () => {
    const m = mirror();
    await m.reconcile();
    const busy = chat('c1');
    busy.thread.busy = true;
    setChats([busy]);
    m.sync();
    await vi.advanceTimersByTimeAsync(5000);
    await m.flush();
    expect(writer.ops).toEqual([]);
    // The turn settles: now it is written.
    setChats([chat('c1', { updatedAt: '2026-10-16T09:06:00.000Z' })]);
    m.sync();
    await vi.advanceTimersByTimeAsync(1000);
    await m.flush();
    expect(writer.ops).toHaveLength(1);
    const text = writer.files.get(chatFilePath(state.conversations.c1!))!.text;
    expect(text).toContain('### You\n\nhello');
  });

  it('writes nothing until the launch pass has run', async () => {
    const m = mirror();
    setChats([chat('c1')]);
    m.sync();
    await vi.advanceTimersByTimeAsync(5000);
    await m.flush();
    expect(writer.ops).toEqual([]);
  });
});

describe('rename and delete', () => {
  it('a rename writes the new file first, then removes the old one', async () => {
    const m = mirror();
    await m.reconcile();
    setChats([chat('c1')]);
    m.sync();
    await m.flush();
    const before = chatFilePath(state.conversations.c1!);
    setChats([chat('c1', { title: 'A better name', updatedAt: '2026-10-16T09:10:00.000Z' })]);
    m.sync();
    await m.flush();
    const after = chatFilePath(state.conversations.c1!);
    expect(after).not.toBe(before);
    expect(writer.ops).toEqual([`write ${before}`, `write ${after}`, `remove ${before}`]);
    expect([...writer.files.keys()]).toEqual([after]);
  });

  it('a deleted chat takes its file, and nothing else', async () => {
    const m = mirror();
    await m.reconcile();
    setChats([chat('c1'), chat('c2')]);
    m.sync();
    await m.flush();
    const gone = chatFilePath(state.conversations.c1!);
    const kept = chatFilePath(state.conversations.c2!);
    setChats([state.conversations.c2!]);
    m.sync();
    await m.flush();
    expect(writer.files.has(gone)).toBe(false);
    expect(writer.files.has(kept)).toBe(true);
  });
});

describe('the switch', () => {
  it('off writes nothing and removes nothing', async () => {
    const m = mirror();
    await m.reconcile();
    setChats([chat('c1')]);
    m.sync();
    await m.flush();
    expect(writer.files.size).toBe(1);
    setChats([chat('c1', { updatedAt: '2026-10-16T09:20:00.000Z' })], { chatFiles: false });
    m.sync();
    await vi.advanceTimersByTimeAsync(5000);
    await m.flush();
    expect(writer.ops).toHaveLength(1);
    expect(writer.files.size).toBe(1);
  });

  it('removeAll removes every file for the chats this device has, old names included', async () => {
    const m = mirror();
    // A file under an older name, from before a rename while the app was shut,
    // and one that is not OpenShore's.
    writer.files.set('2026-10/old-name-c1.md', { text: 'x', mtimeMs: 0 });
    writer.files.set('2026-10/my-own-notes.md', { text: 'mine', mtimeMs: 0 });
    await m.reconcile();
    setChats([chat('c1'), chat('c2')]);
    m.sync();
    await m.flush();
    setChats(Object.values(state.conversations), { chatFiles: false });
    await m.removeAll();
    expect([...writer.files.keys()]).toEqual(['2026-10/my-own-notes.md']);
  });

  it('on a platform with no writer, does nothing', async () => {
    const m = mirror({ noWriter: true });
    await m.reconcile();
    setChats([chat('c1')]);
    m.sync();
    await vi.advanceTimersByTimeAsync(5000);
    await m.flush();
    expect(writer.ops).toEqual([]);
  });
});

describe('the launch pass', () => {
  it('writes missing and stale files, skips fresh ones, and moves a renamed one', async () => {
    const fresh = chat('cfresh');
    const stale = chat('cstale', { updatedAt: '2026-10-16T09:59:00.000Z' });
    const renamed = chat('crenamed', { title: 'New title' });
    const missing = chat('cmissing');
    writer.files.set(chatFilePath(fresh), { text: 'ok', mtimeMs: Date.parse(fresh.updatedAt) });
    writer.files.set(chatFilePath(stale), {
      text: 'old',
      mtimeMs: Date.parse('2026-10-16T09:00:00Z'),
    });
    writer.files.set('2026-10/old-title-crenamed.md', { text: 'old', mtimeMs: Date.now() });
    setChats([fresh, stale, renamed, missing]);
    const m = mirror();
    await m.reconcile();
    await m.flush();
    expect(writer.ops).toEqual([
      `write ${chatFilePath(stale)}`,
      `write ${chatFilePath(renamed)}`,
      'remove 2026-10/old-title-crenamed.md',
      `write ${chatFilePath(missing)}`,
    ]);
  });

  it('is bounded: chats past the window wait until they change', async () => {
    const chats = Array.from({ length: 5 }, (_, i) => chat(`c${i}`));
    setChats(chats);
    const m = mirror({ launchLimit: 2 });
    await m.reconcile();
    await m.flush();
    expect(writer.ops).toEqual([
      `write ${chatFilePath(chats[0]!)}`,
      `write ${chatFilePath(chats[1]!)}`,
    ]);
    m.sync();
    await vi.advanceTimersByTimeAsync(5000);
    await m.flush();
    expect(writer.ops).toHaveLength(2);
    // The oldest changes: now it is written.
    setChats([...chats.slice(0, 4), chat('c4', { updatedAt: '2026-10-16T09:30:00.000Z' })]);
    m.sync();
    await vi.advanceTimersByTimeAsync(1000);
    await m.flush();
    expect(writer.ops).toHaveLength(3);
  });
});

describe('failures are quiet', () => {
  it('logs one line per kind, never throws', async () => {
    writer.fail = true;
    const m = mirror();
    await m.reconcile();
    setChats([chat('c1'), chat('c2')]);
    m.sync();
    await m.flush();
    expect(writer.ops).toHaveLength(2);
    expect(logs).toEqual(['[chat files] write failed: disk full']);
  });
});
