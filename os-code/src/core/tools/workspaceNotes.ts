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
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { VaultIndex } from '../../harness/vault/index.js';
import type { VaultVisibility } from '../../harness/vault/types.js';
import { deepestRealpath } from '../security/jail.js';
import { openEngineVaultIndex } from '../vault/engineIndex.js';
import type { ToolContext, ToolOutput } from './index.js';
import { knownFromText, refreshVault, seatLeaves, visibilityOf } from './vaultFind.js';

/** A path's real location: the system's realpath in one call, else the
 *  deepest existing ancestor's (a file not made yet). */
function realOf(abs: string): string {
  try {
    return realpathSync.native(abs);
  } catch {
    return deepestRealpath(abs);
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

/** A note's visibility from its vault path and, for markdown, its text. */
export function noteVisibility(ctx: ToolContext, notePath: string, text?: string): VaultVisibility {
  const known = text !== undefined && /\.md$/i.test(notePath) ? knownFromText(text) : undefined;
  return visibilityOf(ctx, notePath, known);
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
      const body = text ?? (/\.md$/i.test(notePath) ? noteText(abs) : undefined);
      return showingFor(ctx, noteVisibility(ctx, notePath, body));
    },
    async unlisted(abs) {
      const notePath = vaultPathOf(vault, abs);
      if (notePath === undefined) return false;
      await (refreshed ??= refreshVault(ctx));
      index ??= openEngineVaultIndex(vault).then(
        (handle) => (handle?.isLoaded ? handle.index : undefined),
        () => undefined,
      );
      return visibilityOf(ctx, notePath, (await index)?.entry(notePath)) === 'hidden';
    },
  };
}

/** What a file tool says of a local-only note to a seat that leaves this
 *  network: the vault tools' line, naming the note for vaultRead. */
export function noteStaysHere(path: string, notePath: string): string {
  return `${path} is a vault note that stays on this computer. This model's requests leave this network, so its text is not sent here. A local model can read it with vaultRead ("${notePath}").`;
}

/** What a file tool says of a note the person's vault settings exclude. */
export function noteClosed(path: string): string {
  return `${path} is closed to the agent by the person's vault settings.`;
}

/** Mark an output that carries a local-only note's text. */
export function markedLocal(out: ToolOutput, local: boolean): ToolOutput {
  return local ? { ...out, localOnly: true } : out;
}
