// Where the desktop vault lives, and the one way to change it (Vault M1 1.4,
// CTO F7, CX 1.4). Only the main process picks, checks, and writes vault.dir:
// the renderer never sends a path, and every action here takes none (a pick
// comes from the system dialog, a refinement names a choice main itself
// offered). The folder is stored as an absolute realpath through the engine's
// config writer, which keeps the file's mode. A pick only repoints: nothing is
// copied in or out, and the old folder is left as it was. Bring, a separate
// tap after a pick, copies the old folder's notes in (creates only) and still
// leaves the old folder as it was.
//
// Plain Node with the dialog and the config writer injected, so
// test/deviceFolder.test.ts drives it exactly as main does.
import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { readNote, writeNote } from 'os-code/dist/src/core/vault/noteFile.js';
import { vaultConflictCopyPath } from 'os-code/dist/src/core/vault/conflictName.js';
import { listVaultFolder, vaultNoteAbs } from './vaultFs.js';

/** Why a folder cannot be the vault. The words live in the renderer's copy map
 *  (vaultCopy.ts vaultPickRefusal), so one test reads them all. */
export type VaultPickRefusal =
  | 'root'
  | 'home'
  | 'home-ancestor'
  | 'osc-home'
  | 'managed-holds'
  | 'managed-inside'
  | 'not-writable'
  | 'denied'
  | 'unreadable'
  | 'save-failed';

/** The sync service a folder sits in, read from its real path. */
export type VaultCloudKind =
  'icloud' | 'icloud-openshore' | 'dropbox' | 'onedrive' | 'gdrive' | 'box' | 'other';

/** The machine facts a check needs, all absolute (realpaths where they exist). */
export interface VaultDirEnv {
  home: string;
  oscHome: string;
  managedRoot: string;
  defaultVaultDir: string;
  platform: NodeJS.Platform;
  /** Process environment, for the Windows OneDrive folders. */
  env?: Record<string, string | undefined>;
}

/** What a folder holds, from one bounded walk that never enters a dot folder
 *  (.obsidian, .trash, .git). */
export interface VaultSurvey {
  /** Notes found (capped at the note limit). */
  notes: number;
  /** The walk stopped early (10,000 notes, 50,000 entries, or 3 s). */
  capped: boolean;
  /** Files that are not notes, which the Vault does not show. */
  otherFiles: number;
  /** The folder is itself an Obsidian vault (it holds .obsidian/). */
  obsidian: boolean;
  /** The nearest enclosing Obsidian vault, never above home, when the folder
   *  is not one itself. */
  inside?: { name: string };
  /** Obsidian vaults directly inside the folder, by name (at most 12). */
  holds?: string[];
  /** How many more vaults are inside beyond the 12 named. */
  holdsMore?: number;
  /** OpenShore's own iCloud folder on a Mac, picked at its top. */
  icloudRoot?: boolean;
  cloud?: VaultCloudKind;
}

/** The vault folder as the storage sheet shows it. */
export interface VaultDirInfo {
  /** The absolute folder every process uses. */
  dir: string;
  /** For showing: home as ~ on macOS and Linux, the full path on Windows. */
  display: string;
  /** loadVaultDir's own warning (a relative vault.dir), shown verbatim. */
  warning?: string;
  /** The folder is there and is a folder. */
  exists: boolean;
  os: NodeJS.Platform;
  /** Obsidian opens it ('vault'), is installed but has not opened it
   *  ('installed'), or is not installed ('none'). */
  obsidian: 'vault' | 'installed' | 'none';
  /** Notes in the folder, best effort; absent when the walk failed. */
  count?: number;
  /** The count stopped at the walk's limit. */
  capped?: boolean;
}

/** What a pick or a refinement did. */
export type VaultPickResult =
  | {
      ok: true;
      info: VaultDirInfo;
      survey: VaultSurvey;
      /** The folder the vault used just before, when it had one. */
      previous?: { display: string; notes?: number };
    }
  | { ok: false; cancelled: true }
  | { ok: false; same: true; info: VaultDirInfo }
  | {
      ok: false;
      refused: VaultPickRefusal;
      defaultDisplay?: string;
      managedDisplay?: string;
    };

