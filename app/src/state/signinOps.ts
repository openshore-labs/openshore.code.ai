// Sign-in hygiene (build 2026-09-29, package E2). The rules live here, apart
// from the store (CTO ruling 9), as plain functions a test reads without it;
// the store wires them into the sign-out, the preference sync, and
// saveSettings. Tests: app/test/accounts.test.ts and app/test/auth.test.ts.
//
// Signing out of one device never signs out the others (CX ruling 4), and it
// always finishes on this device, offline too. Ending every sign-in at once
// is its own quiet link, and it says plainly when the server could not be
// reached. The preferences that follow a person merge key by key, so two
// devices changing different ones in the same minute both keep their change.
import {
  mergePreferences,
  preferencesChanged,
  readPreferencesRecord,
  type PreferencesRecord,
} from '../lib/settingsReach.js';
import type { Session, SignOutScope } from '../lib/supabase.js';
import type { AppSettings } from './store.js';

// The words, as CX ruled them (advisor rulings 2026-09-29, CX 4).
export const SIGNED_OUT_HERE = 'Signed out here. Your other devices stay signed in.';
export const SIGN_OUT_EVERYWHERE_LINK = 'Sign out everywhere';
export const SIGN_OUT_EVERYWHERE_TITLE = 'Sign out on every device?';
export const SIGN_OUT_EVERYWHERE_BODY =
  'This device signs out now, and the others within an hour. Nothing on any device is deleted.';
export const SIGN_OUT_EVERYWHERE_FAILED =
  'Could not reach the server, so nothing changed. You are still signed in everywhere.';
/** After it worked: the confirm's own promise, said back once. */
export const SIGNED_OUT_EVERYWHERE =
  'Signed out everywhere. Your other devices sign out within an hour.';

/** How long a sign-out waits on the server before it finishes on this device
 *  anyway. The server call only ends this device's sign-in there, so a late
 *  answer (or none) changes nothing the person relies on. */
export const LOCAL_SIGN_OUT_WAIT_MS = 5000;

type Logout = (accessToken: string, scope: SignOutScope) => Promise<void>;

/** End this device's sign-in on the server, with a live access token (an
 *  expired one would be refused, and the sign-in would stay alive there).
 *  Never throws and never waits past `waitMs`: resolves true when the server
 *  confirmed, false otherwise, and the caller signs out here either way. */
export async function revokeHere(
  session: Session,
  deps: { fresh: (s: Session) => Promise<Session>; logout: Logout },
  waitMs: number = LOCAL_SIGN_OUT_WAIT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), waitMs);
  });
  const tried = (async () => {
    try {
      const fresh = await deps.fresh(session);
      await deps.logout(fresh.accessToken, 'local');
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await Promise.race([tried, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

/** What "Sign out everywhere" came to: 'done' (the server ended every
 *  sign-in), 'failed' (nothing changed anywhere), or 'ended' (the sign-in had
 *  already ended on this device, and the store has said so). */
export type EverywhereOutcome = 'done' | 'failed' | 'ended';

/** End the person's sign-in on every device. Only the server's yes counts:
 *  no wait is cut short here, since a request that landed after a give-up
 *  would sign everything out after the person was told nothing changed. */
export async function revokeEverywhere(deps: {
  fresh: () => Promise<Session | undefined>;
  logout: Logout;
}): Promise<EverywhereOutcome> {
  let session: Session | undefined;
  try {
    session = await deps.fresh();
  } catch {
    return 'failed';
  }
  if (!session) return 'ended';
  try {
    await deps.logout(session.accessToken, 'global');
    return 'done';
  } catch {
    return 'failed';
  }
}

/** Before a sync: a different person signing in than the one whose
 *  preferences were last synced here. Their account's copy wins, so the last
 *  person's times are cleared, never raced. The first sync on a device from
 *  an earlier build only records who it is for. */
export function ownerPatch(
  settings: AppSettings,
  userId: string,
): Partial<AppSettings> | undefined {
  if (!userId || settings.prefsOwner === userId) return undefined;
  if (settings.prefsOwner === undefined) return { prefsOwner: userId };
  return { prefsOwner: userId, prefsStamps: undefined, prefsUpdatedAt: undefined };
}

/** Whether a save touched a notice preference, which the native side keeps
 *  its own copy of (it reads it on a background relaunch). */
export function noticePrefsChanged(before: AppSettings, after: AppSettings): boolean {
  return (
    before.noticeDownloads !== after.noticeDownloads || before.noticeReplies !== after.noticeReplies
  );
}

export interface PrefsSyncDeps {
  /** The signed-in session with a live token, or undefined signed out. */
  session(): Promise<Pick<Session, 'accessToken' | 'user'> | undefined>;
  read(accessToken: string): Promise<unknown>;
  write(accessToken: string, record: PreferencesRecord): Promise<void>;
  settings(): AppSettings;
  save(patch: Partial<AppSettings>): Promise<void>;
  now?(): number;
}

/** The one preference sync, for a push and a pull alike: read the account's
 *  copy, merge it key by key with this device's, take what is newer there,
 *  and write the merge back when it differs. Runs one at a time, so a launch
 *  sync and a change's push never interleave their reads and writes. Every
 *  failure is quiet: the preference is already saved on this device, and the
 *  next change or launch tries again. */
export function createPrefsSync(deps: PrefsSyncDeps): () => Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  const once = async (): Promise<void> => {
    try {
      const session = await deps.session();
      if (!session) return;
      const owner = ownerPatch(deps.settings(), session.user.id);
      if (owner) await deps.save(owner);
      const remote = readPreferencesRecord(await deps.read(session.accessToken));
      const before = deps.settings();
      const merge = mergePreferences(before, remote, deps.now?.() ?? Date.now());
      // A change made here while the account's copy was on its way is newer
      // than this merge. Its own push merges again in a moment, so this pass
      // leaves both sides alone.
      const now = deps.settings();
      if (now.prefsStamps !== before.prefsStamps || preferencesChanged(before, now)) return;
      if (merge.patch) await deps.save(merge.patch);
      if (merge.write) await deps.write(session.accessToken, merge.record);
    } catch {
      // Offline or refused: this device's preferences stand.
    }
  };
  return () => (chain = chain.then(once));
}
