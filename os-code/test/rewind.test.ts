// Rewind (P2): the person takes a coding chat back to one of their own
// messages, and with the files, every file the later tasks changed goes back
// too, through the same restore Undo uses. The model is told what changed
// under it: after any restore (Undo, Redo, rewind) the next task's preamble
// names the files once. A rewind is refused while a task runs or waits, stops
// at the first restore that fails and leaves the chat as it was, and journals
// a marker that every replay reads, so a revived session remembers the same
// conversation the live one does.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDriver } from '../src/daemon/session.js';
import { checkpointDir } from '../src/core/checkpoints/shadowGit.js';
import {
  liveJournal,
  restoreNotes,
  rewindKept,
  seedHistoryFromEvents,
  type JournalEntry,
} from '../src/core/agent/seed.js';
import type { DriverEvent } from '../src/core/agent/types.js';
import type { ChatMessage } from '../src/providers/types.js';

let home: string;
let folder: string;
const priorHome = process.env.OSC_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'osc-rewind-home-'));
  folder = mkdtempSync(join(tmpdir(), 'osc-rewind-work-'));
  process.env.OSC_HOME = home;
});

afterEach(() => {
  if (priorHome === undefined) delete process.env.OSC_HOME;
  else process.env.OSC_HOME = priorHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(folder, { recursive: true, force: true });
});

const read = (rel: string) => readFileSync(join(folder, rel), 'utf8');
const write = (rel: string, text: string) => writeFileSync(join(folder, rel), text);

type Rewound = Extract<DriverEvent, { type: 'rewound' }>;

/**
 * A stand-in for the agent loop: each task journals its task-start and its
 * reply the way the loop does, keeps the model's history (the preamble rides
 * the user turn), and does its task's work on the files. It records every
 * preamble it was handed.
 */
function standIn(driver: LocalDriver, work: Record<string, () => void> = {}) {
  const agent = {
    history: [] as ChatMessage[],
    preambles: [] as Array<string | undefined>,
    async run(text: string, _images: unknown, preamble?: string) {
      agent.preambles.push(preamble);
      driver.emit({ type: 'task-start', input: text });
      agent.history.push({ role: 'user', content: preamble ? `${preamble}\n\n${text}` : text });
      work[text]?.();
      const reply = `Done: ${text}.`;
      driver.emit({ type: 'text-final', text: reply });
      agent.history.push({ role: 'assistant', content: reply });
      driver.emit({ type: 'task-done', reason: 'complete' });
    },
    generateTitle: async () => undefined,
    flushHandoff: () => undefined,
  };
  driver.attachAgent(agent as never);
  return agent;
}

/** Every event the driver journals from here on, with its seq. */
function record(driver: LocalDriver): JournalEntry[] {
  const seen: JournalEntry[] = [];
  driver.onEvent((event, seq) => seen.push({ seq, event }));
  return seen;
}

async function task(driver: LocalDriver, text: string): Promise<void> {
  driver.send(text);
  await waitFor(() => !driver.busy);
}

const taskSeq = (seen: JournalEntry[], input: string): number =>
  seen.find((e) => e.event.type === 'task-start' && e.event.input === input)!.seq;

/** Three tasks: the first writes a.txt, the second changes a.txt and adds
 *  b.txt, the third changes b.txt. */
async function threeTasks(driver: LocalDriver) {
  write('a.txt', 'a0\n');
  const agent = standIn(driver, {
    'first task': () => write('a.txt', 'a1\n'),
    'second task': () => {
      write('a.txt', 'a2\n');
      write('b.txt', 'b2\n');
    },
    'third task': () => write('b.txt', 'b3\n'),
  });
  const seen = record(driver);
  await task(driver, 'first task');
  await task(driver, 'second task');
  await task(driver, 'third task');
  return { agent, seen };
}

