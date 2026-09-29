// Where each setting may go (founder + CX, 2026-09-27; docs/accounts-cx-memo.md).
// Signing in is worth something because a few preferences follow the person to
// every device they sign in on: a reinstall, a new phone, their computer.
// Everything else stays on the device it was made on, signed in or not.
//
// Every AppSettings key is classified here, and the Record type makes a new
// key a type error until it is, the way projectPolicy.ts classifies config.
// 'follows' is a short allowlist of plain choices (a theme, a switch, a
// speed). It never holds a prompt, a path, a project, a persona, an address, a
// key, or a consent that sends something off a device: those are 'device'.
// The settings blob itself never leaves; only pickPreferences() does.
//
// Nothing resets for a signed-out person. The CX memo weighed a relaunch
// reset (iOS ends a suspended app without notice, an update relaunches the
// desktop app, and a blanket reset reruns onboarding and forgets a downloaded
// model) and advised against it; the founder's call is recorded in DECISIONS.
// A named-list reset, if it is ever wanted, is this list's 'follows' keys and
// never a 'device' one.

import type { AppSettings } from '../state/store.js';
import { EFFORTS, type Effort } from './effort.js';

export type SettingReach = 'follows' | 'device';

export const SETTINGS_REACH: Record<keyof AppSettings, SettingReach> = {
  // The preferences that follow a signed-in person.
  theme: 'follows',
  effort: 'follows',
  humanizeWriting: 'follows',
  chainOfThought: 'follows',
  noticeDownloads: 'follows',
  noticeReplies: 'follows',
  voiceReplies: 'follows',
  voiceRate: 'follows',

  // Device state and flags: what this device has, has seen, or was told.
  onboarded: 'device',
  deviceId: 'device',
  deviceModels: 'device',
  cloudModels: 'device',
  harborMiniReady: 'device',
  harborReady: 'device',
  libraryIntroSeen: 'device',
  terminalRoomSeen: 'device',
  guidedSetup: 'device',
  heldFirstMessage: 'device',
  prefsUpdatedAt: 'device',
  accountNoticeSeen: 'device',
  vaultMoveOffer: 'device',
  vaultHubOffer: 'device',
  vaultBeforeHub: 'device',
  vaultRecent: 'device',
  vaultEmptyFolders: 'device',
  // Pairing, hubs, and addresses on this person's network.
  daemon: 'device',
  daemons: 'device',
  preferRemoteHub: 'device',
  pushRegisteredDaemons: 'device',
  hubRoles: 'device',
  hubLastSeen: 'device',
  // Models, stacks, and connections: they name servers and keys on this device.
  claudeModel: 'device',
  byomModels: 'device',
  gitosResources: 'device',
  stack: 'device',
  stacks: 'device',
  pinnedModels: 'device',
  profileOverride: 'device',
  anthropicWorkspaceId: 'device',
  currentConnections: 'device',
  harnessCurrentConnections: 'device',
  searchBackend: 'device',
  perplexityResearch: 'device',
  promptCache: 'device',
  voiceId: 'device',
  // Work: projects, crew personas, repositories, the vault's rules.
  projects: 'device',
  activeProjectId: 'device',
  crew: 'device',
  account: 'device',
  declinedOrgIds: 'device',
  launch: 'device',
  repo: 'device',
  vaultContext: 'device',
  vaultPackSize: 'device',
  vaultHandoff: 'device',
  vaultPrivacy: 'device',
  vaultAgentWrites: 'device',
  wayfinding: 'device',
  // Consents and access: each is made on the device it applies to.
  webSearchConsent: 'device',
  insightsOptIn: 'device',
  permissionMode: 'device',
  terminalControl: 'device',
  storeSecrets: 'device',
  codemagicAccess: 'device',
};

export type Preferences = Partial<Pick<AppSettings, FollowingKey>>;
type FollowingKey =
  | 'theme'
  | 'effort'
  | 'humanizeWriting'
  | 'chainOfThought'
  | 'noticeDownloads'
  | 'noticeReplies'
  | 'voiceReplies'
  | 'voiceRate';

/** The keys that follow a signed-in person, in a stable order. */
export const FOLLOWING_KEYS = (Object.keys(SETTINGS_REACH) as Array<keyof AppSettings>).filter(
  (k) => SETTINGS_REACH[k] === 'follows',
) as FollowingKey[];

/** What travels to the account: the following keys this device has set. */
export function pickPreferences(settings: AppSettings): Preferences {
  const out: Record<string, unknown> = {};
  for (const k of FOLLOWING_KEYS) if (settings[k] !== undefined) out[k] = settings[k];
  return out as Preferences;
}

/** Whether a change touched a preference that follows the person. */
export function preferencesChanged(before: AppSettings, after: AppSettings): boolean {
  return FOLLOWING_KEYS.some((k) => before[k] !== after[k]);
}

/** Whether this device has made any preference of its own yet. */
export function hasOwnPreferences(settings: AppSettings): boolean {
  return FOLLOWING_KEYS.some((k) => settings[k] !== undefined);
}

const THEMES = new Set(['system', 'light', 'dark']);
const BOOL_KEYS: FollowingKey[] = [
  'humanizeWriting',
  'chainOfThought',
  'noticeDownloads',
  'noticeReplies',
  'voiceReplies',
];

/** Read preferences that came back from the account, keeping only known keys
 *  with values of the right shape. Anything else (a key from a newer build, a
 *  value someone edited by hand) is dropped, never applied. */
export function readPreferences(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Preferences = {};
  if (typeof r.theme === 'string' && THEMES.has(r.theme)) {
    out.theme = r.theme as AppSettings['theme'];
  }
  if (typeof r.effort === 'string' && (EFFORTS as readonly string[]).includes(r.effort)) {
    out.effort = r.effort as Effort;
  }
  for (const k of BOOL_KEYS) {
    if (typeof r[k] === 'boolean') (out as Record<string, unknown>)[k] = r[k];
  }
  if (typeof r.voiceRate === 'number' && r.voiceRate >= 0 && r.voiceRate <= 1) {
    out.voiceRate = r.voiceRate;
  }
  return out;
}

/** The copy of preferences kept on the account: when they last changed, and
 *  what they are. */
export interface PreferencesRecord {
  v: 1;
  at: string;
  prefs: Preferences;
}

export function readPreferencesRecord(raw: unknown): PreferencesRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) return undefined;
  return { v: 1, at: r.at, prefs: readPreferences(r.prefs) };
}

/** Which way a sync goes, from the two timestamps: the newer side wins. A
 *  device that never set a preference takes the account's (a new phone); an
 *  account with none takes the device's only if the device has some. */
export function syncDirection(
  local: AppSettings,
  remote: PreferencesRecord | undefined,
): 'pull' | 'push' | 'none' {
  const localAt = local.prefsUpdatedAt;
  if (remote) {
    if (!localAt) return 'pull';
    const r = Date.parse(remote.at);
    const l = Date.parse(localAt);
    if (r > l) return 'pull';
    if (l > r) return 'push';
    return 'none';
  }
  return localAt || hasOwnPreferences(local) ? 'push' : 'none';
}
