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
  // The Home Screen or Dock icon is this device's own (founder, 2026-10-01).
  appIcon: 'device',
  effort: 'follows',
  humanizeWriting: 'follows',
  chainOfThought: 'follows',
  noticeDownloads: 'follows',
  noticeReplies: 'follows',
  voiceReplies: 'follows',
  voiceRate: 'follows',

  // The chat splash's Easter egg deck (lib/greetingDecks.ts): a bit of fun
  // picked on this device, kept off the account's eight preferences.
  greetingStyle: 'device',

  // Device state and flags: what this device has, has seen, or was told.
  onboarded: 'device',
  deviceId: 'device',
  deviceModels: 'device',
  cloudModels: 'device',
  harborMiniReady: 'device',
  harborReady: 'device',
  harborVersion: 'device',
  libraryIntroSeen: 'device',
  navOrder: 'device',
  terminalRoomSeen: 'device',
  guidedSetup: 'device',
  heldFirstMessage: 'device',
  prefsUpdatedAt: 'device',
  prefsStamps: 'device',
  prefsOwner: 'device',
  accountNoticeSeen: 'device',
  passwordsGoneSeen: 'device',
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
  providerModels: 'device',
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
  // A prompt in the person's own words: never follows (the rule above).
  writingVoice: 'device',
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
  webFetchMode: 'device',
  insightsOptIn: 'device',
  permissionMode: 'device',
  terminalControl: 'device',
  storeSecrets: 'device',
  codemagicAccess: 'device',
};

export type Preferences = Partial<Pick<AppSettings, FollowingKey>>;
export type FollowingKey =
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

// The account's copy (v: 2) keeps each preference with the time it changed,
// so two devices that change different preferences in the same minute both
// keep their change: a sync reads the account's copy, keeps the newer side of
// each preference, and writes the merge back. The first copy (v: 1) held one
// time for the whole record, so whichever device wrote last took every key,
// and the other device's change was lost and then reverted.

/** One preference on the account: its value, and when it was set. */
export type PreferenceEntries = {
  [K in FollowingKey]?: { v: NonNullable<AppSettings[K]>; at: string };
};

/** The copy of preferences kept on the account. */
export interface PreferencesRecord {
  v: 2;
  prefs: PreferenceEntries;
}

/** When each preference last changed on this device (ISO times). */
export type PreferenceStamps = Partial<Record<FollowingKey, string>>;

/** The most the account's copy may hold, serialized. Eight plain values and
 *  their times come to about 500 bytes; the cap is there so a bug can never
 *  grow the account's user record. */
export const PREFS_RECORD_MAX_BYTES = 2048;

/** How far ahead of this device's clock a time from the account may be and
 *  still count. A device whose clock runs fast would otherwise win every
 *  preference it touched until its clock came back. */
export const PREFS_FUTURE_SKEW_MS = 5 * 60_000;

function readAt(at: unknown): string | undefined {
  if (typeof at !== 'string' || at.length > 40) return undefined;
  const t = Date.parse(at);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** Read the account's copy. A v: 1 record is taken with its one time on every
 *  key; a v: 2 record keeps each well-formed known key; anything else (a newer
 *  shape, a value edited by hand) is dropped, never applied. */
export function readPreferencesRecord(raw: unknown): PreferencesRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, { v: unknown; at: string }> = {};
  if (r.v === 1) {
    const at = readAt(r.at);
    if (!at) return undefined;
    const prefs = readPreferences(r.prefs) as Record<string, unknown>;
    for (const k of FOLLOWING_KEYS) if (prefs[k] !== undefined) out[k] = { v: prefs[k], at };
    return { v: 2, prefs: out as PreferenceEntries };
  }
  if (r.v !== 2 || !r.prefs || typeof r.prefs !== 'object') return undefined;
  const src = r.prefs as Record<string, unknown>;
  for (const k of FOLLOWING_KEYS) {
    const entry = src[k];
    if (!entry || typeof entry !== 'object') continue;
    const at = readAt((entry as { at?: unknown }).at);
    const v = (readPreferences({ [k]: (entry as { v?: unknown }).v }) as Record<string, unknown>)[
      k
    ];
    if (at && v !== undefined) out[k] = { v, at };
  }
  return { v: 2, prefs: out as PreferenceEntries };
}

