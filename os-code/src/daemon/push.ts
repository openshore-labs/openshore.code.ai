// Completion push from the daemon. When a run finishes while idle, or blocks on
// an approval, and no phone is actively watching, the daemon fires a
// content-free push so the user knows to come back. This is the piece that makes
// "write a prompt, close the app, get told when it is done" work, the same way
// it does when the loop runs on a server.
//
// The daemon holds ONE credential for this: an opaque grant the phone minted and
// handed over (see POST /push/register in serve.ts). It is sealed at rest and
// can do nothing but cause a content-free push to that same user's own devices.
// The push itself is sent by the Supabase push-send function; the daemon only
// tells it "session X needs the user", never any code or prompt text.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { oscHome } from '../config/load.js';
import type { EgressPolicy } from '../core/security/egress.js';
import { isSealed, loadOrCreateDataKey, openString, sealString } from '../core/security/atRest.js';
import { logger } from '../util/log.js';

const log = logger('push');

// How fresh a phone "I am watching this session" beat must be for the daemon to
// treat the user as present and hold the push back. Comfortably longer than the
// phone's beat interval, so one dropped beat does not falsely notify.
const BEAT_FRESH_MS = 30_000;

export interface PushConfig {
  /** The opaque capability grant the phone minted for this daemon. */
  grant: string;
  /** Full URL of the Supabase push-send function. */
  sendUrl: string;
}

// Grants are keyed by the owning user AND the registering device (DAE-7): one
// daemon can serve several members of a team, and one user can pair several
// phones off the same QR credential. A session's completion push goes to
// every device its owner registered. The store is a flat map keyed
// `${userId}:${deviceId}`; entries written before device keys (a bare userId
// key with no userId field) are read as that user's single legacy device.
interface StoredGrant extends PushConfig {
  userId: string;
  deviceId: string;
}
type PushStore = Record<string, StoredGrant>;

function configPath(): string {
  return join(oscHome(), 'push.json');
}

let cached: { path: string; store: PushStore } | undefined;

function normalize(raw: Record<string, unknown>): PushStore {
  const out: PushStore = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Partial<StoredGrant>;
    if (typeof v.grant !== 'string' || typeof v.sendUrl !== 'string') continue;
    const userId = typeof v.userId === 'string' ? v.userId : key;
    const deviceId = typeof v.deviceId === 'string' ? v.deviceId : 'legacy';
    out[`${userId}:${deviceId}`] = { grant: v.grant, sendUrl: v.sendUrl, userId, deviceId };
  }
  return out;
}

function readStore(): PushStore {
  const path = configPath();
  if (cached && cached.path === path) return cached.store;
  let store: PushStore = {};
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (raw) {
      const dk = loadOrCreateDataKey();
      const clear = isSealed(raw) ? (dk ? openString(dk.key, raw) : null) : raw;
      store = clear ? normalize(JSON.parse(clear) as Record<string, unknown>) : {};
    }
  } catch {
    store = {};
  }
  cached = { path, store };
  return store;
}

/**
 * Persist one device's push credential for a user, sealed at rest (mode 600).
 * A phone that sends no deviceId is keyed by its grant, so re-registering the
 * same grant replaces itself and a second phone never overwrites the first.
 */
export function savePushConfig(userId: string, config: PushConfig, deviceId?: string): void {
  const device =
    deviceId && deviceId.trim()
      ? deviceId.trim()
      : `g_${createHash('sha256').update(config.grant).digest('hex').slice(0, 16)}`;
  const store: PushStore = {
    ...readStore(),
    [`${userId}:${device}`]: { ...config, userId, deviceId: device },
  };
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const dk = loadOrCreateDataKey();
  const line = JSON.stringify(store);
  writeFileSync(path, dk ? sealString(dk.key, line) : line, { mode: 0o600 });
  cached = { path, store };
}

/**
 * Every push credential for a session's owner, one per registered device.
 * Falls back to the single registered user's grants when the owner is unknown
 * (a legacy session with no recorded owner) AND exactly one user has
 * registered, which is the personal single-user daemon. With zero or several
 * users and no owner, returns [] rather than guessing whom to notify.
 */
