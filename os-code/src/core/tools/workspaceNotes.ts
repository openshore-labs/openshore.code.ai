// The vault's notes as the workspace's own tools reach them (D5; the privacy
// review's sp-vaultws, 2026-10-08). A vault can sit inside a workspace (one
// picked inside a project), be it (an Obsidian vault opened as a project), or
// hold it, and then readFile, grep, glob, git, repo search and the shell reach
// its notes by their workspace paths. A file whose real path lies in the vault
// folder is judged here the way the vault tools judge a note (vaultFind.ts,
// harness/vault/privacy.ts): by its path in the vault and, for a note's text,
// its own tags and marks, under the machine's rules unioned with the vault's
// own settings file. A note the vault's settings exclude is never shown; a
// local-only note's text reaches only a seat that stays on this network, and
// the output that carries it is marked `localOnly`, so a later turn on a seat
// that leaves gets the stub in its place. Names follow vaultList: a listing
// names a local-only note and leaves an excluded one out.
//
// The sign-off added three readings the vault tools never needed, since they
// never reach these files: a file in the vault's Trash is judged by the place
// it left and as staying on this computer at the least; a markdown note too
// large or unreadable to judge by its tags and marks stays on this computer;
// and the person's deny rules on the vault tools close a note here too.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { VaultIndex } from '../../harness/vault/index.js';
import { isNotePath } from '../../harness/vault/paths.js';
import type { OscodeMark, VaultVisibility } from '../../harness/vault/types.js';
import { openEngineVaultIndex } from '../vault/engineIndex.js';
import type { ToolContext, ToolOutput } from './index.js';
import { closed, knownFromText, refreshVault, seatLeaves, visibilityOf } from './vaultFind.js';

/** A path's real location by the system's own realpath, for the file or,
 *  for one not made yet (a deleted note in git, a Current State not on disk),
 *  its deepest existing ancestor, with the rest of the path kept. Both sides
 *  of every comparison here go through this one call: on Windows the native
 *  realpath spells a folder by its long name where Node's other realpath
 *  keeps an 8.3 short one (RUNNER~1), so mixing the two judged a note in the
 *  vault as outside it, and open. */
function realOf(abs: string): string {
  let existing = abs;
  let tail = '';
  for (;;) {
    try {
      const real = realpathSync.native(existing);
      return tail ? join(real, tail) : real;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return abs;
      const name = existing.slice(parent.length).replace(/^[\\/]+/, '');
      tail = tail ? join(name, tail) : name;
      existing = parent;
    }
  }
}

