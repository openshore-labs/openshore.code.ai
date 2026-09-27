// Live [[wikilink]] suggestions under the Vault editor (Vault M6, 6.7; CTO
// K14, CX X15). A listbox the editor keeps driving: while it is open, Up and
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
  resolveWikilink,
  wikilinkReplaceRange,
  type TextRange,
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
    const target = linkTextFor(p, sourcePath, index);
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
    () => linkOptions(paths, sourcePath, context, headingsOf),
    [paths, sourcePath, context, headingsOf],
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
    insertAtCaret(el, range, linkInsertText(text, range, option.target));
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
