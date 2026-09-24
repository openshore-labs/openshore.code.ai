// Delete my account and Download my data (compliance pass two, part A;
// DECISIONS.md 2026-09-24, "Account deletion ships with Download my data").
//
// The server does the work: export_my_data (migration 0019) returns every row
// it holds for the caller, and the delete-account edge function settles owned
// teams, billing, legal holds, and the account itself. What lives here is the
// app's half: reading the function's answer, the confirm sheet's state as a
// pure reducer (so the flow is tested without a screen), and saving the export
// the way each platform saves a file.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { invokeFunction, invokeFunctionRaw, rpc, select, type Session } from './supabase.js';
import { AuthExpiredError, freshSession } from './authSession.js';
import { openExternal, platform } from './platform.js';

// ------------------------------------------------------------ the answer

/** A team the person owns that has other people in it, as the 409 names it. */
export interface TeamChoice {
  id: string;
  name: string;
  /** Other active members. */
  members: number;
  /** Whether the team pays through Stripe (offers "Cancel renewal instead"). */
  paid: boolean;
}

export type DeletionOutcome =
  | { kind: 'deleted' }
  | { kind: 'reauth'; message: string }
  | { kind: 'orgs'; orgs: TeamChoice[] }
  | { kind: 'error'; message: string };

export const REAUTH_MESSAGE = 'For your safety, sign in again, then delete your account.';
const GENERIC_ERROR = 'Could not delete the account. Try again.';

function parseTeams(raw: unknown): TeamChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: TeamChoice[] = [];
  for (const item of raw) {
    const o = item as Partial<Record<keyof TeamChoice, unknown>> | null;
    if (!o || typeof o.id !== 'string' || !o.id) continue;
    out.push({
      id: o.id,
      name: typeof o.name === 'string' && o.name.trim() ? o.name : 'Your team',
      members: typeof o.members === 'number' ? o.members : 0,
      paid: o.paid === true,
    });
  }
  return out;
}

/** Read delete-account's answer. Pure, so every branch is tested. */
export function interpretDeletionResponse(status: number, body: unknown): DeletionOutcome {
  const b = (body ?? {}) as { deleted?: unknown; code?: unknown; error?: unknown; orgs?: unknown };
  if (status >= 200 && status < 300 && b.deleted === true) return { kind: 'deleted' };
  if (status === 401) return { kind: 'reauth', message: REAUTH_MESSAGE };
  if (status === 409 && b.code === 'transfer_or_delete_org') {
    const orgs = parseTeams(b.orgs);
    if (orgs.length > 0) return { kind: 'orgs', orgs };
  }
  const message = typeof b.error === 'string' && b.error.trim() ? b.error : GENERIC_ERROR;
  return { kind: 'error', message };
}

/** Ask the server to delete the signed-in account. `deleteOrgs` names the
 *  teams the person chose to delete with it. A session that can no longer be
 *  refreshed reads as a stale sign-in, since the answer is the same: sign in
 *  again. */
export async function requestAccountDeletion(
  session: Session,
  deleteOrgs: string[] = [],
): Promise<DeletionOutcome> {
  let token: string;
  try {
    token = (await freshSession(session)).accessToken;
  } catch (err) {
    if (err instanceof AuthExpiredError) return { kind: 'reauth', message: REAUTH_MESSAGE };
    return { kind: 'error', message: 'You look offline. Try again when you are connected.' };
  }
  try {
    const res = await invokeFunctionRaw(
      'delete-account',
      token,
      deleteOrgs.length ? { deleteOrgs } : {},
    );
    return interpretDeletionResponse(res.status, res.body);
  } catch {
    return { kind: 'error', message: 'You look offline. Try again when you are connected.' };
  }
}

// ------------------------------------------------------------ the gate

/** The Delete button unlocks only once the person types their account email.
 *  Case and surrounding space are forgiven; anything else is not. */
export function emailMatches(typed: string, accountEmail: string | undefined): boolean {
  if (!accountEmail) return false;
  const t = typed.trim().toLowerCase();
  return t.length > 0 && t === accountEmail.trim().toLowerCase();
}

// ------------------------------------------------------------ the sheet

export type DeletionPhase =
  | 'confirm' // typing the email
  | 'working' // the request is in flight
  | 'reauth' // the sign-in is too old
  | 'orgs' // a team needs a choice
  | 'kept' // the person kept a team, so the account stays
  | 'error' // something failed; the confirm is still there
  | 'done'; // the account is gone

