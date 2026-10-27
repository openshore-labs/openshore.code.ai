// Chats live in their own sealed file on the iPhone (2026-10-27, "my chats
// aren't saving"): UserDefaults will not persist a domain of 4 MB or more, and
// says nothing, so the whole history no longer rides in Preferences. These
// pin the move out of Preferences, the sealed atomic write, and that a file
// that cannot be opened is never written over.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  platform: 'ios' as 'ios' | 'web',
  files: new Map<string, string>(),
  prefs: new Map<string, string>(),
  locked: false,
  failWrite: false,
  refuseOverwrite: false,
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Library: 'LIBRARY' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path }: { path: string }) => {
      const data = h.files.get(path);
      if (data === undefined) throw new Error('File does not exist');
      return { data };
    },
    stat: async ({ path }: { path: string }) => {
      if (!h.files.has(path)) throw new Error('File does not exist');
      return { type: 'file' };
    },
    writeFile: async ({ path, data }: { path: string; data: string }) => {
      if (h.failWrite) throw new Error('No space');
      h.files.set(path, data);
      return { uri: path };
    },
    deleteFile: async ({ path }: { path: string }) => {
      h.files.delete(path);
    },
    rename: async ({ from, to }: { from: string; to: string }) => {
      if (h.refuseOverwrite && h.files.has(to)) throw new Error('File exists');
      const data = h.files.get(from);
      if (data === undefined) throw new Error('File does not exist');
      h.files.delete(from);
      h.files.set(to, data);
    },
  },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => h.platform,
  sealBlob: async (text: string) => (h.locked ? null : `SEALED:${text}`),
  openBlob: async (blob: string) =>
    h.locked || !blob.startsWith('SEALED:') ? null : blob.slice('SEALED:'.length),
  storeGetJson: async (key: string) => {
    const v = h.prefs.get(key);
    return v === undefined ? undefined : JSON.parse(v);
  },
  storeSetJson: async (key: string, value: unknown) => {
    h.prefs.set(key, JSON.stringify(value));
  },
  storeDelete: async (key: string) => {
    h.prefs.delete(key);
  },
}));

const KEY = 'oscode.conversations.v1';
const FILE = 'oscode-store/oscode.conversations.v1.sealed';

async function fresh() {
  vi.resetModules();
  return import('../src/lib/largeStore.js');
}

beforeEach(() => {
  h.platform = 'ios';
  h.files.clear();
  h.prefs.clear();
  h.locked = false;
  h.failWrite = false;
  h.refuseOverwrite = false;
});

describe('large values on the iPhone', () => {
  it('reads the chats still in Preferences, then moves them to a sealed file', async () => {
    h.prefs.set(KEY, JSON.stringify({ order: ['a'] }));
    const { largeGetJson, largeSetJson } = await fresh();
    expect(await largeGetJson(KEY)).toEqual({ order: ['a'] });
    expect(await largeSetJson(KEY, { order: ['b', 'a'] })).toBe(true);
    expect(h.files.get(FILE)).toBe('SEALED:{"order":["b","a"]}');
    // Gone from Preferences, which frees the domain for everything else.
    expect(h.prefs.has(KEY)).toBe(false);
    expect([...h.files.keys()]).toEqual([FILE]);
  });

  it('reads the file back after a relaunch', async () => {
    let s = await fresh();
    await s.largeGetJson(KEY);
    await s.largeSetJson(KEY, { order: ['x'] });
    s = await fresh();
    expect(await s.largeGetJson(KEY)).toEqual({ order: ['x'] });
  });

  it('a locked key writes nothing, in the clear or over the file', async () => {
    h.files.set(FILE, 'SEALED:{"order":["kept"]}');
    h.locked = true;
    const { largeGetJson, largeSetJson } = await fresh();
    expect(await largeGetJson(KEY)).toBeUndefined();
    expect(await largeSetJson(KEY, { order: [] })).toBe(false);
    expect(h.files.get(FILE)).toBe('SEALED:{"order":["kept"]}');
  });

  it('a file that will not open under this key is copied aside before a save', async () => {
    h.files.set(FILE, 'OTHER-KEY:bytes');
    const { largeGetJson, largeSetJson } = await fresh();
    expect(await largeGetJson(KEY)).toBeUndefined();
    expect(await largeSetJson(KEY, { order: ['new'] })).toBe(true);
    const aside = [...h.files.keys()].find((k) => k.startsWith(`${FILE}.recovery.`));
    expect(aside && h.files.get(aside)).toBe('OTHER-KEY:bytes');
    expect(h.files.get(FILE)).toBe('SEALED:{"order":["new"]}');
  });

  it('a refused write answers false and keeps Preferences as it was', async () => {
    h.prefs.set(KEY, JSON.stringify({ order: ['a'] }));
    const { largeGetJson, largeSetJson } = await fresh();
    await largeGetJson(KEY);
    h.failWrite = true;
    expect(await largeSetJson(KEY, { order: ['b'] })).toBe(false);
    expect(h.prefs.get(KEY)).toBe('{"order":["a"]}');
  });

  it('saves over the file when the file manager will not move onto it', async () => {
    h.refuseOverwrite = true;
    const { largeGetJson, largeSetJson } = await fresh();
    await largeGetJson(KEY);
    expect(await largeSetJson(KEY, { n: 1 })).toBe(true);
    expect(await largeSetJson(KEY, { n: 2 })).toBe(true);
    expect(h.files.get(FILE)).toBe('SEALED:{"n":2}');
    expect([...h.files.keys()]).toEqual([FILE]);
  });

  it('a save cut off before its rename is read from the temp file', async () => {
    h.files.set(`${FILE}.tmp`, 'SEALED:{"order":["mid"]}');
    const { largeGetJson } = await fresh();
    expect(await largeGetJson(KEY)).toEqual({ order: ['mid'] });
  });

  it('saves in order', async () => {
    const { largeGetJson, largeSetJson } = await fresh();
    await largeGetJson(KEY);
    await Promise.all([largeSetJson(KEY, { n: 1 }), largeSetJson(KEY, { n: 2 })]);
    expect(h.files.get(FILE)).toBe('SEALED:{"n":2}');
  });
});

describe('off the iPhone', () => {
  it('is the ordinary sealed store', async () => {
    h.platform = 'web';
    const { largeGetJson, largeSetJson } = await fresh();
    expect(await largeSetJson(KEY, { order: ['d'] })).toBe(true);
    expect(await largeGetJson(KEY)).toEqual({ order: ['d'] });
    expect(h.files.size).toBe(0);
  });
});
