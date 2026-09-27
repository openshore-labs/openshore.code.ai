// The quick switcher (Vault M6 6.1; CTO K9; CX X3, X4): Cmd or Ctrl+O while
// the Vault room is shown opens a top-anchored Sheet with one field. It is a
// desktop overlay (an iPad with a hardware keyboard gets it too); the phone
// has none, since the tree's own search field is its switcher.
//
// Titles only, for speed: the index's title and alias hits are synchronous
// and read nothing. An empty field shows Today's note first, then Recent (the
// two things people open most, first). With no exact title the last row is
// `New note "{q}"`, and Shift+Enter picks it directly. Up, Down, Enter, Esc,
// `role="option"` and `aria-activedescendant`, as in VaultNotePicker. A pick
// waits for the exit, then hands the choice up (UI-4).
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Sheet } from '../Sheet.js';
import { SheetHead } from '../SheetHead.js';
import { useSheetExit } from '../../hooks/useSheetExit.js';
import { VaultResultOption } from './VaultSearch.js';
import {
  VAULT_QUERY_CORE,
  VAULT_SEARCH_ROWS,
  hasExactTitle,
  isBlankQuery,
  vaultTitleRows,
  type VaultQueryCore,
  type VaultRecentRow,
  type VaultSearchSource,
} from '../../lib/vaultSearch.js';
import {
  VAULT_RECENT_TITLE,
  VAULT_SWITCHER_PLACEHOLDER,
  VAULT_SWITCHER_TITLE,
  VAULT_SWITCHER_TODAY,
  vaultSearchCount,
  vaultSwitcherNew,
} from '../../lib/vaultCopy.js';

/** Is this keystroke the switcher's chord (Cmd or Ctrl+O, nothing else)? */
export function isSwitcherChord(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o';
}

/** Cmd or Ctrl+O opens the switcher while `enabled` (the Vault room is
 *  shown). The only binding: Electron has no accelerator on it (K9). */
export function useVaultSwitcherShortcut(enabled: boolean, onOpen: () => void): void {
  const run = useRef(onOpen);
  run.current = onOpen;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isSwitcherChord(e)) return;
      e.preventDefault();
      run.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

type Row =
  | { kind: 'today' }
  | { kind: 'recent'; row: VaultRecentRow }
  | { kind: 'note'; path: string }
  | { kind: 'new'; name: string };