describe('rewind puts the chat and the files back', () => {
  it("resets the model's history to the turns before the message, and the files with it", async () => {
    const driver = new LocalDriver(folder, { persist: false, checkpoints: true });
    const { agent, seen } = await threeTasks(driver);
    expect(read('a.txt')).toBe('a2\n');
    expect(read('b.txt')).toBe('b3\n');

    const result = await driver.rewind(taskSeq(seen, 'second task'), { files: true });
    expect(result).toEqual({ ok: true, paths: ['b.txt', 'a.txt'] });
    // The files are as they were before the second task: b.txt did not exist.
    expect(read('a.txt')).toBe('a1\n');
    expect(() => read('b.txt')).toThrow();
    // The model remembers only the first exchange.
    expect(agent.history).toEqual([
      { role: 'user', content: 'first task' },
      { role: 'assistant', content: 'Done: first task.' },
    ]);
    // One marker, after the restores it names.
    const rewound = seen.filter((e) => e.event.type === 'rewound');
    expect(rewound.map((e) => e.event)).toEqual([
      { type: 'rewound', toSeq: taskSeq(seen, 'second task'), paths: ['b.txt', 'a.txt'] },
    ]);
    const restores = seen.filter((e) => e.event.type === 'checkpoint-restored');
    expect(restores.every((e) => e.seq < rewound[0]!.seq)).toBe(true);
  });

  it('chat only leaves the files as they are and names them as kept', async () => {
    const driver = new LocalDriver(folder, { persist: false, checkpoints: true });
    const { agent, seen } = await threeTasks(driver);
    const result = await driver.rewind(taskSeq(seen, 'second task'), { files: false });
    expect(result).toEqual({ ok: true, paths: [] });
    expect(read('a.txt')).toBe('a2\n');
    expect(read('b.txt')).toBe('b3\n');
    expect(agent.history).toHaveLength(2);
    const rewound = seen.find((e) => e.event.type === 'rewound')!.event as Rewound;
    expect(rewound.paths).toEqual([]);
    expect(rewound.kept?.sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('passes over a checkpoint the person already undid', async () => {
    const driver = new LocalDriver(folder, { persist: false, checkpoints: true });
    const { seen } = await threeTasks(driver);
    const third = seen.filter((e) => e.event.type === 'checkpoint').at(-1)!.event as Extract<
      DriverEvent,
      { type: 'checkpoint' }
    >;
    expect(await driver.restoreCheckpoint(third.id, 'undo')).toEqual({
      ok: true,
      paths: ['b.txt'],
    });
    const result = await driver.rewind(taskSeq(seen, 'second task'), { files: true });
    expect(result).toEqual({ ok: true, paths: ['a.txt', 'b.txt'] });
    expect(read('a.txt')).toBe('a1\n');
    expect(() => read('b.txt')).toThrow();
  });

  it('refuses a message that is not in the chat, or one a rewind already took back', async () => {
    const driver = new LocalDriver(folder, { persist: false, checkpoints: true });
    const { seen } = await threeTasks(driver);
    const notAMessage = seen.find((e) => e.event.type === 'text-final')!.seq;
    expect(await driver.rewind(notAMessage, { files: false })).toEqual({
      error: 'That message is not in this chat any more.',
    });
    expect(await driver.rewind(taskSeq(seen, 'second task'), { files: false })).toMatchObject({
      ok: true,
    });
    expect(await driver.rewind(taskSeq(seen, 'third task'), { files: false })).toEqual({
      error: 'That message is not in this chat any more.',
    });
  });
});

describe('a rewind is replayed the same way everywhere', () => {
  it('a revived session seeds the same history the live one was reset to', async () => {
    const live = new LocalDriver(folder, { id: 'rw1', checkpoints: true });
    const { agent, seen } = await threeTasks(live);
    await live.rewind(taskSeq(seen, 'second task'), { files: true });
    // The person carries on from there.
    await task(live, 'another second task');
    live.dispose();

    const revived = new LocalDriver(folder, { id: 'rw1', checkpoints: true });
    const journal = revived.replayJournal();
    expect(journal.some((e) => e.event.type === 'rewound')).toBe(true);
    const seeded = seedHistoryFromEvents(journal);
    expect(seeded).toEqual([
      { role: 'user', content: 'first task' },
      { role: 'assistant', content: 'Done: first task.' },
      { role: 'user', content: 'another second task' },
      { role: 'assistant', content: 'Done: another second task.' },
    ]);
    // The live model's history says the same words (its user turn also
    // carried the preamble that named the files).
    expect(agent.history.map((m) => m.role)).toEqual(seeded.map((m) => m.role));
    expect(agent.history[2]!.content).toContain('another second task');
    // Only the turns the person can still see are in the live journal view.
    const inputs = liveJournal(journal).flatMap(({ event }) =>
      event.type === 'task-start' ? [event.input] : [],
    );
    expect(inputs).toEqual(['first task', 'another second task']);
  });

  it('a later rewind to an earlier message takes an earlier rewind back with it', () => {
    const journal: JournalEntry[] = [
      { seq: 1, event: { type: 'task-start', input: 'one' } },
      { seq: 2, event: { type: 'text-final', text: 'One.' } },
      { seq: 3, event: { type: 'task-start', input: 'two' } },
      { seq: 4, event: { type: 'text-final', text: 'Two.' } },
      { seq: 5, event: { type: 'task-start', input: 'three' } },
      { seq: 6, event: { type: 'text-final', text: 'Three.' } },
      { seq: 7, event: { type: 'rewound', toSeq: 5, paths: [] } },
      { seq: 8, event: { type: 'task-start', input: 'three again' } },
      { seq: 9, event: { type: 'text-final', text: 'Three again.' } },
      { seq: 10, event: { type: 'rewound', toSeq: 3, paths: ['a.txt'] } },
    ];
    expect(seedHistoryFromEvents(journal)).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'One.' },
    ]);
    // Plain events read as the journal numbers them, 1 to N.
    expect(seedHistoryFromEvents(journal.map((e) => e.event))).toEqual(
      seedHistoryFromEvents(journal),
    );
  });
});