export function loadPushConfigs(ownerUserId?: string): PushConfig[] {
  const all = Object.values(readStore());
  const strip = (g: StoredGrant): PushConfig => ({ grant: g.grant, sendUrl: g.sendUrl });
  if (ownerUserId) return all.filter((g) => g.userId === ownerUserId).map(strip);
  const users = new Set(all.map((g) => g.userId));
  if (users.size === 1) return all.map(strip);
  return [];
}

/**
 * Owns the "is the user watching, and if not, notify" decision. Beats come from
 * the phone (POST /push/beat) and are the authority on foreground state; the
 * daemon never treats a live network socket as "watching", because a
 * backgrounded iOS socket lingers half-open long after the app is gone.
 */
export class PushNotifier {
  private lastBeat = new Map<string, number>();
  // driver id -> the unsubscribe for its listener, so an evicted or deleted
  // driver can be released and a rehydrated one watched afresh (DAE-12).
  private watched = new Map<string, () => void>();

  private readonly now: () => number;
  private readonly resolveConfig: (ownerUserId?: string) => PushConfig[];

  constructor(
    private readonly egress: EgressPolicy,
    options: {
      now?: () => number;
      // Injectable for tests; defaults to the sealed on-disk store.
      resolveConfig?: (ownerUserId?: string) => PushConfig[];
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.resolveConfig = options.resolveConfig ?? loadPushConfigs;
  }

  /** The phone reports it is foreground on this session. */
  recordBeat(sessionId: string): void {
    this.lastBeat.set(sessionId, this.now());
  }

  /** True if a phone beat for this session is fresh enough to hold the push. */
  private isWatched(sessionId: string): boolean {
    const at = this.lastBeat.get(sessionId);
    return at !== undefined && this.now() - at < BEAT_FRESH_MS;
  }

  /**
   * Watch a driver for the two moments that need the user: an approval request
   * (the run is blocked and cannot continue) and a truly idle completion (the
   * queue is empty, so it is not just a pause between batched tasks). Live-only,
   * no journal replay, so reattaching a driver never re-fires old events.
   */
  watch(driver: {
    id: string;
    idle: boolean;
    readonly owner?: string;
    onEvent: (listener: (event: { type: string }, seq: number) => void) => () => void;
  }): void {
    if (this.watched.has(driver.id)) return;
    // Owner is read at fire time, not here: the create path attaches the watcher
    // just before it records the owner, and a rehydrated driver carries its own.
    const off = driver.onEvent((event, seq) => {
      if (event.type === 'approval-request') {
        void this.fire(driver.id, driver.owner, 'approval', seq);
      } else if (event.type === 'task-done') {
        // Let the driver settle: if another queued task starts on the next tick,
        // this was a mid-batch completion, not idle. Only notify once idle.
        setTimeout(() => {
          if (driver.idle) void this.fire(driver.id, driver.owner, 'done', seq);
        }, 0);
      }
    });
    this.watched.set(driver.id, off);
  }

  /** Stop watching a driver (evicted or deleted). Idempotent. */
  unwatch(driverId: string): void {
    const off = this.watched.get(driverId);
    if (!off) return;
    this.watched.delete(driverId);
    this.lastBeat.delete(driverId);
    off();
  }

  /** Best-effort content-free push, to every device the owner registered.
   *  Silently no-ops when unconfigured. */
  private async fire(
    sessionId: string,
    ownerUserId: string | undefined,
    kind: 'approval' | 'done',
    seq: number,
  ): Promise<void> {
    if (this.isWatched(sessionId)) return; // the user is looking at it right now
    const configs = this.resolveConfig(ownerUserId);
    if (!configs.length) return; // no phone registered a grant, nothing to do
    await Promise.all(
      configs.map(async (config) => {
        try {
          const res = await this.egress.fetch(config.sendUrl, 'cloud-api', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ grant: config.grant, sessionId, kind, seq }),
          });
          if (!res.ok) log.info('push-send non-ok', { status: res.status, kind });
          await res.body?.cancel?.();
        } catch (err) {
          // A push is a courtesy, never load-bearing: the run and its journal
          // are unaffected, and the phone still replays everything on reattach.
          log.info('push-send failed', { err: String(err), kind });
        }
      }),
    );
  }
}
