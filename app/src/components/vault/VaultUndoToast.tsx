// The Vault's Undo toast (Vault M6 6.3; CTO K6, R2; CX X9). An action variant
// of the app toast, local to the Vault room (the app toast is a bare string,
// and M6 does not change App.tsx): the text may ellipsize, the Undo button
// never does and is at least 44 px tall. It shows for 6 seconds, the timer
// pausing while the pointer is over it or focus is inside it; a new toast
// replaces it (the earlier note simply stays in Trash). It rides
// useExitPresence, so it sinks and fades out rather than blinking away.
//
// The delete has already landed when this mounts, so the commit haptic fires
// here, once per toast (CX X19). Undo is a button, so App's capture tick is
// its one tick. For VoiceOver the untimed way back is Trash, so the button's
// description says "Also in Trash." (WCAG 2.2.1) wherever Trash is real.
import { useEffect, useRef, useState } from 'react';
import { useExitPresence } from '../../hooks/useExitPresence.js';
import { hapticCommit } from '../../lib/haptics.js';
import { VAULT_UNDO, VAULT_UNDO_ALSO_IN_TRASH, vaultUndoLabel } from '../../lib/vaultCopy.js';

/** How long the toast waits for a hand (CX X9: the plain toast's 3.2 s is too
 *  short to read and reach). */
export const VAULT_UNDO_MS = 6000;

export interface VaultUndoToastItem {
  /** A new id is a new toast: the timer restarts and the haptic fires. */
  id: string;
  text: string;
  /** The note or folder the Undo brings back, for its label. */
  title: string;
  /** Trash is behind it, so it is also restorable from there. */
  trashed: boolean;
}

export function VaultUndoToast({
  item,
  onUndo,
  onDone,
}: {
  item: VaultUndoToastItem | undefined;
  /** Undo was tapped. The toast closes at once; the caller restores. */
  onUndo: (item: VaultUndoToastItem) => void;
  /** The toast timed out (or was undone): the caller clears `item`. */
  onDone: (item: VaultUndoToastItem) => void;
}) {
  const { mounted, closing } = useExitPresence(Boolean(item));
  const last = useRef(item);
  if (item) last.current = item;
  const shown = item ?? last.current;

  // Paused while hovered or focused; the remaining time carries over.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const left = useRef(VAULT_UNDO_MS);
  const started = useRef(0);

  const id = item?.id;
  useEffect(() => {
    if (!id) return;
    left.current = VAULT_UNDO_MS;
    hapticCommit();
  }, [id]);

  useEffect(() => {
    if (!item || paused) return;
    started.current = Date.now();
    const timer = setTimeout(() => onDone(item), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - started.current));
    };
  }, [item, paused, onDone]);

  if (!mounted || !shown) return null;
  return (
    <div
      className={`toast vault-undo-toast${closing ? ' closing' : ''}`}
      role="status"
      aria-live="polite"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <span className="vault-undo-text">{shown.text}</span>
      <button
        type="button"
        className="vault-undo-btn press-fb"
        aria-label={vaultUndoLabel(shown.title)}
        aria-description={shown.trashed ? VAULT_UNDO_ALSO_IN_TRASH : undefined}
        disabled={closing}
        onClick={() => {
          if (!item) return;
          onUndo(item);
          onDone(item);
        }}
      >
        {VAULT_UNDO}
      </button>
    </div>
  );
}
