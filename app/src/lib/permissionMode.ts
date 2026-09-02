// The composer's permission mode: the same four Claude Code offers, and the
// engine enforces them (loop.ts consults the mode before it asks). Default
// asks for writes and shell. Accept edits lets file edits flow and still asks
// for shell. Plan forbids every mutating tool and has the agent propose a
// plan for approval first. Bypass runs everything except cloud spend and the
// always-ask tools without a prompt. Plain chat brains have no tools, so the
// mode is inert there, exactly as the mode picker is in Claude Code.
import type { PermissionMode } from 'os-code/protocol';

export type { PermissionMode } from 'os-code/protocol';

export const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
] as const;

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'acceptEdits';

/** A stored value from before the modes matched Claude Code's ('auto' meant
 *  bypass). Anything unknown falls back to the default. */
export function normalizePermissionMode(value: unknown): PermissionMode {
  if (value === 'auto') return 'bypassPermissions';
  return (PERMISSION_MODES as readonly string[]).includes(String(value))
    ? (value as PermissionMode)
    : DEFAULT_PERMISSION_MODE;
}

export function permissionModeLabel(m: PermissionMode): string {
  switch (m) {
    case 'default':
      return 'Default';
    case 'acceptEdits':
      return 'Accept edits';
    case 'plan':
      return 'Plan';
    case 'bypassPermissions':
      return 'Bypass';
  }
}

export function permissionModeDescription(m: PermissionMode): string {
  switch (m) {
    case 'default':
      return 'Asks before every edit and command';
    case 'acceptEdits':
      return 'File edits flow, commands still ask';
    case 'plan':
      return 'Read only. Proposes a plan you approve first';
    case 'bypassPermissions':
      return 'Runs everything without asking. Cloud spend still asks';
  }
}

/** The next mode when the person cycles with Shift+Tab, Claude Code's order. */
export function nextPermissionMode(m: PermissionMode): PermissionMode {
  const i = PERMISSION_MODES.indexOf(m);
  return PERMISSION_MODES[(i + 1) % PERMISSION_MODES.length]!;
}

// Client-side auto-approval, for the brains that run their tools in the app
// (the stack driver) rather than in the engine. The engine-backed drivers
// decide in the loop and never reach here. Cloud spend always asks.
export function autoApproves(mode: PermissionMode, toolName: string, kind: string): boolean {
  if (kind !== 'tool') return false;
  if (mode === 'bypassPermissions') return true;
  if (mode === 'acceptEdits') return /edit|write|apply|create|patch/i.test(toolName);
  return false; // default and plan: nothing is auto-approved on the client
}
