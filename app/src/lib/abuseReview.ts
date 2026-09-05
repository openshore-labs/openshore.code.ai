// The reviewer's side of enforcement: the Tier 1 reports prepared for an
// operator.
//
// This module cannot submit a report. It can mark one submitted, which is a
// person recording what they did. OpenShore ships no submission integration,
// and nothing here will ever claim a report was filed when it was not.
//
// There is no IP-ban machinery here. An earlier version proposed banning the
// address a violation came from; the founder cut it (2026-09-05, after CTO and
// CMO review), because addresses are shared and an automatic or human-reviewed
// ban both punish bystanders. Enforcement is account termination plus this
// report queue, and nothing else.

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
