// The Vault's resolve sheet (Vault M1, 1.1; design review 1a to 1e, UX review 1.1):
// a note changed somewhere else while the person had unsaved edits in it, or
// was moved or deleted. It shows what happened before it asks, and it never
// chooses for the person:
//
// - One plain sentence, then (for two versions) a neutral compare with three
//   tabs: Changes, Yours, Other version. No red and green: two pieces of work
//   are being compared, and neither is wrong. Lines only in yours wear the
//   accent wash, lines only in the other version the surface wash.
// - Keep both is the one filled row and comes first: it loses nothing. Keep
//   yours and Keep the other version each destroy one side, so each takes two
//   taps (the first arms it, the second commits), the house grammar for loss.
// - Focus goes to the dialog, never a button, so a stray keystroke cannot pick.
// - Nothing claims success early: every row waits while a choice runs, the
//   sheet closes only once it lands, and a failure says so and re-enables.
//
// In move mode (design review 1d) the same sheet steps through a move's
// forked pairs, "1 of 3": the one you moved against the one already there.
// Both files exist, so closing keeps both, and the sheet says so.
//
// Presentational: the Vault screen owns the store calls and passes the result
// back through `busy` and `failed`. Every string is in lib/vaultCopy.ts.
import { useEffect, useMemo, useState } from 'react';
import { unifiedDiff } from 'os-code/protocol';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import {
  VAULT_RESOLVE_AGAIN,
  VAULT_RESOLVE_SAME,
  vaultMoveResolveCopy,
  vaultResolveCopy,
  vaultResolveWhen,
  type VaultResolveMode,
  type VaultResolveRow,
} from '../lib/vaultCopy.js';

type Choice = VaultResolveRow['choice'];
type Tab = 'changes' | 'mine' | 'theirs';

/** One line of the compare: only in yours, only in the other version, the
 *  same in both, or a gap between changed stretches. */
export interface CompareLine {
  kind: 'mine' | 'other' | 'ctx' | 'gap';
  text: string;
}

// Line endings and trailing spaces never count as a change in the compare,
// so two versions that differ only there say so in one line instead.
const forCompare = (t: string) =>
  t
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');

/** The line compare the Changes tab draws: the other version against yours,
 *  through the engine's own unifiedDiff (the one approvals show), with two
 *  lines of context. Empty when no line differs but for spacing. */
export function compareLines(theirs: string, mine: string): CompareLine[] {
  const { text } = unifiedDiff(forCompare(theirs), forCompare(mine), 'note', 2);
  if (!text) return [];
  const out: CompareLine[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    if (line.startsWith('@@')) {
      if (out.length) out.push({ kind: 'gap', text: '⋯' });
      continue;
    }
    const tag = line.charAt(0);
    const body = line.slice(1);
    out.push({
      kind: tag === '+' ? 'mine' : tag === '-' ? 'other' : 'ctx',
      text: body,
    });
  }
  return out;
}

