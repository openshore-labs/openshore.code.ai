// The one action that trusts a session's folder, shared by every host that can
// take the person's tap: the desktop app over IPC, the daemon for a paired
// phone, and the CLI. It records trust on this machine (config/trust.ts) and
// tells the session, so every client watching it folds the card. The settings
// apply from the next session in this folder: a running session keeps the
// config it started with.
import { loadConfig, trustProjectFolder } from '../../config/load.js';
import type { AgentEvent } from './types.js';

export function trustSessionFolder(driver: {
  cwd: string;
  emit(event: AgentEvent): void;
}): { ok: true; folder: string } | { error: string } {
  try {
    const trust = trustProjectFolder(driver.cwd);
    driver.emit({ type: 'project-trust', state: 'trusted', folder: trust.folder, waiting: [] });
    return { ok: true, folder: trust.folder };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * What trusting this folder turns on, one plain phrase each, the same phrases
 * the trust card lists ("uses its own check command"). Read from the folder
 * as it stands now, since trust vouches for the file as it is at the tap. The
 * desktop's native trust dialog shows these (CX cleanup 2): it is the one
 * check the page cannot fake, so it says what trusting does. An unreadable
 * config gives an empty list; trusting it then fails on its own.
 */
export function waitingSettings(cwd: string): string[] {
  try {
    return loadConfig(cwd).projectTrust.waiting;
  } catch {
    return [];
  }
}
