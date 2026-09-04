// Codemagic Access: the master switch that decides whether the active model may
// drive Codemagic on its own, the way Terminal Control decides the shell. Off by
// default. Turning it on is the person's consent to let the model trigger and
// read builds with their Codemagic token, so it can chase a failing build to a
// green one and report where it landed (TestFlight, App Store, Google Play).
//
// Modeled on terminalControl.ts, with one deliberate difference: this is a
// single device-local boolean, not a per-target map. A shell command runs on a
// specific machine, so Terminal Control is keyed per target. Codemagic is one
// cloud account reached by one BYO token that lives in this device's Keychain,
// and that token only ever executes where it already is: the in-process local
// engine (the same device) or the phone's own client-brain loop. It is never
// shipped to a remote hub (the same stance projectSecrets take), so there is no
// second host for an On state to leak onto. See DECISIONS.md (2026-09-04).
//
// These are pure helpers on purpose. The store's approval handler, the phone
// loop, and the settings row all read the same rules from here, and the tests
// pin them without standing up the store. No em dashes anywhere.
import type { ApprovalRequest } from 'os-code/protocol';
import type { ApprovalDecision } from './terminalControl.js';

/** The one tool name Codemagic Access governs. Both the engine tool and the
 *  phone loop present a single 'codemagic' tool, so the gate keys on one name
 *  the way Terminal Control keys on 'runShell'. */
export const CODEMAGIC_TOOL = 'codemagic';

/** Whether Codemagic Access is On. Missing means Off, so a fresh install reads
 *  as Off, the opt-in default. */
export function codemagicAccessOn(access: boolean | undefined): boolean {
  return access === true;
}

/** Whether an approval is the coding agent asking to drive Codemagic. */
export function isCodemagicApproval(req: Pick<ApprovalRequest, 'kind' | 'toolName'>): boolean {
  return req.kind === 'tool' && req.toolName === CODEMAGIC_TOOL;
}

/** Whether this person may grant autonomous Codemagic on this device at all. A
 *  personal account owns its own token. In a commercial org only an admin may,
 *  matching Terminal Control and the daemon, which keep account-wide actions
 *  admin only and refuse members. */
export function canControlCodemagic(
  account: { type?: string } | undefined,
  isAdmin: boolean,
): boolean {
  if (account?.type === 'commercial') return isAdmin;
  return true;
}

/** The single decision the phone loop and the store's approval handler ask:
 *  should this Codemagic action run because Access is On for a person allowed to
 *  control it. Anything that is not a permitted, switched-on Codemagic call is
 *  not ours to auto-run. */
export function shouldRunCodemagic(
  req: Pick<ApprovalRequest, 'kind' | 'toolName'>,
  opts: { access: boolean | undefined; canControl: boolean },
): boolean {
  if (!opts.canControl) return false;
  if (!isCodemagicApproval(req)) return false;
  return codemagicAccessOn(opts.access);
}

/** The reason handed back to the model when it tries to drive Codemagic while
 *  Access is Off, so it directs the person to the switch instead of retrying. */
export function codemagicAccessDenyReason(opts: { canControl: boolean }): string {
  if (!opts.canControl) {
    return 'Codemagic Access is off, and only an organization admin can turn it on. Do not drive Codemagic builds. Tell the person to ask an admin to enable Codemagic Access, or walk them through the build themselves.';
  }
  return 'Codemagic Access is off, so you cannot trigger or read Codemagic builds. Do not retry. Tell the person to turn on Codemagic Access in Settings to let you launch and fix builds here, or walk them through the build yourself.';
}

/** What the store should do with a Codemagic approval request, as one pure
 *  function so the whole gate is pinned by tests rather than living in the event
 *  handler. Returns undefined when the request is not a Codemagic call, so the
 *  caller falls through to Terminal Control / the permission mode untouched. */
export function decideCodemagicApproval(
  req: Pick<ApprovalRequest, 'kind' | 'toolName'>,
  ctx: { access: boolean | undefined; canControl: boolean },
): ApprovalDecision | undefined {
  if (!isCodemagicApproval(req)) return undefined;
  if (shouldRunCodemagic(req, ctx)) return { action: 'auto-approve' };
  return { action: 'auto-deny', reason: codemagicAccessDenyReason({ canControl: ctx.canControl }) };
}
