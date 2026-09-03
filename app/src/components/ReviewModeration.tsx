// The review moderation queue, for OpenShore operators (seeded into
// review_moderators). It is the first-party half of the Apple 1.2 moderation
// method: the auto-hide trigger catches reported content, and this lets an
// operator hide or restore any review. Renders NOTHING for a non-moderator, so
// it is safe to drop into the Admin screen for everyone.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import {
  isReviewModerator,
  listModerationQueue,
  setReviewStatus,
  type ModeratedReview,
} from '../lib/reviews.js';
import { Stars } from './Stars.js';

export function ReviewModeration() {
  const { authSession, showToast } = useApp();
  const [isMod, setIsMod] = useState(false);
  const [queue, setQueue] = useState<ModeratedReview[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void isReviewModerator(authSession).then(setIsMod);
  }, [authSession]);

  const load = useCallback(async () => {
    if (!authSession) return;
    setLoading(true);
    setQueue(await listModerationQueue(authSession));
    setLoading(false);
  }, [authSession]);

  useEffect(() => {
    if (isMod) void load();
  }, [isMod, load]);

  if (!isMod || !authSession) return null;

  const act = async (r: ModeratedReview, status: 'visible' | 'hidden') => {
    try {
      await setReviewStatus(authSession, r.id, status);
      setQueue((q) => q.filter((x) => x.id !== r.id));
      showToast(status === 'hidden' ? 'Review hidden.' : 'Review restored.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update that review.');
    }
  };

  return (
    <div className="card">
      <div className="card-row">
        <div className="grow">
          <h3>Community reviews</h3>
          <div className="sub">Reported or hidden run reports. You decide what stays.</div>
        </div>
        <button className="btn quiet" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {loading ? (
        <p className="hint" style={{ marginTop: 8 }}>
          Loading the queue.
        </p>
      ) : queue.length === 0 ? (
        <p className="hint" style={{ marginTop: 8 }}>
          Nothing needs a look right now.
        </p>
      ) : (
        <div className="mod-list">
          {queue.map((r) => (
            <div className="mod-row" key={r.id}>
              <div className="mod-row-head">
                <Stars value={r.rating} size={12} fill="var(--voice)" label={`${r.rating} of 5`} />
                <span className="mod-status">
                  {r.status}
                  {r.flag_count ? ` · ${r.flag_count} flag${r.flag_count === 1 ? '' : 's'}` : ''}
                </span>
              </div>
              {r.body ? <p className="mod-body">{r.body}</p> : null}
              <div className="mod-meta">{r.model_id}</div>
              <div className="mod-actions">
                {r.status !== 'hidden' ? (
                  <button className="btn quiet" onClick={() => void act(r, 'hidden')}>
                    Hide
                  </button>
                ) : null}
                {r.status !== 'visible' ? (
                  <button className="btn quiet" onClick={() => void act(r, 'visible')}>
                    Restore
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
