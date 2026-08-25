// The composer's permission mode, the same three Claude Code offers. It governs
// how tool approvals are handled for the coding agent (the desktop repo
// session): Auto lets the agent decide, Accept edits auto-approves file edits,
// Plan reviews every step. Plain chat brains have no tools, so the mode is inert
// there, exactly as the mode picker is in Claude Code.
export type PermissionMode = 'auto' | 'acceptEdits' | 'plan';

export const PERMISSION_MODES: readonly PermissionMode[] = ['auto', 'acceptEdits', 'plan'] as const;

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'acceptEdits';

export function permissionModeLabel(m: PermissionMode): string {
  return m === 'auto' ? 'Auto' : m === 'acceptEdits' ? 'Accept edits' : 'Plan';
}

export function permissionModeDescription(m: PermissionMode): string {
  switch (m) {
    case 'auto':
      return 'The agent handles permission decisions';
    case 'acceptEdits':
      return 'Automatically accept all file edits';
    case 'plan':
      return 'Review every step before it runs';
  }
}

// Does this mode auto-approve the given tool approval? Cloud spend always asks,
// mode or not, so money is never spent without a tap.
export function autoApproves(mode: PermissionMode, toolName: string, kind: string): boolean {
  if (kind !== 'tool') return false;
  if (mode === 'auto') return true;
  if (mode === 'acceptEdits') return /edit|write|apply|create|patch/i.test(toolName);
  return false; // plan: nothing is auto-approved
}
