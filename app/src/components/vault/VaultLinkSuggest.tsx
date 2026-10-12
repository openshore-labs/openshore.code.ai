// Live [[wikilink]] suggestions under the Vault editor (Vault M6, 6.7; tech review
// K14, UX review X15). A listbox the editor keeps driving: while it is open, Up and
// Down move the active row, Enter or Tab picks it, and Esc closes the list
// only (never the note). The rows are `role="option"` and the editor carries
// `aria-activedescendant`, so VoiceOver reads the row the keys are on while
// focus never leaves the text.
//
// What it offers: notes whose title or path matches, best prefix first, with
// a muted folder sub-label only when two notes share a title; after
// `[[Note#`, that note's headings; and a new note of the typed name when no
// title matches. A pick inserts the shortest link that reaches the note
// (`linkTextFor`, obs-17), and replaces through a `]]` already there, or up
// to a `|` so an alias is kept (`wikilinkReplaceRange`, ui-15).
//
// Insertion goes through `insertAtCaret`: `execCommand('insertText')` first,
// which enters the native undo stack in Chromium and WebKit, and
// `setRangeText` with a dispatched `input` event only where that is refused.
// Either way the editor's own onChange sees the new text, so the screen's
// save path is the one path.
import { useEffect, useId, useMemo, useState, type RefObject } from 'react';
import {
  buildPathIndex,
  foldPath,
  linkTextFor,
  noteFolder,
  noteTitle,
  resolveMarkdownPath,
  resolveWikilink,
  wikilinkReplaceRange,
  type TextRange,
  type VaultLinkFormat,
  type VaultLinkStyle,
  type VaultPathIndex,
  type WikilinkContext,
} from 'os-code/protocol';
import {
  VAULT_LINK_LIST_LABEL,
  vaultLinkChipAria,
  vaultLinkHeading,
  vaultLinkHeadingAria,
  vaultLinkNew,
  vaultLinkNewAria,
} from '../../lib/vaultCopy.js';

/** Rows shown at most: a chip row on the phone, a short list on the desktop. */
export const LINK_SUGGEST_MAX = 8;

export interface VaultLinkOption {
  key: string;
  kind: 'note' | 'heading' | 'new';
  /** What the row shows. */
  label: string;
  /** The folder, shown muted, only when titles collide. */
  sub?: string;
  /** What VoiceOver reads. */
  aria: string;
  /** The link target written between the brackets. */
  target: string;
  /** The note it reaches (a note or a heading row), for a markdown link. */
  path?: string;
  /** The heading, for a heading row. */
  heading?: string;
}

/** The path from the folder `from` to `to`, `../` where it climbs. */
export function relativeNotePath(from: string, to: string): string {
  const a = from.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** A wikilink target for a note in the vault's link format (Vault M7, tech review
 *  L2, `links.format`): the shortest name that reaches it, its path from the
 *  top, or its path from this note, each used only when it still reaches
 *  exactly that note; otherwise the shortest. */
export function wikiTargetFor(
  path: string,
  sourcePath: string,
  index: VaultPathIndex,
  format: VaultLinkFormat = 'shortest',
): string | undefined {
  const shortest = linkTextFor(path, sourcePath, index);
  if (format === 'shortest') return shortest;
  const stem = path.replace(/\.md$/i, '');
  const want = format === 'absolute' ? stem : relativeNotePath(noteFolder(sourcePath), stem);
  return resolveWikilink(want, index, sourcePath) === path ? want : shortest;
}

/** A markdown link destination, each segment encoded the way Obsidian
 *  writes one (a space as %20, parentheses escaped so the link holds). */
function hrefOf(path: string): string {
  return path
    .split('/')
    .map((seg) =>
      seg === '..' ? seg : encodeURIComponent(seg).replace(/\(/g, '%28').replace(/\)/g, '%29'),
    )
    .join('/');
}

/** A markdown link to a note (Vault M7, `links.style: markdown`), in the
 *  vault's link format; a candidate is used only when markdown's own
 *  resolver reaches exactly that note from here. */
