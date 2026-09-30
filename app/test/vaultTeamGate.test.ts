// What the team vault refuses before any server call (CX Y14, Y15; 0025's
// OV402 and OV403): one answer the store asks before every write it can
// still be handed after the room left the control out (an Undo toast up, a
// Trash page or a resolve sheet already open when the plan lapsed).
import { describe, expect, it } from 'vitest';
import { vaultTeamRefusal, type VaultTeamWrite } from '../src/state/vaultTeamGate.js';
import {
  VAULT_TEAM_DELETE_REFUSED,
  VAULT_TEAM_LAPSED_NOT_CREATED,
  VAULT_TEAM_LAPSED_NOT_DELETED,
  VAULT_TEAM_LAPSED_NOT_RESTORED,
  VAULT_TEAM_LAPSED_NOT_SAVED,
  VAULT_TEAM_LAPSED_NOT_SAVED_LINE,
} from '../src/lib/vaultCopy.js';

const WRITES: VaultTeamWrite[] = ['create', 'save', 'restore', 'delete'];
const active = { entitled: true, isAdmin: false, deleteRole: 'member' as const };
const lapsed = { ...active, entitled: false };

describe('vaultTeamRefusal', () => {
  it('a lapsed plan refuses every write, each in its own words', () => {
    expect(WRITES.map((w) => vaultTeamRefusal('org', lapsed, w))).toEqual([
      VAULT_TEAM_LAPSED_NOT_CREATED,
      VAULT_TEAM_LAPSED_NOT_SAVED_LINE,
      VAULT_TEAM_LAPSED_NOT_RESTORED,
      VAULT_TEAM_LAPSED_NOT_DELETED,
    ]);
    // Each says the plan's reason, never a generic failure.
    for (const w of WRITES) {
      expect(vaultTeamRefusal('org', lapsed, w)).toContain(VAULT_TEAM_LAPSED_NOT_SAVED);
    }
    // Lapsed wins over the delete rule: the plan is the reason then.
    expect(
      vaultTeamRefusal('org', { ...lapsed, deleteRole: 'admin', isAdmin: false }, 'delete'),
    ).toBe(VAULT_TEAM_LAPSED_NOT_DELETED);
  });

  it("admins-only refuses a member's delete and nothing else", () => {
    const member = { ...active, deleteRole: 'admin' as const, isAdmin: false };
    expect(vaultTeamRefusal('org', member, 'delete')).toBe(VAULT_TEAM_DELETE_REFUSED);
    for (const w of ['create', 'save', 'restore'] as const) {
      expect(vaultTeamRefusal('org', member, w)).toBeUndefined();
    }
    // An admin deletes; under member delete, everyone does.
    expect(vaultTeamRefusal('org', { ...member, isAdmin: true }, 'delete')).toBeUndefined();
    expect(vaultTeamRefusal('org', active, 'delete')).toBeUndefined();
  });

  it('an active plan, a plan not read yet, and every other storage refuse nothing', () => {
    for (const w of WRITES) {
      expect(vaultTeamRefusal('org', active, w)).toBeUndefined();
      expect(vaultTeamRefusal('org', undefined, w)).toBeUndefined();
      for (const id of ['local', 'files', 'hub', 'icloud', 'gdrive']) {
        expect(vaultTeamRefusal(id, lapsed, w)).toBeUndefined();
      }
    }
  });
});
