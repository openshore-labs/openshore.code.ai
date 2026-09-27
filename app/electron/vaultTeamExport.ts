// The team vault's export on the desktop (Vault M2 2.8): every team note the
// renderer could read, written as a plain .md file under its own folder,
// "Vault Team/<org>" beside the default personal vault folder, so a desktop
// team member can open the team vault in Obsidian. Plain Node, no Electron,
// so a test runs it in a temp folder exactly as main does.
//
// It follows the iPhone export's manifest rule (0.11): it never removes the
// folder, never touches a file it did not write (Obsidian's .obsidian/ and
// anything added by hand survive), removes only its own files for notes gone
// since, and leaves a file edited there since as it is, naming it (`kept`).
// The manifest lives in the folder's own `.oscode/export.json`, which no note
// list shows. It never writes into the personal vault: a team folder that is,
// holds, or lies inside the personal vault folder is refused.
//
// The renderer is untrusted input (UI-6): the org name becomes one plain
// folder name here, and every note path must be a note and stay inside the
// team folder (the Jail, symlink-safe).
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { isVaultNotePath, vaultNoteAbs } from './vaultFs.js';
import { realOr, vaultDisplay, within } from './vaultDir.js';

/** What an export did; the renderer's VaultExportResult, plus where. */
export interface TeamExportResult {
  written: number;
  total: number;
  removed: number;
  unread: number;
  kept: string[];
  /** The team folder, and how it reads (~ for home on macOS and Linux). */
  dir: string;
  display: string;
}

/** An org's name as one folder name: no separators, no characters Windows or
 *  macOS refuse, no leading dot (hidden), at most 80 characters, and "Team"
 *  when nothing is left. The renderer's copy of this rule (lib/vaultExport.ts
 *  teamFolderName) is held in step by a test. */
export function teamFolderName(org: string): string {
  const cleaned = [...String(org).normalize('NFC')]
    .map((c) => (c.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(c) ? ' ' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
  return cleaned || 'Team';
}

// The same fingerprint the iPhone export keeps (FNV-1a over UTF-16 code
// units, plus the length), so the two exports speak one manifest shape.
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${(h >>> 0).toString(16)}`;
}

type Manifest = Record<string, string>;
const MANIFEST = join('.oscode', 'export.json');

function readManifest(root: string): Manifest {
  try {
    const parsed = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Manifest = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function writeAtomic(abs: string, text: string): void {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = join(
    dirname(abs),
    `.oscode-export-${createHash('sha1').update(abs).digest('hex').slice(0, 8)}.tmp`,
  );
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, abs);
}

/** Whether the export may write a note's file: absent, still exactly what it
 *  last wrote there, or already the note's exact text. A file there that
 *  cannot be read is left alone, as someone's. */
function mayWrite(abs: string, text: string, print: string | undefined): boolean {
  if (!existsSync(abs)) return true;
  let data: string;
  try {
    data = readFileSync(abs, 'utf8');
  } catch {
    return false;
  }
  return data === text || (print !== undefined && fingerprint(data) === print);
}

/** Validate what the renderer sent: an array of `{ path, text }` and an array
 *  of paths, dropping anything else. */
export function parseTeamExport(
  notes: unknown,
  failed: unknown,
): { notes: Array<{ path: string; text: string }>; failed: string[] } {
  const list = Array.isArray(notes)
    ? notes.filter(
        (n): n is { path: string; text: string } =>
          Boolean(n) &&
          typeof (n as { path?: unknown }).path === 'string' &&
          typeof (n as { text?: unknown }).text === 'string',
      )
    : [];
  const gone = Array.isArray(failed)
    ? failed.filter((p): p is string => typeof p === 'string')
    : [];
  return { notes: list.map(({ path, text }) => ({ path, text })), failed: gone };
}

/** Export the team notes into `<base>/<teamFolderName(org)>`. `personal` is
 *  the personal vault folder, which the team folder never is, holds, or lies
 *  in. Throws on a real write failure, so the renderer can say so. */
export function exportTeamVault(opts: {
  base: string;
  org: string;
  personal: string;
  home: string;
  notes: Array<{ path: string; text: string }>;
  failed: readonly string[];
  platform?: NodeJS.Platform;
}): TeamExportResult {
  const platform = opts.platform ?? process.platform;
  const root = join(opts.base, teamFolderName(opts.org));
  const personal = realOr(opts.personal);
  const real = realOr(root);
  if (within(real, personal, platform) || within(personal, real, platform)) {
    throw new Error('The team export would land in your personal vault, so nothing was written.');
  }
  mkdirSync(root, { recursive: true });
  const before = readManifest(root);
  const next: Manifest = {};
  for (const path of opts.failed) if (before[path]) next[path] = before[path];
  const current = new Set([...opts.notes.map((n) => n.path), ...opts.failed]);
  const kept: string[] = [];
  let written = 0;
  let removed = 0;
  let done = false;
  try {
    for (const note of opts.notes) {
      if (!isVaultNotePath(note.path, platform)) continue;
      let abs: string;
      try {
        abs = vaultNoteAbs(root, note.path);
      } catch {
        continue; // Would leave the team folder: never written.
      }
      if (!mayWrite(abs, note.text, before[note.path])) {
        kept.push(note.path);
        continue;
      }
      writeAtomic(abs, note.text);
      next[note.path] = fingerprint(note.text);
      written += 1;
    }
    // Only this device's own files for notes gone since, and only while each
    // still holds exactly what was written.
    for (const [path, print] of Object.entries(before)) {
      if (current.has(path) || !isVaultNotePath(path, platform)) continue;
      try {
        const abs = vaultNoteAbs(root, path);
        if (!statSync(abs).isFile()) continue;
        if (fingerprint(readFileSync(abs, 'utf8')) !== print) continue;
        rmSync(abs);
        removed += 1;
      } catch {
        // Already gone, or outside the folder: nothing to do.
      }
    }
    done = true;
  } finally {
    const manifest = done ? next : { ...before, ...next };
    for (const path of kept) delete manifest[path];
    try {
      writeAtomic(join(root, MANIFEST), JSON.stringify(manifest));
    } catch {
      // The files are written; a manifest that did not land only means the
      // next export treats them as someone's and leaves them.
    }
  }
  return {
    written,
    total: opts.notes.length + opts.failed.length,
    removed,
    unread: opts.failed.length,
    kept,
    dir: root,
    display: vaultDisplay(root, opts.home, platform),
  };
}
