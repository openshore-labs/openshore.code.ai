// Which team vault indexes this device has built, and for whom (round 7 E33).
// An iPhone keeps a team index sealed in Caches, keyed by the team and the
// account (vaultIndexHost's phoneIndexStore), so it outlives the sitting that
// built it. A sign-out dropped only the index of the team on the account at
// that moment, and another account signing in after an expiry dropped none,
// so an index of a team's notes built for one account could stay on the
// device with nothing left that would ever remove it. This list, saved on the
// device, names each one as it opens; a sign-out drops every one its account
// built, and a sign-in drops every one another account built. An expiry
// drops nothing: its index waits for the same account's return. Test: the
// E33 cases in app/test/vaultStore.test.ts.
import { storeGetJson, storeSetJson } from '../lib/platform.js';
import { dropVaultIndex } from '../lib/vaultIndexHost.js';

/** Where the list is kept on the device. It holds ids only, never a note. */
export const TEAM_INDEXES_KEY = 'oscode.vault.teamIndexes';

/** One team index this device built: the team and the account it is for. */
export interface TeamIndexMark {
  orgId: string;
  owner: string;
}

const sameMark = (a: TeamIndexMark, b: TeamIndexMark) => a.orgId === b.orgId && a.owner === b.owner;

function marksOf(raw: unknown): TeamIndexMark[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is TeamIndexMark =>
      typeof m === 'object' &&
      m !== null &&
      typeof (m as TeamIndexMark).orgId === 'string' &&
      typeof (m as TeamIndexMark).owner === 'string',
  );
}

// One read and write of the list at a time, so a mark made while a drop runs
// is never lost to the drop's write.
let chain: Promise<unknown> = Promise.resolve();
function editMarks<T>(fn: (marks: TeamIndexMark[]) => { next?: TeamIndexMark[]; out: T }) {
  const run = chain.then(async () => {
    const marks = marksOf(await storeGetJson(TEAM_INDEXES_KEY).catch(() => undefined));
    const { next, out } = fn(marks);
    if (next) await storeSetJson(TEAM_INDEXES_KEY, next).catch(() => {});
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

/** A team index opened for this account: saved on the list once. The list
 *  is read each time (one small read beside a team list's network call), so
 *  a device whose storage was cleared under it marks the index again. */
export async function noteTeamIndex(orgId: string, owner: string): Promise<void> {
  const mark = { orgId, owner };
  await editMarks((marks) =>
    marks.some((m) => sameMark(m, mark))
      ? { out: undefined }
      : { next: [...marks, mark], out: undefined },
  );
}

/** Drop every team index on the list that `keep` does not keep, here and
 *  where it was kept, and take it off the list. */
export async function dropTeamIndexes(keep: (mark: TeamIndexMark) => boolean): Promise<void> {
  const gone = await editMarks((marks) => {
    const out = marks.filter((m) => !keep(m));
    return out.length ? { next: marks.filter(keep), out } : { out };
  });
  for (const m of gone) {
    await dropVaultIndex({ providerId: 'org', resourceId: m.orgId, owner: m.owner }).catch(
      () => {},
    );
  }
}
