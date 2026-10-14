// Turning completion push back off (security review 2026-10-01, follow-up 2).
// A device that signs out, or forgets a computer, stops being reachable by
// push: push-unregister deletes this device's APNs token row and the grants it
// minted, so the grant a computer still holds stops working at once.
//
// Everything here is best-effort and bounded: a sign-out or a forget finishes
// whatever the server says, offline too. A grant this device could not delete
// stops being used when its computer is forgotten, and the retention job
// deletes one unused for 180 days (0027).
import type { AppSettings } from './store.js';

/** What push-unregister is asked to delete. */
export interface UnregisterBody {
  token?: string;
  grantIds?: string[];
  all?: true;
}

/** How long a sign-out or a forget waits on push-unregister before it goes
 *  on without it. */
export const PUSH_UNREGISTER_WAIT_MS = 4000;

/** The grant ids this device minted, one per computer it registered with. */
export function grantIdsHere(settings: AppSettings): string[] {
  return Object.values(settings.pushGrantIds ?? {}).filter((id) => typeof id === 'string' && id);
}

/** The body for this device's own sign-out: its token and its grants, never
 *  another device's. Undefined when there is nothing to delete. */
export function signOutBody(
  settings: AppSettings,
  token: string | undefined,
): UnregisterBody | undefined {
  const grantIds = grantIdsHere(settings);
  if (!token && grantIds.length === 0) return undefined;
  return { ...(token ? { token } : {}), ...(grantIds.length ? { grantIds } : {}) };
}

/** The body for forgetting one computer: the grant it holds, if known. */
export function forgetHubBody(settings: AppSettings, baseUrl: string): UnregisterBody | undefined {
  const id = settings.pushGrantIds?.[baseUrl];
  return id ? { grantIds: [id] } : undefined;
}

/** The settings patch once push is off for one computer (or, with no
 *  baseUrl, for all of them): the next session there registers afresh. */
export function pushForgottenPatch(
  settings: AppSettings,
  baseUrl?: string,
): Partial<AppSettings> | undefined {
  const registered = settings.pushRegisteredDaemons ?? [];
  const ids = settings.pushGrantIds ?? {};
  if (baseUrl === undefined) {
    if (registered.length === 0 && Object.keys(ids).length === 0) return undefined;
    return { pushRegisteredDaemons: undefined, pushGrantIds: undefined };
  }
  if (!registered.includes(baseUrl) && !(baseUrl in ids)) return undefined;
  const rest = { ...ids };
  delete rest[baseUrl];
  return {
    pushRegisteredDaemons: registered.filter((u) => u !== baseUrl),
    pushGrantIds: Object.keys(rest).length ? rest : undefined,
  };
}

/** Ask push-unregister to delete, waiting at most `waitMs`. Never throws:
 *  resolves true only when the server confirmed. */
export async function unregisterPush(
  body: UnregisterBody | undefined,
  invoke: (body: UnregisterBody) => Promise<unknown>,
  waitMs: number = PUSH_UNREGISTER_WAIT_MS,
): Promise<boolean> {
  if (!body) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), waitMs);
  });
  const tried = invoke(body).then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([tried, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}
