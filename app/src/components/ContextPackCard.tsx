// What the Vault gave this task's seat (Vault M4, 4.4): "Used 3 notes from
// your Vault", the note titles, and any private notes that stayed behind.
// Teal when the seat is local, amber when it leaves this network, so the
// person can see at a glance where their notes went. Built on the changed
// files card's frame, and it arrives the way every transcript card does.
// Every line comes from lib/vaultCopy.ts, where the claims are tested.
import type { ThreadItem } from '../state/types.js';
import { contextPackCopy } from '../lib/vaultCopy.js';
import { isDesktop } from '../lib/platform.js';

export function ContextPackCard({
  item,
  remote = !isDesktop(),
}: {
  item: Extract<ThreadItem, { kind: 'context-pack' }>;
  /** Not the computer running the session (a phone driving it). */
  remote?: boolean;
}) {
  const copy = contextPackCopy(item, { remote });
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
              {n.title}
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
