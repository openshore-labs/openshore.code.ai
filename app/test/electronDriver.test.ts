// G1: on resume the main process returns the session journal (IPC does not
// buffer a pushed replay), and the ElectronDriver replays it into each sink on
// subscribe, ahead of any live event. Without this, a reopened desktop
// conversation renders blank.
import { afterEach, describe, expect, it } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { ElectronDriver } from '../src/drivers/electronDriver.js';

type EventPayload = { sessionId: string; seq: number; event: DriverEvent };

type CommandCall = { method: string; args: unknown[] };

function installBridge(runId: string | undefined = 'r1') {
  let liveCb: ((p: EventPayload) => void) | undefined;
  const calls: CommandCall[] = [];
  (globalThis as unknown as { window: unknown }).window = {
    oscode: {
      onEvent: (cb: (p: EventPayload) => void) => {
        liveCb = cb;
        return () => {
          liveCb = undefined;
        };
      },
      runCommand: (...args: unknown[]) => {
        calls.push({ method: 'runCommand', args });
        return Promise.resolve(runId);
      },
      sendCommandStdin: (...args: unknown[]) => {
        calls.push({ method: 'sendCommandStdin', args });
        return Promise.resolve();
      },
      killCommand: (...args: unknown[]) => {
        calls.push({ method: 'killCommand', args });
        return Promise.resolve();
      },
    },
  };
  return { emitLive: (p: EventPayload) => liveCb?.(p), calls };
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

describe('ElectronDriver chat-to-terminal lane', () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('runCommand forwards the sessionId and returns the runId', async () => {
    const bridge = installBridge('run-42');
    const driver = new ElectronDriver('s1');
    const runId = await driver.runCommand('npm test');
    expect(runId).toBe('run-42');
    expect(bridge.calls).toEqual([{ method: 'runCommand', args: ['s1', 'npm test'] }]);
    driver.dispose();
  });

  it('sendStdin and killCommand forward the sessionId and runId', () => {
    const bridge = installBridge();
    const driver = new ElectronDriver('s1');
    driver.sendStdin('run-7', 'y\n');
    driver.killCommand('run-7');
    expect(bridge.calls).toEqual([
      { method: 'sendCommandStdin', args: ['s1', 'run-7', 'y\n'] },
      { method: 'killCommand', args: ['s1', 'run-7'] },
    ]);
    driver.dispose();
  });

  it('command-* events for this session reach the sink (CommandCard renders)', () => {
    const bridge = installBridge();
    const driver = new ElectronDriver('s1');
    const seen: Array<{ seq: number; type: string }> = [];
    driver.subscribe((event, seq) => seen.push({ seq, type: event.type }));

    bridge.emitLive({
      sessionId: 's1',
      seq: 4,
      event: {
        type: 'command-start',
        runId: 'run-7',
        command: 'ls',
        cwd: '/tmp',
        source: 'user',
      } as DriverEvent,
    });
    bridge.emitLive({
      sessionId: 's1',
      seq: 5,
      event: {
        type: 'command-output',
        runId: 'run-7',
        chunk: 'file',
        stream: 'stdout',
      } as DriverEvent,
    });
    bridge.emitLive({
      sessionId: 's1',
      seq: 6,
      event: {
        type: 'command-end',
        runId: 'run-7',
        exitCode: 0,
        durationMs: 12,
        truncated: false,
      } as DriverEvent,
    });

    expect(seen).toEqual([
      { seq: 4, type: 'command-start' },
      { seq: 5, type: 'command-output' },
      { seq: 6, type: 'command-end' },
    ]);
    driver.dispose();
  });
});

describe('ElectronDriver interactive terminal (Phase 2)', () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  function installTermBridge() {
    let termCb: ((p: { termId: string; b64: string; offset: number }) => void) | undefined;
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const rec =
      (method: string, ret?: unknown) =>
      (...args: unknown[]) => {
        calls.push({ method, args });
        return Promise.resolve(ret);
      };
    (globalThis as unknown as { window: unknown }).window = {
      oscode: {
        onEvent: () => () => {},
        onTerminalData: (cb: (p: { termId: string; b64: string; offset: number }) => void) => {
          termCb = cb;
          return () => {
            termCb = undefined;
          };
        },
        openTerminal: rec('openTerminal', { termId: 'tm1', cols: 100, rows: 30 }),
        terminalSubscribe: rec('terminalSubscribe', true),
        terminalUnsubscribe: rec('terminalUnsubscribe'),
        terminalStdin: rec('terminalStdin', true),
        terminalResize: rec('terminalResize', true),
        terminalKill: rec('terminalKill', true),
      },
    };
    return { calls, emit: (p: { termId: string; b64: string; offset: number }) => termCb?.(p) };
  }

  it('opens a terminal via the bridge', async () => {
    const bridge = installTermBridge();
    const driver = new ElectronDriver('s1');
    const opened = await driver.openTerminal({ cols: 100, rows: 30 });
    expect(opened).toEqual({ termId: 'tm1', cols: 100, rows: 30 });
    expect(bridge.calls[0]).toEqual({ method: 'openTerminal', args: ['s1', 100, 30] });
    driver.dispose();
  });

  it('streams forwarded output to onChunk and unsubscribes on abort', async () => {
    const bridge = installTermBridge();
    const driver = new ElectronDriver('s1');
    const chunks: Array<{ text: string; offset: number }> = [];
    const ac = new AbortController();
    const streamP = driver.terminalStream(
      'tm1',
      0,
      (bytes, offset) => chunks.push({ text: new TextDecoder().decode(bytes), offset }),
      ac.signal,
    );
    // A chunk for tm1 lands; a chunk for another terminal is ignored.
    bridge.emit({ termId: 'tm1', b64: btoa('hello'), offset: 5 });
    bridge.emit({ termId: 'other', b64: btoa('nope'), offset: 4 });
    expect(chunks).toEqual([{ text: 'hello', offset: 5 }]);
    expect(bridge.calls.some((c) => c.method === 'terminalSubscribe')).toBe(true);

    ac.abort();
    await streamP; // resolves on abort
    expect(bridge.calls.some((c) => c.method === 'terminalUnsubscribe')).toBe(true);
    driver.dispose();
  });

  it('forwards stdin, resize, and kill to the bridge', () => {
    const bridge = installTermBridge();
    const driver = new ElectronDriver('s1');
    driver.terminalStdin('tm1', 'ls\n');
    driver.terminalResize('tm1', 120, 40);
    driver.terminalKill('tm1');
    expect(bridge.calls.find((c) => c.method === 'terminalStdin')?.args).toEqual(['tm1', 'ls\n']);
    expect(bridge.calls.find((c) => c.method === 'terminalResize')?.args).toEqual(['tm1', 120, 40]);
    expect(bridge.calls.find((c) => c.method === 'terminalKill')?.args).toEqual(['tm1']);
    driver.dispose();
  });
});