/** What Bring did: the renderer's VaultMoveResult shape, so the move's
 *  forked line reads the same. `moved` holds the notes now in the current
 *  folder (copied, or already there with the same text); `skipped` the ones
 *  that could not be copied; `forked` a note whose name the current folder
 *  held with different text, and the conflict name it landed under. `ok` only
 *  when nothing was skipped and the walk did not stop at the note limit. */
export interface VaultBringResult {
  ok: boolean;
  moved: string[];
  skipped: string[];
  forked: Array<{ from: string; to: string }>;
  /** The walk stopped at the note limit, so later notes stayed behind. */
  capped?: boolean;
  /** Why it was refused or fell short: a folder is not there or not
   *  usable, the two are the same folder, one lies inside the other, some
   *  notes could not be copied, or the note limit was reached. */
  reason?: 'unavailable' | 'same' | 'nested' | 'copy-failed' | 'capped';
}

/** Conflict names Bring tries for one note before it gives up on it. */
const BRING_FORK_TRIES = 20;

/** A refinement the result block offers, and nothing else. */
export type VaultRefineChoice =
  { to: 'enclosing' } | { to: 'child'; name: string } | { to: 'previous' };

export const VAULT_SURVEY_LIMITS = { notes: 10_000, entries: 50_000, ms: 3_000 };
/** How many vaults inside a folder are named before "N more". */
export const VAULT_HOLDS_SHOWN = 12;

/** A path's realpath, or the path resolved when it is not there. */
export function realOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** Whether `target` is `root` or lies inside it. Case-insensitive on Windows
 *  and macOS, whose default volumes are. */
export function within(target: string, root: string, platform: NodeJS.Platform): boolean {
  const fold = platform === 'win32' || platform === 'darwin';
  const t = fold ? target.toLowerCase() : target;
  const r = fold ? root.toLowerCase() : root;
  const base = r.endsWith(sep) ? r : r + sep;
  return t === r || t.startsWith(base);
}

/** The folder as the person reads it: home as ~ on macOS and Linux. */
export function vaultDisplay(dir: string, home: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return dir;
  if (dir === home) return '~';
  return within(dir, home, platform) ? `~${dir.slice(home.length)}` : dir;
}

/** Why a picked folder (a realpath) cannot be the vault, or undefined when it
 *  can. The order matters: the most specific sentence wins. */
export function refusePick(real: string, env: VaultDirEnv): VaultPickRefusal | undefined {
  const p = env.platform;
  if (dirname(real) === real) return 'root';
  if (within(real, env.home, p) && within(env.home, real, p)) return 'home';
  if (within(env.home, real, p)) return 'home-ancestor';
  if (within(real, env.oscHome, p) || within(env.oscHome, real, p)) return 'osc-home';
  if (within(env.managedRoot, real, p)) return 'managed-holds';
  if (within(real, env.managedRoot, p) && !samePath(real, env.defaultVaultDir, p)) {
    return 'managed-inside';
  }
  try {
    accessSync(real, constants.W_OK);
  } catch {
    return 'not-writable';
  }
  return undefined;
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  return within(a, b, platform) && within(b, a, platform);
}

/** List the folder once, right away, so a macOS Files and Folders prompt
 *  appears while the person is choosing, and a declined one never saves a
 *  folder the app cannot read. */
