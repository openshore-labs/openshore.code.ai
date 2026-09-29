// Rewind in the app (P2): the engine's `rewound` marker cuts the transcript
// back to the person's message, live and on replay alike, so the desktop, a
// paired phone, and a reopened chat show the conversation the engine's seed
// gives the model. A coding chat rewinds through its driver on every host
// (the Electron bridge, the daemon route); any other chat is cut in the app.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriverEvent } from 'os-code/protocol';
import { reduceEvent, reduceEvents } from '../src/state/transcript.js';
import { emptyThread, type ThreadItem, type ThreadState } from '../src/state/types.js';
import {
  REWIND_NO_COMPUTER,
  cutThread,
  rewindEngine,
  rewindOffersFiles,
  rewindableIds,
  rewoundLine,
  rewindsFiles,
} from '../src/state/rewindOps.js';
import { guardDriver } from '../src/drivers/guardedDriver.js';
import type { ChatDriver } from '../src/drivers/types.js';

type Entry = { seq: number; event: DriverEvent };

/** Three tasks journaled the way an engine session journals them. */
function journal(): Entry[] {
  const events: DriverEvent[] = [
    { type: 'task-start', input: 'make the page' },
    { type: 'text-final', text: 'Made it.' },
    { type: 'task-done', reason: 'complete' },
    { type: 'checkpoint', id: 'k1', files: [{ path: 'index.html', status: 'added' }] },
    { type: 'task-start', input: 'add a header' },
    { type: 'text-final', text: 'Added.' },
    { type: 'task-done', reason: 'complete' },
    { type: 'checkpoint', id: 'k2', files: [{ path: 'index.html', status: 'modified' }] },
    { type: 'task-start', input: 'and a footer' },
    { type: 'text-final', text: 'Footer in.' },
    { type: 'task-done', reason: 'complete' },
  ];
  return events.map((event, i) => ({ seq: i + 1, event }));
}

const said = (thread: ThreadState) =>
  thread.items.flatMap((i) =>
    i.kind === 'user' || i.kind === 'assistant' || i.kind === 'note'
      ? [`${i.kind}: ${i.text}`]
      : [],
  );

const rewound = (toSeq: number, seq: number, paths: string[] = [], kept?: string[]): Entry => ({
  seq,
  event: { type: 'rewound', toSeq, paths, ...(kept ? { kept } : {}) },
});

describe('the transcript leaves out what a rewind took back', () => {
  it('cuts from the rewound message to the marker, and says what the files did', () => {
    const thread = reduceEvents(emptyThread(), [
      ...journal(),
      {
        seq: 12,
        event: { type: 'checkpoint-restored', id: 'k2', direction: 'undo', paths: ['index.html'] },
      },
      rewound(5, 13, ['index.html']),
    ]);
    expect(said(thread)).toEqual([
      'user: make the page',
      'assistant: Made it.',
      'note: Rewound to an earlier message. index.html went back.',
    ]);
    // Only the first task's card is left; nothing is working.
    expect(thread.items.filter((i) => i.kind === 'changed')).toHaveLength(1);
    expect(thread.busy).toBe(false);
    expect(thread.lastSeq).toBe(13);
  });

  it('a live fold and a replay agree, even with a phone painting its send first', () => {
    const entries = [...journal(), rewound(9, 12, [], ['index.html'])];
    // Live on a phone: each send painted as it leaves (no seq), the hub's
    // echo folding into it with the journal's seq.
    let live = emptyThread();
    for (const { seq, event } of entries) {
      if (event.type === 'task-start') live = reduceEvent(live, event);
      live = reduceEvent(live, event, seq);
    }
    const replay = reduceEvents(emptyThread(), entries);
    expect(said(live)).toEqual(said(replay));
    expect(said(replay)).toEqual([
      'user: make the page',
      'assistant: Made it.',
      'user: add a header',
      'assistant: Added.',
      'note: Rewound to an earlier message. The files stayed as they are.',
    ]);
    const seqs = (t: ThreadState) => t.items.flatMap((i) => (i.kind === 'user' ? [i.seq] : []));
    expect(seqs(live)).toEqual([1, 5]);
    expect(seqs(replay)).toEqual([1, 5]);
  });

  it('the person carries on after it, and a second rewind takes the first back too', () => {
    const entries: Entry[] = [
      ...journal(),
      rewound(9, 12),
      { seq: 13, event: { type: 'task-start', input: 'a footer, but blue' } },
      { seq: 14, event: { type: 'text-final', text: 'Blue footer.' } },
      { seq: 15, event: { type: 'task-done', reason: 'complete' } },
      rewound(5, 16),
    ];
    expect(said(reduceEvents(emptyThread(), entries))).toEqual([
      'user: make the page',
      'assistant: Made it.',
      'note: Rewound to an earlier message.',
    ]);
  });
});

