// The starter layout's preview (Vault M7 7.3; tech review L12; UX review Y13): opt-in, and
// everything it would add is shown before anything is written. Four rows, a
// glyph and one line each, then (only where the vault's settings file can be
// written) the one line on what the settings will say. "Add these" is the one
// primary; the round close adds nothing.
//
// Presentational: the screen offers it only for an empty personal vault with
// folders and no `.obsidian/`, and `onAdd` re-checks emptiness and writes
// every item `ifAbsent` (stream F's `vaultStarter.ts`). It answers how many of
// the items landed. All of them: the one haptic of this surface marks the
// multi-note change (UX review R5, X19's rule), and the sheet asks to close; the
// screen shows the toast. Some: the partial line stays in place and "Add
// these" tries again for the rest.
import { useEffect, useState } from 'react';
import { Icon } from '../Icon.js';
import { Sheet } from '../Sheet.js';
import { SheetHead } from '../SheetHead.js';
import { hapticCommit } from '../../lib/haptics.js';
import {
  VAULT_STARTER_ADD,
  VAULT_STARTER_ROWS,
  VAULT_STARTER_SETTINGS_LINE,
  VAULT_STARTER_SUB,
  VAULT_STARTER_TITLE,
  vaultStarterPartial,
} from '../../lib/vaultCopy.js';

export interface VaultStarterResult {
  added: number;
  total: number;
}

function StarterGlyph({ kind }: { kind: 'note' | 'folder' | 'template' }) {
  return (
    <Icon className="vault-starter-glyph" size={20} weight="hairline">
      {kind === 'folder' ? (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      ) : (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4" />
          {kind === 'template' ? (
            <>
              <path d="M9 12h6" />
              <path d="M9 16h4" />
            </>
          ) : null}
        </>
      )}
    </Icon>
  );
}

export function VaultStarterSheet({
  open,
  writesSettings,
  onClose,
  onAdd,
}: {
  open: boolean;
  /** `vaultCaps().settingsWrite`: the layout also writes `.oscode/vault.json`,
   *  so the settings line is true. Without it the line is left out. */
  writesSettings: boolean;
  onClose: () => void;
  onAdd: () => Promise<VaultStarterResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState<VaultStarterResult | undefined>();
  useEffect(() => {
    if (open) {
      setBusy(false);
      setPartial(undefined);
    }
  }, [open]);

  const add = async () => {
    if (busy) return;
    setBusy(true);
    let result: VaultStarterResult;
    try {
      result = await onAdd();
    } catch {
      result = { added: 0, total: VAULT_STARTER_ROWS.length };
    }
    setBusy(false);
    if (result.total > 0 && result.added >= result.total) {
      hapticCommit();
      onClose();
      return;
    }
    setPartial(result);
  };

  return (
    <Sheet open={open} onClose={onClose} className="vault-starter">
      {open ? (
        <>
          <SheetHead title={VAULT_STARTER_TITLE} onClose={onClose} />
          <p className="hint vault-starter-sub">{VAULT_STARTER_SUB}</p>
          <ul className="vault-starter-rows">
            {VAULT_STARTER_ROWS.map((row) => (
              <li key={row.name} className="vault-starter-row">
                <StarterGlyph kind={row.glyph} />
                <span className="vault-starter-text">
                  <span className="vault-starter-name">{row.name}</span>
                  <span className="vault-starter-line">{row.line}</span>
                </span>
              </li>
            ))}
          </ul>
          {writesSettings ? (
            <p className="hint vault-starter-settings">{VAULT_STARTER_SETTINGS_LINE}</p>
          ) : null}
          {partial ? (
            <p className="vault-starter-partial" role="status">
              {vaultStarterPartial(partial.added, partial.total)}
            </p>
          ) : null}
          <div className="sheet-actions">
            <button
              type="button"
              className="btn primary press-fb"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void add()}
            >
              {VAULT_STARTER_ADD}
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
