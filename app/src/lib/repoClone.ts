// Cloning a repository onto the computer the agent works on, from anywhere in
// the app: this desktop's own engine, or the paired computer over the tailnet
// (the same choice sessions make, so a clone lands where the chat will run).
//
// A private repository needs a credential. The platform the person connected
// in Repositories holds one, so its token rides with the clone: only for an
// https address on that platform's own host (a token is never sent anywhere
// else), used for the one clone as a header, never stored on the computer or
// written into the clone (os-code git/index.ts). Before this, the Repositories
// screen said private repositories used the connected platform, and nothing
// actually passed it.
import { bridge } from './electronBridge.js';
import { isDesktop } from './platform.js';
import { platformForCloneUrl } from './chatRepos.js';
import { repoToken } from './gitos/repoOAuth.js';
import { PlainError } from './plainError.js';
import { daemonCloneRepo, type DaemonTarget } from '../drivers/remoteDriver.js';

export interface CloneTargetSettings {
  daemon?: DaemonTarget;
  preferRemoteHub?: boolean;
}

/** Where a clone (and a session) runs: this desktop's engine unless the
 *  person pointed it at a remote hub, else the paired computer, else nowhere. */
export function computerFor(settings: CloneTargetSettings): 'local' | 'paired' | undefined {
  if (isDesktop() && bridge() && !settings.preferRemoteHub) return 'local';
  if (settings.daemon) return 'paired';
  return undefined;
}

/** The connected token that authorizes cloning this address, if any. */
export async function cloneTokenFor(url: string): Promise<string | undefined> {
  const platform = platformForCloneUrl(url);
  return platform ? repoToken(platform) : undefined;
}

/** Clone onto the computer and return the folder. Throws a plain sentence
 *  when no computer is connected; the engine's own error otherwise (run it
 *  through plainError for a toast). */
export async function cloneOnComputer(
  url: string,
  settings: CloneTargetSettings,
): Promise<{ cwd: string; name: string }> {
  const where = computerFor(settings);
  if (!where) throw new PlainError('Connect your computer first; repositories live there.');
  const token = await cloneTokenFor(url);
  if (where === 'local') {
    const r = await bridge()!.cloneRepo(url, token);
    if ('error' in r) throw new Error(r.error);
    return r;
  }
  return daemonCloneRepo(settings.daemon!, url, token);
}
