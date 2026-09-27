// The note picker behind `[[` in the composer (Vault M5, CTO J15, "take a note
// to a model"). A presence-aware Sheet rises by transform with the person's
// notes, searched by title; picking one hands it back to the composer, which
// inserts a trimmed excerpt with a cost line. Data only through props: the
// composer passes what the store gives it, and this sheet reads nothing else.
//
// Privacy is judged before a row is shown and again at the tap. A hidden note
// never lists. A local-only note shows a lock, and while the chat's seat
// leaves this network it is refused with plain copy, never inserted. The
// person has no override in v1 (D5).
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { VaultVisibility } from 'os-code/protocol';
import { Sheet } from './Sheet.js';
import { CloseGlyph } from './SheetGlyphs.js';
import { Icon } from './Icon.js';
import { hapticTick } from '../lib/haptics.js';

/** One note the picker may offer. `visibility` is the vault privacy rules'
 *  verdict for it (`VaultPrivacy.visibility`), required so a caller cannot
 *  forget to judge a note. */
export interface PickerNote {
  path: string;
  title: string;
  /** ISO 8601. Newest first when nothing is typed. */
  updatedAt: string;
  visibility: VaultVisibility;
}

/** The refusal for a private note while the seat leaves the network (J15). */
export const PRIVATE_NOTE_REFUSED =
  'Private notes stay on this computer. Switch to a local model to ask about it.';

/** The most rows the sheet lists at once. */
export const PICKER_LIMIT = 30;

/** Rank the notes for a query: hidden notes never list; a title that starts
 *  with the query first, then a word in the title that does, then any title
 *  or path that holds it; newest first within a rank. Pure. */
export function searchNotes(
  notes: readonly PickerNote[],
  query: string,
  limit = PICKER_LIMIT,
): PickerNote[] {
  const q = query.trim().toLowerCase();
  const rank = (n: PickerNote): number => {
    if (!q) return 0;
    const title = n.title.toLowerCase();
    if (title.startsWith(q)) return 0;
    if (title.split(/[\s\-_/.]+/).some((w) => w.startsWith(q))) return 1;
    if (title.includes(q)) return 2;
    if (n.path.toLowerCase().includes(q)) return 3;
    return -1;
  };
  const time = (n: PickerNote) => Date.parse(n.updatedAt) || 0;
  return notes
    .filter((n) => n.visibility !== 'hidden')
    .map((n) => ({ n, r: rank(n) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || time(b.n) - time(a.n) || a.n.title.localeCompare(b.n.title))
    .slice(0, limit)
    .map((x) => x.n);
}

/** Whether a note may go to the current seat. Pure. */
export function noteRefused(note: Pick<PickerNote, 'visibility'>, leavesNetwork: boolean): boolean {
  return note.visibility === 'hidden' || (note.visibility === 'local-only' && leavesNetwork);
}

function SearchGlyph() {
  return (
    <Icon size={18}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20 20" />
    </Icon>
  );
}

function LockGlyph() {
  return (
    <Icon size={14} aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

let pickerSeq = 0;

export function VaultNotePicker({
  open,
  notes,
  leavesNetwork,
  onPick,
  onClose,
}: {
  open: boolean;
  notes: readonly PickerNote[];
  /** The chat's seat leaves this network (a cloud model): private notes are
   *  refused. */
  leavesNetwork: boolean;
  /** A note the person chose that may go to this seat. */
  onPick: (note: PickerNote) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [refused, setRefused] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idBase = useRef(`vault-pick-${pickerSeq++}`).current;

  // Each open starts clean, with the search field focused in the commit, so
  // the keyboard stays up and the next letters search.
  useLayoutEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setRefused(null);
    inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  const shown = searchNotes(notes, query);
  const listed = notes.some((n) => n.visibility !== 'hidden');
  const current = Math.min(active, Math.max(0, shown.length - 1));

  const choose = (note: PickerNote) => {
    if (noteRefused(note, leavesNetwork)) {
      setRefused(note.path);
      return;
    }
    onPick(note);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (!shown.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((current + 1) % shown.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((current - 1 + shown.length) % shown.length);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // The keyboard has no click for the app's tap tick to catch.
      hapticTick();
      choose(shown[current]!);
    }
  };

  const sheet = (
    <Sheet open={open} onClose={onClose} className="repo-sheet vault-note-picker">
      <div className="mode-head">
        <button className="mode-close press-fb" aria-label="Close" onClick={onClose}>
          <CloseGlyph />
        </button>
        <h2 id={`${idBase}-title`}>Take a note to this chat</h2>
      </div>
      <div className="repo-sheet-body">
        {refused ? (
          <p className="hint repo-sheet-note" role="status" aria-live="polite">
            {PRIVATE_NOTE_REFUSED}
          </p>
        ) : null}
        {shown.length ? (
          <div
            className="ms-group"
            role="listbox"
            id={`${idBase}-list`}
            aria-labelledby={`${idBase}-title`}
          >
            {shown.map((n, i) => {
              const locked = n.visibility === 'local-only';
              const blocked = noteRefused(n, leavesNetwork);
              return (
                <button
                  key={n.path}
                  id={`${idBase}-opt-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === current}
                  aria-disabled={blocked || undefined}
                  data-path={n.path}
                  className={`ms-row press-fb press-fb--row${i === current ? ' ms-row-default' : ''}${blocked ? ' ms-row-disabled' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(n)}
                >
                  <span className="ms-row-text">
                    <span className="ms-row-main">{n.title}</span>
                    <span className="ms-row-sub">
                      {locked
                        ? blocked
                          ? 'Private. Stays on this computer while this chat uses a cloud model.'
                          : 'Private. Stays on this computer.'
                        : n.path}
                    </span>
                  </span>
                  {locked ? (
                    <span className="ms-row-value" aria-label="Private note">
                      <LockGlyph />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="hint repo-sheet-hint">
            {listed ? 'No note matches that.' : 'No notes in your vault yet.'}
          </p>
        )}
      </div>
      <label className="repo-sheet-search">
        <SearchGlyph />
        <input
          ref={inputRef}
          type="search"
          placeholder="Search notes"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setRefused(null);
          }}
          onKeyDown={onKeyDown}
          aria-label="Search notes by title"
          aria-controls={shown.length ? `${idBase}-list` : undefined}
          aria-activedescendant={shown.length ? `${idBase}-opt-${current}` : undefined}
        />
      </label>
    </Sheet>
  );

  // The composer sits under blurred chrome, which would make it the
  // containing block for a fixed scrim; the sheet covers the viewport from
  // the body like every other sheet.
  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body);
}
