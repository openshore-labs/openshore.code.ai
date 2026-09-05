// The enforcement review surface, for OpenShore operators seeded into
// abuse_reviewers: the Tier 1 reports prepared for an authority.
//
// Renders NOTHING for anyone else, so it is safe to drop into the Admin screen
// for every account.
//
// There is no IP-ban queue here. Enforcement is account termination plus this
// report queue, and nothing else (2026-09-05, founder call after CTO and CMO
// review): OpenShore does not collect, store, or act on an IP address.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import {
  isAbuseReviewer,
  listAbuseReports,
  markReportSubmitted,
  type AbuseReportRow,
} from '../lib/abuseReview.js';

const CATEGORY_LABEL: Record<AbuseReportRow['category'], string> = {
  csam: 'Child sexual abuse material',
  ncii: 'Non-consensual intimate imagery',
  'weapons-uplift': 'Weapons uplift',
};

export function EnforcementReview() {
  const { authSession, showToast } = useApp();
  const [isReviewer, setIsReviewer] = useState(false);
  const [reports, setReports] = useState<AbuseReportRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void isAbuseReviewer(authSession).then(setIsReviewer);
  }, [authSession]);

  const load = useCallback(async () => {
    if (!authSession) return;
    setLoading(true);
    setReports(await listAbuseReports(authSession));
    setLoading(false);
  }, [authSession]);

  useEffect(() => {
    if (isReviewer) void load();
  }, [isReviewer, load]);

  if (!isReviewer || !authSession) return null;

  const markSubmitted = async (report: AbuseReportRow) => {
    const destination = window.prompt(
      'Where did you submit this report? Name the authority or hotline.',
    );
    if (!destination?.trim()) return;
    try {
      await markReportSubmitted(
        authSession,
        report.id,
        destination.trim(),
        `Submitted by an operator to ${destination.trim()}.`,
      );
      setReports((rs) =>
        rs.map((r) => (r.id === report.id ? { ...r, status: 'submitted' as const } : r)),
      );
      showToast('Recorded as submitted.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update that report.');
    }
  };

  return (
    <div className="card">
      <div className="card-row">
        <div className="grow">
          <h3>Prepared reports</h3>
          <div className="sub">
            Tier 1 records prepared for an authority. OpenShore submits nothing on its own, so a
            report stays queued until a person files it and says so here.
          </div>
        </div>
        <button className="btn quiet" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {loading ? (
        <p className="hint" style={{ marginTop: 8 }}>
          Loading the queue.
        </p>
      ) : reports.length === 0 ? (
        <p className="hint" style={{ marginTop: 8 }}>
          No reports prepared.
        </p>
      ) : (
        <div className="mod-list">
          {reports.map((r) => (
            <div className="mod-row" key={r.id}>
              <div className="mod-row-head">
                <strong>{CATEGORY_LABEL[r.category]}</strong>
                <span className="mod-status">{r.status}</span>
              </div>
              <div className="mod-meta">
                {new Date(r.occurred_at).toLocaleString()} · request {r.request_hash.slice(0, 12)}
              </div>
              {r.detail ? <p className="mod-body">{r.detail}</p> : null}
              {r.status === 'queued' ? (
                <div className="mod-actions">
                  <button className="btn quiet" onClick={() => void markSubmitted(r)}>
                    I submitted this
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
