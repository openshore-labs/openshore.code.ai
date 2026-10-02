// The signed-in person's profile (founder, 2026-10-02): the account button in
// the sidebar names the account, and tapping it opens the profile sheet
// (components/ProfileSheet.tsx). Nothing here is a new stored field: the name
// shown is the account's own email, and the plan reads the entitlement the
// app already holds.
import type { AppSettings } from '../state/store.js';
import { SETTINGS_REACH } from './settingsReach.js';
import { create } from 'zustand';

/** The plain name of each preference that follows a signed-in person. */
export const FOLLOWS_LABEL: Partial<Record<keyof AppSettings, string>> = {
  theme: 'appearance',
  effort: 'effort',
  humanizeWriting: 'Humanize Writing',
  chainOfThought: 'Chain of Thought',
  noticeDownloads: 'download notices',
  noticeReplies: 'reply notices',
  voiceReplies: 'spoken replies',
  voiceRate: 'voice speed',
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

/** One sentence naming what follows the person to every device. */
export function followsLine(): string {
  const names = followingKeys().map(followsLabel);
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}` : names[0];
  const first = list ? list.charAt(0).toUpperCase() + list.slice(1) : '';
  return `${first} follow you to every device you sign in on.`;
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
    return {
      short: 'Free in the beta',
      value: 'Free in the beta',
      sub: 'Everything is open to everyone during the beta.',
    };
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
