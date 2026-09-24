// Account deletion (compliance pass two, part A). The app's half is a pure
// reading of the edge function's answer and a pure reducer for the confirm
// sheet, so the typed-email gate, the stale sign-in, and the team choice are
// all tested here without a screen. The server's decision core
// (supabase/functions/_shared/accountDeletion.ts) is plain TypeScript with no
// Deno API, so it is imported and tested here too.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeFunctionRaw, freshSession, FakeAuthExpired } = vi.hoisted(() => {
  class FakeAuthExpired extends Error {}
  return { invokeFunctionRaw: vi.fn(), freshSession: vi.fn(), FakeAuthExpired };
});
vi.mock('../src/lib/supabase.js', () => ({
  invokeFunctionRaw: (...args: unknown[]) => invokeFunctionRaw(...args),
  invokeFunction: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
}));
vi.mock('../src/lib/authSession.js', () => ({
  AuthExpiredError: FakeAuthExpired,
  freshSession: (...args: unknown[]) => freshSession(...args),
}));
vi.mock('../src/lib/platform.js', () => ({
  openExternal: vi.fn(),
  platform: () => 'web',
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: vi.fn() },
}));

import {
  REAUTH_MESSAGE,
  canSubmitDeletion,
  deletionReducer,
  emailMatches,
  exportFileName,
  initialDeletionState,
  interpretDeletionResponse,
  requestAccountDeletion,
  type DeletionState,
} from '../src/lib/accountDeletion.js';
import {
  REAUTH_WINDOW_MS,
  decodeJwtPayload,
  escapeLike,
  isRecentSignIn,
  latestHold,
  orgsNeedingChoice,
  parseDeleteOrgs,
  refundEligible,
  signedInAtSeconds,
  stripUserId,
} from '../../supabase/functions/_shared/accountDeletion.ts';
import type { Session } from '../src/lib/supabase.js';

const session: Session = {
  accessToken: 'tok',
  refreshToken: 'ref',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'u1', email: 'Ada@Example.com' },
};

const TEAM = { id: 'org-1', name: 'Harbor Co', members: 3, paid: true };

beforeEach(() => {
  invokeFunctionRaw.mockReset();
  freshSession.mockReset();
  freshSession.mockImplementation(async (s: Session) => s);
});

describe('reading the delete-account answer', () => {
  it('reads success', () => {
    expect(interpretDeletionResponse(200, { deleted: true })).toEqual({ kind: 'deleted' });
  });

  it('reads a 401 as a stale sign-in, whatever the body says', () => {
    expect(interpretDeletionResponse(401, { code: 'reauth_required' })).toEqual({
      kind: 'reauth',
      message: REAUTH_MESSAGE,
    });
    expect(interpretDeletionResponse(401, undefined).kind).toBe('reauth');
  });

  it('reads a 409 transfer_or_delete_org into the teams that need a choice', () => {
    const out = interpretDeletionResponse(409, {
      code: 'transfer_or_delete_org',
      orgs: [TEAM, { id: '', name: 'bad' }, { id: 'org-2', members: 1 }],
    });
    expect(out).toEqual({
      kind: 'orgs',
      orgs: [TEAM, { id: 'org-2', name: 'Your team', members: 1, paid: false }],
    });
  });

  it('reads any other failure as an error with the server line or a plain one', () => {
    expect(interpretDeletionResponse(502, { error: 'Could not cancel billing.' })).toEqual({
      kind: 'error',
      message: 'Could not cancel billing.',
    });
    expect(interpretDeletionResponse(500, undefined).kind).toBe('error');
    // A 409 with no teams in it is not a choice the person can make.
    expect(interpretDeletionResponse(409, { code: 'transfer_or_delete_org', orgs: [] }).kind).toBe(
      'error',
    );
    // A 200 without the deleted flag is not a deletion.
    expect(interpretDeletionResponse(200, {}).kind).toBe('error');
  });
});