function within(target: string, root: string): boolean {
  return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** This session's vault folder by its real path, when it exists. */
export function realVaultRoot(vaultRoot: string | undefined): string | undefined {
  if (!vaultRoot || !existsSync(vaultRoot)) return undefined;
  return realOf(resolve(vaultRoot));
}

/** A file's path inside the vault folder (`vault`, a real path), forward
 *  slashes, '' for the folder itself, judged by where the file really lies so
 *  a link cannot dress a note as a plain file. Undefined outside the vault. */
export function vaultPathOf(vault: string, abs: string): string | undefined {
  const rel = relative(vault, realOf(resolve(abs)));
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return rel.split(sep).join('/');
}

/** Whether the vault folder and the folder at `dir` overlap: one is the
 *  other or lies inside it, by real path (workspaces.ts overlapsVault). */
export function vaultMeets(vaultRoot: string | undefined, dir: string): boolean {
  const vault = realVaultRoot(vaultRoot);
  if (!vault) return false;
  const real = realOf(resolve(dir));
  return within(real, vault) || within(vault, real);
}

/** A test, made once per pass, for whether a workspace-relative path lies in
 *  the vault folder: repo search, the code map and retrieval before turn one
 *  leave such files to the vault's own tools. Undefined with no vault. */
export function vaultFileTest(
  vaultRoot: string | undefined,
  cwd: string,
): ((rel: string) => boolean) | undefined {
  const vault = realVaultRoot(vaultRoot);
  if (!vault) return undefined;
  return (rel) => vaultPathOf(vault, join(cwd, rel)) !== undefined;
}

/** How a workspace file may be shown to the seat answering now: `open` (not
 *  a note, or an open one), `shown-local` (a local-only note, to a seat that
 *  stays), `withheld` (a local-only note, to a seat that leaves) or `closed`
 *  (a note the vault's settings exclude, on every seat). */
export type NoteShowing = 'open' | 'shown-local' | 'withheld' | 'closed';

/** The vault's Trash folder, at its root, as a vault path's prefix.
 *  OpenShore's Trash keeps a note's place under it (`.trash/Journal/day.md`,
 *  folderFs.ts); Obsidian's own keeps only its name (`.trash/day.md`). */
const TRASH_PREFIX = '.trash/';

const RANK: Record<VaultVisibility, number> = { open: 0, 'local-only': 1, hidden: 2 };
function stricter(a: VaultVisibility, b: VaultVisibility): VaultVisibility {
  return RANK[a] >= RANK[b] ? a : b;
}

/** A note's visibility from its vault path and what is known of it (its own
 *  tags and marks, or the index's), the way the vault tools judge one: the
 *  vault's rules, and the person's deny rules on the vault tools. A file in
 *  the vault's Trash is judged by the place it left, and as staying on this
 *  computer at the least, since Obsidian's Trash keeps no folder to judge
 *  it by. */
function judged(
  ctx: ToolContext,
  notePath: string,
  known?: { tags?: readonly string[]; oscode?: readonly OscodeMark[] },
): VaultVisibility {
  const trashed = notePath.toLowerCase().startsWith(TRASH_PREFIX);
  const place = trashed ? notePath.slice(TRASH_PREFIX.length) : notePath;
  if (closed(ctx, place)) return 'hidden';
  const visibility = visibilityOf(ctx, place, known);
  return trashed ? stricter(visibility, 'local-only') : visibility;
}

/** A note's visibility from its vault path and, for markdown, its text. */
export function noteVisibility(ctx: ToolContext, notePath: string, text?: string): VaultVisibility {
  const known = text !== undefined && /\.md$/i.test(notePath) ? knownFromText(text) : undefined;
  return judged(ctx, notePath, known);
}

/** A workspace file's visibility as a note, from its vault path and, for
 *  markdown, its text (read here when the caller has not). A markdown note
 *  too large or unreadable to judge by its tags and marks is judged as
 *  staying on this computer. */
export function fileVisibility(
  ctx: ToolContext,
  notePath: string,
  abs: string,
  text?: string,
): VaultVisibility {
  if (!/\.md$/i.test(notePath)) return noteVisibility(ctx, notePath);
  const body = text ?? noteText(abs);
  const visibility = noteVisibility(ctx, notePath, body);
  return body === undefined ? stricter(visibility, 'local-only') : visibility;
}

/** How a visibility shows to the seat answering now. */
export function showingFor(ctx: ToolContext, visibility: VaultVisibility): NoteShowing {
  if (visibility === 'hidden') return 'closed';
  if (visibility === 'local-only') return seatLeaves(ctx) ? 'withheld' : 'shown-local';
  return 'open';
}

/** The largest note read to judge its tags and marks, readFile's bound. */
const JUDGE_MAX_BYTES = 2_000_000;

/** A markdown file's text for judging, or undefined when it cannot be read. */
function noteText(abs: string): string | undefined {
  try {
    if (statSync(abs).size > JUDGE_MAX_BYTES) return undefined;
    return readFileSync(abs, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * The judge one tool call uses: the vault folder resolved once, its own
 * settings read again before the first note is judged (refreshVault, kept
 * 2 s by the holder), and each file's verdict kept for the call. Undefined
 * with no vault folder, when every file is open.
 */
export interface WorkspaceNotes {
  /** The vault folder's real path. */
  readonly vault: string;
  /** The file's vault path, or undefined outside the vault. */
  notePath(abs: string): string | undefined;
  /** How the file at `abs` shows now. `text` is its text when the caller
   *  already read it; a markdown note's text is read otherwise. */
  showing(abs: string, text?: string): Promise<NoteShowing>;
  /** Whether a listing leaves the file's name out: a note the vault's
   *  settings exclude, by its path and, once the vault's index is open, its
   *  tags and marks, as vaultList judges one. */
  unlisted(abs: string): Promise<boolean>;
}

export function workspaceNotes(ctx: ToolContext): WorkspaceNotes | undefined {
  const vault = realVaultRoot(ctx.vaultRoot);
  if (!vault) return undefined;
  let refreshed: Promise<void> | undefined;
  let index: Promise<VaultIndex | undefined> | undefined;
  return {
    vault,
    notePath: (abs) => vaultPathOf(vault, abs),
    async showing(abs, text) {
      const notePath = vaultPathOf(vault, abs);
      if (notePath === undefined) return 'open';
      await (refreshed ??= refreshVault(ctx));
      return showingFor(ctx, fileVisibility(ctx, notePath, abs, text));
    },
    async unlisted(abs) {
      const notePath = vaultPathOf(vault, abs);
      if (notePath === undefined) return false;
      await (refreshed ??= refreshVault(ctx));
      index ??= openEngineVaultIndex(vault).then(
        (handle) => (handle?.isLoaded ? handle.index : undefined),
        () => undefined,
      );
      return judged(ctx, notePath, (await index)?.entry(notePath)) === 'hidden';
    },
  };
}

/**
 * A test, made once per pass, for whether a workspace-relative path is a
 * vault note this seat must not be handed unmarked: one the vault's rules
 * exclude or keep on this computer, judged by its path and, for markdown, its
 * own text. Repo search leaves such files out (never sent to an embedder,
 * which may be a cloud one, nor ranked); every other file is searched as
 * before, a vault's open notes and the code in a project inside a vault
 * included. Read the vault's own settings first (refreshVault). Undefined
 * with no vault folder.
 */
export function privateNoteTest(
  ctx: ToolContext,
  cwd: string,
): ((rel: string) => boolean) | undefined {
  const vault = realVaultRoot(ctx.vaultRoot);
  if (!vault) return undefined;
  const verdicts = new Map<string, boolean>();
  return (rel) => {
    let hit = verdicts.get(rel);
    if (hit === undefined) {
      const abs = join(cwd, rel);
      const notePath = vaultPathOf(vault, abs);
      hit = notePath !== undefined && fileVisibility(ctx, notePath, abs) !== 'open';
      verdicts.set(rel, hit);
    }
    return hit;
  };
}

/** What a file tool says of a local-only file to a seat that leaves this
 *  network: the vault tools' line, naming a note for vaultRead. A file
 *  vaultRead cannot open (one that is not a note, or one in Trash) is named
 *  for a local model alone. */
export function noteStaysHere(path: string, notePath: string): string {
  const reader = isNotePath(notePath) ? ` with vaultRead ("${notePath}")` : '';
  return `${path} is in the vault and stays on this computer. This model's requests leave this network, so its text is not sent here. A local model can read it${reader}.`;
}

/** What a file tool says of a note the person's vault settings or
 *  permission rules close to the agent. */
export function noteClosed(path: string): string {
  return `${path} is closed to the agent by the person's vault settings or permission rules.`;
}

/** Mark an output that carries a local-only note's text. */
export function markedLocal(out: ToolOutput, local: boolean): ToolOutput {
  return local ? { ...out, localOnly: true } : out;
}
