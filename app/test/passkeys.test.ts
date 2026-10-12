// Passkeys (founder, CTO and CX, 2026-10-12): the relying party is always
// openshore.ai, the native ceremony's answer becomes WebAuthn's JSON, and a
// passkey is offered for adding only after a fresh email sign-in.
import { describe, expect, it } from 'vitest';
import {
  RP_ID,
  assertOptionsFrom,
  assertionJson,
  passkeyLine,
  passkeyProblem,
  PasskeyError,
  PASSKEY_CANCELED,
  recentEmailProof,
  registerOptionsFrom,
  registrationJson,
  sessionMethods,
} from '../src/lib/passkeys.js';

const jwt = (claims: object) =>
  `h.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.s`;

describe('the relying party is ours', () => {
  it('takes GoTrue options for openshore.ai, and refuses any other site', () => {
    const opts = registerOptionsFrom({
      challenge: 'Y2g',
      rp: { id: 'openshore.ai' },
      user: { id: 'dXNlcg', name: 'a@b.c' },
      excludeCredentials: [{ id: 'a2V5' }],
    });
    expect(opts).toEqual({
      rpId: RP_ID,
      challenge: 'Y2g',
      userId: 'dXNlcg',
      userName: 'a@b.c',
      exclude: ['a2V5'],
    });
    expect(() =>
      registerOptionsFrom({
        challenge: 'c',
        rp: { id: 'evil.example' },
        user: { id: 'u', name: 'n' },
      }),
    ).toThrow();
    expect(assertOptionsFrom({ challenge: 'c' })).toEqual({ rpId: RP_ID, challenge: 'c' });
    expect(() => assertOptionsFrom({ challenge: 'c', rpId: 'evil.example' })).toThrow();
  });
});

describe("the ceremony's answer as WebAuthn JSON", () => {
  it('a registration', () => {
    expect(
      registrationJson({ id: 'aWQ', clientDataJSON: 'Y2Q', attestationObject: 'YW8' }),
    ).toEqual({
      id: 'aWQ',
      rawId: 'aWQ',
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: 'Y2Q',
        attestationObject: 'YW8',
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: {},
    });
  });

  it('an assertion, with the user handle only when there is one', () => {
    const base = { id: 'aWQ', clientDataJSON: 'Y2Q', authenticatorData: 'YWQ', signature: 'c2ln' };
    expect((assertionJson(base).response as Record<string, unknown>).userHandle).toBeUndefined();
    expect(
      (assertionJson({ ...base, userHandle: 'dQ' }).response as Record<string, unknown>).userHandle,
    ).toBe('dQ');
  });
});

describe('a passkey is added only after a fresh email sign-in', () => {
  const now = Date.UTC(2026, 9, 12, 12, 0, 0);
  const at = (minutesAgo: number) => Math.floor((now - minutesAgo * 60_000) / 1000);

  it('reads the token amr claim', () => {
    expect(sessionMethods(jwt({ amr: [{ method: 'otp', timestamp: 1 }] }))).toEqual([
      { method: 'otp', timestamp: 1 },
    ]);
    expect(sessionMethods('not-a-token')).toBeUndefined();
  });

  it('an email code or link in the last 10 minutes counts', () => {
    expect(recentEmailProof(jwt({ amr: [{ method: 'otp', timestamp: at(2) }] }), now)).toBe(true);
    expect(recentEmailProof(jwt({ amr: [{ method: 'magiclink', timestamp: at(9) }] }), now)).toBe(
      true,
    );
  });

  it('an old one, or a passkey sign-in, does not', () => {
    expect(recentEmailProof(jwt({ amr: [{ method: 'otp', timestamp: at(11) }] }), now)).toBe(false);
    expect(recentEmailProof(jwt({ amr: [{ method: 'passkey', timestamp: at(1) }] }), now)).toBe(
      false,
    );
    expect(recentEmailProof(jwt({}), now)).toBe(false);
  });
});

describe('the words', () => {
  it('a row names when it was added and last used', () => {
    expect(
      passkeyLine({ id: '1', name: 'iCloud Keychain', createdAt: '2026-10-12T10:00:00Z' }, 'en-GB'),
    ).toBe('Added 12 Oct 2026');
    expect(
      passkeyLine(
        {
          id: '1',
          name: 'x',
          createdAt: '2026-10-12T10:00:00Z',
          lastUsedAt: '2026-10-14T10:00:00Z',
        },
        'en-GB',
      ),
    ).toBe('Added 12 Oct 2026 · Last used 14 Oct 2026');
  });

  it('a back-out is not an error, and a missing step-up says what to do', () => {
    expect(
      passkeyProblem(Object.assign(new Error('The passkey was cancelled.'), { code: 'canceled' })),
    ).toBe(PASSKEY_CANCELED);
    expect(passkeyProblem(new PasskeyError('Database error', 'unexpected_failure'))).toMatch(
      /Try again/,
    );
    expect(passkeyProblem(new Error('passkey_needs_recent_email'))).toMatch(/by email first/);
  });
});
