// Stack Health per platform, the same "window onto that machine" shape the
// catalog loader uses. On desktop the Electron bridge folds it from the local
// journals. On the phone there is no bridge, so it reads the paired hub's
// /stack-health over the tailnet: the numbers are still computed on the machine
// that runs the models and only the aggregate crosses, never a copy of the
// sessions. With neither a bridge nor a hub there is nothing to read yet, and the
// screen invites the person to pair one.
//
// Cadence is daily, not on demand (founder, 2026-09-04). A per-range result is
// cached with the time it was folded; within a day the cache is served as-is and
// nothing recomputes, so opening the screen twice in an afternoon shows the same
// numbers. Past a day (or with no cache) it folds fresh on open and restamps.
// This is why the screen has no manual refresh: it updates about once a day, on
// its own.
import type { StackHealth, StackHealthRange } from 'os-code/protocol';
import { bridge } from './electronBridge.js';
import { storeGetJson, storeSetJson } from './platform.js';
import type { DaemonTarget } from '../drivers/remoteDriver.js';

export type StackHealthResult =
  | { kind: 'ready'; health: StackHealth; updatedAt: number }
  /** A hub was configured but could not be reached (asleep, off the tailnet). */
  | { kind: 'unreachable' }
  /** An admin has restricted Stack Health on this hub to admins only. */
  | { kind: 'restricted' }
  /** No window onto any machine: no desktop bridge and no paired hub. */
  | { kind: 'none' }
  /** The bridge was present but the fold failed. */
  | { kind: 'error' };

const DAY_MS = 24 * 60 * 60 * 1000;
const cacheKey = (range: StackHealthRange) => `oscode.cache.stackhealth.v1.${range}`;

interface CachedHealth {
  health: StackHealth;
  fetchedAt: number;
}

async function readCache(range: StackHealthRange): Promise<CachedHealth | undefined> {
  try {
    const raw = await storeGetJson<CachedHealth>(cacheKey(range));
    if (raw && typeof raw.fetchedAt === 'number' && raw.health) return raw;
  } catch {
    // A missing or unreadable cache is not an error; fold fresh.
  }
  return undefined;
}

/** Fold Stack Health for the range once a day. Serves a cache younger than a day
 *  without recomputing; otherwise reads the desktop bridge, then the paired hub,
 *  and restamps the cache. A stale cache still beats an empty screen when the
 *  fresh fold cannot be reached. */
export async function loadAppStackHealth(
  range: StackHealthRange,
  daemon?: DaemonTarget,
): Promise<StackHealthResult> {
  const cached = await readCache(range);
  if (cached && Date.now() - cached.fetchedAt < DAY_MS) {
    return { kind: 'ready', health: cached.health, updatedAt: cached.fetchedAt };
  }

  const store = async (health: StackHealth): Promise<StackHealthResult> => {
    const fetchedAt = Date.now();
    try {
      await storeSetJson(cacheKey(range), { health, fetchedAt } as CachedHealth);
    } catch {
      // A write failure only costs the daily-cadence benefit, never the read.
    }
    return { kind: 'ready', health, updatedAt: fetchedAt };
  };

  const b = bridge();
  if (b) {
    try {
      return await store(await b.stackHealth(range));
    } catch {
      if (cached) return { kind: 'ready', health: cached.health, updatedAt: cached.fetchedAt };
      return { kind: 'error' };
    }
  }
  if (daemon) {
    try {
      const res = await fetch(`${daemon.baseUrl}/stack-health?range=${encodeURIComponent(range)}`, {
        headers: { authorization: `Bearer ${daemon.token}` },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return await store((await res.json()) as StackHealth);
      }
      // An admin closed it: a first-class state, never a stale cache. Drop any
      // cache so a previously-open number cannot linger after it is restricted.
      if (res.status === 403) {
        try {
          await storeSetJson(cacheKey(range), undefined as unknown as CachedHealth);
        } catch {
          // Best effort; the restricted state is what the screen shows regardless.
        }
        return { kind: 'restricted' };
      }
      if (cached) return { kind: 'ready', health: cached.health, updatedAt: cached.fetchedAt };
      return { kind: 'unreachable' };
    } catch {
      if (cached) return { kind: 'ready', health: cached.health, updatedAt: cached.fetchedAt };
      return { kind: 'unreachable' };
    }
  }
  if (cached) return { kind: 'ready', health: cached.health, updatedAt: cached.fetchedAt };
  return { kind: 'none' };
}

export type StackHealthVisibility = 'everyone' | 'admins';

/** Read the hub's current Stack Health visibility (any member). */
export async function getStackHealthVisibility(
  daemon: DaemonTarget,
): Promise<StackHealthVisibility | undefined> {
  try {
    const res = await fetch(`${daemon.baseUrl}/stack-health/visibility`, {
      headers: { authorization: `Bearer ${daemon.token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const body = (await res.json()) as { visibility?: string };
      if (body.visibility === 'admins' || body.visibility === 'everyone') return body.visibility;
    }
  } catch {
    // Unreachable: the caller shows a neutral state rather than guessing.
  }
  return undefined;
}

/** Set the hub's Stack Health visibility (admin-only, enforced server-side).
 *  Returns true on success. */
export async function setStackHealthVisibility(
  daemon: DaemonTarget,
  visibility: StackHealthVisibility,
): Promise<boolean> {
  try {
    const res = await fetch(`${daemon.baseUrl}/stack-health/visibility`, {
      method: 'POST',
      headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ visibility }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
