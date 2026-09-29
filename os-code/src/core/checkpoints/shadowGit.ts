// Undo for an agent's work: a checkpoint before every task, kept in a shadow
// git directory on this machine, outside the project (v1 Phase 1; see
// docs/v1-direction-review.md "Undo").
//
// Why a shadow repository and not the project's own git: it works in a folder
// that has no git at all (most of a first-time person's folders), it never
// touches the project's index, branches, or history, it is never pushed, and
// it sees every file a task changed, including the ones a shell command wrote,
// which the loop's own touched-file map (the best-of-N restore) cannot.
//
// The store lives at ~/.os-code/checkpoints/<hash of the folder's real path>/,
// mode 0700, with one checkpoints.json beside the git objects. A checkpoint
// records the tree before the task, the tree after, and the files between
// them; undo writes the "before" versions back (and removes files the task
// created), taking a fresh snapshot first so Redo can put the task's versions
// back. Only files the task changed are ever restored: a path from outside the
// record is refused, whoever asks.
//
// Best effort by design: a folder too large to snapshot, a missing git, or a
// failed command means no checkpoint for that task, never a failed task.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { oscHome } from '../../config/home.js';
import { scrubbedEnv } from '../exec/childEnv.js';

export type CheckpointFileStatus = 'added' | 'modified' | 'deleted';

export interface CheckpointFile {
  /** Relative to the folder, forward slashes. */
  path: string;
  /** What the task did to it. */
  status: CheckpointFileStatus;
}

export interface CheckpointRecord {
  id: string;
  sessionId: string;
  /** Snapshot commits in the shadow repository. */
  before: string;
  after: string;
  at: string;
  files: CheckpointFile[];
  /** Paths currently undone, each with the snapshot Redo restores from. */
  undone?: Record<string, string>;
}

export type RestoreDirection = 'undo' | 'redo';

export type RestoreResult = { ok: true; paths: string[] } | { error: string };

interface StoreFile {
  version: 1;
  folder: string;
  records: CheckpointRecord[];
  /** Records aged out since the last collection. */
  agedOut?: number;
}

/** Folders with more files than this get no checkpoints (a home folder
 *  opened by mistake would otherwise copy everything). */
export const CHECKPOINT_MAX_FILES = 20_000;
/** Files larger than this are left out of snapshots (a video in the folder is
 *  not something a coding task changes, and copying it each task is waste). */
export const CHECKPOINT_MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Records kept per folder; older ones age out. */
export const CHECKPOINT_KEEP = 200;
/** After this many records age out, the shadow store collects what they held,
 *  so disk use stays bounded. */
export const CHECKPOINT_GC_EVERY = 20;
/** Only objects older than this are collected, so a task still running (its
 *  "before" snapshot not yet recorded) never loses what it started from. */
export const CHECKPOINT_PRUNE_AGE = '2.days.ago';

// Dependency and cache folders: rebuilt, never authored, often huge. The
// project's own .gitignore applies on top of these.
const SKIP_DIRS = [
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  '.gradle',
  'Pods',
];

// One queue per shadow folder: two sessions in the same folder must not race
// on the shadow index.
const queues = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prior = queues.get(key) ?? Promise.resolve();
  const next = prior.then(work, work);
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/** The shadow store's folder for a working folder. */
export function checkpointDir(cwd: string): string {
  let real = resolve(cwd);
  try {
    real = realpathSync(real);
  } catch {
    // A folder that does not resolve keys by its absolute path.
  }
  const hash = createHash('sha256').update(real).digest('hex').slice(0, 20);
  return join(oscHome(), 'checkpoints', hash);
}

/** A record path is restorable only if it stays inside the folder. */
function safeRelative(path: string): boolean {
  if (!path || isAbsolute(path) || path.includes('\0')) return false;
  const norm = normalize(path).split('\\').join('/');
  return norm !== '..' && !norm.startsWith('../') && !norm.split('/').includes('..');
}

export interface ShadowOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  keep?: number;
  gcEvery?: number;
  pruneAge?: string;
}

