// Terminal Control: the master switch that decides whether the active model may
// run shell commands on a machine on its own, or whether the person keeps per
// command control. Off by default, and scoped per target so an On state at your
// own desk never follows a session onto a shared hub (the incident the CTO
// flagged: state that travels across hosts).
//
// These are pure helpers on purpose. The store's approval handler, the Terminal
// room, and the settings row all read the same rules from here, and the tests
// pin them without standing up the store. No em dashes anywhere.
import type { ApprovalRequest } from 'os-code/protocol';
import { autoApproves, type PermissionMode } from './permissionMode.js';

/** The id used for the machine this desktop app runs on itself (its local
 *  engine). A phone or a second desktop attaching over the tailnet keys off the
 *  hub's base URL instead, so the two never share an On state. */
export const LOCAL_TARGET = 'local';

/** The one shell tool the coding agent runs. Terminal Control governs only this
 *  tool: file edits stay under the permission mode, and cloud spend always asks,
 *  both left untouched. */
export const SHELL_TOOL = 'runShell';

/** Where the active session runs, as a stable id. The local engine is a fixed
 *  key; a remote hub is its own base URL. Undefined when nothing is reachable
 *  (no local engine and no paired hub), which means there is no target to
 *  control and the switch stays inert. */
export function terminalTargetId(opts: {
  desktopLocal: boolean;
  daemon?: { baseUrl: string };
}): string | undefined {
  if (opts.desktopLocal) return LOCAL_TARGET;
  return opts.daemon?.baseUrl;
}

/** A plain name for the target, shown wherever the switch is armed so no one
 *  ever mistakes the hub for the laptop in front of them. Prefers the hub's
 *  saved name, then its tailnet host. */
export function terminalTargetLabel(opts: {
  desktopLocal: boolean;
  daemon?: { baseUrl: string; name?: string };
}): string {
  if (opts.desktopLocal) return 'This computer';
  const name = opts.daemon?.name?.trim();
  if (name) return name;
  const url = opts.daemon?.baseUrl;
  if (!url) return 'your hub';
  try {
    return new URL(url).hostname;
  } catch {
    return 'your hub';
  }
}

/** Whether Terminal Control is On for a given target. Missing means Off, so a
 *  fresh install and an unlisted target both read as Off. */
export function terminalControlOn(
  map: Record<string, boolean> | undefined,
  targetId: string | undefined,
): boolean {
  if (!targetId) return false;
  return map?.[targetId] === true;
}

/** Whether an approval is the coding agent asking to run a shell command. */
export function isShellApproval(req: Pick<ApprovalRequest, 'kind' | 'toolName'>): boolean {
  return req.kind === 'tool' && req.toolName === SHELL_TOOL;
}

/** Whether this person may grant autonomous shell on this machine at all. A
 *  personal account owns its own box. In a commercial org only an admin may,
 *  matching the daemon, which keeps the raw shell admin only and refuses
 *  members. */
export function canControlTerminal(
  account: { type?: string } | undefined,
  isAdmin: boolean,
): boolean {
  if (account?.type === 'commercial') return isAdmin;
  return true;
}

/** The single decision the store's approval handler asks: should this shell
 *  approval be auto approved because Terminal Control is On for a target this
 *  person is allowed to control. Anything that is not a permitted, switched on
 *  shell call falls through to the existing permission mode rules untouched. */
export function shouldAutoRunShell(
  req: Pick<ApprovalRequest, 'kind' | 'toolName'>,
  opts: {
    targetId: string | undefined;
    control: Record<string, boolean> | undefined;
    canControl: boolean;
  },
): boolean {
  if (!opts.canControl) return false;
  if (!isShellApproval(req)) return false;
  return terminalControlOn(opts.control, opts.targetId);
}

/** The reason handed back to the model when it tries to run a shell command
 *  while Terminal Control is Off, so it directs the person to the switch
 *  instead of retrying. Off keeps the model and the terminal fully separate:
 *  the person works the terminal themselves until they let the model in. */
export function terminalControlDenyReason(opts: { label: string; canControl: boolean }): string {
  if (!opts.canControl) {
    return `Terminal Control is off for ${opts.label}, and only an organization admin can turn it on. Do not run terminal commands. Tell the person to ask an admin to enable Terminal Control, or give them the exact command to run themselves and use what they paste back.`;
  }
  return `Terminal Control is off, so you cannot run terminal commands on ${opts.label}. Do not retry. Tell the person to turn on Terminal Control in Settings (or the Terminal room) to let you run commands here, or give them the exact command to run themselves and use what they paste back.`;
}

/** What the store should do with an approval request, as one pure function so
 *  the WHOLE assembly is pinned by tests rather than living in the event
 *  handler. 'sheet' means show the approval sheet and let the person decide,
 *  never client-auto-approve. This is deliberately exhaustive so a desktop
 *  non-shell tool (e.g. an always-ask vaultWrite) can never be auto-approved by
 *  the client: an engine session already decided to ask, so the sheet stands. */
export type ApprovalDecision =
  { action: 'auto-approve' } | { action: 'auto-deny'; reason: string } | { action: 'sheet' };

export function decideApproval(
  req: Pick<ApprovalRequest, 'kind' | 'toolName'>,
  ctx: {
    driverKind: string;
    desktopLocal: boolean;
    daemon?: { baseUrl: string; name?: string };
    control: Record<string, boolean> | undefined;
    canControl: boolean;
    mode: PermissionMode;
  },
): ApprovalDecision {
  // A shell call on a desktop-backed session is Terminal Control's to decide.
  if (ctx.driverKind === 'desktop' && isShellApproval(req)) {
    const targetId = terminalTargetId({ desktopLocal: ctx.desktopLocal, daemon: ctx.daemon });
    if (shouldAutoRunShell(req, { targetId, control: ctx.control, canControl: ctx.canControl })) {
      return { action: 'auto-approve' };
    }
    const label = terminalTargetLabel({ desktopLocal: ctx.desktopLocal, daemon: ctx.daemon });
    return {
      action: 'auto-deny',
      reason: terminalControlDenyReason({ label, canControl: ctx.canControl }),
    };
  }
  // A client-brain tool runs in the app, so the permission mode auto-answers the
  // class it covers, exactly as before Terminal Control existed.
  if (ctx.driverKind !== 'desktop') {
    return autoApproves(ctx.mode, req.toolName, req.kind)
      ? { action: 'auto-approve' }
      : { action: 'sheet' };
  }
  // A desktop non-shell ask (cloud spend, an always-ask tool like vaultWrite):
  // the engine already chose to ask, so the sheet always shows. The client
  // never auto-approves an engine session's non-shell tool.
  return { action: 'sheet' };
}
