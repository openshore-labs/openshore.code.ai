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
}

export const PROFILES: Record<SecurityProfileName, SecurityProfile> = {
  'local-interactive': {
    name: 'local-interactive',
    allowSessionAutoApprove: true,
    allowShellAutoApprove: true,
    maxStepsCeiling: 100,
    allowCloudAutoApprove: true,
  },
  'remote-attached': {
    name: 'remote-attached',
    allowSessionAutoApprove: true,
    allowShellAutoApprove: false,
    maxStepsCeiling: 60,
    allowCloudAutoApprove: false,
  },
  headless: {
    name: 'headless',
    allowSessionAutoApprove: false,
    allowShellAutoApprove: false,
    maxStepsCeiling: 40,
    allowCloudAutoApprove: false,
  },
};

export function profileFor(name: SecurityProfileName): SecurityProfile {
  return PROFILES[name];
}
