// "About this note" (Vault M7 7.2; CTO L9, L10; CX Y12, Y16): what the note's
// provenance says, row by row, and the one thing a person does with it, Mark
// as reviewed. Reviewed means the person read it; it changes nothing a model
// sees, and the sheet says so under the button. The foot line is honest about
// trust: these are the note's own properties, which anyone who can edit the
// note can change.
//
// Presentational: `onMark(next)` is the screen's compare-and-swap write
// through `mergeProvenance` (the person's own write, no approval). It answers
// `ok` (the sheet asks to close; the screen shows the toast and the chip
// changes), `changed` (the note moved on somewhere else; the screen has the
// newer version open) or `failed`. Nothing claims success early: the button
// waits while the write runs, and a refusal or failure says so in place.
import { useEffect, useState } from 'react';
import type { NoteProvenance } from 'os-code/protocol';
import { Sheet } from '../Sheet.js';
import { SheetHead } from '../SheetHead.js';
import {
  VAULT_ABOUT_CREATED,
  VAULT_ABOUT_EDITED_BY,
  VAULT_ABOUT_FOOT,
  VAULT_ABOUT_HOW,
  VAULT_ABOUT_HOWS,
  VAULT_ABOUT_NOT_YET,
  VAULT_ABOUT_RAN,
  VAULT_ABOUT_RAN_LOCAL,
  VAULT_ABOUT_REVIEWED,
  VAULT_ABOUT_SIZE,
  VAULT_ABOUT_SIZES,
  VAULT_ABOUT_TITLE,
  VAULT_ABOUT_WRITTEN_BY,
  VAULT_MARK_NOT_REVIEWED,
  VAULT_MARK_REVIEWED,
  VAULT_MARK_REVIEWED_SUB,
  vaultAboutRanCloud,
  vaultMarkFailed,
  vaultMarkRefused,
} from '../../lib/vaultCopy.js';

export type VaultMarkResult = 'ok' | 'changed' | 'failed' | { kind: 'refused'; line: string };

/** An ISO date as a short local date, or undefined when it does not parse
 *  (a hand-edited property is shown as nothing rather than as nonsense). */
export function aboutDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function VaultAboutNote({
  open,
  title,
  provenance,
  canMark = true,
  formatDate = aboutDate,
  onClose,
  onMark,
}: {
  open: boolean;
  /** The note's title, for the refusal and failure lines. */
  title: string;
  provenance: NoteProvenance | undefined;
  /** The storage can write this note now (not away, not read-only). */
  canMark?: boolean;
  /** How a recorded ISO date reads. */
  formatDate?: (iso: string | undefined) => string | undefined;
  onClose: () => void;
  /** Write `oscode-reviewed` (true) or remove it (false). */
  onMark: (reviewed: boolean) => Promise<VaultMarkResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | undefined>();
  // A fresh open starts clean.
  useEffect(() => {
    if (open) {
      setBusy(false);
      setLine(undefined);
    }
  }, [open]);

  const p = provenance ?? {};
  const reviewed = Boolean(p.reviewed);
  const created = formatDate(p.created);
  const reviewedOn = formatDate(p.reviewed);

  const mark = async () => {
    if (busy) return;
    setBusy(true);
    setLine(undefined);
    let result: VaultMarkResult;
    try {
      result = await onMark(!reviewed);
    } catch {
      result = 'failed';
    }
    setBusy(false);
    if (result === 'ok') {
      onClose();
      return;
    }
    // Refused for good (a team out of free space): the storage's line.
    if (typeof result === 'object') {
      setLine(result.line);
      return;
    }
    setLine(result === 'changed' ? vaultMarkRefused(title) : vaultMarkFailed(title));
  };

  return (
    <Sheet open={open} onClose={onClose} className="vault-about">
      {open ? (
        <>
          <SheetHead title={VAULT_ABOUT_TITLE} onClose={onClose} />
          <dl className="vault-about-rows">
            {p.model ? (
              <div className="vault-about-row">
                <dt>
                  {p.source === 'agent-edit' ? VAULT_ABOUT_EDITED_BY : VAULT_ABOUT_WRITTEN_BY}
                </dt>
                <dd>{p.model}</dd>
              </div>
            ) : null}
            {p.where === 'local' || p.where === 'cloud' ? (
              <div className="vault-about-row">
                <dt>{VAULT_ABOUT_RAN}</dt>
                <dd
                  className={
                    p.where === 'local' ? 'vault-about-ran-local' : 'vault-about-ran-cloud'
                  }
                >
                  {p.where === 'local' ? VAULT_ABOUT_RAN_LOCAL : vaultAboutRanCloud(p.provider)}
                </dd>
              </div>
            ) : null}
            {p.size ? (
              <div className="vault-about-row">
                <dt>{VAULT_ABOUT_SIZE}</dt>
                <dd>{VAULT_ABOUT_SIZES[p.size]}</dd>
              </div>
            ) : null}
            {p.source ? (
              <div className="vault-about-row">
                <dt>{VAULT_ABOUT_HOW}</dt>
                <dd>{VAULT_ABOUT_HOWS[p.source]}</dd>
              </div>
            ) : null}
            {created ? (
              <div className="vault-about-row">
                <dt>{VAULT_ABOUT_CREATED}</dt>
                <dd>{created}</dd>
              </div>
            ) : null}
            <div className="vault-about-row">
              <dt>{VAULT_ABOUT_REVIEWED}</dt>
              <dd>{reviewed ? (reviewedOn ?? p.reviewed) : VAULT_ABOUT_NOT_YET}</dd>
            </div>
          </dl>
          <p className="hint vault-about-foot">{VAULT_ABOUT_FOOT}</p>
          {line ? (
            <p className="vault-about-line" role="status">
              {line}
            </p>
          ) : null}
          {canMark ? (
            <div className="sheet-actions">
              <button
                type="button"
                className={`btn press-fb ${reviewed ? 'quiet' : 'primary'}`}
                disabled={busy}
                aria-busy={busy}
                aria-describedby={reviewed ? undefined : 'vault-about-mark-sub'}
                onClick={() => void mark()}
              >
                {reviewed ? VAULT_MARK_NOT_REVIEWED : VAULT_MARK_REVIEWED}
              </button>
              {reviewed ? null : (
                <p id="vault-about-mark-sub" className="hint vault-about-sub">
                  {VAULT_MARK_REVIEWED_SUB}
                </p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