export function VaultSwitcher({
  open,
  onClose,
  source,
  core = VAULT_QUERY_CORE,
  recent = [],
  agentLabel,
  onPick,
  onToday,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  source: VaultSearchSource | undefined;
  core?: VaultQueryCore;
  /** `vaultRecentRows(...)`, shown while the field is empty. */
  recent?: readonly VaultRecentRow[];
  /** `vaultRecentAgentLabel(vaultCopy(...))`; undefined makes an agent row
   *  a plain row. */
  agentLabel?: string;
  /** A note was chosen; called after the sheet's exit has played. */
  onPick: (path: string) => void;
  /** Today's note (stream H's `vaultToday`); the first row when empty. */
  onToday?: () => void;
  /** A new note with this name; offered when no title matches exactly. */
  onCreate?: (name: string) => void;
}) {
  const base = useId();
  const [query, setQuery] = useState('');
  const [activeAt, setActiveAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Play the exit before a choice propagates (UI-4): the parent closes the
  // switcher the moment it learns the choice.
  const pending = useRef<(() => void) | null>(null);
  const { closing, dismiss } = useSheetExit(() => {
    const run = pending.current;
    pending.current = null;
    onClose();
    if (run) run();
  });

  // Each open starts clean, with the field focused in the commit, so the next
  // letters search.
  useLayoutEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveAt(0);
    inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  const blank = isBlankQuery(query);
  const titles = useMemo(
    () => (source && !blank ? vaultTitleRows(source, core, query, VAULT_SEARCH_ROWS) : []),
    [source, core, query, blank],
  );
  const offerNew = Boolean(onCreate) && !blank && !hasExactTitle(titles, query);

  const rows: Row[] = blank
    ? [
        ...(onToday ? [{ kind: 'today' } as const] : []),
        ...recent.map((row) => ({ kind: 'recent', row }) as const),
      ]
    : [
        ...titles.map((t) => ({ kind: 'note', path: t.path }) as const),
        ...(offerNew ? [{ kind: 'new', name: query.trim() } as const] : []),
      ];
  const current = Math.min(activeAt, Math.max(0, rows.length - 1));
  const optionId = (i: number) => `${base}-opt-${i}`;

  const choose = (row: Row) => {
    if (row.kind === 'today') {
      if (onToday) pending.current = () => onToday();
    } else if (row.kind === 'new') {
      if (onCreate) pending.current = () => onCreate(row.name);
    } else {
      const path = row.kind === 'recent' ? row.row.path : row.path;
      pending.current = () => onPick(path);
    }
    dismiss();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && e.shiftKey && offerNew) {
      e.preventDefault();
      choose({ kind: 'new', name: query.trim() });
      return;
    }
    if (!rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveAt((current + 1) % rows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveAt((current - 1 + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(rows[current]!);
    }
  };

  const listId = `${base}-list`;
  const recentStart = onToday ? 1 : 0;

  return (
    <Sheet open={open && !closing} onClose={dismiss} variant="top" className="vault-switcher">
      <SheetHead title={VAULT_SWITCHER_TITLE} onClose={dismiss} />
      <div className="vault-switcher-body">
        <div className="vault-search-field">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            value={query}
            placeholder={VAULT_SWITCHER_PLACEHOLDER}
            aria-label={VAULT_SWITCHER_PLACEHOLDER}
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={rows.length ? optionId(current) : undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveAt(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <p className="vault-search-count" role="status" aria-live="polite">
          {blank ? '' : vaultSearchCount(titles.length)}
        </p>
        <div
          className="vault-search-list vault-switcher-list"
          role="listbox"
          id={listId}
          aria-label={VAULT_SWITCHER_TITLE}
        >
          {blank && onToday ? (
            <VaultResultOption
              id={optionId(0)}
              active={current === 0}
              title={{ text: VAULT_SWITCHER_TODAY, ranges: [] }}
              folder=""
              index={0}
              onActive={() => setActiveAt(0)}
              onChoose={() => choose({ kind: 'today' })}
            />
          ) : null}
          {blank && recent.length ? (
            <div role="group" aria-labelledby={`${base}-recent`}>
              <div className="vault-search-group" id={`${base}-recent`} role="presentation">
                {VAULT_RECENT_TITLE}
              </div>
              {recent.map((row, i) => {
                const at = recentStart + i;
                return (
                  <VaultResultOption
                    key={row.path}
                    id={optionId(at)}
                    active={current === at}
                    title={{ text: row.title, ranges: [] }}
                    folder={row.folder}
                    sub={row.agent && agentLabel ? agentLabel : undefined}
                    index={i + recentStart}
                    onActive={() => setActiveAt(at)}
                    onChoose={() => choose({ kind: 'recent', row })}
                  />
                );
              })}
            </div>
          ) : null}
          {!blank
            ? titles.map((t, i) => (
                <VaultResultOption
                  key={t.path}
                  id={optionId(i)}
                  active={current === i}
                  title={t.title}
                  folder={t.folder}
                  excerpt={t.excerpt}
                  index={i}
                  onActive={() => setActiveAt(i)}
                  onChoose={() => choose({ kind: 'note', path: t.path })}
                />
              ))
            : null}
          {offerNew ? (
            <VaultResultOption
              id={optionId(titles.length)}
              active={current === titles.length}
              title={{ text: vaultSwitcherNew(query), ranges: [] }}
              folder=""
              index={titles.length}
              onActive={() => setActiveAt(titles.length)}
              onChoose={() => choose({ kind: 'new', name: query.trim() })}
            />
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