export function listOnce(real: string): 'denied' | 'unreadable' | undefined {
  try {
    readdirSync(real);
    return undefined;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM' || code === 'EACCES' ? 'denied' : 'unreadable';
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The sync service holding a folder, from its real path, or undefined when
 *  none can be told. Nothing is claimed for a place that cannot be detected. */
export function cloudKindOf(real: string, env: VaultDirEnv): VaultCloudKind | undefined {
  const p = env.platform;
  const home = env.home;
  const mobile = join(home, 'Library', 'Mobile Documents');
  const openshoreVault = join(mobile, 'iCloud~ai~openshore~oscode', 'Documents', 'vault.personal');
  if (within(real, openshoreVault, p)) return 'icloud-openshore';
  if (
    within(real, join(mobile, 'com~apple~CloudDocs'), p) ||
    within(real, join(mobile, 'iCloud~md~obsidian'), p)
  ) {
    return 'icloud';
  }
  const storage = join(home, 'Library', 'CloudStorage');
  if (within(real, storage, p) && real !== storage) {
    const top = real.slice(storage.length + 1).split(sep)[0] ?? '';
    if (/^Dropbox/i.test(top)) return 'dropbox';
    if (/^OneDrive/i.test(top)) return 'onedrive';
    if (/^GoogleDrive/i.test(top)) return 'gdrive';
    if (/^Box/i.test(top)) return 'box';
    return 'other';
  }
  if (within(real, join(home, 'Dropbox'), p)) return 'dropbox';
  const e = env.env ?? {};
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const dir = e[key];
    if (dir && within(real, realOr(dir), p)) return 'onedrive';
  }
  if (p === 'win32' && real.split(/[\\/]/)[1] === 'My Drive') return 'gdrive';
  return undefined;
}

/** One bounded walk of a folder: its notes, its other files, and where it
 *  sits among Obsidian vaults. Never enters a dot folder, never climbs above
 *  home, and stops at the survey limits. */
export function surveyVaultFolder(
  real: string,
  env: VaultDirEnv,
  limits = VAULT_SURVEY_LIMITS,
  now: () => number = Date.now,
): VaultSurvey {
  const start = now();
  let notes = 0;
  let otherFiles = 0;
  let entries = 0;
  let capped = false;
  const stack = [real];
  walk: while (stack.length) {
    const dir = stack.pop()!;
    let list;
    try {
      list = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of list) {
      if (++entries > limits.entries || notes >= limits.notes || now() - start > limits.ms) {
        capped = true;
        break walk;
      }
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) stack.push(join(dir, entry.name));
      else if (entry.isFile()) {
        if (/\.md$/i.test(entry.name)) notes++;
        else otherFiles++;
      }
    }
  }
  const survey: VaultSurvey = {
    notes,
    capped,
    otherFiles,
    obsidian: isDir(join(real, '.obsidian')),
  };
  if (!survey.obsidian) {
    const inside = enclosingVault(real, env);
    if (inside) survey.inside = { name: baseName(inside) };
  }
  const holds = childVaults(real);
  if (holds.length) {
    survey.holds = holds.slice(0, VAULT_HOLDS_SHOWN);
    if (holds.length > VAULT_HOLDS_SHOWN) survey.holdsMore = holds.length - VAULT_HOLDS_SHOWN;
  }
  if (isIcloudRoot(real, env)) survey.icloudRoot = true;
  const cloud = cloudKindOf(real, env);
  if (cloud) survey.cloud = cloud;
  return survey;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/** The nearest folder above `real` that is an Obsidian vault, walking up to
 *  home and never above it. */
export function enclosingVault(real: string, env: VaultDirEnv): string | undefined {
  if (!within(real, env.home, env.platform)) return undefined;
  let dir = dirname(real);
  while (within(dir, env.home, env.platform)) {
    if (isDir(join(dir, '.obsidian'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

/** The Obsidian vaults directly inside a folder, by name, sorted. */
export function childVaults(real: string): string[] {
  let list;
  try {
    list = readdirSync(real, { withFileTypes: true });
  } catch {
    return [];
  }
  return list
    .filter(
      (e) => e.isDirectory() && !e.name.startsWith('.') && isDir(join(real, e.name, '.obsidian')),
    )
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

function isIcloudRoot(real: string, env: VaultDirEnv): boolean {
  const root = join(
    env.home,
    'Library',
    'Mobile Documents',
    'iCloud~ai~openshore~oscode',
    'Documents',
  );
  return samePath(real, root, env.platform) && isDir(join(real, 'vault.personal'));
}

/** The folder as the storage sheet shows it. */
export function vaultDirInfo(
  current: { dir: string; warning?: string },
  env: VaultDirEnv,
  obsidianApp: boolean,
): VaultDirInfo {
  const dir = current.dir;
  const exists = isDir(dir);
  const info: VaultDirInfo = {
    dir,
    display: vaultDisplay(dir, env.home, env.platform),
    exists,
    os: env.platform,
    obsidian: !obsidianApp
      ? 'none'
      : exists && isDir(join(dir, '.obsidian'))
        ? 'vault'
        : 'installed',
  };
  if (current.warning) info.warning = current.warning;
  if (exists) {
    try {
      const s = surveyVaultFolder(dir, env);
      info.count = s.notes;
      if (s.capped) info.capped = true;
    } catch {
      // Best effort: the card leaves its sentence about the folder's notes out.
    }
  }
  return info;
}

export interface VaultDirDeps {
  env: () => VaultDirEnv;
  /** loadVaultDir(), read again on every call. */
  current: () => { dir: string; warning?: string };
  /** Write vault.dir (saveGlobalConfig). Throws when the write fails. */
  save: (dir: string) => void;
  obsidianApp: () => boolean;
  log?: (message: string) => void;
  /** Notes one Bring copies before it stops (tests use a small one). */
  bringLimit?: number;
}

/** The pick and its refinements. Holds the folder the vault used before the
 *  last change, in memory for the life of the process, so Go back can repoint
 *  without the renderer ever naming a path. */
export class VaultDirChooser {
  /** Set only by a successful pick or refinement in this process. */
  private previous: string | undefined;
  private bringing = false;

  constructor(private readonly deps: VaultDirDeps) {}

  info(): VaultDirInfo {
    return vaultDirInfo(this.deps.current(), this.deps.env(), this.deps.obsidianApp());
  }

  /** A folder from the system dialog (undefined when it was cancelled). */
  pick(picked: string | undefined): VaultPickResult {
    if (!picked) return { ok: false, cancelled: true };
    return this.repoint(realOr(picked));
  }

  /** One of the choices the result block offered, checked against what main
   *  itself found; never a path from the renderer. */
  refine(choice: unknown): VaultPickResult {
    const env = this.deps.env();
    const c = parseRefineChoice(choice);
    const cur = realOr(this.deps.current().dir);
    if (c.to === 'previous') {
      if (!this.previous) throw new Error('blocked: there is no earlier folder');
      return this.repoint(this.previous);
    }
    if (c.to === 'enclosing') {
      const up = enclosingVault(cur, env);
      if (!up) throw new Error('blocked: this folder is not inside a vault');
      return this.repoint(realOr(up));
    }
    const allowed =
      childVaults(cur).includes(c.name) || (c.name === 'vault.personal' && isIcloudRoot(cur, env));
    if (!allowed) throw new Error('blocked: not a folder main offered');
    return this.repoint(realOr(join(cur, c.name)));
  }

  /**
   * Bring the notes of the folder the vault used before the last pick into
   * the one it uses now (the CTO's ruling on Bring). Takes no argument; any
   * the renderer sends is ignored. Every write is a create (ifAbsent): a note
   * already here is never replaced; the same text is left as it is, and
   * different text lands beside it under the conflict name. Nothing is ever
   * removed, and nothing is written into the previous folder, whose walk
   * does not sweep and follows no link. One Bring at a time.
   */
  async bringPrevious(): Promise<VaultBringResult> {
    const previous = this.previous;
    if (!previous) throw new Error('blocked: there is no earlier folder');
    if (this.bringing) throw new Error('blocked: a bring is already running');
    this.bringing = true;
    try {
      return await this.bring(previous);
    } finally {
      this.bringing = false;
    }
  }

  private async bring(previousDir: string): Promise<VaultBringResult> {
    const env = this.deps.env();
    const p = env.platform;
    const refused = (reason: VaultBringResult['reason']): VaultBringResult => ({
      ok: false,
      moved: [],
      skipped: [],
      forked: [],
      reason,
    });
    const from = realOr(previousDir);
    const to = realOr(this.deps.current().dir);
    if (!vaultDirExists(from) || !vaultDirExists(to)) return refused('unavailable');
    if (refusePick(from, env) || refusePick(to, env)) return refused('unavailable');
    if (samePath(from, to, p)) return refused('same');
    if (within(from, to, p) || within(to, from, p)) return refused('nested');
    const limit = this.deps.bringLimit ?? VAULT_SURVEY_LIMITS.notes;
    let listed;
    try {
      listed = await listVaultFolder(from, { sweep: false, limit: limit + 1 });
    } catch (err) {
      this.deps.log?.(`bring could not list the previous folder: ${(err as Error).message}`);
      return refused('unavailable');
    }
    const capped = listed.length > limit;
    const when = new Date();
    const moved: string[] = [];
    const skipped: string[] = [];
    const forked: VaultBringResult['forked'] = [];
    for (const { path: rel } of listed.slice(0, limit)) {
      try {
        const note = await readNote(vaultNoteAbs(from, rel));
        if (!note) {
          skipped.push(rel);
          continue;
        }
        const first = await writeNote(vaultNoteAbs(to, rel), note.text, { ifAbsent: true });
        if (first.ok || first.theirs?.text === note.text) {
          moved.push(rel);
          continue;
        }
        if (first.conflict !== 'exists') {
          skipped.push(rel);
          continue;
        }
        let landed: string | undefined;
        for (let n = 1; n <= BRING_FORK_TRIES && !landed; n++) {
          const copy = vaultConflictCopyPath(rel, when, n);
          const r = await writeNote(vaultNoteAbs(to, copy), note.text, { ifAbsent: true });
          if (r.ok || r.theirs?.text === note.text) landed = copy;
          else if (r.conflict !== 'exists') break;
        }
        if (landed) forked.push({ from: rel, to: landed });
        else skipped.push(rel);
      } catch (err) {
        // One note that fails never stops the rest; it stays in the old folder.
        this.deps.log?.(`bring skipped a note: ${(err as Error).message}`);
        skipped.push(rel);
      }
    }
    const result: VaultBringResult = { ok: !skipped.length && !capped, moved, skipped, forked };
    if (capped) result.capped = true;
    if (skipped.length) result.reason = 'copy-failed';
    else if (capped) result.reason = 'capped';
    return result;
  }

  private repoint(real: string): VaultPickResult {
    const env = this.deps.env();
    const current = this.deps.current();
    const curReal = realOr(current.dir);
    if (!current.warning && samePath(real, curReal, env.platform)) {
      return { ok: false, same: true, info: this.info() };
    }
    const refused = refusePick(real, env) ?? listOnce(real);
    if (refused) {
      const out: VaultPickResult = { ok: false, refused };
      if (refused === 'managed-inside') {
        out.defaultDisplay = vaultDisplay(env.defaultVaultDir, env.home, env.platform);
        out.managedDisplay = vaultDisplay(env.managedRoot, env.home, env.platform);
      }
      return out;
    }
    try {
      this.deps.save(real);
    } catch (err) {
      this.deps.log?.(`vault.dir was not saved: ${(err as Error).message}`);
      return { ok: false, refused: 'save-failed' };
    }
    const before = current.warning ? undefined : curReal;
    this.previous = before;
    const survey = surveyVaultFolder(real, env);
    const result: VaultPickResult = { ok: true, info: this.info(), survey };
    if (before) {
      const prev: { display: string; notes?: number } = {
        display: vaultDisplay(before, env.home, env.platform),
      };
      if (isDir(before)) prev.notes = surveyVaultFolder(before, env).notes;
      result.previous = prev;
    }
    return result;
  }
}

/** A refinement from the renderer, checked: only the three shapes, and a
 *  child name that is one plain folder name. */
export function parseRefineChoice(v: unknown): VaultRefineChoice {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('blocked: choice must be an object');
  }
  const c = v as Record<string, unknown>;
  if (c.to === 'enclosing' || c.to === 'previous') return { to: c.to };
  if (c.to === 'child') {
    const name = c.name;
    if (
      typeof name !== 'string' ||
      !name ||
      name.length > 255 ||
      /[\\/]/.test(name) ||
      name.startsWith('.')
    ) {
      throw new Error('blocked: child must be one plain folder name');
    }
    return { to: 'child', name };
  }
  throw new Error('blocked: unknown choice');
}

/** Whether a folder is there (for main's list, which must never create a
 *  configured folder that has gone missing). */
export function vaultDirExists(dir: string): boolean {
  return existsSync(dir) && isDir(dir);
}
