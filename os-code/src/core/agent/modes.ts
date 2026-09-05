// The permission mode a session may actually run in. The remote and headless
// profiles promise that shell never auto-runs, and bypassPermissions would
// break that promise, so it is downgraded to acceptEdits, announced, never
// silent (ENG-1). One helper, so the daemon's POST /sessions and the loop's
// setMode land on the same answer.
import type { SecurityProfile } from '../security/profiles.js';
import type { PermissionMode } from './types.js';

export interface EffectiveMode {
  mode: PermissionMode;
  /** Present when the request was downgraded; shown to the person as a note. */
  note?: string;
}

export function effectiveMode(profile: SecurityProfile, requested: PermissionMode): EffectiveMode {
  if (requested !== 'bypassPermissions' || profile.allowShellAutoApprove) {
    return { mode: requested };
  }
  const where = profile.name === 'headless' ? 'a headless session' : 'a phone-attached session';
  return {
    mode: 'acceptEdits',
    note: `Bypass permissions is not available on ${where}: shell commands always ask here. Using Accept edits instead.`,
  };
}
