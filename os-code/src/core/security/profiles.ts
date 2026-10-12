// Security profiles. The phone/headless profile is strictly MORE restrictive
// than sitting at the desk, never less: a remote attach must not inherit an
// auto-approve the user set while local and interactive.

export type SecurityProfileName = 'local-interactive' | 'remote-attached' | 'headless';

export interface SecurityProfile {
  name: SecurityProfileName;
  /** May the user grant a session-wide "always allow" for a tool? */
  allowSessionAutoApprove: boolean;
  /** May runShell ever run without a per-command approval? */
  allowShellAutoApprove: boolean;
  /** Hard cap on agent steps per task, regardless of config. */
  maxStepsCeiling: number;
  /** May a cloud-spend step be pre-approved for the whole session? */
  allowCloudAutoApprove: boolean;
  /** May a push (a commit leaving the machine) ever run without asking? Off
   *  on the headless profile: an unattended routine never pushes silently. */
  allowPushAutoApprove: boolean;
  /** May a network step (web search, a page fetch, another agent's service)
   *  run at all without a person to ask? Off on the headless profile, where a
   *  network call is denied outright, never asked: a routine reads files
   *  other people wrote, and one injected line could send a secret out in a
   *  URL or a search while nobody watches (tech review 3, headless means offline). */
  allowNetworkAutoApprove: boolean;
}

export const PROFILES: Record<SecurityProfileName, SecurityProfile> = {
  'local-interactive': {
    name: 'local-interactive',
    allowSessionAutoApprove: true,
    allowShellAutoApprove: true,
    maxStepsCeiling: 100,
    allowCloudAutoApprove: true,
    allowPushAutoApprove: true,
    allowNetworkAutoApprove: true,
  },
  'remote-attached': {
    name: 'remote-attached',
    allowSessionAutoApprove: true,
    allowShellAutoApprove: false,
    maxStepsCeiling: 60,
    allowCloudAutoApprove: false,
    allowPushAutoApprove: true,
    allowNetworkAutoApprove: true,
  },
  headless: {
    name: 'headless',
    allowSessionAutoApprove: false,
    allowShellAutoApprove: false,
    maxStepsCeiling: 40,
    allowCloudAutoApprove: false,
    allowPushAutoApprove: false,
    allowNetworkAutoApprove: false,
  },
};

export function profileFor(name: SecurityProfileName): SecurityProfile {
  return PROFILES[name];
}
