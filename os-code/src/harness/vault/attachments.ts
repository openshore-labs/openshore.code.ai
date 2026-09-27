// Attachments (Vault M6, CTO K11): which vault files are attachments the Vault
// reads (png, jpg, jpeg, gif, webp, avif, svg, pdf), their type, and how an
// embed or a markdown link finds one. One order, pinned in
// test/vaultMarkdownCore.test.ts:
//
//   1. The exact vault path, compared with `foldPath` (exact case wins).
//   2. Relative to the source note's folder, `..` resolved; climbing above the
//      vault root never matches.
//   3. The `attachmentFolderPath` setting from `obsidian/app`: `/` (or absent)
//      is the root, `./` the note's own folder, `./sub` a folder under it,
//      anything else a vault folder.
//   4. Obsidian's basename order: a suffix match on whole segments, the
//      source's own folder first, then fewest segments, then shortest string,
//      then code-point order (the same tie-breaks as `resolveWikilink`).
//
// Pure and import-free past the vault core.

import { foldPath, noteFolder } from './paths.js';
import { compareCodePoints } from './resolve.js';
import type { AttachmentFolderSetting, AttachmentMime, VaultPathIndex } from './types.js';

/** The largest attachment `readBytes` hands over, in bytes (K11). The
 *  daemon's `/vault/files` route and every provider share it. */
export const VAULT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXT: Readonly<Record<string, AttachmentMime>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

/** The type an attachment path names by its extension, or undefined. */
export function attachmentMime(path: string): AttachmentMime | undefined {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  if (!m) return undefined;
  const name = path.slice(path.lastIndexOf('/') + 1);
  // A bare ".png" is a dot file, not an attachment named "".
  if (name.length === m[0].length) return undefined;
  return MIME_BY_EXT[m[1]!.toLowerCase()];
}

/** Whether `path` names an attachment the Vault reads: an allowed extension,
 *  no dot segment, no empty segment, no backslash, no control character, not
 *  rooted. */
export function isAttachmentPath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  if (path.split('/').some((s) => s === '' || s.startsWith('.'))) return false;
  return attachmentMime(path) !== undefined;
}

function startsWithBytes(bytes: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (bytes.length < at + sig.length) return false;
  for (let k = 0; k < sig.length; k++) if (bytes[at + k] !== sig[k]) return false;
  return true;
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

/** The first bytes as Latin-1 text, for the SVG sniff (no host decoder). */
function latin1(bytes: Uint8Array, max: number): string {
  let out = '';
  const n = Math.min(bytes.length, max);
  for (let k = 0; k < n; k++) out += String.fromCharCode(bytes[k]!);
  return out;
}

/** An ISO BMFF `ftyp` box naming an AVIF brand, major or compatible. */
function isAvif(bytes: Uint8Array): boolean {
  if (!startsWithBytes(bytes, ascii('ftyp'), 4)) return false;
  const size = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  const end = Math.min(bytes.length, size >= 16 ? size : 16, 256);
  for (let at = 8; at + 4 <= end; at += 4) {
    if (at === 12) continue; // the minor version, not a brand
    const brand = latin1(bytes.subarray(at, at + 4), 4);
    if (brand === 'avif' || brand === 'avis') return true;
  }
  return false;
}

/** An SVG document: optional BOM, XML declaration, comments and doctype, then
 *  an `<svg` root. No NUL byte in the sniffed head. */
function isSvg(bytes: Uint8Array): boolean {
  let head = latin1(bytes, 4096);
  if (head.includes('\u0000')) return false;
  if (head.startsWith('ï»¿')) head = head.slice(3);
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>\s*)*<svg[\s>/]/i.test(
    head,
  );
}

/** Whether the first bytes match the type (the rasters and PDF are checked by
 *  magic bytes; SVG by a text sniff). */
export function bytesMatchMime(bytes: Uint8Array, mime: AttachmentMime): boolean {
  switch (mime) {
    case 'image/png':
      return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return startsWithBytes(bytes, ascii('GIF87a')) || startsWithBytes(bytes, ascii('GIF89a'));
    case 'image/webp':
      return startsWithBytes(bytes, ascii('RIFF')) && startsWithBytes(bytes, ascii('WEBP'), 8);
    case 'image/avif':
      return isAvif(bytes);
    case 'application/pdf':
      // The header may sit anywhere in the first 1024 bytes (PDF 1.7, 7.5.2).
      return latin1(bytes, 1024).includes('%PDF-');
    case 'image/svg+xml':
      return isSvg(bytes);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Resolution

interface AttachmentData {
  byFold: Map<string, string[]>;
  byBase: Map<string, string[]>;
}

const DATA = new WeakMap<object, AttachmentData>();

function dataOf(attachments: readonly string[] | VaultPathIndex): AttachmentData {
  const cached = DATA.get(attachments);
  if (cached) return cached;
  const paths = Array.isArray(attachments)
    ? (attachments as readonly string[])
    : (attachments as VaultPathIndex).paths;
  const byFold = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, p: string) => {
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  };
  for (const p of paths) {
    if (!isAttachmentPath(p)) continue;
    const folded = foldPath(p);
    push(byFold, folded, p);
    push(byBase, folded.slice(folded.lastIndexOf('/') + 1), p);
  }
  for (const list of byFold.values()) list.sort(compareCodePoints);
  const data = { byFold, byBase };
  DATA.set(attachments, data);
  return data;
}

function pickFold(list: string[] | undefined, want: string): string | undefined {
  if (!list?.length) return undefined;
  const nfc = want.normalize('NFC');
  return list.find((p) => p.normalize('NFC') === nfc) ?? list[0];
}

/** `folder` joined with `rel`, `.` and `..` resolved; undefined when it
 *  climbs above the vault root or names nothing. */
function joinRelative(folder: string, rel: string): string | undefined {
  const out = folder ? folder.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return undefined;
      out.pop();
    } else out.push(seg);
  }
  return out.length ? out.join('/') : undefined;
}

