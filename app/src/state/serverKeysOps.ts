// Keys on your server (founder, 2026-10-09), the store's half: what turning a
// key on or off for a docked server sends, and what disconnecting a provider
// and forgetting or re-pairing a server do to the keys a server keeps. Plain
// functions over the daemon wire (drivers/remoteDriver.ts); the store wires
// the lifecycle into disconnectProvider, removeHub and saveHub, and Cloud
// Connections calls the rest. Every step is best effort: a server that does
// not answer is said plainly, never waited on forever, and the person is told
// how to remove a key over SSH instead. Test: app/test/serverKeys.test.tsx.
import {
  daemonDeleteAllKeys,
  daemonDeleteKey,
  daemonForgetSelf,
  daemonListKeys,
  daemonPutKey,
  keysNotOffered,
  type DaemonTarget,
} from '../drivers/remoteDriver.js';
import { secretGet } from '../lib/platform.js';
import { providerSecretKey, type ProviderInfo } from '../lib/providers.js';
import { serverPutBody } from '../lib/serverKeys.js';
import type { DaemonProviderKey } from 'os-code/protocol';
import type { HubRole } from '../drivers/types.js';

/** The docked servers among the saved hubs whose keys this device may
 *  change. Only a server keeps keys (the desktop app takes its keys from its
 *  own app and has no key routes), and a member device changes none there. */
export function dockedServers(
  hubs: readonly DaemonTarget[],
  roles: Readonly<Record<string, HubRole>> = {},
): DaemonTarget[] {
  return hubs.filter((h) => h.kind === 'server' && roles[h.baseUrl] !== 'member');
}

/** Send this device's key for a provider to a server, once. The key is read
 *  from this device's secret store at the moment it goes, and Claude's goes
 *  with the workspace id it acts in. Throws the server's own words (or
 *  "not on this device" when the key has gone from here). */
export async function putKeyOnServer(
  target: DaemonTarget,
  provider: Pick<ProviderInfo, 'id' | 'name' | 'openaiBaseUrl'>,
  workspaceId?: string,
): Promise<DaemonProviderKey> {
  const key = (await secretGet(providerSecretKey(provider.id)))?.trim();
  if (!key) {
    throw new Error(`The ${provider.name} key is not on this device any more. Connect it again.`);
  }
  return daemonPutKey(target, provider.id, serverPutBody(provider, key, workspaceId));
}

export interface KeyRemoval {
  /** The servers its key was removed from. */
  removedFrom: DaemonTarget[];
  /** The servers that did not answer, or would not remove it, and so may
   *  still keep it. */
  notRemoved: DaemonTarget[];
}

/** Remove one provider's key from every docked server that keeps it. Each
 *  server is asked first (a list spends none of its key writes), and one
 *  that keeps no such key, or offers no keys to this device (a member, an
 *  older server), is left alone. */
export async function removeKeyFromServers(
  servers: readonly DaemonTarget[],
  providerId: string,
): Promise<KeyRemoval> {
  const outcomes = await Promise.all(
    servers.map(async (server): Promise<'removed' | 'none' | 'failed'> => {
      try {
        const keys = await daemonListKeys(server);
        if (!keys.some((k) => k.id === providerId)) return 'none';
        await daemonDeleteKey(server, providerId);
        return 'removed';
      } catch (err) {
        return keysNotOffered(err) ? 'none' : 'failed';
      }
    }),
  );
  return {
    removedFrom: servers.filter((_, i) => outcomes[i] === 'removed'),
    notRemoved: servers.filter((_, i) => outcomes[i] === 'failed'),
  };
}

/** What forgetting a hub did to the keys it keeps: nothing to do (a
 *  computer, or a server that offers this device no keys), every key
 *  deleted, or the server could not be reached, so any key it keeps stays
 *  there until it is removed over SSH. */
export type HubKeysCleared =
  { kind: 'none' } | { kind: 'cleared'; removed: string[] } | { kind: 'failed' };

/** Delete every provider key a server keeps, with this device's credential,
 *  while that credential still works. A computer is never asked, nor a
 *  server this device is a member of. */
export async function clearServerKeys(
  target: DaemonTarget,
  role?: HubRole,
): Promise<HubKeysCleared> {
  if (dockedServers([target], role ? { [target.baseUrl]: role } : {}).length === 0) {
    return { kind: 'none' };
  }
  if (!target.token) return { kind: 'none' };
  try {
    const gone = await daemonDeleteAllKeys(target);
    return { kind: 'cleared', removed: gone.removed };
  } catch (err) {
    return keysNotOffered(err) ? { kind: 'none' } : { kind: 'failed' };
  }
}

/** This device leaving a hub: the keys there go first, then this device's
 *  credential is revoked (best effort, as it always was), so the device is
 *  never left unable to delete the keys it put there. */
export async function leaveHub(target: DaemonTarget, role?: HubRole): Promise<HubKeysCleared> {
  const cleared = await clearServerKeys(target, role);
  if (target.token) void daemonForgetSelf(target);
  return cleared;
}