export function markdownLinkFor(
  o: { path?: string; target: string; heading?: string },
  sourcePath: string,
  index: VaultPathIndex,
  format: VaultLinkFormat = 'shortest',
): string {
  // The words: the heading, else the note's title, else the typed name.
  const words = o.heading ?? (o.path ? noteTitle(o.path) : o.target);
  const text = words.replace(/[[\]]/g, ' ').trim() || o.target;
  const path = o.path ?? `${o.target.replace(/\.md$/i, '')}.md`;
  const name = path.slice(path.lastIndexOf('/') + 1);
  const rel = relativeNotePath(noteFolder(sourcePath), path);
  const order =
    format === 'relative' ? [rel, path] : format === 'absolute' ? [path, rel] : [name, rel, path];
  const reaches = (c: string) => !o.path || resolveMarkdownPath(c, sourcePath, index) === o.path;
  const chosen = order.find(reaches) ?? rel;
  const hash = o.heading ? `#${encodeURIComponent(o.heading)}` : '';
  return `[${text}](${hrefOf(chosen)}${hash})`;
}

/** Characters a heading link cannot carry; Obsidian writes a space. */
const HEADING_UNSAFE = /[[\]|#^]/g;

function folderLabel(path: string): string {
  return noteFolder(path).split('/').filter(Boolean).join(' / ');
}

/** The rows for an open link, pure (tests call it directly). */
export function linkOptions(
  paths: readonly string[],
  sourcePath: string,
  ctx: WikilinkContext | null,
  headingsOf?: (path: string) => readonly string[],
  max = LINK_SUGGEST_MAX,
  format: VaultLinkFormat = 'shortest',
): VaultLinkOption[] {
  if (!ctx) return [];
  const index = buildPathIndex(paths);
  const raw = ctx.query;
  const hash = raw.indexOf('#');
  if (hash !== -1) {
    const notePart = raw.slice(0, hash).trim();
    const hq = raw.slice(hash + 1);
    if (hq.startsWith('^') || !headingsOf) return [];
    const path = notePart ? resolveWikilink(notePart, index, sourcePath) : sourcePath;
    if (!path) return [];
    const q = hq.trim().toLowerCase();
    const seen = new Set<string>();
    return headingsOf(path)
      .map((h) => h.replace(HEADING_UNSAFE, ' ').replace(/\s+/g, ' ').trim())
      .filter((h) => {
        if (!h || seen.has(h)) return false;
        seen.add(h);
        return !q || h.toLowerCase().includes(q);
      })
      .map((h, i) => ({ h, i, prefix: h.toLowerCase().startsWith(q) ? 0 : 1 }))
      .sort((a, b) => a.prefix - b.prefix || a.i - b.i)
      .slice(0, max)
      .map(({ h }) => ({
        key: `h:${h}`,
        kind: 'heading' as const,
        label: vaultLinkHeading(h),
        aria: vaultLinkHeadingAria(h),
        target: `${notePart}#${h}`,
        path,
        heading: h,
      }));
  }
  const q = raw.trim().toLowerCase();
  // Titles that more than one note shares, across the whole vault.
  const titleCount = new Map<string, number>();
  for (const p of paths) {
    const t = foldPath(noteTitle(p));
    titleCount.set(t, (titleCount.get(t) ?? 0) + 1);
  }
  const notes: VaultLinkOption[] = [];
  const ranked = paths
    .filter((p) => p !== sourcePath)
    .map((p) => ({ p, t: noteTitle(p) }))
    .filter(({ p, t }) => !q || t.toLowerCase().includes(q) || p.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.t.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.t.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.t.length - b.t.length || (a.p < b.p ? -1 : a.p > b.p ? 1 : 0);
    });
  for (const { p, t } of ranked) {
    if (notes.length >= max) break;
    const target = wikiTargetFor(p, sourcePath, index, format);
    if (target === undefined) continue;
    const collides = (titleCount.get(foldPath(t)) ?? 0) > 1;
    const sub = collides ? folderLabel(p) : '';
    notes.push({
      key: `n:${p}`,
      kind: 'note',
      label: t,
      ...(sub ? { sub } : {}),
      aria: vaultLinkChipAria(t, sub),
      target,
      path: p,
    });
  }
  const typed = raw.trim();
  const canCreate =
    typed.length > 0 && !paths.some((p) => foldPath(noteTitle(p)) === foldPath(typed));
  if (canCreate) {
    notes.push({
      key: 'new',
      kind: 'new',
      label: vaultLinkNew(typed),
      aria: vaultLinkNewAria(typed),
      target: typed,
    });
  }
  return notes;
}