export interface DeletionState {
  phase: DeletionPhase;
  typed: string;
  /** Teams awaiting a choice, from the last 409. */
  orgs: TeamChoice[];
  /** Teams the person chose to delete with the account, sent on resubmit. */
  deleteOrgs: string[];
  /** The team kept, named in the 'kept' message. */
  keptTeam?: string;
  error?: string;
}

export type DeletionAction =
  | { type: 'type'; value: string }
  | { type: 'submit' }
  | { type: 'result'; outcome: DeletionOutcome }
  | { type: 'deleteTeam'; id: string }
  | { type: 'keepTeam'; id: string }
  | { type: 'reset' };

export const initialDeletionState: DeletionState = {
  phase: 'confirm',
  typed: '',
  orgs: [],
  deleteOrgs: [],
};

/** Whether the confirm's Delete button is live. */
export function canSubmitDeletion(state: DeletionState, accountEmail: string | undefined): boolean {
  return (
    (state.phase === 'confirm' || state.phase === 'error') &&
    emailMatches(state.typed, accountEmail)
  );
}

export function deletionReducer(state: DeletionState, action: DeletionAction): DeletionState {
  switch (action.type) {
    case 'type':
      return state.phase === 'working' ? state : { ...state, typed: action.value };
    case 'submit':
      return state.phase === 'working' ? state : { ...state, phase: 'working', error: undefined };
    case 'result': {
      const o = action.outcome;
      if (o.kind === 'deleted') return { ...state, phase: 'done', orgs: [], error: undefined };
      if (o.kind === 'reauth') return { ...state, phase: 'reauth', error: o.message };
      if (o.kind === 'orgs') return { ...state, phase: 'orgs', orgs: o.orgs, error: undefined };
      return { ...state, phase: 'error', error: o.message };
    }
    case 'deleteTeam': {
      if (state.phase !== 'orgs' || !state.orgs.some((o) => o.id === action.id)) return state;
      const deleteOrgs = state.deleteOrgs.includes(action.id)
        ? state.deleteOrgs
        : [...state.deleteOrgs, action.id];
      return { ...state, phase: 'working', deleteOrgs, error: undefined };
    }
    case 'keepTeam': {
      const team = state.orgs.find((o) => o.id === action.id);
      if (state.phase !== 'orgs' || !team) return state;
      return { ...state, phase: 'kept', keptTeam: team.name, deleteOrgs: [] };
    }
    case 'reset':
      return initialDeletionState;
  }
}

// ------------------------------------------------------------ Apple and billing

/** Whether the account holds an Apple subscription, which a server cannot
 *  cancel. Read from the server's own rows; unknown reads as no. */
export async function hasAppleSubscription(session: Session): Promise<boolean> {
  try {
    const fresh = await freshSession(session);
    const [ents, links] = await Promise.all([
      select<{ source: string }>(
        'user_entitlements',
        fresh.accessToken,
        `select=source&user_id=eq.${fresh.user.id}`,
      ),
      select<{ original_transaction_id: string }>(
        'apple_links',
        fresh.accessToken,
        `select=original_transaction_id&user_id=eq.${fresh.user.id}&limit=1`,
      ),
    ]);
    return ents.some((e) => e.source === 'apple') || links.length > 0;
  } catch {
    return false;
  }
}

/** "Cancel renewal instead": the existing Stripe customer portal for one team,
 *  in the system browser. Kept off iOS by the caller, like every billing path
 *  (Apple 3.1.1). */
export async function openTeamBillingPortal(session: Session, orgId: string): Promise<void> {
  const fresh = await freshSession(session);
  const { url } = await invokeFunction<{ url: string }>('stripe-portal', fresh.accessToken, {
    orgId,
  });
  openExternal(url);
}

// ------------------------------------------------------------ Download my data

/** Every row the server holds for the signed-in account (export_my_data). */
export async function exportMyData(session: Session): Promise<unknown> {
  const fresh = await freshSession(session);
  return rpc<unknown>('export_my_data', fresh.accessToken, {});
}

/** The file name for an export taken at `now`, dated so a second export does
 *  not silently replace the first. */
export function exportFileName(now: Date = new Date()): string {
  return `openshore-account-data-${now.toISOString().slice(0, 10)}.json`;
}

/** Save the export where each platform keeps a file the person can find: the
 *  Files app on iPhone (Documents, the same home the vault export uses), and a
 *  browser download on the desktop and the web. Returns a line for the toast. */
export async function saveExport(data: unknown, now: Date = new Date()): Promise<string> {
  const name = exportFileName(now);
  const text = JSON.stringify(data, null, 2);
  if (platform() === 'ios') {
    await Filesystem.writeFile({
      path: `OpenShore/${name}`,
      data: text,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    return `Saved ${name} to the Files app.`;
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `Downloaded ${name}.`;
}
