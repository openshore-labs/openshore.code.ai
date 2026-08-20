// G1: on resume the main process returns the session journal (IPC does not
// buffer a pushed replay), and the ElectronDriver replays it into each sink on
// subscribe, ahead of any live event. Without this, a reopened desktop
// conversation renders blank.
import { afterEach, describe, expect, it } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { ElectronDriver } from '../src/drivers/electronDriver.js';

type EventPayload = { sessionId: string; seq: number; event: DriverEvent };

function installBridge() {
  let liveCb: ((p: EventPayload) => void) | undefined;
  (globalThis as unknown as { window: unknown }).window = {
    oscode: {
      onEvent: (cb: (p: EventPayload) => void) => {
        liveCb = cb;
        return () => {
          liveCb = undefined;
        };
      },
    },
  };
  return { emitLive: (p: EventPayload) => liveCb?.(p) };
}

describe('ElectronDriver journal replay (G1)', () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('replays the resume journal on subscribe, then live events follow', () => {
    const bridge = installBridge();
    const journal = [
      { seq: 1, event: { type: 'task-start', input: 'hi' } as DriverEvent },
      { seq: 2, event: { type: 'text-final', text: 'hello there' } as DriverEvent },
    ];
    const driver = new ElectronDriver('s1', journal);
    const seen: Array<{ seq: number; type: string }> = [];
    driver.subscribe((event, seq) => seen.push({ seq, type: event.type }));

    // The journal replayed in order, before any live event.
    expect(seen).toEqual([
      { seq: 1, type: 'task-start' },
      { seq: 2, type: 'text-final' },
    ]);

    // A live event for this session appends after the journal.
    bridge.emitLive({
      sessionId: 's1',
      seq: 3,
      event: { type: 'task-done', reason: 'complete' } as DriverEvent,
    });
    expect(seen[seen.length - 1]).toEqual({ seq: 3, type: 'task-done' });

    // A live event for a different session is ignored.
    bridge.emitLive({
      sessionId: 'other',
      seq: 9,
      event: { type: 'task-done', reason: 'complete' } as DriverEvent,
    });
    expect(seen).toHaveLength(3);
    driver.dispose();
  });

  it('a fresh session (no journal) replays nothing', () => {
    installBridge();
    const driver = new ElectronDriver('s2');
    const seen: number[] = [];
    driver.subscribe((_event, seq) => seen.push(seq));
    expect(seen).toEqual([]);
    driver.dispose();
  });
});
