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
 *  ever mistakes the hub for the laptop in front of them. */
export function terminalTargetLabel(opts: {
  desktopLocal: boolean;
  daemon?: { baseUrl: string };
}): string {
  if (opts.desktopLocal) return 'This computer';
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