describe('requestAccountDeletion', () => {
  it('posts to delete-account with no body on the first try', async () => {
    invokeFunctionRaw.mockResolvedValue({ status: 200, body: { deleted: true } });
    await expect(requestAccountDeletion(session)).resolves.toEqual({ kind: 'deleted' });
    expect(invokeFunctionRaw).toHaveBeenCalledWith('delete-account', 'tok', {});
  });

  it('resubmits with the teams the person chose to delete', async () => {
    invokeFunctionRaw.mockResolvedValue({ status: 200, body: { deleted: true } });
    await requestAccountDeletion(session, ['org-1']);
    expect(invokeFunctionRaw).toHaveBeenCalledWith('delete-account', 'tok', {
      deleteOrgs: ['org-1'],
    });
  });

  it('turns a 409 into the team choice', async () => {
    invokeFunctionRaw.mockResolvedValue({
      status: 409,
      body: { code: 'transfer_or_delete_org', orgs: [TEAM] },
    });
    await expect(requestAccountDeletion(session)).resolves.toEqual({ kind: 'orgs', orgs: [TEAM] });
  });

  it('treats a session that can no longer refresh as a stale sign-in', async () => {
    freshSession.mockRejectedValue(new FakeAuthExpired('expired'));
    await expect(requestAccountDeletion(session)).resolves.toEqual({
      kind: 'reauth',
      message: REAUTH_MESSAGE,
    });
    expect(invokeFunctionRaw).not.toHaveBeenCalled();
  });

  it('reads a network failure as an error, never a deletion', async () => {
    invokeFunctionRaw.mockRejectedValue(new TypeError('fetch failed'));
    const out = await requestAccountDeletion(session);
    expect(out.kind).toBe('error');
  });
});

describe('the typed-email gate', () => {
  it('unlocks only on the account email, forgiving case and outer space', () => {
    expect(emailMatches('ada@example.com', 'Ada@Example.com')).toBe(true);
    expect(emailMatches('  ADA@EXAMPLE.COM ', 'Ada@Example.com')).toBe(true);
    expect(emailMatches('ada@example.co', 'Ada@Example.com')).toBe(false);
    expect(emailMatches('', 'Ada@Example.com')).toBe(false);
    expect(emailMatches('ada@example.com', undefined)).toBe(false);
  });

  it('keeps Delete disabled until the email is typed, and while a request runs', () => {
    let s = initialDeletionState;
    expect(canSubmitDeletion(s, 'ada@example.com')).toBe(false);
    s = deletionReducer(s, { type: 'type', value: 'ada@example.com' });
    expect(canSubmitDeletion(s, 'ada@example.com')).toBe(true);
    s = deletionReducer(s, { type: 'submit' });
    expect(s.phase).toBe('working');
    expect(canSubmitDeletion(s, 'ada@example.com')).toBe(false);
    // Typing is ignored mid-request.
    expect(deletionReducer(s, { type: 'type', value: 'x' }).typed).toBe('ada@example.com');
  });
});

describe('the deletion flow', () => {
  const typed: DeletionState = { ...initialDeletionState, typed: 'ada@example.com' };

  it('ends in done on success', () => {
    const s = deletionReducer(deletionReducer(typed, { type: 'submit' }), {
      type: 'result',
      outcome: { kind: 'deleted' },
    });
    expect(s.phase).toBe('done');
  });

  it('asks for a fresh sign-in on a 401', () => {
    const s = deletionReducer(deletionReducer(typed, { type: 'submit' }), {
      type: 'result',
      outcome: { kind: 'reauth', message: REAUTH_MESSAGE },
    });
    expect(s.phase).toBe('reauth');
    expect(s.error).toBe(REAUTH_MESSAGE);
  });

  it('keeps the confirm up with the message on an error, and lets it retry', () => {
    const s = deletionReducer(deletionReducer(typed, { type: 'submit' }), {
      type: 'result',
      outcome: { kind: 'error', message: 'Try again.' },
    });
    expect(s.phase).toBe('error');
    expect(s.error).toBe('Try again.');
    expect(canSubmitDeletion(s, 'ada@example.com')).toBe(true);
  });

  it('on a 409, "Delete the team" resubmits with that team named', () => {
    let s = deletionReducer(deletionReducer(typed, { type: 'submit' }), {
      type: 'result',
      outcome: { kind: 'orgs', orgs: [TEAM] },
    });
    expect(s.phase).toBe('orgs');
    expect(s.orgs).toEqual([TEAM]);
    s = deletionReducer(s, { type: 'deleteTeam', id: 'org-1' });
    expect(s.phase).toBe('working');
    expect(s.deleteOrgs).toEqual(['org-1']);
    // A second owned team surfaces on the next 409 and joins the list.
    s = deletionReducer(s, {
      type: 'result',
      outcome: { kind: 'orgs', orgs: [{ id: 'org-2', name: 'Two', members: 1, paid: false }] },
    });
    s = deletionReducer(s, { type: 'deleteTeam', id: 'org-2' });
    expect(s.deleteOrgs).toEqual(['org-1', 'org-2']);
  });

  it('on a 409, "Keep the team" cancels the deletion and names the team', () => {
    let s = deletionReducer(typed, {
      type: 'result',
      outcome: { kind: 'orgs', orgs: [TEAM] },
    });
    s = deletionReducer(s, { type: 'keepTeam', id: 'org-1' });
    expect(s.phase).toBe('kept');
    expect(s.keptTeam).toBe('Harbor Co');
    expect(s.deleteOrgs).toEqual([]);
  });

  it('ignores a team choice for a team it was not asked about', () => {
    const s = deletionReducer(typed, { type: 'result', outcome: { kind: 'orgs', orgs: [TEAM] } });
    expect(deletionReducer(s, { type: 'deleteTeam', id: 'nope' })).toBe(s);
    expect(deletionReducer(s, { type: 'keepTeam', id: 'nope' })).toBe(s);
  });

  it('starts over on reset', () => {
    const s = deletionReducer(typed, { type: 'result', outcome: { kind: 'orgs', orgs: [TEAM] } });
    expect(deletionReducer(s, { type: 'reset' })).toEqual(initialDeletionState);
  });

  it('dates the export file', () => {
    expect(exportFileName(new Date('2026-09-24T12:00:00Z'))).toBe(
      'openshore-account-data-2026-09-24.json',
    );
  });
});

