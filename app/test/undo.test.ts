// Undo in the app (v1 Phase 1): the engine checkpoints every task on the
// computer the chat runs on and says which files changed; the changed-files
// card carries the undo, a restore echoes back so every device folds the same
// card, and the drivers pass the tap through to the engine.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriverEvent } from 'os-code/protocol';
import { reduceEvents } from '../src/state/transcript.js';
import { emptyThread, type ThreadItem } from '../src/state/types.js';
import { guardDriver } from '../src/drivers/guardedDriver.js';
import type { ChatDriver, DriverEventSink } from '../src/drivers/types.js';

type Changed = Extract<ThreadItem, { kind: 'changed' }>;
const changedOf = (items: ThreadItem[]) => items.filter((i): i is Changed => i.kind === 'changed');

const edit = (id: string, path: string): DriverEvent[] => [
  {
    type: 'tool-start',
    call: { id, name: 'editFile', args: { path, old: 'a', new: 'b' } },
  } as DriverEvent,
  {
    type: 'tool-end',
    call: { id, name: 'editFile', args: { path, old: 'a', new: 'b' } },
    result: { ok: true, content: 'ok', diffText: '--- a\n+++ b\n-a\n+b\n' },
  } as DriverEvent,
];

describe('the changed-files card carries undo', () => {
  it("joins the engine's checkpoint to the task's card, adding files a command wrote", () => {
    const thread = reduceEvents(
      emptyThread(),
      [
        { type: 'task-start', input: 'fix the page' } as DriverEvent,
        ...edit('c1', 'index.html'),
        { type: 'task-done', reason: 'complete' } as DriverEvent,
        {
          type: 'checkpoint',
          id: 'abc123',
          files: [
            { path: 'index.html', status: 'modified' },
            { path: 'photos/2024-03-12.jpg', status: 'added' },
          ],
        },
      ].map((event) => ({ event })),
    );
    const cards = changedOf(thread.items);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.checkpointId).toBe('abc123');
    expect(cards[0]!.files.map((f) => [f.path, f.status])).toEqual([
      ['index.html', 'modified'],
      ['photos/2024-03-12.jpg', 'added'],
    ]);
  });

  it('makes a card when the task changed files only through commands, or stopped early', () => {
    const thread = reduceEvents(
      emptyThread(),
      [
        { type: 'task-start', input: 'rename the photos' } as DriverEvent,
        { type: 'task-done', reason: 'aborted' } as DriverEvent,
        { type: 'checkpoint', id: 'def456', files: [{ path: 'a.jpg', status: 'deleted' }] },
      ].map((event) => ({ event })),
    );
    const cards = changedOf(thread.items);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      checkpointId: 'def456',
      files: [{ path: 'a.jpg', status: 'deleted' }],
    });
  });

  it('folds on a restore from any device, and unfolds on redo', () => {
    const start: DriverEvent[] = [
      { type: 'task-start', input: 'go' } as DriverEvent,
      {
        type: 'checkpoint',
        id: 'k1',
        files: [
          { path: 'a.txt', status: 'modified' },
          { path: 'b.txt', status: 'modified' },
        ],
      },
    ];
    const one = reduceEvents(
      emptyThread(),
      [
        ...start,
        {
          type: 'checkpoint-restored',
          id: 'k1',
          direction: 'undo',
          paths: ['a.txt'],
        } as DriverEvent,
      ].map((event) => ({ event })),
    );
    expect(changedOf(one.items)[0]!.undone).toEqual(['a.txt']);
    const all = reduceEvents(
      one,
      [
        {
          type: 'checkpoint-restored',
          id: 'k1',
          direction: 'undo',
          paths: ['b.txt'],
        } as DriverEvent,
      ].map((event) => ({ event })),
    );
    expect(changedOf(all.items)[0]!.undone!.sort()).toEqual(['a.txt', 'b.txt']);
    const redo = reduceEvents(
      all,
      [
        {
          type: 'checkpoint-restored',
          id: 'k1',
          direction: 'redo',
          paths: ['a.txt', 'b.txt'],
        } as DriverEvent,
      ].map((event) => ({ event })),
    );
    expect(changedOf(redo.items)[0]!.undone).toEqual([]);
  });
});

class FakeDriver implements ChatDriver {
  readonly kind = 'desktop' as const;
  calls: Array<[string, string, string | undefined]> = [];
  send(): void {}
  abort(): void {}
  answerApproval(): void {}
  subscribe(_sink: DriverEventSink): () => void {
    return () => {};
  }
  dispose(): void {}
  async restoreCheckpoint(
    id: string,
    direction: 'undo' | 'redo',
    path?: string,
  ): Promise<{ ok: true; paths: string[] }> {
    this.calls.push([id, direction, path]);
    return { ok: true, paths: path ? [path] : ['a.txt'] };
  }
}

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
});

describe('the drivers pass undo through', () => {
  it('reaches the engine driver underneath the ethics wrapper', async () => {
    const inner = new FakeDriver();
    const guarded = guardDriver(inner);
    await expect(guarded.restoreCheckpoint!('k1', 'undo', 'a.txt')).resolves.toEqual({
      ok: true,
      paths: ['a.txt'],
    });
    expect(inner.calls).toEqual([['k1', 'undo', 'a.txt']]);
  });

  it('is wired end to end on the desktop bridge and over the phone route', () => {
    const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
    expect(src('electron/preload.cjs')).toContain(
      "restoreCheckpoint: invoke('osc:restoreCheckpoint')",
    );
    expect(src('electron/main.ts')).toContain("'osc:restoreCheckpoint'");
    expect(src('src/drivers/remoteDriver.ts')).toContain('/checkpoints/');
  });
});

describe('the card reads calm', () => {
  const card = readFileSync(join(__dirname, '..', 'src/components/ChangedFilesCard.tsx'), 'utf8');
  it('has no confirm step, presses like every tappable, and never says red things', () => {
    expect(card).toContain('press-fb');
    expect(card).not.toMatch(/window\.confirm|confirm-|ConfirmSheet/);
    expect(card).not.toMatch(/btn danger|--danger/);
    expect(card).toContain('Files are back');
  });
});

describe('the verify pill (v1 Phase 1)', () => {
  it('turns a verify event into one plain pill, the last one the verdict', () => {
    const thread = reduceEvents(
      emptyThread(),
      [
        {
          type: 'verify',
          passed: false,
          summary: 'Not yet: one thing would break in the browser.',
          detail: 'script.js looks for an element with id "join-button"',
          willRetry: true,
          check: 'page',
        },
        {
          type: 'verify',
          passed: true,
          summary: 'It works: every file the page loads is there.',
          check: 'page',
        },
      ].map((event) => ({ event: event as DriverEvent })),
    );
    const pills = thread.items.filter((i) => i.kind === 'verify');
    expect(pills).toMatchObject([
      { passed: false, check: 'page', retrying: true },
      { passed: true, check: 'page', retrying: false },
    ]);
  });

  it('reads in plain words, and keeps teal and amber for local and cloud', () => {
    const pill = readFileSync(join(__dirname, '..', 'src/components/VerifyPill.tsx'), 'utf8');
    for (const words of [
      'It works',
      'Not yet',
      'Checks pass',
      'Checks failing',
      'Not yet, fixing it',
    ]) {
      expect(pill).toContain(`'${words}'`);
    }
    const css = readFileSync(join(__dirname, '..', 'src/theme.css'), 'utf8');
    const block = css.slice(css.indexOf('.verify-pill {'), css.indexOf('/* Undo (v1 Phase 1)'));
    expect(block).not.toMatch(/--local|--cloud/);
  });
});
