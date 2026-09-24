// The confirm before a current's connection is forgotten on this device. A
// forget reaches further than the sheet it starts in: the current turns off in
// every project that uses it and its API key leaves the secure store, so it
// asks first, in the app's one confirm grammar (Keep, then a danger button).
// The label is the roster's, passed in, never a name written here.
import { Sheet } from './Sheet.js';
import { forgetCurrentCopy } from '../lib/confirmCopy.js';

export function ForgetCurrentConfirm({
  label,
  onKeep,
  onForget,
}: {
  /** The current's roster label; undefined when no confirm is open. */
  label: string | undefined;
  onKeep: () => void;
  onForget: () => void;
}) {
  return (
    <Sheet open={Boolean(label)} onClose={onKeep} variant="confirm">
      {label ? (
        <>
          <h3>{forgetCurrentCopy(label).title}</h3>
          <p>{forgetCurrentCopy(label).body}</p>
          <div className="confirm-row">
            <button type="button" className="btn ghost" onClick={onKeep}>
              Keep
            </button>
            <button type="button" className="btn danger" onClick={onForget}>
              Forget
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
