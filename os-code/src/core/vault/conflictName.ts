// The keep-both name for a note's second version: "Note (conflict 2026-09-27
// 1405).md" beside the note, in this device's local time. Shared by the app's
// store (a stash replay, a move's forks, Keep both) and the desktop's main
// process (Bring from the previous folder), so both name the same note the
// same way in the same minute. Pure, with no imports, so it rides the
// browser-safe protocol surface.

/** The typed-name rule the app holds (app/src/lib/vault.ts cleanNotePath):
 *  NFC, "/" separators, no characters common file systems or Obsidian's link
 *  syntax refuse, no leading dots or spaces on a segment, no empty segment.
 *  A test in the app keeps the two in step. */
function cleanNoteName(raw: string): string {
  return raw
    .normalize('NFC')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((s) =>
      s
        .trim()
        .replace(/[<>:"|?*#^[\]]/g, '')
        .replace(/^[\s.]+/, ''),
    )
    .filter(Boolean)
    .join('/');
}

/** The keep-both name for a copy of `path` made at `when`. n above 1 adds a
 *  counter, so a second copy in the same minute never lands on the first. */
export function vaultConflictCopyPath(path: string, when: Date, n = 1): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  const stamp =
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ` +
    `${pad(when.getHours())}${pad(when.getMinutes())}${n > 1 ? ` ${n}` : ''}`;
  const base = path.replace(/\.md$/i, '');
  const cleaned = cleanNoteName(`${base} (conflict ${stamp})`);
  return cleaned ? `${cleaned}.md` : `Note (conflict ${stamp}).md`;
}
