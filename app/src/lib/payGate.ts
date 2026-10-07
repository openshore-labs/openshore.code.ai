// The Personal paid gate, sold as OpenShore Plus (os-code/DECISIONS.md).
// The advisors (CTO, CFO, CX, 2026-09-30) put only coding, building and
// agentic work behind it, on actions. The founder widened it the same day,
// twice: first Pairing, then every room but five. Free is Chats,
// Projects, the Stack, Cloud Connections and Settings (and what those reach:
// a chat, a project, its notes, the setup page). Everything else is Plus:
// Terminal, Repositories, Vault, My Crew, Pairing, and the later
// tiers' rooms. A paid room opens the paywall instead of the room
// (store.ts setView), and the free build's sidebar lists those rooms greyed
// under an Upgrade banner (components/Sidebar.tsx). The actions keep their
// own doors too: a coding session anywhere, a routine made, edited or run,
// Scan and Connect, and a chat or shell on the computer from another device.
// What someone made is never locked away: their chats, their notes on disk,
// a pairing, a routine already scheduled.
//
// Every account feature is classified here, and the Record type makes a new
// one a type error until it is: a feature is paid only by being written down
// as paid. The sign-in comes first (lib/accountGate.ts); the paywall opens
// after the sign-in sheet when both are needed. Enforcement is app-side only,
// since the person owns the engine and the daemon.

import { ROOM_ACCOUNT, type AccountFeature } from './accountGate.js';
import type { ViewName } from '../state/store.js';

export type PayLevel = 'personal' | 'free';

export const PAY_GATE: Record<AccountFeature, PayLevel> = {
  // Plus: the coding agent (a 'desktop' session, the sample project, a
  // command inside a coding chat), My Crew (Crew's agentic work too: create,
  // edit, Run now; deleting, pausing and stopping stay free, in payOps),
  // Terminal, Repositories, and Vault.
  coding: 'personal',
  crew: 'personal',
  // Docking (the Computer room: a computer at home or a server you rent) is
  // free, the founder's call of 2026-10-07 ("Do not gate anything"; the
  // connect-anywhere build). Everything it opens keeps its own door.
  pairing: 'free',
  // The purchase itself, when tapped signed out (no room carries it).
  plus: 'personal',
  terminal: 'personal',
  repos: 'personal',
  vault: 'personal',
  // Free, behind the free sign-in only.
  projects: 'free',
  connections: 'free',
  // Later tiers (docs/release-tiers.md), classified now so the type holds:
  // Stack Health, the Marketplace and Launch are Plus when their tiers open,
  // and Admin is the team's own room (its seats are billed per org, apart).
  health: 'personal',
  marketplace: 'personal',
  launch: 'personal',
  admin: 'free',
};

/** What Crew says to someone without Plus who still has routines (CTO,
 *  2026-09-30): they keep running, and stopping them is free. */
export const CREW_PLUS_LINE =
  'Your routines keep running on your computer while it is on, and you can pause, stop or delete them any time. Making or changing a crew member or a routine is part of OpenShore Plus.';

/** Whether this feature is part of the paid Personal plan. */
export function featurePaid(feature: AccountFeature): boolean {
  return PAY_GATE[feature] === 'personal';
}

/** Whether a room is part of Plus: its account feature is paid. The free
 *  five, and the rooms they reach, have no paid feature. */
export function roomPaid(view: ViewName): boolean {
  const feature = ROOM_ACCOUNT[view];
  return Boolean(feature && featurePaid(feature));
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
