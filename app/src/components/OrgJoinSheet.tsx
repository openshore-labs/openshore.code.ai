// The explicit yes before this device adopts a company org someone else added
// the signed-in person to (BE-1 client half, CTO ruling 2026-09-05). An org
// the person owns, or one this device already references, is adopted without
// asking; anything else waits here. "Not now" is remembered on this device
// until sign-out, so the question is asked once, not on every launch. The
// server row is untouched either way; only what this device shows is gated.
import { Sheet } from './Sheet.js';
import { useApp } from '../state/store.js';

export function OrgJoinSheet() {
  const join = useApp((s) => s.orgJoin);
  const joinOrg = useApp((s) => s.joinOrg);
  const declineOrg = useApp((s) => s.declineOrg);
  const name = join?.org.name ?? 'A company';

  return (
    <Sheet open={Boolean(join)} onClose={() => void declineOrg()} variant="confirm">
      {join ? (
        <>
          <h3>{name} added you to their team. Join it on this device?</h3>
          <p>
            Joining shows the team&apos;s shared projects and vault here. You can leave the company
            account from Settings at any time.
          </p>
          <div className="confirm-row">
            <button className="btn ghost press-fb" onClick={() => void declineOrg()}>
              Not now
            </button>
            <button className="btn primary press-fb" onClick={() => void joinOrg()}>
              Join
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
