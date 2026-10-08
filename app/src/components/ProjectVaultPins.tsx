// Notes pinned to a project's context (Vault M5, CTO J14). The person places
// them (tenet 4), so they ride the pack in both modes, trimmed to fit a small
// seat, with privacy applied: a hidden note never goes, a note that stays on
// this computer never reaches a cloud seat. Pins name the person's own notes,
// so the pin list stays on this device and never syncs with a shared project.
//
// Editors only (a local project, or edit on a shared one), on the
// ProjectCurrents pattern: rendered by ProjectDetailScreen when the person may
// edit. The picker is a Sheet; every row answers the finger (press-fb).
//
// A private pin holds every cloud handoff in its project (CX and CMO,
// 2026-10-08, G), so its row and the picker wear the lock and "Private", and
// a line under the list says what it does while Memory carries the pins to
// the coding agent.
import { useEffect, useState, type CSSProperties } from 'react';
import type { VaultVisibility } from 'os-code/protocol';
import { useApp } from '../state/store.js';
import { memoryOverride } from '../lib/currents.js';
import { PROJECT_VAULT_PINS_MAX } from '../state/types.js';
import type { VaultPickerNote } from '../lib/vaultExcerpt.js';
import { noteTitle } from '../lib/vault.js';
import { hapticCommit } from '../lib/haptics.js';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { LockGlyph } from './SheetGlyphs.js';
import {
  VAULT_PIN_PRIVATE_LINE,
  VAULT_PRIVATE_OFF_CLOUD,
  VAULT_PRIVATE_TAG,
} from '../lib/vaultCopy.js';

/** The line a pin the vault no longer holds shows (J14). */
export const PIN_MISSING_LINE = 'Pinned note not found';

export function ProjectVaultPins({ projectId, index }: { projectId: string; index: number }) {
  const project = useApp((s) => s.settings.projects?.find((p) => p.id === projectId));
  const setProjectVaultPins = useApp((s) => s.setProjectVaultPins);
  const unpinVaultNote = useApp((s) => s.unpinVaultNote);
  const vaultPinStatus = useApp((s) => s.vaultPinStatus);
  const vaultPinPrivacy = useApp((s) => s.vaultPinPrivacy);
  const memoryOn = useApp((s) => memoryOverride(s.settings) !== false);
  const vaultPickerNotes = useApp((s) => s.vaultPickerNotes);
  const pins = project?.vaultPins ?? [];
  const pinsKey = pins.join('\n');

  // Which pins the vault still holds, read when the list changes.
  // Which pins the vault still holds, and which are private, read when the
  // list changes.
  const [status, setStatus] = useState<Record<string, 'ok' | 'missing' | 'unknown'>>({});
  const [privacy, setPrivacy] = useState<Record<string, VaultVisibility>>({});
  useEffect(() => {
    let live = true;
    if (!pins.length) {
      setStatus({});
      setPrivacy({});
      return;
    }
    void vaultPinStatus(pins).then((s) => {
      if (live) setStatus(s);
    });
    void vaultPinPrivacy(pins)
      .then((v) => {
        if (live) setPrivacy(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // pinsKey stands for the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsKey, vaultPinStatus, vaultPinPrivacy]);

  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<VaultPickerNote[] | undefined>();
  useEffect(() => {
    if (!open) return;
    let live = true;
    setNotes(undefined);
    void vaultPickerNotes().then((n) => {
      if (live) setNotes(n);
    });
    return () => {
      live = false;
    };
  }, [open, vaultPickerNotes]);

  if (!project) return null;
  const full = pins.length >= PROJECT_VAULT_PINS_MAX;
  const isPrivate = (path: string) => status[path] !== 'missing' && privacy[path] === 'local-only';
  const holdsPrivate = pins.some(isPrivate);
  const toggle = (path: string) => {
    const on = pins.includes(path);
    if (!on && full) return;
    hapticCommit();
    void setProjectVaultPins(projectId, on ? pins.filter((p) => p !== path) : [...pins, path]);
  };

  return (
    <section className="card project-section" style={{ '--i': index } as CSSProperties}>
      <div className="card-row">
        <div className="grow">
          <span className="eyebrow">In every chat here</span>
          <h3>Pinned notes</h3>
        </div>
        <button type="button" className="suggestion press-fb" onClick={() => setOpen(true)}>
          {pins.length ? 'Edit' : 'Pin a note'}
        </button>
      </div>
      {pins.length ? (
        <>
          <div className="check-list" style={{ marginTop: 8 }}>
            {pins.map((path) => {
              const missing = status[path] === 'missing';
              return (
                <div key={path} className="multiselect-row" style={{ cursor: 'default' }}>
                  <span className="grow">
                    {noteTitle(path)}
                    {isPrivate(path) ? (
                      <span className="hint">
                        {' · '}
                        <LockGlyph /> {VAULT_PRIVATE_TAG} · {path}
                      </span>
                    ) : (
                      <span className="hint"> · {missing ? PIN_MISSING_LINE : path}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="suggestion press-fb"
                    aria-label={`Unpin ${noteTitle(path)}`}
                    onClick={() => void unpinVaultNote(projectId, path)}
                  >
                    Unpin
                  </button>
                </div>
              );
            })}
          </div>
          {holdsPrivate && memoryOn ? (
            <p className="hint" style={{ marginTop: 6 }}>
              {VAULT_PIN_PRIVATE_LINE}
            </p>
          ) : null}
        </>
      ) : (
        <p className="hint" style={{ marginTop: 6 }}>
          Pin notes from your Vault and every chat here starts with them, trimmed to fit the model.{' '}
          {VAULT_PRIVATE_OFF_CLOUD}
        </p>
      )}

      <Sheet open={open} onClose={() => setOpen(false)}>
        <SheetHead title="Pin notes" onClose={() => setOpen(false)} />
        <p className="sheet-sub">
          Up to {PROJECT_VAULT_PINS_MAX} notes. {VAULT_PRIVATE_OFF_CLOUD}
        </p>
        {notes === undefined ? (
          <p className="hint">Reading your Vault.</p>
        ) : notes.length === 0 ? (
          <p className="hint">No notes in your Vault yet.</p>
        ) : (
          <div className="check-list">
            {notes.map((n) => {
              const on = pins.includes(n.path);
              return (
                <label key={n.path} className="multiselect-row press-fb press-fb--row">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && full}
                    onChange={() => toggle(n.path)}
                  />
                  <span className="grow">
                    {n.title}
                    {n.localOnly ? (
                      <span className="hint">
                        {' · '}
                        <LockGlyph /> {VAULT_PRIVATE_TAG}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {full ? (
          <p className="hint">{PROJECT_VAULT_PINS_MAX} pinned. Unpin one to add another.</p>
        ) : null}
      </Sheet>
    </section>
  );
}
