// The reviewer's side of enforcement: the proposed IP bans waiting on a human,
// and the Tier 1 reports prepared for an operator.
//
// Two things this module deliberately cannot do.
//
// It cannot apply an IP ban. It can move a proposal to approved or rejected,
// with an expiry, and that is a decision recorded for an operator to act on at
// the edge. Nothing in the app or the database bans an address on its own,
// because addresses are shared and an automatic ban punishes bystanders.
//
// It cannot submit a report. It can mark one submitted, which is a person
// recording what they did. OpenShore ships no submission integration, and
// nothing here will ever claim a report was filed when it was not.

import { rpcPublic, type Session } from './supabase.js';
import { isConfigured } from './supabase.js';
import { freshSession } from './authSession.js';

async function tokenFor(session?: Session): Promise<string | undefined> {
  if (!isConfigured() || !session) return undefined;
  try {
    return (await freshSession(session)).accessToken;
  } catch {
    return undefined;
  }
}

export interface IpBanProposal {
  id: string;
  ip_address: string;
  user_id: string | null;
  reason: string;
  proposed_at: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  reviewed_by: string | null;
  reviewed_at: string | null;
  expires_at: string | null;
  review_notes: string[];
}

export interface AbuseReportRow {
  id: string;
  user_id: string | null;
  category: 'csam' | 'ncii' | 'weapons-uplift';
  request_hash: string;
  occurred_at: string;
  status: 'queued' | 'submitted' | 'not-submitted';
  destination: string | null;
  detail: string | null;
  created_at: string;
  submitted_at: string | null;
}

/** Whether the signed-in person is an abuse reviewer. Decides whether the
 *  enforcement surface shows at all. */
export async function isAbuseReviewer(session?: Session): Promise<boolean> {
  const token = await tokenFor(session);
  if (!token) return false;
  try {
    return (await rpcPublic<boolean>('is_abuse_reviewer', {}, token)) === true;
  } catch {
    return false;
  }
}

/** Proposals waiting on a person. Empty for anyone else (the RPC refuses). */
export async function listIpBanProposals(session: Session): Promise<IpBanProposal[]> {
  const token = await tokenFor(session);
  if (!token) return [];
  try {
    return await rpcPublic<IpBanProposal[]>('admin_list_ip_ban_proposals', { p_limit: 100 }, token);
  } catch {
    return [];
  }
}

/**
 * Decide one proposal. An approval needs an expiry: the question is never only
 * whether to ban an address, it is also for how long, and a permanent ban
 * outlives the person who earned it.
 */
export async function decideIpBan(
  session: Session,
  proposalId: string,
  decision: 'approved' | 'rejected',
  expiresAt?: string,
): Promise<void> {
  const token = await tokenFor(session);
  if (!token) throw new Error('Sign in as a reviewer.');
  if (decision === 'approved' && !expiresAt) {
    throw new Error('An approved IP ban needs an expiry.');
  }
  await rpcPublic(
    'admin_decide_ip_ban',
    { p_proposal_id: proposalId, p_decision: decision, p_expires_at: expiresAt ?? null },
    token,
  );
}

/** The prepared reports, queued ones first. */
export async function listAbuseReports(session: Session): Promise<AbuseReportRow[]> {
  const token = await tokenFor(session);
  if (!token) return [];
  try {
    return await rpcPublic<AbuseReportRow[]>('admin_list_abuse_reports', { p_limit: 100 }, token);
  } catch {
    return [];
  }
}

/** Record that a person submitted a report, and where. */
export async function markReportSubmitted(
  session: Session,
  reportId: string,
  destination: string,
  detail: string,
): Promise<void> {
  const token = await tokenFor(session);
  if (!token) throw new Error('Sign in as a reviewer.');
  await rpcPublic(
    'admin_mark_report_submitted',
    { p_report_id: reportId, p_destination: destination, p_detail: detail },
    token,
  );
}

/** A common expiry to offer, so the reviewer is not typing timestamps. */
export function expiryFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
