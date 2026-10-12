// "Replace the shared key" on the Pairing screen (UX review cleanup 5b).
// Before per-device pairing, a setup connected with one shared key; replacing
// it cuts off anything still using the old one, while paired devices keep
// their own credentials and a terminal on this computer reads the new key by
// itself. The link shows even with no device paired, since a setup on the
// shared key alone is the one this protects. It asks once, in the app's
// confirm grammar (Cancel, then the danger button), and says how it went in
// a toast.
import { useState } from 'react';
import { Sheet } from './Sheet.js';
import { hapticApproval } from '../lib/haptics.js';

export const REPLACE_KEY_COPY = {
  link: 'Replace the shared key',
  title: 'Replace the shared key?',
  body: 'Older setups connected with one shared key instead of pairing. Replacing it cuts off anything still using the old one. The devices listed here keep working, and OpenShore in a terminal on this computer picks up the new key by itself.',
  confirm: 'Replace key',
  cancel: 'Cancel',
  done: 'Shared key replaced. Anything that used the old one must pair again.',
  failed: 'The key was not replaced, so nothing changed.',
} as const;

export function ReplaceSharedKey({
  rotate,
  onToast,
}: {
  /** The bridge's rotateSharedToken; main replaces the key and never hands
   *  it to the page. */
  rotate: () => Promise<{ rotated: true } | { error: string }>;
  onToast: (text: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const replace = async () => {
    if (busy) return;
    setBusy(true);
    let ok = false;
    try {
      const result = await rotate();
      ok = !('error' in result);
      // The raw reason goes to the log; the person reads the plain line.
      if (!ok) console.warn('[pair] shared key not replaced:', (result as { error: string }).error);
    } catch (err) {
      console.warn('[pair] shared key not replaced:', err);
    }
    setBusy(false);
    setAsking(false);
    if (ok) hapticApproval();
    onToast(ok ? REPLACE_KEY_COPY.done : REPLACE_KEY_COPY.failed);
  };

  return (
    <>
      <button type="button" className="hint press-fb" onClick={() => setAsking(true)}>
        {REPLACE_KEY_COPY.link}
      </button>
      <Sheet open={asking} onClose={() => !busy && setAsking(false)} variant="confirm">
        <h3>{REPLACE_KEY_COPY.title}</h3>
        <p>{REPLACE_KEY_COPY.body}</p>
        <div className="confirm-row">
          <button
            type="button"
            className="btn ghost press-fb"
            disabled={busy}
            onClick={() => setAsking(false)}
          >
            {REPLACE_KEY_COPY.cancel}
          </button>
          <button
            type="button"
            className="btn danger press-fb"
            disabled={busy}
            onClick={() => void replace()}
          >
            {REPLACE_KEY_COPY.confirm}
          </button>
        </div>
      </Sheet>
    </>
  );
}