function suffixHits(data: AttachmentData, target: string): string[] {
  const want = foldPath(target)
    .split('/')
    .filter((s) => s !== '');
  if (!want.length || want.some((s) => s === '.' || s === '..')) return [];
  const list = data.byBase.get(want[want.length - 1]!);
  if (!list) return [];
  return list.filter((p) => {
    const segs = foldPath(p).split('/');
    if (segs.length < want.length) return false;
    const off = segs.length - want.length;
    return want.every((s, k) => segs[off + k] === s);
  });
}

/** The folder step 3 looks in for a note at `source`, or undefined when the
 *  setting names the root (step 1 has already looked there). */
function settingFolder(source: string, setting?: AttachmentFolderSetting): string | undefined {
  const s = (setting ?? '').trim();
  if (s === '' || s === '/') return undefined;
  if (s === '.' || s === './') return noteFolder(source);
  if (s.startsWith('./')) return joinRelative(noteFolder(source), s.slice(2)) ?? '';
  return (
    s
      .split('/')
      .filter((x) => x !== '')
      .join('/') || undefined
  );
}

/** The target as written, without a `#subpath` or `|size`, trimmed; a
 *  percent-encoded markdown destination is decoded when it decodes. */
function cleanTarget(target: string): string {
  let t = target;
  const bar = t.indexOf('|');
  if (bar !== -1) t = t.slice(0, bar);
  const hash = t.indexOf('#');
  if (hash !== -1) t = t.slice(0, hash);
  t = t.trim();
  if (t.startsWith('<') && t.endsWith('>')) t = t.slice(1, -1).trim();
  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch {
      // Keep it as written.
    }
  }
  return t;
}

/** The attachment `target` (as written in `source`) names, or undefined.
 *  `attachments` holds the vault's attachment paths (any note paths in it
 *  are passed over). Build the list or index once and reuse it: the lookup is
 *  cached per object. */
export function resolveAttachment(
  target: string,
  source: string,
  attachments: readonly string[] | VaultPathIndex,
  setting?: AttachmentFolderSetting,
): string | undefined {
  const t = cleanTarget(target);
  if (!t || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(t) || t.startsWith('//')) return undefined;
  if (!attachmentMime(t)) return undefined;
  const data = dataOf(attachments);
  const relative = /^\.\.?\//.test(t);
  // 1. The exact vault path (never for an explicitly relative target).
  if (!relative) {
    const exact = t
      .split('/')
      .filter((s) => s !== '')
      .join('/');
    const hit = pickFold(data.byFold.get(foldPath(exact)), exact);
    if (hit) return hit;
  }
  // 2. Relative to the source's folder.
  const rel = joinRelative(noteFolder(source), t);
  const relHit = rel && pickFold(data.byFold.get(foldPath(rel)), rel);
  if (relHit) return relHit;
  if (relative) return undefined;
  // 3. The attachments folder setting.
  const folder = settingFolder(source, setting);
  if (folder !== undefined) {
    const inFolder = joinRelative(folder, t);
    const hit = inFolder && pickFold(data.byFold.get(foldPath(inFolder)), inFolder);
    if (hit) return hit;
  }
  // 4. Obsidian's basename order.
  const hits = suffixHits(data, t);
  if (!hits.length) return undefined;
  const home = foldPath(noteFolder(source));
  const rank = (p: string) => (foldPath(noteFolder(p)) === home ? 0 : 1);
  hits.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.split('/').length - b.split('/').length ||
      a.length - b.length ||
      compareCodePoints(a, b),
  );
  return hits[0];
}

/** The shortest embed text (`![[text]]`) that reaches `path` from `source`:
 *  the file name when that names only this attachment, else a longer path
 *  suffix, else the full path. Undefined when no wikilink can hold the name
 *  (`# ^ [ ] |`) or the path does not resolve. */
export function attachmentLinkText(
  path: string,
  source: string,
  attachments: readonly string[] | VaultPathIndex,
  setting?: AttachmentFolderSetting,
): string | undefined {
  if (/[[\]|#^]/.test(path)) return undefined;
  const data = dataOf(attachments);
  const segs = path.split('/');
  for (let k = 1; k <= segs.length; k++) {
    const cand = segs.slice(-k).join('/');
    if (cand.trim() !== cand) continue;
    if (resolveAttachment(cand, source, attachments, setting) !== path) continue;
    if (k === segs.length || suffixHits(data, cand).length === 1) return cand;
  }
  return undefined;
}