describe('a rewind waits for the agent, and stops at the first failure', () => {
  it('is refused while a task runs, and while one waits in the queue', async () => {
    const driver = new LocalDriver(folder, { persist: false, checkpoints: true });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let started = false;
    driver.attachAgent({
      run: (text: string) => {
        started = true;
        driver.emit({ type: 'task-start', input: text });
        return gate;
      },
      generateTitle: async () => undefined,
      flushHandoff: () => undefined,
      history: [],
    } as never);
    driver.send('long task');
    await waitFor(() => started);
    const busy = { error: 'Wait for the current step to finish, then rewind.' };
    expect(await driver.rewind(1, { files: true })).toEqual(busy);
    release();
    await waitFor(() => !driver.busy);
    // A message waiting its turn counts too.
    (driver as unknown as { queue: unknown[] }).queue.push({ text: 'queued task' });
    expect(await driver.rewind(1, { files: false })).toEqual(busy);
  });

  it('stops at a checkpoint it cannot restore, says what went back, and keeps the chat', async () => {
    const driver = new LocalDriver(folder, { persist: false, checkpoints: true });
    const { agent, seen } = await threeTasks(driver);
    const ids = seen.flatMap(({ event }) => (event.type === 'checkpoint' ? [event.id] : []));
    expect(ids).toHaveLength(3);
    // The second task's checkpoint has aged out of this computer's store.
    const storePath = join(checkpointDir(folder), 'checkpoints.json');
    const store = JSON.parse(readFileSync(storePath, 'utf8')) as {
      records: Array<{ id: string }>;
    };
    store.records = store.records.filter((r) => r.id !== ids[1]);
    writeFileSync(storePath, JSON.stringify(store));
    const historyBefore = [...agent.history];

    const result = await driver.rewind(taskSeq(seen, 'first task'), { files: true });
    expect('error' in result && result.error).toBe(
      'The rewind stopped partway: That checkpoint is not on this computer any more. The chat stays as it was, and these files already went back: b.txt.',
    );
    // The third task's change went back; the rest stayed.
    expect(read('b.txt')).toBe('b2\n');
    expect(read('a.txt')).toBe('a2\n');
    // No marker, the model's history untouched, and a note on every device.
    expect(seen.some((e) => e.event.type === 'rewound')).toBe(false);
    expect(agent.history).toEqual(historyBefore);
    const error = 'error' in result ? result.error : '';
    expect(seen.some((e) => e.event.type === 'note' && e.event.message === error)).toBe(true);
    // The files that did go back ride the next task's preamble.
    await task(driver, 'fourth task');
    expect(agent.preambles.at(-1)).toContain('[undo]');
    expect(agent.preambles.at(-1)).toContain('b.txt');
  });

  it('says so plainly when nothing could go back', async () => {
    const driver = new LocalDriver(folder, { persist: false, checkpoints: true });
    const { agent, seen } = await threeTasks(driver);
    rmSync(join(checkpointDir(folder), 'checkpoints.json'));
    const result = await driver.rewind(taskSeq(seen, 'second task'), { files: true });
    expect(result).toEqual({
      error:
        'The rewind stopped: That checkpoint is not on this computer any more. The chat and its files stay as they were.',
    });
    expect(agent.history).toHaveLength(6);
    expect(read('b.txt')).toBe('b3\n');
  });
});

