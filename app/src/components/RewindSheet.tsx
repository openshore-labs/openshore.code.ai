// "Rewind to here" (P2): the choice a rewind asks for, on a message the
// person sent. A coding chat offers the chat and its folder's files, or the
// chat alone; a chat with no folder behind it offers the one choice. The
// sheet stays up while the rewind runs (putting files back can take a moment
// on a slow computer), answers the tap at once, and says plainly when it did
// not happen. It rides <Sheet>, so it never snaps shut.
import { useEffect, useState } from 'react';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { hapticCommit } from '../lib/haptics.js';
import {
  REWIND_BODY,
  REWIND_CHAT,
  REWIND_CHAT_ONLY,
  REWIND_COPY,
  REWIND_FILES_LINE,
  REWIND_TITLE,
  REWIND_WITH_FILES,
} from '../state/rewindOps.js';

/** The tapped choice's label while its rewind runs. */
export const REWINDING = 'Rewinding...';

export function RewindSheet({
  open,
  files,
  onChoose,
  onClose,
  onCopy,
}: {
  open: boolean;
  /** Offer the files too: a coding chat, with a folder behind it. */
  files: boolean;
  /** Rewind, with the files or without; resolves to why it did not happen,
   *  or to nothing once it has (the parent closes the sheet then). */
  onChoose: (files: boolean) => Promise<string | undefined>;
  onClose: () => void;
  /** The phone's long press: the way to copy the words, since the hold
   *  takes the bubble's text selection. */
  onCopy?: () => void;
}) {
  const [working, setWorking] = useState<'files' | 'chat' | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    setWorking(undefined);
    setError(undefined);
  }, [open]);

  const choose = async (withFiles: boolean) => {
    if (working) return;
    hapticCommit();
    setWorking(withFiles ? 'files' : 'chat');
    setError(undefined);
    let failed: string | undefined;
    try {
      failed = await onChoose(withFiles);
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err);
    }
    setWorking(undefined);
    if (failed) setError(failed);
  };
  // A rewind under way finishes before the sheet goes, so its answer lands.
  const close = () => {
    if (!working) onClose();
  };

  return (
    <Sheet open={open} onClose={close} className="rewind-sheet">
      <SheetHead title={REWIND_TITLE} onClose={close} />
      <p className="sheet-sub">{REWIND_BODY}</p>
      {files ? <p className="sheet-sub rewind-files-line">{REWIND_FILES_LINE}</p> : null}
      {error ? (
        <p className="rewind-failed" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sheet-actions">
        {files ? (
          <>
            <button
              type="button"
              className="btn primary press-fb"
              disabled={Boolean(working)}
              onClick={() => void choose(true)}
            >
              {working === 'files' ? REWINDING : REWIND_WITH_FILES}
            </button>
            <button
              type="button"
              className="btn ghost press-fb"
              disabled={Boolean(working)}
              onClick={() => void choose(false)}
            >
              {working === 'chat' ? REWINDING : REWIND_CHAT_ONLY}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn primary press-fb"
            disabled={Boolean(working)}
            onClick={() => void choose(false)}
          >
            {working ? REWINDING : REWIND_CHAT}
          </button>
        )}
        {onCopy ? (
          <button
            type="button"
            className="btn ghost press-fb"
            disabled={Boolean(working)}
            onClick={onCopy}
          >
            {REWIND_COPY}
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
