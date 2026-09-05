// Enforcement: what happens to an account after a block, and what happens to
// an IP address, which is a different question with a different answer.
//
// The ladder
//   Level 0  Block and log. Every violation, always. Most stop here.
//   Level 1  Repeated Tier 2 refusals or lower-severity abuse: a warning, then
//            a temporary restriction.
//   Level 2  Any Tier 1 attempt, or abuse that persists past level 1:
//            permanent termination.
//
// Two things this file is careful about.
//
// A failed check is not a violation. When the layer blocks because its own
// checks could not complete, that is the layer failing closed, and counting it
// against the person would punish them for our bug. `check-failed` records are
// filtered out before the ladder ever sees them.
//
// An IP ban is proposed, never applied. Addresses are shared: households,
// offices, cafes, university networks, and carrier-grade NAT put thousands of
// unrelated people behind one address. An automatic ban is collateral damage
// with no appeal, so this file can only ever produce a PROPOSAL that a human
// confirms. There is no function here that applies one.

import type { EthicsRecord } from './chokepoint.js';

export type EnforcementLevel = 0 | 1 | 2;

export type EnforcementAction = 'log-only' | 'warn' | 'restrict' | 'terminate';

export interface EnforcementOutcome {
  level: EnforcementLevel;
  action: EnforcementAction;
  /** One plain line for the account's activity log and for the person. */
  reason: string;
  /** Tier 1: a report is owed to the appropriate authority or hotline. */
  reportRequired: boolean;
  /** Termination: an IP ban may be proposed for human review. */
  proposeIpBan: boolean;
}

/** How many Tier 2 blocks before a warning, and before a restriction. */
export const TIER2_WARN_AT = 3;
export const TIER2_RESTRICT_AT = 6;

/** Records that count against a person. A failed check never does. */
export function countableViolations(history: EthicsRecord[]): EthicsRecord[] {
  return history.filter((r) => r.action === 'blocked' && r.category !== 'check-failed');
}

/**
 * Decide the outcome from the account's full block history, newest or oldest
 * order does not matter. Pure: no clock, no storage, no side effect, so the
 * same history always produces the same answer and a test can pin it.
 */
export function evaluateEnforcement(history: EthicsRecord[]): EnforcementOutcome {
  const violations = countableViolations(history);
  const tier1 = violations.filter((r) => r.tier === 1);
  const tier2 = violations.filter((r) => r.tier === 2);

  // Any Tier 1 attempt is level 2. There is no accumulation threshold and no
  // consent override: one attempt at the hard-blocked categories ends the
  // account, and a report is owed where law requires or permits one.
  if (tier1.length > 0) {
    return {
      level: 2,
      action: 'terminate',
      reason:
        tier1.length === 1
          ? 'A prohibited request in a hard-blocked category.'
          : `${tier1.length} prohibited requests in hard-blocked categories.`,
      reportRequired: true,
      proposeIpBan: true,
    };
  }

  if (tier2.length >= TIER2_RESTRICT_AT) {
    return {
      level: 1,
      action: 'restrict',
      reason: `${tier2.length} blocked requests to recreate a real person without authorization.`,
      reportRequired: false,
      proposeIpBan: false,
    };
  }

  if (tier2.length >= TIER2_WARN_AT) {
    return {
      level: 1,
      action: 'warn',
      reason: `${tier2.length} blocked requests to recreate a real person without authorization.`,
      reportRequired: false,
      proposeIpBan: false,
    };
  }

  return {
    level: 0,
    action: 'log-only',
    reason: violations.length
      ? `${violations.length} blocked request${violations.length === 1 ? '' : 's'} on this account.`
      : 'No blocked requests on this account.',
    reportRequired: false,
    proposeIpBan: false,
  };
}

// ---------------------------------------------------------------------------
// The IP ban queue
// ---------------------------------------------------------------------------