/** When this device set a preference: its own stamp, else the one time an
 *  earlier build kept for all of them. Undefined when it was never stamped
 *  (set before accounts existed, or the last person's stamps were cleared). */
function stampOf(settings: AppSettings, k: FollowingKey): string | undefined {
  return settings.prefsStamps?.[k] ?? settings.prefsUpdatedAt;
}

/** A change made on this device: each following key it touched is stamped
 *  with `at`. */
export function stampOwnChange(before: AppSettings, after: AppSettings, at: string): AppSettings {
  const stamps: PreferenceStamps = { ...after.prefsStamps };
  for (const k of FOLLOWING_KEYS) if (before[k] !== after[k]) stamps[k] = at;
  return { ...after, prefsStamps: stamps };
}

function sameRecord(a: PreferenceEntries, b: PreferenceEntries | undefined): boolean {
  for (const k of FOLLOWING_KEYS) {
    const x = a[k];
    const y = b?.[k];
    if (x?.v !== y?.v || x?.at !== y?.at) return false;
  }
  return true;
}

/** The serialized size of a record, in bytes. */
export function recordBytes(record: PreferencesRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).length;
}

export interface PreferencesMerge {
  /** The merged copy, holding only following keys. */
  record: PreferencesRecord;
  /** Whether the account's copy needs the merge written back. */
  write: boolean;
  /** What this device takes: the account's newer values and every key's
   *  stamp. Undefined when nothing here changes. */
  patch?: Partial<AppSettings>;
}

/** Merge this device's preferences with the account's copy, key by key: the
 *  later time wins, and a tie keeps the account's. A value this device never
 *  stamped loses to any on the account (a new phone takes the account's), and
 *  one the account lacks is added, stamped now. A time from the account more
 *  than five minutes ahead is not trusted: it never overrides a value here,
 *  and it is not applied here; with no value here, the account's entry is
 *  left as it is. */
export function mergePreferences(
  local: AppSettings,
  remote: PreferencesRecord | undefined,
  now: number = Date.now(),
): PreferencesMerge {
  const nowAt = new Date(now).toISOString();
  const record: Record<string, { v: unknown; at: string }> = {};
  const taken: Record<string, unknown> = {};
  const stamps: Record<string, string> = {};
  for (const k of FOLLOWING_KEYS) {
    const value = local[k];
    const localAt = value === undefined ? undefined : stampOf(local, k);
    const theirs = remote?.prefs[k];
    const trusted = theirs !== undefined && Date.parse(theirs.at) <= now + PREFS_FUTURE_SKEW_MS;
    if (
      theirs &&
      trusted &&
      (value === undefined || !localAt || Date.parse(theirs.at) >= Date.parse(localAt))
    ) {
      record[k] = theirs;
      stamps[k] = theirs.at;
      if (value !== theirs.v) taken[k] = theirs.v;
    } else if (value !== undefined) {
      const at = localAt ?? nowAt;
      record[k] = { v: value, at };
      stamps[k] = at;
    } else if (theirs) {
      record[k] = theirs;
    }
  }
  const merged: PreferencesRecord = { v: 2, prefs: record as PreferenceEntries };
  const write =
    !sameRecord(merged.prefs, remote?.prefs) && recordBytes(merged) <= PREFS_RECORD_MAX_BYTES;
  const restamp =
    local.prefsUpdatedAt !== undefined ||
    FOLLOWING_KEYS.some((k) => local.prefsStamps?.[k] !== stamps[k]);
  const patch =
    Object.keys(taken).length || restamp
      ? ({ ...taken, prefsStamps: stamps, prefsUpdatedAt: undefined } as Partial<AppSettings>)
      : undefined;
  return { record: merged, write, patch };
}
