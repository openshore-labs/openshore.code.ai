// The enforcement review surface, for OpenShore operators seeded into
// abuse_reviewers. Two queues that only a person can clear: proposed IP bans,
// and Tier 1 reports prepared for an authority.
//
// Renders NOTHING for anyone else, so it is safe to drop into the Admin screen
// for every account.
//
// The IP queue is written to slow the reviewer down on purpose. The proposal's
// own review notes are shown above the buttons, an approval is a choice of
// duration rather than a single Approve, and Reject is the quiet default
// action. An address is shared far more often than people assume, and the cost
// of a wrong ban falls on someone who did nothing.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import {
  decideIpBan,
  expiryFromNow,
  isAbuseReviewer,
  listAbuseReports,
  listIpBanProposals,
  markReportSubmitted,
  type AbuseReportRow,
  type IpBanProposal,
} from '../lib/abuseReview.js';

const CATEGORY_LABEL: Record<AbuseReportRow['category'], string> = {
  csam: 'Child sexual abuse material',
  ncii: 'Non-consensual intimate imagery',
  'weapons-uplift': 'Weapons uplift',
};

export function EnforcementReview() {
  const { authSession, showToast } = useApp();
  const [isReviewer, setIsReviewer] = useState(false);
  const [bans, setBans] = useState<IpBanProposal[]>([]);
  const [reports, setReports] = useState<AbuseReportRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void isAbuseReviewer(authSession).then(setIsReviewer);
  }, [authSession]);

  const load = useCallback(async () => {
    if (!authSession) return;
    setLoading(true);
    const [proposals, prepared] = await Promise.all([
      listIpBanProposals(authSession),
      listAbuseReports(authSession),
    ]);
    setBans(proposals);
    setReports(prepared);
    setLoading(false);
  }, [authSession]);

  useEffect(() => {
    if (isReviewer) void load();
  }, [isReviewer, load]);

  if (!isReviewer || !authSession) return null;

  const decide = async (
    proposal: IpBanProposal,
    decision: 'approved' | 'rejected',
    days?: number,
  ) => {
    try {
      await decideIpBan(authSession, proposal.id, decision, days ? expiryFromNow(days) : undefined);
      setBans((q) => q.filter((p) => p.id !== proposal.id));
      showToast(
        decision === 'rejected'
          ? 'Proposal rejected. No address was banned.'
          : `Approved for ${days} days. Apply it at your edge; nothing here bans an address.`,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not record that decision.');
    }
  };

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
    <>
      <div className="card">
        <div className="card-row">
          <div className="grow">
            <h3>Proposed IP bans</h3>
            <div className="sub">
              Queued by a termination. Nothing is banned until you decide, and nothing here applies
              a ban.
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
        ) : bans.length === 0 ? (
          <p className="hint" style={{ marginTop: 8 }}>
            Nothing waiting on a decision.
          </p>
        ) : (
          <div className="mod-list">
            {bans.map((p) => (
              <div className="mod-row" key={p.id}>
                <div className="mod-row-head">
                  <strong>{p.ip_address}</strong>
                  <span className="mod-status">{new Date(p.proposed_at).toLocaleDateString()}</span>
                </div>
                <p className="mod-body">{p.reason}</p>
                <ul className="hint" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {p.review_notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                <div className="mod-actions">
                  <button className="btn quiet" onClick={() => void decide(p, 'rejected')}>
                    Reject
                  </button>
                  <button className="btn quiet" onClick={() => void decide(p, 'approved', 7)}>
                    Approve 7 days
                  </button>
                  <button className="btn quiet" onClick={() => void decide(p, 'approved', 30)}>
                    Approve 30 days
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-row">
          <div className="grow">
            <h3>Prepared reports</h3>
            <div className="sub">
              Tier 1 records prepared for an authority. OpenShore submits nothing on its own, so a
              report stays queued until a person files it and says so here.
            </div>
          </div>
        </div>
        {reports.length === 0 ? (
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
    </>
  );
}
