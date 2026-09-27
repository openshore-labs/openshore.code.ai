// The desktop vault folder's file work, as main's osc:vault* handlers run it:
// plain Node, no Electron, so a test calls these exactly as main does
// (test/providerContract.test.ts, test/deviceFolder.test.ts). Every note is
// read, versioned, and written through the engine's one note file module
// (os-code noteFile), the same one the agent's vaultWrite uses, so the two
// never drift on how a note is saved (Vault M1, CTO F1, F2, F5).
//
// The renderer is untrusted input (UI-6), so every path is checked twice
// here: it must be a note (`.md`, no dot segment, so `.obsidian/` plugin data
// and attachments never cross; CTO F7.4) and it must resolve inside the vault
// folder (the Jail, symlink-safe). A write's guard is validated the same way.
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Jail } from 'os-code/dist/src/core/security/jail.js';
import {
  noteVersion,
  readNote,
  statNote,
  sweepNoteTemps,
  writeNote,
  type NoteGuard,
} from 'os-code/dist/src/core/vault/noteFile.js';

/** A note as it crosses the bridge (the seam's StoredFile). */
export interface VaultFile {
  path: string;
  text: string;
  updatedAt: string;
  version: string;
}

/** A note's metadata as it crosses the bridge (the seam's StoredFileMeta);
 *  size is in bytes. */
export interface VaultFileMeta {
  path: string;
  updatedAt: string;
  size: number;
  version: string;
}

/** The seam's WriteResult, as main answers osc:vaultWrite. */
export type VaultWriteResult =
  | { ok: true; file: VaultFile }
  | { ok: false; conflict: 'changed' | 'missing' | 'exists'; theirs?: VaultFile };

/** The seam's note rule (app/src/lib/gitos/providers.ts isNotePath), held
 *  again here because main cannot import renderer code. A test keeps the two
 *  in step. */
export function isVaultNotePath(path: string): boolean {
  if (!/\.md$/i.test(path)) return false;
  return !path.split('/').some((segment) => segment.startsWith('.'));
}

/** The longest version token main accepts in a guard. A real one is three
 *  decimal numbers, far shorter. */
const MAX_GUARD_VERSION = 200;

/** A write guard from the renderer, checked: `{ ifMatch }` with a string of
 *  at most 200 characters, or `{ ifAbsent: true }`; never both, never
 *  anything else. Undefined when no guard was sent. */
export function parseVaultGuard(v: unknown): NoteGuard | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('blocked: guard must be an object');
  }
  const g = v as Record<string, unknown>;
  const hasMatch = g.ifMatch !== undefined;
  const hasAbsent = g.ifAbsent !== undefined;
  if (hasMatch && hasAbsent) throw new Error('blocked: guard takes ifMatch or ifAbsent, not both');
  if (hasMatch) {
    if (typeof g.ifMatch !== 'string' || g.ifMatch.length > MAX_GUARD_VERSION) {
      throw new Error('blocked: guard.ifMatch must be a short string');
    }
    return { ifMatch: g.ifMatch };
  }
  if (g.ifAbsent === true) return { ifAbsent: true };
  throw new Error('blocked: guard must be { ifMatch } or { ifAbsent: true }');
}

/** The absolute path of a note in the vault folder, refusing anything that is
 *  not a note or would leave the folder. Makes the folder when it is missing,
 *  so a first write has somewhere to land. */
export function vaultNoteAbs(root: string, path: string): string {
  if (typeof path !== 'string' || !isVaultNotePath(path)) {
    throw new Error('blocked: only notes (.md, outside dot folders) cross the vault bridge');
  }
  mkdirSync(root, { recursive: true });
  return new Jail(root).resolve(path);
}

/** Every note in the folder, with its version from one bigint lstat, sorted
 *  by path. Dot entries (`.obsidian/`, `.trash/`, our temp files) and
 *  non-notes are skipped. Temp files a crash left behind are swept as the walk
 *  passes their folder. */
export function listVaultFolder(root: string): VaultFileMeta[] {
  if (!existsSync(root)) return [];
  const out: VaultFileMeta[] = [];
  const walk = (dir: string): void => {
    sweepNoteTemps(dir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        let st;
        try {
          st = lstatSync(abs, { bigint: true });
        } catch {
          continue; // Gone between the listing and the stat.
        }
        out.push({
          path: relative(root, abs).split(sep).join('/'),
          updatedAt: new Date(Number(st.mtimeMs)).toISOString(),
          size: Number(st.size),
          version: noteVersion(st),
        });
      }
    }
  };
  walk(root);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** One note's text with the version of exactly those bytes, or null. */
export async function readVaultFile(root: string, path: string): Promise<VaultFile | null> {
  const note = await readNote(vaultNoteAbs(root, path));
  return note && { path, text: note.text, updatedAt: note.updatedAt, version: note.version };
}

/** One note's metadata from one lstat, or null (osc:vaultStat). */
export async function statVaultFile(root: string, path: string): Promise<VaultFileMeta | null> {
  const st = await statNote(vaultNoteAbs(root, path));
  return st && { path, updatedAt: st.updatedAt, size: st.size, version: st.version };
}

/** Write a note through the engine's writeNote: temp file then rename, and the
 *  guard checked after the temp file is complete, as late as it can be. A
 *  conflict is a result that leaves the note as it was. */
export async function writeVaultFile(
  root: string,
  path: string,
  text: string,
  guard?: NoteGuard,
): Promise<VaultWriteResult> {
  const r = await writeNote(vaultNoteAbs(root, path), text, guard);
  if (r.ok) {
    return { ok: true, file: { path, text, updatedAt: r.updatedAt, version: r.version } };
  }
  const theirs = r.theirs && { path, ...r.theirs };
  return theirs ? { ok: false, conflict: r.conflict, theirs } : { ok: false, conflict: r.conflict };
}

/** Remove a note, when it is there. */
export function removeVaultFile(root: string, path: string): void {
  const abs = vaultNoteAbs(root, path);
  if (existsSync(abs)) rmSync(abs);
}
