// What the team vault refuses before any server call (UX review Y14, Y15; 0025's
// OV402 and OV403). The room leaves out every control the server would
// refuse (VaultScreen's newNoteOffered and todayOffered, and the caps); this
// is the store's own answer for what can still be tapped when the plan
// changes under it (an Undo toast still up, a Trash page or a resolve sheet
// already open) and for any other caller, so each says the plan's line
// instead of asking the server and showing a generic failure. The store only
// wires it in. Test: app/test/vaultTeamGate.test.ts.
import type { OrgVaultPlan } from '../lib/gitos/orgVault.js';
import {
  VAULT_TEAM_DELETE_REFUSED,
  VAULT_TEAM_FULL_NOT_CREATED,
  VAULT_TEAM_FULL_NOT_RESTORED,
  VAULT_TEAM_LAPSED_NOT_CREATED,
  VAULT_TEAM_LAPSED_NOT_DELETED,
  VAULT_TEAM_LAPSED_NOT_RESTORED,
  VAULT_TEAM_LAPSED_NOT_SAVED_LINE,
} from '../lib/vaultCopy.js';

/** The kind of write the store is about to make to a vault. */
export type VaultTeamWrite = 'create' | 'save' | 'restore' | 'delete';

const LAPSED: Record<VaultTeamWrite, string> = {
  create: VAULT_TEAM_LAPSED_NOT_CREATED,
  save: VAULT_TEAM_LAPSED_NOT_SAVED_LINE,
  restore: VAULT_TEAM_LAPSED_NOT_RESTORED,
  delete: VAULT_TEAM_LAPSED_NOT_DELETED,
};

/** The whole line a write to this vault is refused with now, or undefined
 *  when the server would take it as far as the plan says. Only the team vault
 *  has a plan, and before its first read (undefined) nothing is refused here;
 *  the server's own OV402 or OV403 still says it then. A lapsed plan takes no
 *  write at all; admins-only takes no delete from a member (a restore or a
 *  move is not a delete, 0025 section 5). */
export function vaultTeamRefusal(
  providerId: string,
  plan: OrgVaultPlan | undefined,
  write: VaultTeamWrite,
): string | undefined {
  if (providerId !== 'org' || !plan) return undefined;
  if (plan.entitled === false) return LAPSED[write];
  if (write === 'delete' && plan.deleteRole === 'admin' && plan.isAdmin === false) {
    return VAULT_TEAM_DELETE_REFUSED;
  }
  // The free space is used up (0023, learned from a refusal, E27): a new
  // note and a note brought back add text, so they are refused here. A save
  // may only trim, so the store judges it by its size.
  if (plan.full && write === 'create') return VAULT_TEAM_FULL_NOT_CREATED;
  if (plan.full && write === 'restore') return VAULT_TEAM_FULL_NOT_RESTORED;
  return undefined;
}