export class ShadowCheckpoints {
  readonly dir: string;
  private readonly maxFiles: number;
  private readonly maxFileBytes: number;
  private readonly keep: number;
  private readonly gcEvery: number;
  private readonly pruneAge: string;

  constructor(
    readonly cwd: string,
    options: ShadowOptions = {},
  ) {
    this.dir = checkpointDir(cwd);
    this.maxFiles = options.maxFiles ?? CHECKPOINT_MAX_FILES;
    this.maxFileBytes = options.maxFileBytes ?? CHECKPOINT_MAX_FILE_BYTES;
    this.keep = options.keep ?? CHECKPOINT_KEEP;
    this.gcEvery = options.gcEvery ?? CHECKPOINT_GC_EVERY;
    this.pruneAge = options.pruneAge ?? CHECKPOINT_PRUNE_AGE;
  }

  private git(args: string[], input?: string): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = execFile(
        'git',
        [
          '--git-dir',
          this.dir,
          '--work-tree',
          this.cwd,
          '--literal-pathspecs',
          '-c',
          'core.autocrlf=false',
          '-c',
          'core.safecrlf=false',
          '-c',
          'core.quotepath=false',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'core.hooksPath=/dev/null',
          ...args,
        ],
        {
          cwd: this.cwd,
          maxBuffer: 64 * 1024 * 1024,
          timeout: 120_000,
          // Local only: no credential is needed, so git (and anything the
          // work tree's config points it at) gets no key at all.
          env: {
            ...scrubbedEnv(),
            GIT_DIR: undefined,
            GIT_WORK_TREE: undefined,
            GIT_INDEX_FILE: undefined,
            GIT_AUTHOR_NAME: 'OpenShore',
            GIT_AUTHOR_EMAIL: 'checkpoints@localhost',
            GIT_COMMITTER_NAME: 'OpenShore',
            GIT_COMMITTER_EMAIL: 'checkpoints@localhost',
            GIT_TERMINAL_PROMPT: '0',
          },
        },
        (err, stdout) => {
          if (err) reject(err);
          else resolvePromise(stdout);
        },
      );
      if (input !== undefined) child.stdin?.end(input);
    });
  }

  private async ensureRepo(): Promise<void> {
    if (existsSync(join(this.dir, 'HEAD'))) return;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    await new Promise<void>((resolvePromise, reject) => {
      execFile('git', ['init', '--bare', '--quiet', this.dir], { env: scrubbedEnv() }, (err) =>
        err ? reject(err) : resolvePromise(),
      );
    });
    await this.git(['config', 'core.bare', 'false']);
    await this.git(['config', 'gc.auto', '0']);
  }

  /** OpenShore's own state folder, relative to the working folder, when the
   *  working folder contains it (a session opened on the home folder): the
   *  checkpoints must never snapshot themselves. */
  private ownStateInside(): string | undefined {
    const rel = relative(resolve(this.cwd), resolve(oscHome())).split('\\').join('/');
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
    return rel;
  }

  /** Walk the folder the way a snapshot will see it: count files (refusing a
   *  folder past the cap) and collect the ones too big to copy. */
  private scan(): { tooMany: boolean; big: string[] } {
    const big: string[] = [];
    const skip = new Set([...SKIP_DIRS, '.git']);
    const own = this.ownStateInside();
    const stack = [''];
    let count = 0;
    while (stack.length) {
      const rel = stack.pop()!;
      let entries: string[];
      try {
        entries = readdirSync(join(this.cwd, rel));
      } catch {
        continue;
      }
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry}` : entry;
        let st;
        try {
          st = lstatSync(join(this.cwd, childRel));
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (!skip.has(entry) && childRel !== own) stack.push(childRel);
        } else if (st.isFile() || st.isSymbolicLink()) {
          if (++count > this.maxFiles) return { tooMany: true, big };
          if (st.isFile() && st.size > this.maxFileBytes) big.push(childRel);
        }
      }
    }
    return { tooMany: false, big };
  }

  private writeExcludes(big: string[]): void {
    const infoDir = join(this.dir, 'info');
    mkdirSync(infoDir, { recursive: true });
    const escape = (p: string) => p.replace(/([\\*?[\]!#])/g, '\\$1');
    const lines = [
      '# Written by OpenShore for its checkpoints. The project .gitignore applies too.',
      ...SKIP_DIRS.map((d) => `${d}/`),
      ...(this.ownStateInside() ? [`/${escape(this.ownStateInside()!)}/`] : []),
      ...big.map((p) => `/${escape(p)}`),
      '',
    ];
    writeFileSync(join(infoDir, 'exclude'), lines.join('\n'));
  }

  /** Snapshot the folder as it is now. Returns the snapshot's commit, or
   *  undefined when the folder cannot be snapshotted (too large, no git). */
  snapshot(label: string): Promise<string | undefined> {
    return serialize(this.dir, () => this.snapshotNow(label));
  }

  private async snapshotNow(label: string): Promise<string | undefined> {
    try {
      const { tooMany, big } = this.scan();
      if (tooMany) return undefined;
      await this.ensureRepo();
      this.writeExcludes(big);
      await this.git(['add', '--all', '--ignore-errors', '--', '.']).catch(async () => {
        // --ignore-errors still exits non-zero when a file could not be read;
        // what it could read is staged, which is what a snapshot needs.
      });
      const tree = (await this.git(['write-tree'])).trim();
      // Each snapshot stands alone (no parent chain), held by the record that
      // uses it, so a record that ages out lets its snapshots be collected.
      // The latest one is held too, for the task that is running now.
      const commit = (await this.git(['commit-tree', tree, '-m', label])).trim();
      await this.git(['update-ref', 'refs/osc/last', commit]);
      return commit;
    } catch {
      return undefined;
    }
  }

  /** The files that differ between two snapshots. */
  private async diff(from: string, to: string): Promise<CheckpointFile[]> {
    const out = await this.git([
      'diff-tree',
      '-r',
      '-z',
      '--no-renames',
      '--name-status',
      from,
      to,
    ]);
    const parts = out.split('\0').filter((p) => p.length);
    const files: CheckpointFile[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const code = parts[i]!.charAt(0);
      const path = parts[i + 1]!;
      const status: CheckpointFileStatus =
        code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified';
      files.push({ path, status });
    }
    return files;
  }

  /** Record a task's checkpoint from its before and after snapshots. Returns
   *  undefined when the task changed nothing. */
  record(sessionId: string, before: string, after: string): Promise<CheckpointRecord | undefined> {
    return serialize(this.dir, async () => {
      try {
        if (before === after) return undefined;
        const files = await this.diff(before, after);
        if (!files.length) return undefined;
        const record: CheckpointRecord = {
          id: after.slice(0, 12),
          sessionId,
          before,
          after,
          at: new Date().toISOString(),
          files,
        };
        await this.git(['update-ref', `refs/osc/r/${record.id}/before`, before]);
        await this.git(['update-ref', `refs/osc/r/${record.id}/after`, after]);
        const store = this.read();
        const all = [...store.records.filter((r) => r.id !== record.id), record];
        const dropped = all.slice(0, Math.max(0, all.length - this.keep));
        store.records = all.slice(-this.keep);
        store.agedOut = (store.agedOut ?? 0) + dropped.length;
        for (const old of dropped) await this.dropRefs(old.id);
        const collect = store.agedOut >= this.gcEvery;
        if (collect) store.agedOut = 0;
        this.write(store);
        if (collect) await this.collect();
        return record;
      } catch {
        return undefined;
      }
    });
  }

  /** Checkpoints recorded for this folder, oldest first (one session's, when
   *  a session id is given). */
  list(sessionId?: string): CheckpointRecord[] {
    const records = this.read().records;
    return sessionId ? records.filter((r) => r.sessionId === sessionId) : records;
  }

  /**
   * Undo or redo a checkpoint: every file it changed, or one of them. Undo
   * snapshots the folder first, so Redo puts back exactly what was there,
   * including anything changed after the task. `sessionId`, when given, must
   * match the record's: a session can only restore its own work.
   */
  restore(
    id: string,
    direction: RestoreDirection,
    options: { path?: string; sessionId?: string } = {},
  ): Promise<RestoreResult> {
    return serialize(this.dir, async () => {
      const store = this.read();
      const record = store.records.find((r) => r.id === id);
      if (!record || (options.sessionId && record.sessionId !== options.sessionId)) {
        return { error: 'That checkpoint is not on this computer any more.' };
      }
      const known = new Set(record.files.map((f) => f.path));
      if (options.path !== undefined && (!known.has(options.path) || !safeRelative(options.path))) {
        return { error: 'That file was not part of this change.' };
      }
      const undone = { ...(record.undone ?? {}) };
      const candidates = options.path ? [options.path] : [...known];
      const paths = candidates.filter(
        (p) => safeRelative(p) && (direction === 'undo' ? !(p in undone) : p in undone),
      );
      if (!paths.length) {
        return direction === 'undo' ? { error: 'Already undone.' } : { error: 'Nothing to redo.' };
      }
      try {
        if (direction === 'undo') {
          const redo = await this.snapshotNow(`before undo of ${record.id}`);
          if (!redo)
            return { error: 'Could not save the current files first, so nothing was changed.' };
          // Held by the record, so Redo survives a collection.
          await this.git(['update-ref', `refs/osc/r/${record.id}/redo-${redo.slice(0, 12)}`, redo]);
          for (const path of paths) {
            const status = record.files.find((f) => f.path === path)!.status;
            await this.put(path, status === 'added' ? undefined : record.before);
            undone[path] = redo;
          }
        } else {
          for (const path of paths) {
            const from = undone[path]!;
            const exists = await this.inTree(from, path);
            await this.put(path, exists ? from : undefined);
            delete undone[path];
          }
        }
      } catch (err) {
        return { error: `The files could not all be put back: ${(err as Error).message}` };
      }
      record.undone = Object.keys(undone).length ? undone : undefined;
      this.write(store);
      return { ok: true, paths };
    });
  }

  /** Let go of every snapshot an aged-out record held. */
  private async dropRefs(id: string): Promise<void> {
    const refs = (
      await this.git(['for-each-ref', '--format=%(refname)', `refs/osc/r/${id}/`]).catch(() => '')
    )
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    for (const ref of refs) await this.git(['update-ref', '-d', ref]).catch(() => undefined);
  }

  /** Collect what aged-out records held. Objects younger than the prune age
   *  stay, so a running task's starting snapshot is never taken. A shadow
   *  store from before this change chained every snapshot; that chain goes. */
  private async collect(): Promise<void> {
    await this.git(['update-ref', '-d', 'refs/heads/checkpoints']).catch(() => undefined);
    await this.git(['reflog', 'expire', '--expire=now', '--all']).catch(() => undefined);
    await this.git(['gc', '--quiet', `--prune=${this.pruneAge}`]).catch(() => undefined);
  }

  private async inTree(commit: string, path: string): Promise<boolean> {
    try {
      await this.git(['cat-file', '-e', `${commit}:${path}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** Write one path from a snapshot, or remove it when `from` is undefined. */
  private async put(path: string, from: string | undefined): Promise<void> {
    const abs = join(this.cwd, path);
    if (from === undefined) {
      rmSync(abs, { force: true });
      return;
    }
    await this.git(['checkout', from, '--', path]);
  }

  private storePath(): string {
    return join(this.dir, 'checkpoints.json');
  }

  private read(): StoreFile {
    try {
      const parsed = JSON.parse(readFileSync(this.storePath(), 'utf8')) as Partial<StoreFile>;
      if (Array.isArray(parsed.records)) {
        return {
          version: 1,
          folder: this.cwd,
          records: parsed.records,
          agedOut: typeof parsed.agedOut === 'number' ? parsed.agedOut : 0,
        };
      }
    } catch {
      // Missing or unreadable: no checkpoints to offer.
    }
    return { version: 1, folder: this.cwd, records: [] };
  }

  private write(store: StoreFile): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.storePath()}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.storePath());
  }
}
