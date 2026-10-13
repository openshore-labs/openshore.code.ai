// The Vault's search field and results (Vault M6 6.1; tech review K8, K16; UX review X1,
// X2, X4). The field sits at the top of the tree at every folder level, on
// every platform, and always searches the whole vault (`path:` narrows it).
// Focusing it swaps the tree for results by crossfade; Esc clears it and
// swaps back. Focused and empty, it shows the grammar hint and Recent.
//
// Title hits show at once, with no read. Text hits follow after a short
// debounce, then their excerpts, each keystroke cancelling the last search.
// Matches are drawn as `<mark>` elements from ranges, never an HTML string.
// Every state is said plainly: the index still reading, the index failed
// (titles only, with Try again), no match, and Your computer away.
//
// Data only through props: the screen hands in the search source (the index
// and the body cache), the index status, and the Recent rows.
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useExitPresence } from '../../hooks/useExitPresence.js';
import { durationMs } from '../../lib/motion.js';
import {
  VAULT_QUERY_CORE,
  VAULT_SEARCH_DEBOUNCE_MS,
  VAULT_SEARCH_ROWS,
  isBlankQuery,
  markedPieces,
  vaultBodyRows,
  vaultTitleRows,
  type VaultMarkedText,
  type VaultQueryCore,
  type VaultRecentRow,
  type VaultResultRow,
  type VaultSearchIndex,
  type VaultSearchSource,
} from '../../lib/vaultSearch.js';
import {
  VAULT_RECENT_TITLE,
  VAULT_SEARCH_AWAY,
  VAULT_SEARCH_CAPPED,
  VAULT_SEARCH_FAILED,
  VAULT_SEARCH_HINT,
  VAULT_SEARCH_IN_NOTES,
  VAULT_SEARCH_LABEL,
  VAULT_SEARCH_MORE_LOADING,
  VAULT_SEARCH_PLACEHOLDER,
  VAULT_SEARCH_TITLES,
  VAULT_SEARCH_TRY_AGAIN,
  vaultSearchCount,
  vaultSearchFolder,
  vaultSearchIndexing,
  vaultSearchNoMatch,
  vaultSearchRowLabel,
} from '../../lib/vaultCopy.js';

