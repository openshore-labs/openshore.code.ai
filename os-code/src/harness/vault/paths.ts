// The Vault's note-path rules (Vault M3, CTO H4): one new-name rule the engine,
// the desktop's main process and the app share, the note filter every
// provider's list runs through, and the small path helpers (title, folder,
// conflict copies, line endings). Pure and import-free, so it rides the
// browser-safe protocol surface and the phone's core.
//
// The new-name rule, applied to NEW names only (an existing note keeps any
// name the file system gave it, so "Decision: auth?.md" still updates):
//   - NFC, and "/" separators;
//   - none of \ : * ? " < > | # ^ [ ] (Obsidian's own refusal set plus its
//     link syntax);
//   - no dot-led segment, and no trailing dot or space on a segment;
//   - no Windows reserved name (CON, PRN, AUX, NUL, COM1 to COM9, LPT1 to
//     LPT9), judged on the part before the first dot;
//   - at most 255 bytes of UTF-8 per segment.

import type { Eol, IsNotePathOptions, NewNoteNameCheck } from './types.js';

/** The longest segment, in UTF-8 bytes, most file systems hold. */
export const MAX_SEGMENT_BYTES = 255;

/** The characters a new name may not carry. Backslash is here too; the
 *  cleaner turns it into a separator, the checker refuses it. */