export function VaultResolveSheet({
  open,
  mode,
  title,
  mine,
  theirs,
  loadedAt,
  again,
  busy,
  failed,
  move,
  onChoose,
  onClose,
}: {
  open: boolean;
  mode: VaultResolveMode | 'move';
  /** Move mode: which pair of how many, the moved note's name now, and
   *  whether the last choice landed only in part. */
  move?: { i: number; n: number; copyTitle: string; partial?: boolean };
  /** The note's title. */
  title: string;
  /** The person's text now. */
  mine: string;
  /** What is in the note now (edit mode). */
  theirs?: { text: string; updatedAt: string; version?: string };
  /** When the editor loaded the note on this device, for the time line. */
  loadedAt?: number;
  /** The other version changed again while the sheet was up. */
  again?: boolean;
  busy: boolean;
  failed: boolean;
  onChoose: (choice: Choice) => void;
  /** Close without choosing ('not now'): X, the scrim, Escape, a drag. */
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('changes');
  const [armed, setArmed] = useState<Choice | undefined>();
  const theirsKey = `${move?.i ?? ''}:${theirs?.version ?? theirs?.updatedAt ?? ''}`;
  const compares = mode !== 'missing';
  // A new other version, a new pair, or the sheet opening again, starts
  // unarmed.
  useEffect(() => {
    setArmed(undefined);
  }, [theirsKey, open, mode]);
  // Each pair opens on its Changes tab.
  useEffect(() => {
    setTab('changes');
  }, [move?.i]);

  const when =
    mode === 'edit' && theirs && loadedAt !== undefined
      ? vaultResolveWhen(theirs.updatedAt, loadedAt)
      : undefined;
  const moveCopy =
    mode === 'move'
      ? vaultMoveResolveCopy({
          title,
          copyTitle: move?.copyTitle ?? title,
          i: move?.i ?? 1,
          n: move?.n ?? 1,
        })
      : undefined;
  const copy = moveCopy ?? vaultResolveCopy(mode === 'move' ? 'edit' : mode, { title, when });
  const lines = useMemo(
    () => (compares && theirs ? compareLines(theirs.text, mine) : []),
    [compares, theirs, mine],
  );

  const pick = (row: VaultResolveRow) => {
    if (busy) return;
    if (row.armed && armed !== row.choice) {
      setArmed(row.choice);
      return;
    }
    setArmed(undefined);
    onChoose(row.choice);
  };

  const pane = () => {
    if (!compares || !theirs || !copy.tabs) return null;
    if (tab === 'mine' || tab === 'theirs') {
      return <pre className="vault-compare-full">{tab === 'mine' ? mine : theirs.text}</pre>;
    }
    if (!lines.length) return <p className="hint vault-compare-full">{VAULT_RESOLVE_SAME}</p>;
    return lines.map((l, i) =>
      l.kind === 'gap' ? (
        <div key={i} className="vault-cmp-gap" aria-hidden="true">
          {l.text}
        </div>
      ) : (
        <div key={i} className={`vault-cmp-line ${l.kind}`}>
          {l.kind === 'ctx' ? null : (
            <span className="visually-hidden">
              {l.kind === 'mine' ? copy.srPrefix!.mine : copy.srPrefix!.theirs}
            </span>
          )}
          {l.text || ' '}
        </div>
      ),
    );
  };

  return (
    <Sheet open={open} onClose={onClose} className="vault-resolve" initialFocus="dialog">
      <SheetHead title={copy.title} onClose={onClose} />
      {moveCopy?.counter ? (
        <p className="hint vault-resolve-counter" key={`n:${theirsKey}`}>
          {moveCopy.counter}
        </p>
      ) : null}
      <p key={`sub:${theirsKey}`} className="sheet-sub vault-resolve-sub">
        {copy.sub}
      </p>
      {again ? (
        <p className="hint vault-resolve-again" role="status">
          {VAULT_RESOLVE_AGAIN}
        </p>
      ) : null}
      {copy.tabs ? (
        <>
          <div className="segmented vault-resolve-tabs" role="tablist" aria-label={copy.title}>
            {(['changes', 'mine', 'theirs'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`seg press-fb${tab === t ? ' active' : ''}`}
                onClick={() => {
                  setTab(t);
                  setArmed(undefined);
                }}
              >
                {copy.tabs![t]}
              </button>
            ))}
          </div>
          {tab === 'changes' && lines.length ? (
            <div className="vault-cmp-legend" aria-hidden="true">
              <span>
                <span className="vault-cmp-swatch mine" />
                {copy.legend!.mine}
              </span>
              <span>
                <span className="vault-cmp-swatch other" />
                {copy.legend!.theirs}
              </span>
            </div>
          ) : null}
          <div className="vault-compare">
            <div key={`${tab}:${theirsKey}`} className="vault-compare-pane">
              {pane()}
            </div>
          </div>
        </>
      ) : null}
      {failed ? (
        <p className="hint vault-resolve-failed" role="alert">
          {copy.failure}
        </p>
      ) : null}
      {moveCopy && move?.partial ? (
        <p className="hint vault-resolve-failed" role="status">
          {moveCopy.partial}
        </p>
      ) : null}
      <div className="sheet-actions">
        {copy.rows.map((row) => {
          const isArmed = armed === row.choice;
          const tone = isArmed ? 'danger' : row.primary ? 'primary' : 'ghost';
          return (
            <button
              key={row.choice}
              type="button"
              className={`btn vault-provider press-fb ${tone}`}
              disabled={busy}
              data-choice={row.choice}
              onClick={() => pick(row)}
            >
              <span className="grow">
                {isArmed && row.armed ? row.armed : row.label}
                <span className="sub">{row.sub}</span>
              </span>
            </button>
          );
        })}
      </div>
      {moveCopy ? <p className="hint vault-resolve-close">{moveCopy.closeLine}</p> : null}
    </Sheet>
  );
}