/** Text with its matches as `<mark>` elements. React escapes every piece. */
export function Marked({ text, ranges }: VaultMarkedText) {
  return (
    <>
      {markedPieces(text, ranges).map((p, i) =>
        p.mark ? (
          <mark key={i} className="vault-search-mark">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** One result or Recent row, as an option in a listbox. */
export function VaultResultOption({
  id,
  active,
  title,
  folder,
  excerpt,
  sub,
  index,
  onActive,
  onChoose,
}: {
  id: string;
  active: boolean;
  title: VaultMarkedText;
  folder: string;
  excerpt?: VaultMarkedText;
  /** A muted sub-label in place of the folder (Recent's agent label). */
  sub?: string;
  /** Position in its group, for the arrival stagger. */
  index: number;
  onActive: () => void;
  onChoose: () => void;
}) {
  const where = vaultSearchFolder(folder);
  const label = vaultSearchRowLabel(title.text, folder, excerpt?.text);
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      aria-label={sub ? `${label} ${sub}.` : label}
      className={`vault-search-row press-fb press-fb--row${active ? ' vault-search-row--active' : ''}`}
      style={{ '--i': Math.min(index, 8) } as CSSProperties}
      // Keep focus in the field, so the results stay up through the tap.
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={onActive}
      onClick={onChoose}
    >
      <span className="vault-search-row-title">
        <Marked {...title} />
      </span>
      {sub || where ? <span className="vault-search-row-sub">{sub ?? where}</span> : null}
      {excerpt ? (
        <span className="vault-search-row-excerpt">
          <Marked {...excerpt} />
        </span>
      ) : null}
    </button>
  );
}

/** Is this keystroke the platform's find-in-vault chord (Cmd or Ctrl+Shift+F)? */
export function isFindChord(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f';
}

interface BodyState {
  q: string;
  rows: VaultResultRow[];
  capped: boolean;
  done: boolean;
}

const NO_BODY: BodyState = { q: '', rows: [], capped: false, done: true };

export function VaultSearch({
  query,
  onQuery,
  source,
  core = VAULT_QUERY_CORE,
  index,
  away = false,
  onRetryIndex,
  recent = [],
  agentLabel,
  onOpen,
  desktop = false,
  debounceMs = VAULT_SEARCH_DEBOUNCE_MS,
  children,
}: {
  /** What is typed. The screen holds it, so a tapped #tag can fill `tag:x`. */
  query: string;
  onQuery: (q: string) => void;
  /** The index and the body cache; undefined until the index opens. */
  source: VaultSearchSource | undefined;
  /** The pure query core (stream A1's); a test injects its own. */
  core?: VaultQueryCore;
  /** What bodies can be searched now (`vaultSearchIndexState`). */
  index: VaultSearchIndex;
  /** Your computer is off: this searches what the device last saw. */
  away?: boolean;
  onRetryIndex?: () => void;
  /** `vaultRecentRows(...)`, shown while the field is focused and empty. */
  recent?: readonly VaultRecentRow[];
  /** `vaultRecentAgentLabel(vaultCopy(...))`: undefined where the agent is
   *  not this vault's, and then an agent-written row is a plain row. */
  agentLabel?: string;
  onOpen: (path: string) => void;
  /** Cmd or Ctrl+Shift+F focuses the field. */
  desktop?: boolean;
  debounceMs?: number;
  /** The tree, shown whenever search is not. */
  children?: ReactNode;
}) {
  const base = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [activeAt, setActiveAt] = useState(0);
  const [body, setBody] = useState<BodyState>(NO_BODY);

  const blank = isBlankQuery(query);
  const searching = !blank || focused;
  const failed = index.kind === 'failed';

  // Titles: synchronous, zero reads, every keystroke.
  // One past the cap, so the cap line knows when titles alone overflow it.
  const titleHits = useMemo(
    () => (source && !blank ? vaultTitleRows(source, core, query, VAULT_SEARCH_ROWS + 1) : []),
    [source, core, query, blank],
  );
  const titles = useMemo(() => titleHits.slice(0, VAULT_SEARCH_ROWS), [titleHits]);
  const titlesCapped = titleHits.length > VAULT_SEARCH_ROWS;

  // Text: debounced, cancelled by the next keystroke, progressive.
  useEffect(() => {
    if (!source || blank || failed) {
      setBody(NO_BODY);
      return;
    }
    const signal = { aborted: false };
    setBody((b) => (b.q === query ? b : { q: query, rows: [], capped: false, done: false }));
    const timer = setTimeout(() => {
      const exclude = new Set(titles.map((r) => r.path));
      void vaultBodyRows(source, core, query, {
        exclude,
        limit: Math.max(0, VAULT_SEARCH_ROWS - titles.length),
        signal,
        onRows: (rows, s) => {
          if (!signal.aborted) setBody({ q: query, rows, capped: s.capped, done: s.done });
        },
      }).then((r) => {
        if (!signal.aborted && !r.cancelled) {
          setBody({ q: query, rows: r.rows, capped: r.capped, done: true });
        }
      });
    }, debounceMs);
    return () => {
      signal.aborted = true;
      clearTimeout(timer);
    };
  }, [source, core, query, blank, failed, titles, debounceMs]);

  // Desktop: Cmd or Ctrl+Shift+F focuses the field from anywhere in the room.
  useEffect(() => {
    if (!desktop || typeof window === 'undefined') return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isFindChord(e)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktop]);

  const text = body.q === query ? body.rows : [];
  const bodyDone = body.q === query ? body.done : false;
  const capped = body.q === query && body.capped;
  const showRecent = blank && recent.length > 0;
  const rows: Array<{ key: string; path: string }> = showRecent
    ? recent.map((r) => ({ key: `r:${r.path}`, path: r.path }))
    : [...titles, ...text].map((r) => ({ key: `${r.group}:${r.path}`, path: r.path }));
  const current = Math.min(activeAt, Math.max(0, rows.length - 1));
  const optionId = (i: number) => `${base}-opt-${i}`;
  const listId = `${base}-list`;

  const open = (path: string) => onOpen(path);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onQuery('');
      setActiveAt(0);
      inputRef.current?.blur();
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
      open(rows[current]!.path);
    }
  };

  // The honest lines, in the order a person reads them.
  const total = titles.length + text.length;
  const loading = index.kind === 'loading' && index.total > 0 ? index : undefined;
  const noMatch = !blank && bodyDone && total === 0;
  const count = !blank && (total > 0 || bodyDone) ? vaultSearchCount(total) : '';

  // The crossfade: each layer stays mounted through its fade out.
  const fade = durationMs('--dur-3', 220);
  const results = useExitPresence(searching, fade);
  const tree = useExitPresence(!searching, fade);

  let n = 0;
  const option = (row: VaultResultRow, i: number) => {
    const at = n++;
    return (
      <VaultResultOption
        key={`${row.group}:${row.path}`}
        id={optionId(at)}
        active={at === current}
        title={row.title}
        folder={row.folder}
        excerpt={row.excerpt}
        index={i}
        onActive={() => setActiveAt(at)}
        onChoose={() => open(row.path)}
      />
    );
  };

  return (
    <div className="vault-search">
      <div className="vault-search-field">
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          value={query}
          placeholder={VAULT_SEARCH_PLACEHOLDER}
          aria-label={VAULT_SEARCH_LABEL}
          aria-expanded={searching && rows.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={searching && rows.length ? optionId(current) : undefined}
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            onQuery(e.target.value);
            setActiveAt(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />
      </div>
      <p className="vault-search-count" role="status" aria-live="polite">
        {searching ? count : ''}
      </p>
      <div className="vault-search-stage">
        {/* The tree stays in the page while hidden, so its scroll and its open
            folders are where the person left them. */}
        <div
          className={`vault-search-layer${tree.closing ? ' closing' : ''}`}
          hidden={!tree.mounted}
        >
          {children}
        </div>
        {results.mounted ? (
          <div
            className={`vault-search-layer vault-search-results${results.closing ? ' closing' : ''}`}
          >
            {blank ? <p className="hint vault-search-hint">{VAULT_SEARCH_HINT}</p> : null}
            {away ? <p className="hint vault-search-note">{VAULT_SEARCH_AWAY}</p> : null}
            {failed && !blank ? (
              <div className="vault-search-note vault-search-note--failed">
                <p className="hint">{VAULT_SEARCH_FAILED}</p>
                {onRetryIndex ? (
                  <button
                    type="button"
                    className="btn quiet press-fb"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onRetryIndex}
                  >
                    {VAULT_SEARCH_TRY_AGAIN}
                  </button>
                ) : null}
              </div>
            ) : null}
            {loading && !blank && !failed ? (
              <p className="hint vault-search-note">
                {vaultSearchIndexing(loading.done, loading.total)}
              </p>
            ) : null}
            <div
              className="vault-search-list"
              role="listbox"
              id={listId}
              aria-label={VAULT_SEARCH_LABEL}
            >
              {showRecent ? (
                <div role="group" aria-labelledby={`${base}-recent`}>
                  <div className="vault-search-group" id={`${base}-recent`} role="presentation">
                    {VAULT_RECENT_TITLE}
                  </div>
                  {recent.map((r, i) => {
                    const at = n++;
                    return (
                      <VaultResultOption
                        key={`r:${r.path}`}
                        id={optionId(at)}
                        active={at === current}
                        title={{ text: r.title, ranges: [] }}
                        folder={r.folder}
                        sub={r.agent && agentLabel ? agentLabel : undefined}
                        index={i}
                        onActive={() => setActiveAt(at)}
                        onChoose={() => open(r.path)}
                      />
                    );
                  })}
                </div>
              ) : null}
              {!blank && titles.length ? (
                <div role="group" aria-labelledby={`${base}-titles`}>
                  <div className="vault-search-group" id={`${base}-titles`} role="presentation">
                    {VAULT_SEARCH_TITLES}
                  </div>
                  {titles.map(option)}
                </div>
              ) : null}
              {!blank && text.length ? (
                <div role="group" aria-labelledby={`${base}-text`}>
                  <div className="vault-search-group" id={`${base}-text`} role="presentation">
                    {VAULT_SEARCH_IN_NOTES}
                  </div>
                  {text.map(option)}
                </div>
              ) : null}
            </div>
            {noMatch ? (
              <p className="hint vault-search-note">
                {vaultSearchNoMatch(query)}
                {loading ? ` ${VAULT_SEARCH_MORE_LOADING}` : ''}
              </p>
            ) : null}
            {!blank && (titlesCapped || (capped && bodyDone)) ? (
              <p className="hint vault-search-note">{VAULT_SEARCH_CAPPED}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