export interface IpBanProposal {
  /** The address, exactly as the enforcement event carried it. */
  ipAddress: string;
  /** The account the termination applies to. */
  accountId: string;
  reason: string;
  proposedAt: string;
  /** Always 'pending'. This module cannot produce any other status. */
  status: 'pending';
  /**
   * The reviewer's checklist, carried with the proposal so the person deciding
   * sees the collateral-damage question before they see the Approve button.
   */
  reviewNotes: string[];
}

export const IP_REVIEW_NOTES: string[] = [
  'Shared addresses are the norm. Households, offices, cafes, schools, and carrier-grade NAT put unrelated people behind one address.',
  'A ban here does not reach the account holder if they move networks, and it does reach everyone else who does not.',
  'Prefer the account termination alone unless this address shows a pattern across several terminated accounts.',
  'Set an expiry. A permanent address ban outlives the person who earned it.',
];

/**
 * Build a proposal for human review. This is the ONLY thing the code can do
 * with an IP address in an enforcement context: there is deliberately no
 * applyIpBan function in this module, so an automatic ban cannot be written by
 * accident later. Applying a confirmed ban is an operator action, taken through
 * the admin review surface.
 */
export function proposeIpBan(input: {
  ipAddress: string;
  accountId: string;
  reason: string;
  now?: () => Date;
}): IpBanProposal {
  return {
    ipAddress: input.ipAddress,
    accountId: input.accountId,
    reason: input.reason,
    proposedAt: (input.now ?? (() => new Date()))().toISOString(),
    status: 'pending',
    reviewNotes: IP_REVIEW_NOTES,
  };
}

// ---------------------------------------------------------------------------
// The reporting hook
// ---------------------------------------------------------------------------

export interface AbuseReport {
  /** The category being reported. Only Tier 1 categories are reportable. */
  category: 'csam' | 'ncii' | 'weapons-uplift';
  accountId: string;
  /** The hash of the offending request. The content itself is never retained. */
  requestHash: string;
  occurredAt: string;
  /** Where this is destined, when an operator has configured a destination. */
  destination?: string;
}

export type ReportStatus =
  /** Prepared and stored, waiting for an operator to submit it. */
  | 'queued'
  /** An operator or a configured integration confirmed submission. */
  | 'submitted'
  /** Not applicable in this jurisdiction, or the operator declined. */
  | 'not-submitted';

export interface ReportOutcome {
  report: AbuseReport;
  status: ReportStatus;
  /** Plain language about what did and did not happen. Never overstated. */
  detail: string;
}

/**
 * The reporting hook. Where law requires or permits it, Tier 1 material is
 * reported to the appropriate authority or hotline, which in the United States
 * means NCMEC for child sexual abuse material.
 *
 * OpenShore ships NO submission integration, and this function does not
 * pretend otherwise. It prepares the report and returns 'queued'. An operator
 * wires a real destination and marks it submitted; nothing in this codebase
 * will ever claim a report was filed when it was not. That honesty is the
 * point of the hook: a fabricated "reported to NCMEC" would be worse than no
 * hook at all.
 */
export function prepareReport(input: {
  category: AbuseReport['category'];
  accountId: string;
  requestHash: string;
  occurredAt: string;
  submit?: (report: AbuseReport) => Promise<{ submitted: boolean; detail: string }>;
  destination?: string;
}): Promise<ReportOutcome> {
  const report: AbuseReport = {
    category: input.category,
    accountId: input.accountId,
    requestHash: input.requestHash,
    occurredAt: input.occurredAt,
    destination: input.destination,
  };
  if (!input.submit) {
    return Promise.resolve({
      report,
      status: 'queued',
      detail:
        'Report prepared and stored for the operator. No submission integration is configured, so nothing has been sent.',
    });
  }
  return input
    .submit(report)
    .then((result) => ({
      report,
      status: result.submitted ? ('submitted' as const) : ('not-submitted' as const),
      detail: result.detail,
    }))
    .catch((err: unknown) => ({
      report,
      status: 'queued' as const,
      detail: `Submission failed, so the report stays queued: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }));
}
