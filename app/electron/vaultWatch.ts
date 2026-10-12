// Seeing changes to the vault folder from the agent, Obsidian, or a sync client
// while the Vault room is open (Vault M1, tech review F3). The watcher is a hint, never
// the protection: compare-and-swap on every write is the protection, and the
// room's re-check on focus is the backstop. So it stays small:
//
// - macOS and Windows: one native recursive fs.watch on the vault root
//   (FSEvents, ReadDirectoryChangesW).
// - Linux: Node's recursive mode is a userland walker that stalls the main
//   process and opens one inotify watch per file, so instead a plain watch on
//   the root plus one on the open note's folder. A folder watch survives a
//   rename-over; deeper tree changes arrive on focus.
//
// No chokidar, no polling timer, and no echo suppression: the store compares
// versions, so our own saves cancel out. Events are filtered to notes,
// debounced (300 ms trailing, 1 s at most), and sent as { paths, tree }.
// Plain Node with fs.watch injected, so test/vaultWatch.test.ts drives it.
import { dirname } from 'node:path';

/** What the renderer is told (electronBridge.ts VaultChange). */
export interface VaultChange {
  paths: string[];
  tree: boolean;
  rootGone?: boolean;
}

/** The slice of an FSWatcher this module uses. */
export interface WatchHandle {
  close(): void;
  on(event: 'error', listener: (err: unknown) => void): unknown;
}

export type WatchFn = (
  path: string,
  options: { recursive?: boolean; persistent: boolean },
  listener: (event: string, filename: string | Buffer | null) => void,
) => WatchHandle;

export interface VaultWatchDeps {
  watch: WatchFn;
  platform: NodeJS.Platform;
  send: (change: VaultChange) => void;
  debounceMs?: number;
  maxWaitMs?: number;
  /** Above this many paths a batch becomes { paths: [], tree: true }. */
  maxPaths?: number;
}

export const VAULT_WATCH_DEBOUNCE_MS = 300;
export const VAULT_WATCH_MAX_WAIT_MS = 1000;
export const VAULT_WATCH_MAX_PATHS = 200;

/** What one fs.watch filename means for the vault, relative to the watched
 *  folder `under` ('' for the root): a changed note, a tree change the watcher
 *  cannot name (no filename, or a bare name with no extension, which is a
 *  folder), or nothing (a dot path, such as our own temp files, `.obsidian/`,
 *  or `.git/`, and any file that is not a note). */
export function vaultWatchEvent(
  filename: string | Buffer | null | undefined,
  under = '',
): { path: string } | { tree: true } | null {
  if (filename === null || filename === undefined) return { tree: true };
  const name = (typeof filename === 'string' ? filename : filename.toString('utf8')).replace(
    /\\/g,
    '/',
  );
  if (!name) return { tree: true };
  const rel = under ? `${under}/${name}` : name;
  const segments = rel.split('/').filter(Boolean);
  if (segments.some((s) => s.startsWith('.'))) return null;
  const last = segments[segments.length - 1] ?? '';
  if (/\.md$/i.test(last)) return { path: segments.join('/') };
  return last.includes('.') ? null : { tree: true };
}

export class VaultWatcher {
  private root: string | undefined;
  private openDir: string | undefined;
  private rootHandle: WatchHandle | undefined;
  private dirHandle: WatchHandle | undefined;
  private paths = new Set<string>();
  private tree = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstAt = 0;
  private readonly recursive: boolean;

  constructor(private readonly deps: VaultWatchDeps) {
    this.recursive = deps.platform === 'darwin' || deps.platform === 'win32';
  }

  /** Watch `root`, with the open note's path (relative, already checked by
   *  main) so Linux can watch its folder too. Called again when the open note
   *  changes; a new root restarts the watch. */
  start(root: string, openPath?: string): void {
    if (this.root !== root) {
      this.stop();
      this.root = root;
      this.rootHandle = this.arm(root, '', this.recursive);
    }
    if (this.recursive) return;
    const dir = openPath ? dirname(openPath).replace(/\\/g, '/') : '';
    const openDir = dir === '.' ? '' : dir;
    if (openDir === this.openDir) return;
    this.dirHandle?.close();
    this.dirHandle = undefined;
    this.openDir = openDir;
    if (openDir) this.dirHandle = this.arm(`${root}/${openDir}`, openDir, false);
  }

  /** Stop watching and drop anything not yet sent. */
  stop(): void {
    this.rootHandle?.close();
    this.dirHandle?.close();
    this.rootHandle = undefined;
    this.dirHandle = undefined;
    this.root = undefined;
    this.openDir = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.paths.clear();
    this.tree = false;
  }

  /** Whether a watch is running, for tests and main's window lifecycle. */
  get watching(): boolean {
    return this.rootHandle !== undefined;
  }

  private arm(path: string, under: string, recursive: boolean): WatchHandle | undefined {
    let handle: WatchHandle;
    try {
      handle = this.deps.watch(
        path,
        recursive ? { recursive: true, persistent: false } : { persistent: false },
        (_event, filename) => this.note(vaultWatchEvent(filename, under)),
      );
    } catch {
      // The folder is not there (yet), or not ours to watch: focus re-checks.
      return undefined;
    }
    handle.on('error', () => {
      if (under) {
        // The open note's folder went away: drop that watch and let the
        // store re-list. The root watch carries on.
        handle.close();
        if (this.dirHandle === handle) this.dirHandle = undefined;
        this.note({ tree: true });
        return;
      }
      // The root was deleted or became unreadable. Say so once and stop;
      // never respawn in a loop.
      this.stop();
      this.deps.send({ paths: [], tree: true, rootGone: true });
    });
    return handle;
  }

  private note(event: { path: string } | { tree: true } | null): void {
    if (!event) return;
    if ('tree' in event) this.tree = true;
    else this.paths.add(event.path);
    const now = Date.now();
    if (!this.timer) this.firstAt = now;
    if (this.timer) clearTimeout(this.timer);
    const debounce = this.deps.debounceMs ?? VAULT_WATCH_DEBOUNCE_MS;
    const maxWait = this.deps.maxWaitMs ?? VAULT_WATCH_MAX_WAIT_MS;
    const wait = Math.max(0, Math.min(debounce, this.firstAt + maxWait - now));
    this.timer = setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    this.timer = undefined;
    const paths = [...this.paths];
    const tree = this.tree;
    this.paths.clear();
    this.tree = false;
    if (!paths.length && !tree) return;
    const max = this.deps.maxPaths ?? VAULT_WATCH_MAX_PATHS;
    this.deps.send(paths.length > max ? { paths: [], tree: true } : { paths, tree });
  }
}
