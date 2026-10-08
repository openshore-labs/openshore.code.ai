// The signed-in person's profile (founder, 2026-10-02): the account button in
// the sidebar names the account, and tapping it opens the profile sheet
// (components/ProfileSheet.tsx). Nothing here is a new stored field: the name
// shown is the account's own email, and the plan reads the entitlement the
// app already holds.
import type { AppSettings } from '../state/store.js';
import { SETTINGS_REACH } from './settingsReach.js';
import { featureOn } from './focus.js';
import { create } from 'zustand';

/** The plain name of each preference that follows a signed-in person. */
export const FOLLOWS_LABEL: Partial<Record<keyof AppSettings, string>> = {
  theme: 'appearance',
  effort: 'effort',
  humanizeWriting: 'Humanize Writing',
  chainOfThought: 'Chain of Thought',
  noticeDownloads: 'notices',
  noticeReplies: 'notices',
  voiceReplies: 'voice',
  voiceRate: 'voice',
};

/** Every key settingsReach.ts lets follow the person, in its order. */
export function followingKeys(): Array<keyof AppSettings> {
  return (Object.keys(SETTINGS_REACH) as Array<keyof AppSettings>).filter(
    (k) => SETTINGS_REACH[k] === 'follows',
  );
}

/** The plain name of a following key (the key itself when unnamed, which the
 *  test forbids). */
export function followsLabel(key: keyof AppSettings): string {
  return FOLLOWS_LABEL[key] ?? String(key);
}

/** The preferences that follow the person, named once each in plain words
 *  (the row's label already says they follow you; CX, 2026-10-02). */
export function followsLine(): string {
  const names = [...new Set(followingKeys().map(followsLabel))];
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}` : names[0];
  const first = list ? list.charAt(0).toUpperCase() + list.slice(1) : '';
  return `${first}.`;
}

/** What the profile says is never copied to the account, true in every
 *  tier (privacy review, 2026-10-08). A Personal build sends none of these to
 *  our server; a build with teams keeps a team's name, its project settings
 *  and vault notes, and the addresses its members are invited at, there for
 *  the team (the team entry in egressManifest.ts, in the same words), so the
 *  line claims only the person's own. */
export function notCopiedLine(teams: boolean = featureOn('teams')): string {
  return teams
    ? "OpenShore does not copy your own chats, projects, keys, or vault to your account. A team's name, project settings, vault notes, and the addresses it invites are kept on our server, for the team."
    : 'OpenShore does not copy your chats, projects, keys, or vault to your account.';
}

/** The letter in the account's avatar. */
export function accountInitial(email?: string): string {
  const c = email?.trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}

/** Personal's standing in plain words, for the sidebar, Settings and the
 *  profile: free for everyone while the pay gates are off (the beta), else
 *  Plus (until when) or Free. */
export function planStanding(opts: { gates: boolean; unlocked: boolean; validUntil?: string }): {
  short: string;
  value: string;
  sub: string;
} {
  if (!opts.gates) {
    // Nothing is sold, so there is no plan to name (the App Store build,
    // 2026-10-02): no "Free", and never "beta" (App Review 2.2).
    return { short: '', value: '', sub: '' };
  }
  if (opts.unlocked) {
    const until = opts.validUntil
      ? new Date(opts.validUntil).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : undefined;
    return {
      short: 'OpenShore Plus',
      value: 'Active',
      sub: until
        ? `All of OpenShore is open. Renews or ends ${until}.`
        : 'All of OpenShore is open.',
    };
  }
  return {
    short: 'Free',
    value: 'Not yet',
    sub: 'Chats, Projects, the Stack and Cloud Connections are free. Plus opens the rest.',
  };
}

/** Whether the profile sheet is up. Its own small store, so the shell can
 *  hold the sheet (a sheet inside the sliding drawer would ride its
 *  transform) without adding to state/store.ts. */
export const useProfileSheet = create<{ open: boolean; show: () => void; hide: () => void }>(
  (set) => ({
    open: false,
    show: () => set({ open: true }),
    hide: () => set({ open: false }),
  }),
);

/** Where Settings should land when it opens: the id of a group another room
 *  linked to (the profile's "Preferences that follow you"). Taken once. */
export const useSettingsJump = create<{
  target?: string;
  jump: (id: string) => void;
  take: () => string | undefined;
}>((set, get) => ({
  target: undefined,
  jump: (id) => set({ target: id }),
  take: () => {
    const t = get().target;
    if (t) set({ target: undefined });
    return t;
  },
}));

/** The Settings group the preferences that follow you start in. */
export const FOLLOWS_GROUP_ID = 'settings-this-device';