describe('the server decision core', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  const sec = (ms: number) => Math.floor(ms / 1000);

  function jwt(payload: object): string {
    const b64 = Buffer.from(JSON.stringify(payload))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `h.${b64}.s`;
  }

  it('decodes a token payload', () => {
    expect(decodeJwtPayload(jwt({ iat: 5 }))).toEqual({ iat: 5 });
    expect(decodeJwtPayload('nope')).toBeUndefined();
  });

  it('requires a sign-in under ten minutes old', () => {
    expect(REAUTH_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(isRecentSignIn({ iat: sec(now - 60_000) }, now)).toBe(true);
    expect(isRecentSignIn({ iat: sec(now - 11 * 60_000) }, now)).toBe(false);
    expect(isRecentSignIn(undefined, now)).toBe(false);
    expect(isRecentSignIn({}, now)).toBe(false);
  });

  it('reads the sign-in time from amr, so a silent refresh does not count as a sign-in', () => {
    const claims = {
      iat: sec(now - 30_000),
      amr: [{ method: 'password', timestamp: sec(now - 3 * 3_600_000) }],
    };
    expect(signedInAtSeconds(claims)).toBe(sec(now - 3 * 3_600_000));
    expect(isRecentSignIn(claims, now)).toBe(false);
    const fresh = { iat: sec(now), amr: [{ method: 'otp', timestamp: sec(now - 120_000) }] };
    expect(isRecentSignIn(fresh, now)).toBe(true);
  });

  it('stops only on owned teams with other people that were not chosen for deletion', () => {
    const owned = [
      { id: 'a', name: 'A', otherActiveMembers: 2, paid: true },
      { id: 'b', name: 'B', otherActiveMembers: 0, paid: false },
      { id: 'c', name: 'C', otherActiveMembers: 1, paid: false },
    ];
    expect(orgsNeedingChoice(owned, []).map((o) => o.id)).toEqual(['a', 'c']);
    expect(orgsNeedingChoice(owned, ['a']).map((o) => o.id)).toEqual(['c']);
    expect(orgsNeedingChoice(owned, ['a', 'c'])).toEqual([]);
  });

  it('reads deleteOrgs defensively', () => {
    expect(parseDeleteOrgs({ deleteOrgs: ['a', 'a', '', 3, 'b'] })).toEqual(['a', 'b']);
    expect(parseDeleteOrgs({ deleteOrgs: 'a' })).toEqual([]);
    expect(parseDeleteOrgs(null)).toEqual([]);
  });

  it('refunds in full only inside 14 days of the charge, and never a zero invoice', () => {
    const day = 86_400_000;
    expect(refundEligible(sec(now - 13 * day), 50000, now)).toBe(true);
    expect(refundEligible(sec(now - 14 * day), 50000, now)).toBe(true);
    expect(refundEligible(sec(now - 15 * day), 50000, now)).toBe(false);
    expect(refundEligible(sec(now - day), 0, now)).toBe(false);
    expect(refundEligible(undefined, 50000, now)).toBe(false);
  });

  it('copies held rows without the user id, held until the latest hold', () => {
    const rows = [
      { id: '1', user_id: 'u1', legal_hold_until: '2027-01-01T00:00:00.000Z' },
      { id: '2', user_id: 'u1', legal_hold_until: '2027-06-01T00:00:00.000Z' },
    ];
    expect(stripUserId(rows)).toEqual([
      { id: '1', legal_hold_until: '2027-01-01T00:00:00.000Z' },
      { id: '2', legal_hold_until: '2027-06-01T00:00:00.000Z' },
    ]);
    expect(latestHold(rows)).toBe('2027-06-01T00:00:00.000Z');
    expect(latestHold([])).toBeUndefined();
  });

  it('escapes LIKE wildcards in an email', () => {
    expect(escapeLike('a_b%c@x.io')).toBe('a\\_b\\%c@x.io');
  });
});