/** Put `text` over `range` in a text field the way typing would: through
 *  `execCommand('insertText')` so the native undo stack holds it, else
 *  `setRangeText` and an `input` event so the field's listeners still hear
 *  it. The caret lands after the inserted text. */
export function insertAtCaret(
  el: HTMLTextAreaElement | HTMLInputElement,
  range: TextRange,
  text: string,
): void {
  const before = el.value;
  const expected = before.slice(0, range.start) + text + before.slice(range.end);
  try {
    el.focus({ preventScroll: true });
  } catch {
    // A field that cannot take focus still takes the text below.
  }
  el.setSelectionRange?.(range.start, range.end);
  let done = false;
  try {
    const doc = el.ownerDocument ?? document;
    done = typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text);
  } catch {
    done = false;
  }
  if (done && el.value === expected) return;
  // Refused, or accepted without touching the field (some webviews): write
  // it directly, once, unless the command already changed the text.
  if (el.value !== before) return;
  if (typeof el.setRangeText === 'function') {
    el.setRangeText(text, range.start, range.end, 'end');
  } else {
    el.value = expected;
    el.setSelectionRange?.(range.start + text.length, range.start + text.length);
  }
  const doc = el.ownerDocument ?? document;
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  const EventCtor = view?.Event ?? Event;
  el.dispatchEvent(new EventCtor('input', { bubbles: true }));
}

/** The text a pick writes over its range: `[[target]]`, or `[[target` when
 *  the range stops at an alias's `|`. */
export function linkInsertText(text: string, range: TextRange, target: string): string {
  return text[range.end] === '|' ? `[[${target}` : `[[${target}]]`;
}

export interface VaultLinkSuggestProps {
  /** Every note path in the vault. */
  paths: readonly string[];
  /** The open note, never offered as its own link. */
  sourcePath: string;
  /** The open link under the caret (`wikilinkContext`), or null. */
  context?: WikilinkContext | null;
  /** Wave 0's shape, until the screen passes `context`: what has been typed
   *  since the open `[[`, or null. */
  query?: string | null;
  /** The editor: its keys drive the list, and a pick inserts into it. */
  editor?: RefObject<HTMLTextAreaElement | null>;
  /** A note's headings, in order, for `[[Note#` (the index entry's). */
  headingsOf?: (path: string) => readonly string[];
  /** Esc, or a pick: the screen clears its link context. */
  onDismiss?: () => void;
  /** Wave 0's shape: hand the link target to the screen to insert, in place
   *  of inserting here. Left out, a pick inserts through `insertAtCaret`. */
  onPick?: (target: string) => void;
  /** `chips`: one horizontal row (the phone's accessory bar). `list`: a
   *  vertical list pinned under the editor (the desktop). */
  layout?: 'chips' | 'list';
  /** The replace range (tests inject; the core's by default). */
  replaceRange?: (text: string, ctx: WikilinkContext) => TextRange;
  /** The vault's `links.style` (Vault M7, tech review L2): a markdown pick writes
   *  `[Title](path)` over the typed `[[`. Default wikilinks. */
  linkStyle?: VaultLinkStyle;
  /** The vault's `links.format`: which path a link names. Default shortest. */
  linkFormat?: VaultLinkFormat;
}

