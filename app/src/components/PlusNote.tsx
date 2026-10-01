// "Part of OpenShore Plus", said inside a paid room a free person can still
// open because it holds something to stop or let go of (roomPass in
// state/payOps.ts; CTO, 2026-09-30): Crew with routines, Pairing
// with pairings. The free actions work below it; the paid ones open the
// sheet. Shown only while the paywall would open, so never with the pay
// gates off.
import type { AccountFeature } from '../lib/accountGate.js';
import { useApp } from '../state/store.js';

export function PlusNote({ feature, line }: { feature: AccountFeature; line: string }) {
  const door = useApp((s) => s.personalDoor(feature));
  const requirePersonal = useApp((s) => s.requirePersonal);
  if (door !== 'paywall') return null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Part of OpenShore Plus</h3>
      <div className="sub">{line}</div>
      <button
        className="btn primary press-fb"
        style={{ width: '100%', marginTop: 12 }}
        onClick={() => requirePersonal(feature)}
      >
        See Plus
      </button>
    </div>
  );
}
