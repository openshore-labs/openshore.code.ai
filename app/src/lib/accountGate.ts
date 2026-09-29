// Accounts (founder + CX, 2026-09-27; docs/accounts-cx-memo.md). Chatting needs
// no account: Harbor Lite and Harbor on the phone, the Stack, and a model you
// connect yourself. Everything else OpenShore does is behind a free sign-in:
// the coding agent, Projects, Terminal, Repositories, Vault, Crew, Cloud
// Connections, and pairing a phone with a computer. Buying Personal already
// needs one.
//
// The gate is a door, never a wipe. Signed out, what someone made stays on the
// device and readable (their chats, their notes on disk); a gated room opens
// the sign-in sheet instead, and signing in carries on to the room. A build
// with no account backend configured has nobody to sign in with, so the gate
// stays open there (needsAccount).
//
// Every room is classified, and the Record type makes a new room a type error
// until it is: a room is free only by being written down as free here.

import type { ViewName } from '../state/store.js';
import type { ConversationSource } from '../state/types.js';

export type AccountFeature =
  | 'coding'
  | 'projects'
  | 'terminal'
  | 'repos'
  | 'vault'
  | 'crew'
  | 'connections'
  | 'pairing'
  | 'marketplace'
  | 'launch'
  | 'admin';

/** Which account feature each room belongs to, or null for a free room. */
export const ROOM_ACCOUNT: Record<ViewName, AccountFeature | null> = {
  // Free: chat, the chat list, the Stack (where the models to chat with come
  // from), its health check, Settings, and the setup page.
  chat: null,
  chats: null,
  stack: null,
  stackhealth: null,
  settings: null,
  onboarding: null,
  // Behind a free sign-in.
  projects: 'projects',
  project: 'projects',
  projectmemory: 'projects',
  terminalroom: 'terminal',
  terminal: 'terminal',
  repos: 'repos',
  vault: 'vault',
  crew: 'crew',
  crewcommand: 'crew',
  connections: 'connections',
  pair: 'pairing',
  marketplace: 'marketplace',
  launch: 'launch',
  admin: 'admin',
};

/** Which account feature each brain a chat can run on needs, or null for a
 *  free chat. Only the coding agent ('desktop', a session that reads, edits
 *  and runs in a repository) needs one. The free chat with a computer's own
 *  local model ('desktop-chat', no tools, no session) is chat, on the phone
 *  and on the desktop alike (CTO ruling 8). */
export const SOURCE_ACCOUNT: Record<ConversationSource['kind'], AccountFeature | null> = {
  desktop: 'coding',
  'desktop-chat': null,
  device: null,
  cloud: null,
  stack: null,
  mock: null,
};

/** Whether a person must sign in before using account features: only when
 *  this build has accounts at all and nobody is signed in. */
export function needsAccount(configured: boolean, signedIn: boolean): boolean {
  return configured && !signedIn;
}

/** The feature a room needs an account for, or undefined when it is free. */
export function roomAccountFeature(view: ViewName): AccountFeature | undefined {
  return ROOM_ACCOUNT[view] ?? undefined;
}

/** What the sign-in sheet says for each feature. One line, then the same
 *  promise: signing in is free, and nothing made on this device goes away. */
export const ACCOUNT_GATE_TITLE: Record<AccountFeature, string> = {
  coding: 'The coding agent needs an account',
  projects: 'Projects need an account',
  terminal: 'Terminal needs an account',
  repos: 'Repositories need an account',
  vault: 'Vault needs an account',
  crew: 'Crew needs an account',
  connections: 'Cloud Connections need an account',
  pairing: 'Pairing your phone and computer needs an account',
  marketplace: 'The Marketplace needs an account',
  launch: 'Launch needs an account',
  admin: 'Admin needs an account',
};

export const ACCOUNT_GATE_BODY =
  'Signing in is free. It opens building, Projects, Vault, Crew, and pairing, and takes your theme, reasoning, voice, and notice settings to every device you sign in on. Your chats stay on your devices, and chatting needs no account.';

/** The pitch on the sign-in card and in the sidebar. */
export const ACCOUNT_PITCH =
  'Sign in to build, pair your phone, and take your settings to any device. Your chats stay on your devices.';

/** Under the signed-in card: what the account is doing for them. */
export const SIGNED_IN_PERKS =
  'Your theme, reasoning, voice, and notice settings follow you to every device you sign in on. Signing out keeps everything on this device.';

/** Said once to someone who used OpenShore before the gate, signed out. */
export const ACCOUNT_NOTICE =
  'Projects, Vault, Crew, and pairing now need an account. Everything you made is still here and comes back when you sign in.';