describe('which messages a chat can rewind to', () => {
  const coding = { kind: 'desktop' as const, sessionId: 's1' };
  const device = { kind: 'device' as const, modelId: 'm', modelName: 'M' };
  const items: ThreadItem[] = [
    { kind: 'user', id: 'u1', text: 'one', seq: 1 },
    { kind: 'assistant', id: 'a1', text: 'One.', streaming: false },
    { kind: 'user', id: 'u2', text: 'held back', seq: 4, withheld: true },
    { kind: 'user', id: 'u3', text: 'on its way' },
  ];
  const thread = { ...emptyThread(), items };

  it('a coding chat offers only messages the engine journaled; any other chat, every one', () => {
    expect(rewindableIds(thread, coding)).toEqual(['u1']);
    expect(rewindableIds(thread, device)).toEqual(['u1', 'u2', 'u3']);
    expect(rewindsFiles(coding)).toBe(true);
    expect(rewindsFiles(device)).toBe(false);
    expect(rewindsFiles({ kind: 'desktop-chat' })).toBe(false);
  });

  it('offers the files only when a later task changed files the engine checkpointed', () => {
    const coded: ThreadState = {
      ...thread,
      items: [
        ...items,
        { kind: 'changed', id: 'c1', files: [], checkpointId: 'k1' },
        { kind: 'user', id: 'u4', text: 'just asking', seq: 9 },
        { kind: 'assistant', id: 'a4', text: 'Answered.', streaming: false },
      ],
    };
    expect(rewindOffersFiles(coded, 'u1', coding)).toBe(true);
    // Nothing checkpointed after the last message: the chat is the one choice.
    expect(rewindOffersFiles(coded, 'u4', coding)).toBe(false);
    // A chat with no folder never offers files.
    expect(rewindOffersFiles(coded, 'u1', device)).toBe(false);
  });

  it('none while the chat works or waits on the person, and none in the guided setup', () => {
    expect(rewindableIds({ ...thread, busy: true }, coding)).toEqual([]);
    const request = { id: 'ap', kind: 'tool', toolName: 'runShell', risk: 'shell', summary: 's' };
    expect(rewindableIds({ ...thread, pendingApprovals: [request as never] }, device)).toEqual([]);
    expect(rewindableIds(thread, device, { guided: true })).toEqual([]);
  });

  it('a chat the app rewinds itself is cut before the message, with the same line', () => {
    const cut = cutThread({ ...thread, busy: false }, 2);
    expect(cut.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'note']);
    expect(rewoundLine({ paths: [] })).toBe('Rewound to an earlier message.');
    expect(rewoundLine({ paths: ['a', 'b'] })).toBe(
      'Rewound to an earlier message. a and b went back.',
    );
    expect(rewoundLine({ paths: ['a', 'b', 'c', 'd', 'e'] })).toBe(
      'Rewound to an earlier message. a, b, c and 2 more went back.',
    );
  });
});

describe('a coding chat rewinds through its driver on every host', () => {
  it('asks the engine, and says so plainly when no computer is there to ask', async () => {
    expect(await rewindEngine(undefined, 5, true)).toEqual({ error: REWIND_NO_COMPUTER });
    const asked: Array<[number, boolean]> = [];
    const driver = {
      rewind: async (seq: number, opts: { files: boolean }) => {
        asked.push([seq, opts.files]);
        return { ok: true as const, paths: ['index.html'] };
      },
    } as unknown as ChatDriver;
    expect(await rewindEngine(driver, 5, true)).toEqual({ ok: true, paths: ['index.html'] });
    const broken = {
      rewind: async () => {
        throw new Error('socket closed');
      },
    } as unknown as ChatDriver;
    expect(await rewindEngine(broken, 5, false)).toEqual({
      error: 'Could not reach your computer to rewind.',
    });
    expect(asked).toEqual([[5, true]]);
  });

  it('the guard passes rewind through, and only when the driver has it', async () => {
    const base = {
      kind: 'desktop' as const,
      send() {},
      abort() {},
      answerApproval() {},
      subscribe: () => () => {},
      dispose() {},
    };
    expect(guardDriver(base as ChatDriver).rewind).toBeUndefined();
    const withRewind = guardDriver({
      ...base,
      rewind: async (seq: number, opts: { files: boolean }) => ({
        ok: true as const,
        paths: [`${seq}:${opts.files}`],
      }),
    } as ChatDriver);
    expect(await withRewind.rewind!(9, { files: false })).toEqual({ ok: true, paths: ['9:false'] });
  });

  it('a paired phone asks its computer over the rewind route', async () => {
    const { RemoteDriver } = await import('../src/drivers/remoteDriver.js');
    const calls: Array<{ url: string; body: string }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(JSON.stringify({ error: 'That message is not in this chat any more.' }), {
        status: 409,
      });
    }) as typeof fetch;
    try {
      const driver = new RemoteDriver('s1', { baseUrl: 'http://hub:4816', token: 't' }, 0, {
        terminalOnly: true,
      });
      const result = await driver.rewind(7, { files: true });
      expect(calls).toEqual([
        {
          url: 'http://hub:4816/sessions/s1/rewind',
          body: JSON.stringify({ toSeq: 7, files: true }),
        },
      ]);
      expect(result).toEqual({ error: 'That message is not in this chat any more.' });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('the desktop asks its engine over the bridge', async () => {
    const calls: unknown[][] = [];
    Object.assign(globalThis, {
      window: {
        oscode: {
          platform: 'electron',
          onEvent: () => () => {},
          rewind: async (...args: unknown[]) => {
            calls.push(args);
            return { ok: true, paths: [] };
          },
        },
      },
    });
    try {
      const { ElectronDriver } = await import('../src/drivers/electronDriver.js');
      const driver = new ElectronDriver('s9');
      expect(await driver.rewind(3, { files: false })).toEqual({ ok: true, paths: [] });
      expect(calls).toEqual([['s9', 3, false]]);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it('the preload, the bridge type, and main stay in lockstep', () => {
    const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    expect(src('electron/preload.cjs')).toContain("rewind: invoke('osc:rewind')");
    expect(src('src/lib/electronBridge.ts')).toMatch(
      /rewind\?\(\s*sessionId: string,\s*toSeq: number,\s*files: boolean,\s*\)/,
    );
    expect(src('electron/main.ts')).toContain(
      "host.rewind(str(sessionId, 'sessionId'), num(toSeq, 'toSeq'), bool(files))",
    );
  });
});
