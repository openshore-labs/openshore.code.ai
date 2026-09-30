// The Personal paid gate (CTO, CFO, CX, 2026-09-30; os-code/DECISIONS.md).
// Only coding, building and agentic work is paid, and the gate sits on
// actions, not rooms: starting or reattaching a coding session, the sample
// project, and creating, editing or running a Crew routine. Desktop + phone
// is paid too (founder, 2026-09-30, over the advisors' "pairing free"):
// pairing a phone or another computer, and each chat with the computer's
// models or shell in its home folder opened from that other device.
// Everything else (every chat on the device itself, web search in chat, the
// Stack, Projects, Repositories, your own Vault notes by hand, including the
// vault a pairing points at the computer, the desktop's own home shell,
// Settings, Cloud Connections, reading an old coding chat) stays free.
//
// Every account feature is classified here, and the Record type makes a new
// one a type error until it is: a feature is paid only by being written down
// as paid. The sign-in comes first (lib/accountGate.ts); the paywall opens
// after the sign-in sheet when both are needed. Enforcement is app-side only,
// since the person owns the engine and the daemon.

import type { AccountFeature } from './accountGate.js';

export type PayLevel = 'personal' | 'free';

export const PAY_GATE: Record<AccountFeature, PayLevel> = {
  // Paid: the coding agent (a 'desktop' session, the sample project, a
  // command inside a coding chat), Crew's agentic work (create, edit, Run
  // now; deleting, pausing, stopping and reading runs stay free, in payOps),
  // and Desktop + phone (Connect, the desktop's pairing code, and the
  // computer reached from another device; Revoke and Forget stay free).
  coding: 'personal',
  crew: 'personal',
  pairing: 'personal',
  // Free, behind the free sign-in only.
  projects: 'free',
  terminal: 'free',
  repos: 'free',
  vault: 'free',
  connections: 'free',
  // Later tiers (docs/release-tiers.md), classified now so the type holds:
  // the Marketplace already has a paywall reason, Launch builds an app, and
  // Admin is the team's own room (its seats are billed per org, apart).
  marketplace: 'personal',
  launch: 'personal',
  admin: 'free',
};

/** Whether this feature is part of the paid Personal plan. */
export function featurePaid(feature: AccountFeature): boolean {
  return PAY_GATE[feature] === 'personal';
}

/** The build flag. Nothing shipped sets it: only the build submitted to App
 *  Review (and the store release after it) carries VITE_PAY_GATES=1. Spelled
 *  as a literal read so the bundler folds it, the way lib/focus.ts reads
 *  VITE_RELEASE_TIER; app/scripts/check-apple-roots.mjs reads the same
 *  variable. Every price a person can read also sits behind it (plans.ts
 *  shownPrice). */
export const PAY_GATES_ENABLED = import.meta.env.VITE_PAY_GATES === '1';

/** The same reading, for a test or a script handed an environment. */
export function payGatesFrom(env: { VITE_PAY_GATES?: string } | undefined): boolean {
  return env?.VITE_PAY_GATES === '1';
}

/** The web price, on the Stripe rail only (desktop and web). iOS shows the
 *  App Store's own localized price and never this one (App Store 3.1.1).
 *  The same $49.99 a year on both rails (CFO). */
export const PERSONAL_WEB_PRICE = '$49.99';

// No trial at launch (CX, 2026-09-30). The CFO's 14-day trial is a hook, not
// a switch: it needs an Apple introductory offer on the subscription group
// and a Stripe trial (subscription_data.trial_period_days) set the same way,
// so the two rails never disagree. Revisit with both set; DECISIONS records it.
