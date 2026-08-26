// The PTY host with a FAKE pty injected: no node-pty needed, which is the whole
// point. These pin the ring buffer, offset-based replay across a reattach, and
// write/resize/kill routed to the pty, plus that a killed terminal stops
// accepting input.
import { describe, expect, it } from 'vitest';
import {
  RingBuffer,
  TerminalManager,
  type TerminalPty,
  type PtyFactory,
} from '../src/daemon/terminal.js';

/** A pty stand-in the manager drives. Records writes/resizes/kills and lets the
 *  test push output as the real pty would. */
class FakePty implements TerminalPty {
  writes: string[] = [];
  resizes: Array<{ cols: number; rows: number }> = [];
  killed = false;
  private dataCb?: (data: string) => void;
  private exitCb?: (info: { exitCode: number }) => void;

  write(data: string): void {
    this.writes.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }
  kill(): void {
    this.killed = true;
    this.exitCb?.({ exitCode: 0 });
  }
  onData(cb: (data: string) => void): void {
    this.dataCb = cb;
  }
  onExit(cb: (info: { exitCode: number }) => void): void {
    this.exitCb = cb;
  }
  // Test helper: emit output as the pty produced it.
  emit(text: string): void {
    this.dataCb?.(text);
  }
}

function managerWith(pty: FakePty, ringBytes?: number): TerminalManager {
  const spawn: PtyFactory = async () => pty;
  return new TerminalManager({ spawn, ringBytes });
}

describe('RingBuffer (absolute offsets)', () => {
  it('replays exactly the tail since a given offset', () => {
    const ring = new RingBuffer(1024);
    ring.append(Buffer.from('abc'));
    ring.append(Buffer.from('def'));
    expect(ring.end).toBe(6);
    expect(ring.since(0).data.toString()).toBe('abcdef');
    expect(ring.since(3).data.toString()).toBe('def');
    expect(ring.since(6).data.toString()).toBe('');
  });

  it('drops the oldest bytes past the cap and advances the base offset', () => {
    const ring = new RingBuffer(4);
    ring.append(Buffer.from('abcdef')); // over cap: keeps the last 4 ("cdef")
    expect(ring.end).toBe(6);
    // Asking since 0 (older than what is retained) yields the whole window, and
    // the end offset still reports the true total so the client cannot silently
    // miss the gap.
    const replay = ring.since(0);
    expect(replay.data.toString()).toBe('cdef');
    expect(replay.endOffset).toBe(6);
    expect(ring.since(4).data.toString()).toBe('ef');
  });

  it('tail returns the last N retained bytes', () => {
    const ring = new RingBuffer(1024);
    ring.append(Buffer.from('hello world'));
    expect(ring.tail(5).toString()).toBe('world');
    expect(ring.tail(100).toString()).toBe('hello world');
  });
});

describe('TerminalManager with an injected fake pty', () => {
  it('creates a terminal and streams live output to a subscriber', async () => {
    const pty = new FakePty();
    const mgr = managerWith(pty);
    const { termId } = await mgr.ensure({ sessionId: 's1', cwd: '/tmp', cols: 100, rows: 30 });
    expect(mgr.has(termId)).toBe(true);

    const chunks: Array<{ text: string; offset: number }> = [];
    const off = mgr.subscribe(termId, 0, (data, endOffset) => {
      chunks.push({ text: data.toString(), offset: endOffset });
    });
    expect(off).toBeTypeOf('function');

    pty.emit('one\n');
    pty.emit('two\n');
    expect(chunks.map((c) => c.text)).toEqual(['one\n', 'two\n']);
    // Offsets are absolute and monotonic.
    expect(chunks[0]!.offset).toBe(4);
    expect(chunks[1]!.offset).toBe(8);
  });

  it('replays the ring buffer from an offset when a client reattaches', async () => {
    const pty = new FakePty();
    const mgr = managerWith(pty);
    const { termId } = await mgr.ensure({ sessionId: 's1', cwd: '/tmp' });

    // First client sees everything, then drops.
    const first: string[] = [];
    const off1 = mgr.subscribe(termId, 0, (d) => first.push(d.toString()));
    pty.emit('aaaa'); // offset -> 4
    pty.emit('bbbb'); // offset -> 8
    off1!();

    // The terminal kept running while nobody watched; new output arrives.
    pty.emit('cccc'); // offset -> 12

    // A reattaching client resumes from offset 4 and must see b then c, not a.
    const replayed: string[] = [];
    mgr.subscribe(termId, 4, (d) => replayed.push(d.toString()));
    expect(replayed.join('')).toBe('bbbbcccc');
    // And it keeps receiving live output after the replay.
    pty.emit('dddd');
    expect(replayed.join('')).toBe('bbbbccccdddd');
    expect(first).toEqual(['aaaa', 'bbbb']);
  });

  it('routes write and resize to the pty', async () => {
    const pty = new FakePty();
    const mgr = managerWith(pty);
    const { termId } = await mgr.ensure({ sessionId: 's1', cwd: '/tmp' });
    expect(mgr.write(termId, 'ls\n')).toBe(true);
    expect(pty.writes).toEqual(['ls\n']);
    expect(mgr.resize(termId, 120, 40)).toBe(true);
    expect(pty.resizes.at(-1)).toEqual({ cols: 120, rows: 40 });
  });

  it('kill stops the pty and refuses further writes', async () => {
    const pty = new FakePty();
    const mgr = managerWith(pty);
    const { termId } = await mgr.ensure({ sessionId: 's1', cwd: '/tmp' });
    expect(mgr.kill(termId)).toBe(true);
    expect(pty.killed).toBe(true);
    expect(mgr.has(termId)).toBe(false);
    // Writes, resizes, and a second kill on a gone terminal are clean falses.
    expect(mgr.write(termId, 'x')).toBe(false);
    expect(mgr.resize(termId, 80, 24)).toBe(false);
    expect(mgr.kill(termId)).toBe(false);
    expect(mgr.subscribe(termId, 0, () => {})).toBeUndefined();
  });

  it('readForSession returns the most recent terminal tail, scoped to the session', async () => {
    const pty = new FakePty();
    const mgr = managerWith(pty);
    const { termId } = await mgr.ensure({ sessionId: 's1', cwd: '/tmp' });
    pty.emit('line one\nline two\nline three\n');
    const tail = mgr.readForSession('s1', 2);
    expect(tail).toContain('line two');
    expect(tail).toContain('line three');
    expect(tail).not.toContain('line one');
    // A different session sees nothing (no cross-session leak).
    expect(mgr.readForSession('other', 10)).toBeUndefined();
    // Targeting an unknown termId yields undefined too.
    expect(mgr.readForSession('s1', 10, 'no-such')).toBeUndefined();
    expect(termId).toBeTruthy();
  });

  it('ensure is idempotent on an existing termId and resizes it', async () => {
    const pty = new FakePty();
    const mgr = managerWith(pty);
    const first = await mgr.ensure({ sessionId: 's1', cwd: '/tmp', cols: 80, rows: 24 });
    const again = await mgr.ensure({
      sessionId: 's1',
      termId: first.termId,
      cwd: '/tmp',
      cols: 120,
      rows: 40,
    });
    expect(again.termId).toBe(first.termId);
    expect(pty.resizes.at(-1)).toEqual({ cols: 120, rows: 40 });
  });
});
