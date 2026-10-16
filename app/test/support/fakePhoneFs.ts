// An in-memory stand-in for the phone's Documents folder, behind the same
// PhoneFs seam the real @capacitor/filesystem adapter fills
// (src/lib/gitos/phoneFolder.ts). Folders are real entries, so an empty folder
// lists, a non-empty one will not rmdir without `recursive`, and a write
// makes its parents the way the plugin's `recursive: true` does. Like the
// plugin, rename replaces a name that is taken, so the code above it has to
// check first. Names are case-sensitive here (a stricter test than APFS,
// which folds case: the transport's folded checks must hold either way).
//
// `clock` is the mtime every change stamps; tests freeze it to land two
// writes in one millisecond.
import type { PhoneFs, PhoneFsEntry, PhoneFsStat } from '../../src/lib/gitos/phoneFolder.js';

interface Node {
  type: 'file' | 'directory';
  data: string;
  /** True when `data` is base64 (a binary file a test put there). */
  binary?: boolean;
  mtime: number;
}

export interface FakePhoneFs extends PhoneFs {
  nodes: Map<string, Node>;
  clock: { now: number; frozen: boolean };
  /** Put a text file there as another app would, parents made. */
  put(path: string, text: string): void;
  /** Put a binary file there (base64 data). */
  putBase64(path: string, data: string): void;
  /** The text at a path, or undefined. */
  text(path: string): string | undefined;
  drop(path: string): void;
  /** Every path under `prefix` (files and folders), sorted. */
  paths(prefix?: string): string[];
  /** Calls the code made, by name, for tests that check what was touched. */
  calls: string[];
  reset(): void;
}

const norm = (p: string) => p.replace(/^\/+|\/+$/g, '');
function toBase64(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export function createFakePhoneFs(): FakePhoneFs {
  const nodes = new Map<string, Node>();
  const clock = { now: 1_760_000_000_000, frozen: false };
  const calls: string[] = [];
  const tick = () => (clock.frozen ? clock.now : ++clock.now);

  const mkdirs = (dir: string) => {
    const parts = norm(dir).split('/').filter(Boolean);
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      const n = nodes.get(cur);
      if (n && n.type !== 'directory') throw new Error(`${cur} is a file`);
      if (!n) nodes.set(cur, { type: 'directory', data: '', mtime: tick() });
    }
  };
  const children = (dir: string) => {
    const d = norm(dir);
    const prefix = d ? `${d}/` : '';
    return [...nodes.keys()].filter(
      (k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/') && k !== d,
    );
  };
  const sizeOf = (n: Node) =>
    n.type === 'directory'
      ? 0
      : n.binary
        ? Math.floor((n.data.length * 3) / 4)
        : new TextEncoder().encode(n.data).length;
  const statOf = (n: Node): PhoneFsStat => ({ type: n.type, size: sizeOf(n), mtime: n.mtime });

  const fs: FakePhoneFs = {
    nodes,
    clock,
    calls,
    async stat(path) {
      const n = nodes.get(norm(path));
      return n ? statOf(n) : null;
    },
    async readdir(path) {
      const d = norm(path);
      if (d && nodes.get(d)?.type !== 'directory') return [];
      return children(d).map((k): PhoneFsEntry => ({
        name: k.slice(d ? d.length + 1 : 0),
        ...statOf(nodes.get(k)!),
      }));
    },
    async readText(path) {
      const n = nodes.get(norm(path));
      return n && n.type === 'file' && !n.binary ? n.data : null;
    },
    async readBase64(path) {
      const n = nodes.get(norm(path));
      if (!n || n.type !== 'file') return null;
      return n.binary ? n.data : toBase64(n.data);
    },
    async writeText(path, text) {
      calls.push(`write ${norm(path)}`);
      const p = norm(path);
      if (nodes.get(p)?.type === 'directory') throw new Error(`${p} is a folder`);
      mkdirs(parentOf(p));
      nodes.set(p, { type: 'file', data: text, mtime: tick() });
    },
    async deleteFile(path) {
      calls.push(`delete ${norm(path)}`);
      const p = norm(path);
      const n = nodes.get(p);
      if (!n || n.type !== 'file') throw new Error(`${p} does not exist`);
      nodes.delete(p);
    },
    async mkdir(path) {
      calls.push(`mkdir ${norm(path)}`);
      mkdirs(path);
    },
    async rmdir(path, recursive) {
      calls.push(`rmdir ${norm(path)}`);
      const p = norm(path);
      if (nodes.get(p)?.type !== 'directory') throw new Error(`${p} is not a folder`);
      const under = [...nodes.keys()].filter((k) => k.startsWith(`${p}/`));
      if (under.length && !recursive) throw new Error(`${p} is not empty`);
      for (const k of under) nodes.delete(k);
      nodes.delete(p);
    },
    async rename(from, to) {
      calls.push(`rename ${norm(from)} -> ${norm(to)}`);
      const f = norm(from);
      const t = norm(to);
      const n = nodes.get(f);
      if (!n) throw new Error(`${f} does not exist`);
      if (!nodes.get(parentOf(t)) && parentOf(t)) throw new Error(`${parentOf(t)} does not exist`);
      // Like the plugin: a name that is taken is replaced.
      for (const k of [...nodes.keys()]) if (k === t || k.startsWith(`${t}/`)) nodes.delete(k);
      const moving = [...nodes.entries()].filter(([k]) => k === f || k.startsWith(`${f}/`));
      for (const [k] of moving) nodes.delete(k);
      for (const [k, v] of moving) nodes.set(`${t}${k.slice(f.length)}`, v);
    },
    put(path, text) {
      const p = norm(path);
      mkdirs(parentOf(p));
      nodes.set(p, { type: 'file', data: text, mtime: tick() });
    },
    putBase64(path, data) {
      const p = norm(path);
      mkdirs(parentOf(p));
      nodes.set(p, { type: 'file', data, binary: true, mtime: tick() });
    },
    text(path) {
      const n = nodes.get(norm(path));
      return n && n.type === 'file' && !n.binary ? n.data : undefined;
    },
    drop(path) {
      const p = norm(path);
      for (const k of [...nodes.keys()]) if (k === p || k.startsWith(`${p}/`)) nodes.delete(k);
    },
    paths(prefix = '') {
      const p = norm(prefix);
      return [...nodes.keys()].filter((k) => !p || k === p || k.startsWith(`${p}/`)).sort();
    },
    reset() {
      nodes.clear();
      calls.length = 0;
      clock.frozen = false;
    },
  };
  return fs;
}