describe('the model hears what changed under it (the fix: Undo used to tell it nothing)', () => {
  it("after an Undo, the next task's preamble names the files put back, once", async () => {
    const driver = new LocalDriver(folder, { persist: false, checkpoints: true });
    write('index.html', 'before\n');
    const agent = standIn(driver, { 'make the page': () => write('index.html', 'after\n') });
    const seen = record(driver);
    await task(driver, 'make the page');
    const checkpoint = seen.find((e) => e.event.type === 'checkpoint')!.event as Extract<
      DriverEvent,
      { type: 'checkpoint' }
    >;
    await driver.restoreCheckpoint(checkpoint.id, 'undo');

    await task(driver, 'now add a title');
    const note = agent.preambles.at(-1)!;
    expect(note).toContain('[undo]');
    expect(note).toContain('index.html');
    expect(note).toContain('back to how they were before');
    // The model's own user turn carries it; the transcript shows only the words.
    expect(agent.history.at(-2)!.content).toContain('index.html');
    expect(seen.filter((e) => e.event.type === 'task-start').at(-1)!.event).toEqual({
      type: 'task-start',
      input: 'now add a title',
    });

    // Said once: the task after that hears nothing about it.
    await task(driver, 'and a footer');
    expect(agent.preambles.at(-1)).toBeUndefined();
  });

  it('a Redo is named too, and a revived session still says it', async () => {
    write('index.html', 'before\n');
    const driver = new LocalDriver(folder, { id: 'rw2', checkpoints: true });
    standIn(driver, { 'make the page': () => write('index.html', 'after\n') });
    const seen = record(driver);
    await task(driver, 'make the page');
    const checkpoint = seen.find((e) => e.event.type === 'checkpoint')!.event as Extract<
      DriverEvent,
      { type: 'checkpoint' }
    >;
    await driver.restoreCheckpoint(checkpoint.id, 'undo');
    await driver.restoreCheckpoint(checkpoint.id, 'redo');
    driver.dispose();

    const revived = new LocalDriver(folder, { id: 'rw2', checkpoints: true });
    const agent = standIn(revived);
    await task(revived, 'keep going');
    const note = agent.preambles.at(-1)!;
    expect(note).toContain('[undo]');
    expect(note).toContain('[redo] The person redid changes');
    expect(note.indexOf('[undo]')).toBeLessThan(note.indexOf('[redo]'));
  });

  it('after a rewind, the next preamble names the files that went back or stayed', async () => {
    const driver = new LocalDriver(folder, { persist: false, checkpoints: true });
    const { agent, seen } = await threeTasks(driver);
    await driver.rewind(taskSeq(seen, 'third task'), { files: true });
    await task(driver, 'a different third task');
    expect(agent.preambles.at(-1)).toContain(
      '[rewind] The person rewound this chat to an earlier message. These files went back to how they were then: b.txt.',
    );

    await driver.rewind(taskSeq(seen, 'second task'), { files: false });
    await task(driver, 'a different second task');
    const note = agent.preambles.at(-1)!;
    expect(note).toContain('changed after that message and stayed as they are');
    expect(note).toContain('a.txt');
  });

  it('restoreNotes reads only what happened since the last live message', () => {
    const journal: JournalEntry[] = [
      { seq: 1, event: { type: 'task-start', input: 'one' } },
      { seq: 2, event: { type: 'checkpoint-restored', id: 'k', direction: 'undo', paths: ['x'] } },
      { seq: 3, event: { type: 'task-start', input: 'two' } },
      { seq: 4, event: { type: 'text-final', text: 'Two.' } },
    ];
    expect(restoreNotes(journal)).toEqual([]);
    // Taking "two" back brings the undo it was told about back too: its
    // preamble is gone from the model's history with it.
    const back = [
      ...journal,
      { seq: 5, event: { type: 'rewound', toSeq: 3, paths: [] } } as JournalEntry,
    ];
    expect(restoreNotes(back)).toHaveLength(1);
    expect(restoreNotes(back)[0]).toContain('[undo]');
  });

  it('rewindKept leaves out what went back, and with the files only earlier undos stay', () => {
    const journal: JournalEntry[] = [
      {
        seq: 1,
        event: { type: 'checkpoint', id: 'w', files: [{ path: 'w.txt', status: 'modified' }] },
      },
      { seq: 2, event: { type: 'task-start', input: 'x' } },
      {
        seq: 3,
        event: { type: 'checkpoint', id: 'x', files: [{ path: 'x.txt', status: 'added' }] },
      },
      {
        seq: 4,
        event: { type: 'checkpoint-restored', id: 'w', direction: 'undo', paths: ['w.txt'] },
      },
    ];
    expect(rewindKept(journal, 2, false, []).sort()).toEqual(['w.txt', 'x.txt']);
    expect(rewindKept(journal, 2, true, ['x.txt'])).toEqual(['w.txt']);
  });
});

async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
