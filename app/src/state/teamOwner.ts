// Team vault calls bound to the account that started them (R-19, round 7
// E5). The team provider asks for a token on every call, from whoever is
// signed in when the call goes out, so a save, a keep-both copy, a replay or
// a move that runs across a sign-out and another account's sign-in would go
// on under the new account, with its name on the words. Every team target the
// store hands out carries its provider through ownerBoundProvider: each call
// first checks, in the same turn as the provider reads the session for its
// token, that the target's account is still the one signed in, and refuses
// for good otherwise, so nothing is sent and the store keeps the text for the
// account that typed it. Test: app/test/teamOwner.test.ts, and the round 7
// cases in app/test/vaultStore.test.ts.
import type { StorageProvider } from '../lib/gitos/providers.js';
import { VAULT_TEAM_OTHER_ACCOUNT, VAULT_TEAM_SIGN_IN_LINE } from '../lib/vaultCopy.js';

/** A team call refused because its account is not the one signed in now.
 *  Permanent (the store's vaultRefusal reads `permanent`): retrying it under
 *  another account is exactly what must never happen. */
export class TeamAccountRefusal extends Error {
  readonly permanent = true;
  constructor(signedIn: boolean) {
    super(signedIn ? VAULT_TEAM_OTHER_ACCOUNT : VAULT_TEAM_SIGN_IN_LINE);
    this.name = 'TeamAccountRefusal';
  }
}

const bound = new WeakMap<StorageProvider, Map<string, StorageProvider>>();

/** The provider, answering only while `owner` is the account `signedIn`
 *  names. Every method is async on the seam, so a refused call answers with
 *  a rejected promise, never a throw. One wrapper per provider and owner. */
export function ownerBoundProvider(
  provider: StorageProvider,
  owner: string | undefined,
  signedIn: () => string | undefined,
): StorageProvider {
  let byOwner = bound.get(provider);
  if (!byOwner) bound.set(provider, (byOwner = new Map()));
  const key = owner ?? '';
  const known = byOwner.get(key);
  if (known) return known;
  const wrapped = new Proxy(provider, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const now = signedIn();
        if (!owner || now !== owner) return Promise.reject(new TeamAccountRefusal(Boolean(now)));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  byOwner.set(key, wrapped);
  return wrapped;
}