const FORBIDDEN = /[\\:*?"<>|#^[\]]/g;
/** The same set without the backslash, for the cleaner (which has already
 *  turned every backslash into "/"). */
const FORBIDDEN_CLEAN = /[<>:"|?*#^[\]]/g;

const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** File types that sit beside notes in an Obsidian vault (images, audio,
 *  video, PDF, canvas, base) plus config, office, and archive files. A name
 *  that already ends in one names a file, not a note (obs-12). */
const NON_NOTE_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|heic|tiff?|ico|pdf|canvas|base|mp3|wav|m4a|ogg|flac|3gp|mp4|webm|mov|mkv|ogv|json|csv|zip|docx?|xlsx?|pptx?)$/i;

const MD = /\.md$/i;

/** The UTF-8 length of a string, counted without any encoder (the core stays
 *  free of host globals). A lone surrogate counts as the 3 bytes of U+FFFD. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/** Cut `s` to at most `max` UTF-8 bytes on a code point boundary. */
function truncateBytes(s: string, max: number): string {
  if (utf8Length(s) <= max) return s;
  let out = '';
  let used = 0;
  for (const ch of s) {
    const b = utf8Length(ch);
    if (used + b > max) break;
    out += ch;
    used += b;
  }
  return out;
}

/** A path folded for comparing only (NFC, then lowercase), never for
 *  writing: two spellings that fold the same name the same note. */
export function foldPath(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/** Is this segment (or its part before the first dot) a Windows reserved
 *  device name? */
function isReserved(segment: string): boolean {
  const dot = segment.indexOf('.');
  return RESERVED.test((dot === -1 ? segment : segment.slice(0, dot)).trim());
}

/** One segment cleaned by the new-name rule, or '' when nothing is left. */
function cleanSegment(raw: string): string {
  let s = raw
    .trim()
    .replace(FORBIDDEN_CLEAN, '')
    .replace(/^[\s.]+/, '');
  s = truncateBytes(s, MAX_SEGMENT_BYTES).replace(/[\s.]+$/, '');
  if (s && isReserved(s)) s = reservedSafe(s);
  return s;
}

/** "CON" becomes "CON_", "com1.plan" becomes "com1_.plan". */
function reservedSafe(s: string): string {
  const dot = s.indexOf('.');
  return dot === -1 ? `${s}_` : `${s.slice(0, dot)}_${s.slice(dot)}`;
}

/** A typed name or link target cleaned into a vault-relative path, before any
 *  extension rule: NFC, forward slashes, forbidden characters dropped, no
 *  leading dot or space and no trailing dot or space on any segment, reserved
 *  names made safe, each segment at most 255 bytes. Stripping the dots also
 *  drops "." and ".." segments, so a typed name or a wikilink can never climb
 *  out of the vault root (SEC: path jail). '' when nothing is left. */
export function cleanNotePath(raw: string): string {
  return raw
    .normalize('NFC')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map(cleanSegment)
    .filter(Boolean)
    .join('/');
}

/** Normalize a typed note name or path into a vault-relative .md path, the
 *  one new-name rule. Every path it returns is one `isNotePath` accepts.
 *  Undefined for an empty result, and for a name that already ends in a known
 *  non-markdown extension: `diagram.png` is an attachment, so a new note is
 *  never an empty `diagram.png.md`. A name with any other dot, like
 *  `v1.2 plan`, is still a note. */
export function normalizeNotePath(raw: string): string | undefined {
  const cleaned = cleanNotePath(raw);
  if (!cleaned) return undefined;
  const slash = cleaned.lastIndexOf('/');
  const folder = slash === -1 ? '' : cleaned.slice(0, slash + 1);
  const name = cleaned.slice(slash + 1);
  let stem: string;
  let ext: string;
  if (MD.test(name)) {
    stem = name.slice(0, -3);
    ext = name.slice(-3);
  } else {
    if (NON_NOTE_EXTENSION.test(name)) return undefined;
    stem = name;
    ext = '.md';
  }
  stem = truncateBytes(stem, MAX_SEGMENT_BYTES - ext.length).replace(/[\s.]+$/, '');
  if (!stem) return undefined;
  if (isReserved(stem)) stem = reservedSafe(stem);
  return `${folder}${stem}${ext}`;
}

/** The benign spelling of a typed name: NFC, trimmed, empty segments and
 *  surrounding slashes collapsed, .md appended. Nothing is stripped. */
function plainNotePath(raw: string): string {
  const joined = raw
    .normalize('NFC')
    .trim()
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
  if (!joined) return '';
  return MD.test(joined) ? joined : `${joined}.md`;
}

/** The one new-name rule as a check, for the engine's `vaultWrite` on a new
 *  note: `{ ok, path }` when the name is already clean, else a refusal with
 *  the cleaned name to offer instead. A write to an existing exact path does
 *  not come here. */
export function checkNewNoteName(raw: string): NewNoteNameCheck {
  const suggestion = normalizeNotePath(raw);
  const refuse = (why: string): NewNoteNameCheck => {
    const use = suggestion ? ` Use "${suggestion}".` : '';
    return suggestion
      ? { ok: false, error: `${why}${use}`, suggestion }
      : { ok: false, error: why };
  };
  const plain = plainNotePath(raw);
  if (!plain) return refuse('Give the note a name.');
  const bad = [...new Set(plain.match(FORBIDDEN) ?? [])];
  if (bad.length) {
    return refuse(
      `Note names cannot contain ${bad.join(' ')}; file systems or Obsidian's links refuse them.`,
    );
  }
  const segments = plain.split('/');
  if (segments.some((s) => s.startsWith('.'))) {
    return refuse('Note names cannot start with a dot; the vault and Obsidian hide them.');
  }
  const stems = segments.map((s, i) => (i === segments.length - 1 ? s.slice(0, -3) : s));
  if (stems.some((s) => /[\s.]$/.test(s))) {
    return refuse('A part of a note name cannot end in a dot or a space.');
  }
  const reserved = stems.find((s) => isReserved(s));
  if (reserved !== undefined) return refuse(`"${reserved}" is a name Windows reserves.`);
  if (segments.some((s) => utf8Length(s) > MAX_SEGMENT_BYTES)) {
    return refuse('Each part of a note name must be 255 bytes or fewer.');
  }
  if (!suggestion) {
    const ext = nonNoteExtension(raw);
    return refuse(
      ext ? `A name ending in ${ext} names a file, not a note.` : 'Give the note a name.',
    );
  }
  return suggestion === plain
    ? { ok: true, path: plain }
    : refuse('That name is not a clean note name.');
}

/** One path segment made safe for a folder or file name, for names the
 *  engine derives (a routine's folder): forbidden characters become spaces,
 *  runs of space collapse, no leading or trailing dot or space, reserved
 *  names made safe, at most 255 bytes. `fallback` when nothing is left. */
export function safeNoteName(segment: string, fallback = 'Untitled'): string {
  let s = segment
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '');
  s = truncateBytes(s, MAX_SEGMENT_BYTES).replace(/[\s.]+$/, '');
  if (s && isReserved(s)) s = reservedSafe(s);
  return s || fallback;
}

/** The seam's note rule: a .md file with no dot segment, no backslash, not
 *  rooted. `windows` also refuses what a Windows file system cannot hold: a
 *  colon (a drive or an NTFS stream), the other forbidden characters, a
 *  reserved name, and a segment ending in a dot or a space. */
export function isNotePath(path: string, options: IsNotePathOptions = {}): boolean {
  if (!MD.test(path)) return false;
  if (path.includes('\\') || path.startsWith('/')) return false;
  const segments = path.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) return false;
  if (options.windows) {
    if (/[:*?"<>|]/.test(path)) return false;
    if (segments.some((s) => isReserved(s) || /[\s.]$/.test(s))) return false;
  }
  return true;
}

/** A note's display title: its filename without the .md extension, exactly
 *  how Obsidian titles a note. */
export function noteTitle(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(MD, '');
}

/** The folder a note lives in, '' at the vault root. */
export function noteFolder(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** The extension of a name that names a file rather than a note (".pdf" for
 *  "report.pdf"), or undefined for a note name. */
export function nonNoteExtension(raw: string): string | undefined {
  return NON_NOTE_EXTENSION.exec(raw.trim())?.[0].toLowerCase();
}

/** A conflict copy, as the team server or `vaultConflictCopyPath` names it:
 *  "name (conflict 2026-01-01 1200).md". */
export function isConflictCopy(path: string): boolean {
  return /\(conflict [^)]*\)\.md$/i.test(path);
}

/** A note's line endings: `crlf` only when every line break is CRLF, `lf`
 *  when none is (or there is no line break), `mixed` otherwise (a lone CR
 *  counts as mixed). The save path puts CRLF back only on an all-CRLF note. */
export function eolOf(text: string): Eol {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) lf++;
    else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    }
  }
  if (cr > 0 || (lf > 0 && crlf > 0)) return 'mixed';
  return crlf > 0 ? 'crlf' : 'lf';
}

/** The keep-both name for a copy of `path` made at `when`, beside the note,
 *  in this device's local time: "Plan (conflict 2026-09-27 1405).md". n above
 *  1 adds a counter, so a second copy in the same minute never lands on the
 *  first. The base is cleaned by the new-name rule and shortened, never the
 *  suffix, so the copy always stays a conflict copy. */
export function vaultConflictCopyPath(path: string, when: Date, n = 1): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  const stamp =
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ` +
    `${pad(when.getHours())}${pad(when.getMinutes())}${n > 1 ? ` ${n}` : ''}`;
  const suffix = ` (conflict ${stamp})`;
  const cleaned = cleanNotePath(path.replace(MD, ''));
  if (!cleaned) return `Note${suffix}.md`;
  const slash = cleaned.lastIndexOf('/');
  const folder = slash === -1 ? '' : cleaned.slice(0, slash + 1);
  const room = MAX_SEGMENT_BYTES - utf8Length(suffix) - 3;
  const base = truncateBytes(cleaned.slice(slash + 1), room).replace(/[\s.]+$/, '') || 'Note';
  return `${folder}${base}${suffix}.md`;
}
