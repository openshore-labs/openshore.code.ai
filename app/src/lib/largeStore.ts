// A value too large for the key-value store (2026-10-27, "my chats aren't
// saving"). On the iPhone the sealed store is Capacitor Preferences, which is
// UserDefaults, and iOS will not persist a UserDefaults domain of 4 MB or more:
// the write answers as if it worked, the value lives in memory for this launch,
// and it is gone after a relaunch. Every chat rode in one sealed value there,
// so a long enough history stopped saving without a word. A large value now
// lives in its own file in Library, sealed with the same device key (the way
// the vault index lives in Caches), written to a temp file and renamed so a
// kill mid-write never leaves half a file. The first save moves the value out
// of Preferences, which also frees the domain for everything else.
//
// Off the iPhone this is the ordinary sealed store, unchanged.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import {
  openBlob,
  platform,
  sealBlob,
  storeDelete,
  storeGetJson,
  storeSetJson,
} from './platform.js';

/** The folder in Library that holds the large values. Not in Documents, so it
 *  never shows in the Files app beside the OpenShore folder. */
export const LARGE_STORE_DIR = 'oscode-store';

const pathOf = (key: string) => `${LARGE_STORE_DIR}/${key}.sealed`;
const at = (path: string) => ({ path, directory: Directory.Library });

/** What a load found, so a save never overwrites a file it could not read. */
type FileState = 'missing' | 'read' | 'unreadable';
const fileState = new Map<string, FileState>();
const chains = new Map<string, Promise<unknown>>();

/** One write at a time per key, in the order they were asked for. */
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (chains.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  chains.set(key, run);
  return run;
}

async function readFileText(path: string): Promise<string | undefined> {
  try {
    const { data } = await Filesystem.readFile({ ...at(path), encoding: Encoding.UTF8 });
    return typeof data === 'string' ? data : undefined;
  } catch {
    return undefined;
  }
}

/** Rename `from` over `to`. iOS's file manager refuses to move onto an
 *  existing file, so when the rename is refused the old file goes first; a
 *  kill between the two leaves the temp file, which a load reads. */
async function moveOver(from: string, to: string): Promise<void> {
  const move = () =>
    Filesystem.rename({
      from,
      to,
      directory: Directory.Library,
      toDirectory: Directory.Library,
    });
  try {
    await move();
  } catch {
    await Filesystem.deleteFile(at(to)).catch(() => {});
    await move();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat(at(path));
    return true;
  } catch {
    return false;
  }
}

/** Read a large value. On the iPhone: the file, else (before its first save)
 *  the value still in Preferences. A file that is there but cannot be opened
 *  right now (a locked key) reads as absent and is never written over. */
export async function largeGetJson<T>(key: string): Promise<T | undefined> {
  if (platform() !== 'ios') return storeGetJson<T>(key);
  const path = pathOf(key);
  // A save cut off between its two steps left only the temp file.
  const text = (await readFileText(path)) ?? (await readFileText(`${path}.tmp`));
  if (text === undefined) {
    if (await exists(path)) {
      fileState.set(key, 'unreadable');
      return undefined;
    }
    fileState.set(key, 'missing');
    return storeGetJson<T>(key);
  }
  const json = await openBlob(text);
  if (json === null) {
    fileState.set(key, 'unreadable');
    return undefined;
  }
  fileState.set(key, 'read');
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

/** Save a large value. Answers whether it reached the disk. On the iPhone a
 *  key that cannot seal right now keeps the file as it is (false), never
 *  writes in the clear; a file this launch could not open is copied aside
 *  before the first save over it, so its bytes stay recoverable. */
export function largeSetJson(key: string, value: unknown): Promise<boolean> {
  return serialized(key, async () => {
    if (platform() !== 'ios') {
      await storeSetJson(key, value);
      return true;
    }
    // A save before any load (none today) learns what is on disk first.
    if (!fileState.has(key)) await largeGetJson(key);
    const path = pathOf(key);
    const sealed = await sealBlob(JSON.stringify(value));
    if (sealed === null) return false;
    if (fileState.get(key) === 'unreadable') {
      try {
        await Filesystem.rename({
          from: path,
          to: `${path}.recovery.${Date.now()}`,
          directory: Directory.Library,
          toDirectory: Directory.Library,
        });
      } catch {
        // Nothing there to keep after all.
      }
    }
    const temp = `${path}.tmp`;
    try {
      await Filesystem.writeFile({
        ...at(temp),
        data: sealed,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      await moveOver(temp, path);
    } catch {
      return false;
    }
    if (fileState.get(key) !== 'read') {
      // The value lives in its file now: the old copy in Preferences goes,
      // which is what lets the rest of the store save again.
      await storeDelete(key).catch(() => {});
    }
    fileState.set(key, 'read');
    return true;
  });
}
