// What the Vault gave this task's seat (Vault M4, 4.4): "Used 3 notes from
// your Vault", the note titles, and any private notes that stayed behind.
// Teal when the seat is local, amber when it leaves this network, so the
// person can see at a glance where their notes went. Built on the changed
// files card's frame, and it arrives the way every transcript card does.
// Every line comes from lib/vaultCopy.ts, where the claims are tested.
//
// Vault M5 (tech review J9): when this device's vault can open the note (an app
// chat's own vault, or the computer's vault reached as the hub), a title is a
// button that opens it; otherwise titles stay plain and the foot says they
// are on the computer.
import type { ThreadItem } from '../state/types.js';
import { contextPackCopy } from '../lib/vaultCopy.js';
import { isDesktop } from '../lib/platform.js';

export function ContextPackCard({
  item,
  remote = !isDesktop(),
  onOpen,
}: {
  item: Extract<ThreadItem, { kind: 'context-pack' }>;
  /** Not the computer running the session (a phone driving it). */
  remote?: boolean;
  /** Open a note in the Vault, when this device's vault holds it (the store's
   *  `vaultPackOpener`). Absent keeps the titles plain. */
  onOpen?: (path: string) => void;
}) {
  // A device that can open the notes is not "remote" for the card's foot:
  // the notes are one tap away, not only on the computer.
  const copy = contextPackCopy(item, { remote: remote && !onOpen });
  if (!copy) return null;
  return (
    <div className={`context-pack-card ${item.seat}`}>
      <div className="context-pack-head">
        <span className="context-pack-title">{copy.headline}</span>
        <span className="context-pack-seat">{copy.seat}</span>
      </div>
      {copy.notes.length ? (
        <ul className="context-pack-list">
          {copy.notes.map((n) => (
            <li key={n.path} className="context-pack-note" title={n.path}>
              {onOpen ? (
                <button
                  type="button"
                  className="linklike press-fb context-pack-open"
                  onClick={() => onOpen(n.path)}
                >
                  {n.title}
                </button>
              ) : (
                n.title
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {copy.withheld || copy.cold || copy.remote ? (
        <div className="context-pack-foot">
          {copy.withheld ? <p>{copy.withheld}</p> : null}
          {copy.cold ? <p>{copy.cold}</p> : null}
          {copy.remote ? <p>{copy.remote}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