export function VaultLinkSuggest({
  paths,
  sourcePath,
  context: contextProp,
  query: queryProp,
  editor,
  headingsOf,
  onDismiss,
  onPick,
  layout = 'list',
  replaceRange = wikilinkReplaceRange,
  linkStyle = 'wiki',
  linkFormat = 'shortest',
}: VaultLinkSuggestProps) {
  const context = useMemo<WikilinkContext | null>(
    () =>
      contextProp !== undefined
        ? contextProp
        : queryProp === null || queryProp === undefined
          ? null
          : { start: 0, end: 0, query: queryProp, embed: false },
    [contextProp, queryProp],
  );
  const options = useMemo(
    () => linkOptions(paths, sourcePath, context, headingsOf, LINK_SUGGEST_MAX, linkFormat),
    [paths, sourcePath, context, headingsOf, linkFormat],
  );
  const [active, setActive] = useState(0);
  const base = useId();
  const optionId = (i: number) => `${base}-opt-${i}`;
  const listId = `${base}-list`;
  const query = context?.query;
  // A new query starts at the top row.
  useEffect(() => setActive(0), [query]);
  const shownActive = Math.min(active, Math.max(0, options.length - 1));
  const open = options.length > 0;

  const pick = (option: VaultLinkOption) => {
    if (onPick) {
      onPick(option.target);
      return;
    }
    const el = editor?.current;
    if (!el || !context) return;
    const text = el.value;
    const range = replaceRange(text, context);
    // A markdown link has no alias half, so an alias already typed keeps
    // the wikilink it belongs to.
    const markdown = linkStyle === 'markdown' && text[range.end] !== '|';
    insertAtCaret(
      el,
      range,
      markdown
        ? markdownLinkFor(option, sourcePath, buildPathIndex(paths), linkFormat)
        : linkInsertText(text, range, option.target),
    );
    onDismiss?.();
  };

  // The editor keeps focus; its keys drive the list while the list is open.
  useEffect(() => {
    const el = editor?.current;
    if (!el || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive(
          (i) => (Math.min(i, options.length - 1) + step + options.length) % options.length,
        );
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) {
        const option = options[Math.min(active, options.length - 1)];
        if (!option) return;
        e.preventDefault();
        pick(option);
        return;
      }
      if (e.key === 'Escape') {
        // Closes the list only: the note, and any sheet or room behind it,
        // never hear this Esc.
        e.preventDefault();
        e.stopPropagation();
        onDismiss?.();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  // The editor names the list it drives and the row the keys are on.
  useEffect(() => {
    const el = editor?.current;
    if (!el) return;
    if (!open) {
      el.removeAttribute('aria-activedescendant');
      el.removeAttribute('aria-controls');
      el.setAttribute('aria-expanded', 'false');
      return;
    }
    el.setAttribute('aria-autocomplete', 'list');
    el.setAttribute('aria-controls', listId);
    el.setAttribute('aria-expanded', 'true');
    el.setAttribute('aria-activedescendant', optionId(shownActive));
    return () => {
      el.removeAttribute('aria-activedescendant');
      el.removeAttribute('aria-controls');
      el.setAttribute('aria-expanded', 'false');
    };
  });

  if (!open) return null;
  return (
    <div
      id={listId}
      className={`vault-link-suggest vault-link-suggest--${layout}`}
      role="listbox"
      aria-label={VAULT_LINK_LIST_LABEL}
      aria-orientation={layout === 'chips' ? 'horizontal' : 'vertical'}
    >
      {options.map((o, i) => (
        <button
          key={o.key}
          id={optionId(i)}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={i === shownActive}
          aria-label={o.aria}
          data-kind={o.kind}
          className={[
            'vault-link-chip',
            'press-fb',
            o.kind === 'new' ? 'vault-link-new' : '',
            o.kind === 'heading' ? 'vault-link-heading' : '',
            i === shownActive ? 'is-active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          // onMouseDown, not onClick, so the pick lands before the
          // textarea's blur clears the link context, and preventDefault so
          // focus (and the keyboard) stays in the note.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(o);
          }}
          onMouseEnter={() => setActive(i)}
        >
          <span className="vault-link-label">{o.label}</span>
          {o.sub ? (
            <span className="vault-link-sub" aria-hidden="true">
              {o.sub}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
