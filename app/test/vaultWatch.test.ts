// The vault folder watcher (Vault M1, tech review F3), with fs.watch injected: the
// path filter keeps only notes (never our own temp files, `.obsidian/`, or an
// attachment), a change it cannot name becomes a tree change, events are
// debounced (300 ms trailing, 1 s at most) into one { paths, tree }, a flood
// becomes a tree change, Linux watches the root plus the open note's folder
// (never recursive), and a root that goes away is said once, never respawned.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VaultWatcher,
  vaultWatchEvent,
  type VaultChange,
  type WatchFn,
} from '../electron/vaultWatch.js';

type Armed = {
  path: string;
  options: { recursive?: boolean; persistent: boolean };
  emit: (filename: string | null) => void;
  fail: () => void;
  closed: boolean;
};

function harness(platform: NodeJS.Platform) {
  const armed: Armed[] = [];
  const sent: VaultChange[] = [];
  const watch: WatchFn = (path, options, listener) => {
    let onError: ((err: unknown) => void) | undefined;
    const a: Armed = {
      path,
      options,
      emit: (f) => listener('change', f),
      fail: () => onError?.(new Error('EPERM')),
      closed: false,
    };
    armed.push(a);
    return {
      close: () => {
        a.closed = true;
      },
      on: (_e: 'error', cb: (err: unknown) => void) => {
        onError = cb;
      },
    };
  };
  const w = new VaultWatcher({ watch, platform, send: (c) => sent.push(c) });
  return { w, armed, sent };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the watch path filter', () => {
  it('keeps notes and drops dot paths, temp files, and attachments', () => {
    expect(vaultWatchEvent('Ideas.md')).toEqual({ path: 'Ideas.md' });
    expect(vaultWatchEvent('sub\\deep\\Note.md')).toEqual({ path: 'sub/deep/Note.md' });
    expect(vaultWatchEvent('Note.md', 'sub')).toEqual({ path: 'sub/Note.md' });
    expect(vaultWatchEvent('.Ideas.md.oscode-0a1b2c3d.tmp')).toBeNull();
    expect(vaultWatchEvent('.obsidian/workspace.json')).toBeNull();
    expect(vaultWatchEvent('.obsidian/Hidden.md')).toBeNull();
    expect(vaultWatchEvent('.git/index')).toBeNull();
    expect(vaultWatchEvent('diagram.png')).toBeNull();
  });

  it('a null name or a bare folder name is a tree change', () => {
    expect(vaultWatchEvent(null)).toEqual({ tree: true });
    expect(vaultWatchEvent('Projects')).toEqual({ tree: true });
    expect(vaultWatchEvent(Buffer.from('a.md'))).toEqual({ path: 'a.md' });
  });
});

describe('the watcher', () => {
  it('on macOS and Windows arms one recursive watch on the root', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const { w, armed } = harness(platform);
      w.start('/v', 'deep/Note.md');
      w.start('/v', 'other/Else.md');
      expect(armed).toHaveLength(1);
      expect(armed[0]!.options).toEqual({ recursive: true, persistent: false });
    }
  });

  it("on Linux watches the root and the open note's folder, re-armed when it changes", () => {
    const { w, armed } = harness('linux');
    w.start('/v', 'deep/Note.md');
    expect(armed.map((a) => [a.path, a.options.recursive])).toEqual([
      ['/v', undefined],
      ['/v/deep', undefined],
    ]);
    w.start('/v', 'other/Else.md');
    expect(armed[1]!.closed).toBe(true);
    expect(armed[2]!.path).toBe('/v/other');
    // A note at the root needs no second watch.
    w.start('/v', 'Top.md');
    expect(armed[2]!.closed).toBe(true);
    expect(armed).toHaveLength(3);
  });

  it('debounces events into one change, with folder-relative names mapped', () => {
    const { w, armed, sent } = harness('linux');
    w.start('/v', 'deep/Note.md');
    armed[1]!.emit('Note.md');
    armed[0]!.emit('Top.md');
    armed[0]!.emit('.Top.md.oscode-12345678.tmp');
    vi.advanceTimersByTime(299);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([{ paths: ['deep/Note.md', 'Top.md'], tree: false }]);
  });

  it('sends within 1 s even while events keep arriving', () => {
    const { w, armed, sent } = harness('darwin');
    w.start('/v');
    for (let i = 0; i < 6; i++) {
      armed[0]!.emit('a.md');
      vi.advanceTimersByTime(200);
    }
    expect(sent.length).toBe(1);
  });

  it('more than 200 paths becomes a tree change', () => {
    const { w, armed, sent } = harness('darwin');
    w.start('/v');
    for (let i = 0; i < 201; i++) armed[0]!.emit(`n${i}.md`);
    vi.advanceTimersByTime(300);
    expect(sent).toEqual([{ paths: [], tree: true }]);
  });

  it('a root that fails says rootGone once and does not respawn', () => {
    const { w, armed, sent } = harness('darwin');
    w.start('/v');
    armed[0]!.fail();
    expect(sent).toEqual([{ paths: [], tree: true, rootGone: true }]);
    expect(armed[0]!.closed).toBe(true);
    expect(w.watching).toBe(false);
    expect(armed).toHaveLength(1);
  });

  it('stop closes every watch and drops what was not sent', () => {
    const { w, armed, sent } = harness('linux');
    w.start('/v', 'd/n.md');
    armed[0]!.emit('a.md');
    w.stop();
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([]);
    expect(armed.every((a) => a.closed)).toBe(true);
  });
});
