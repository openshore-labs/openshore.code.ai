// The save target is fixed when the save is scheduled (0.7, ui-24,
// orgvault-16). The Vault screen's debounce lives in lib/vaultAutosave.ts, so
// the capture itself is under test here, not only the store honouring `at`
// (vaultStore.test.ts). A scope flip or a sign-out inside the 600 ms window
// changes where a NEW save would go; the text already typed still goes to the
// vault, and the account, it was typed under, where the store decides what
// that account's text may do (a signed-out account's team text is never sent,
// and never shown to the next one).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vaultAutosave, VAULT_AUTOSAVE_MS } from '../src/lib/vaultAutosave.js';

type Ref = { providerId: string; resourceId: string; owner?: string };
const team: Ref = { providerId: 'org', resourceId: 'org_1', owner: 'user_a' };
const personal: Ref = { providerId: 'local', resourceId: 'vault.personal' };

function harness(start: Ref | undefined) {
  let target = start;
  const saves: Array<{ path: string; text: string; at: Ref | undefined }> = [];
  const autosave = vaultAutosave<Ref>({
    target: () => target,
    save: (path, text, at) => saves.push({ path, text, at }),
  });
  return { autosave, saves, retarget: (t: Ref | undefined) => (target = t) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('vaultAutosave', () => {
  it('waits out the debounce, then saves the latest text once', () => {
    const { autosave, saves } = harness(personal);
    autosave.schedule('a.md', 'd');
    autosave.schedule('a.md', 'dr');
    autosave.schedule('a.md', 'draft');
    vi.advanceTimersByTime(VAULT_AUTOSAVE_MS - 1);
    expect(saves).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(saves).toEqual([{ path: 'a.md', text: 'draft', at: personal }]);
  });

  it('a scope flip mid-debounce writes the text to the vault it was typed into', () => {
    const { autosave, saves, retarget } = harness(team);
    autosave.schedule('Plan.md', 'team words');
    retarget(personal);
    vi.advanceTimersByTime(VAULT_AUTOSAVE_MS);
    expect(saves).toEqual([{ path: 'Plan.md', text: 'team words', at: team }]);
  });

  it('a sign-out mid-debounce still names the account that typed it, never the personal vault', () => {
    const { autosave, saves, retarget } = harness(team);
    autosave.schedule('Plan.md', 'team words');
    // forgetSession: the scope falls back to personal and nobody is signed in.
    retarget(personal);
    autosave.flush();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.at).toEqual(team);
    expect(saves[0]!.at?.owner).toBe('user_a');
    // Nothing is left to fire later.
    vi.advanceTimersByTime(VAULT_AUTOSAVE_MS * 2);
    expect(saves).toHaveLength(1);
  });

  it('flush writes now to the captured target; a second flush has nothing to send', () => {
    const { autosave, saves } = harness(personal);
    autosave.schedule('a.md', 'x');
    autosave.flush();
    autosave.flush();
    vi.advanceTimersByTime(VAULT_AUTOSAVE_MS);
    expect(saves).toEqual([{ path: 'a.md', text: 'x', at: personal }]);
  });

  it('cancel drops the pending text (a delete of the note it belongs to)', () => {
    const { autosave, saves } = harness(personal);
    autosave.schedule('a.md', 'x');
    autosave.cancel();
    vi.advanceTimersByTime(VAULT_AUTOSAVE_MS);
    autosave.flush();
    expect(saves).toEqual([]);
  });

  it('a save scheduled for another note or another vault sends the pending one first', () => {
    const { autosave, saves, retarget } = harness(team);
    autosave.schedule('a.md', 'team a');
    retarget(personal);
    autosave.schedule('a.md', 'personal a');
    expect(saves).toEqual([{ path: 'a.md', text: 'team a', at: team }]);
    autosave.schedule('b.md', 'personal b');
    expect(saves[1]).toEqual({ path: 'a.md', text: 'personal a', at: personal });
    vi.advanceTimersByTime(VAULT_AUTOSAVE_MS);
    expect(saves[2]).toEqual({ path: 'b.md', text: 'personal b', at: personal });
    expect(saves).toHaveLength(3);
  });

  it('another account on the same team vault is another target', () => {
    const { autosave, saves, retarget } = harness(team);
    autosave.schedule('a.md', 'from a');
    retarget({ ...team, owner: 'user_b' });
    autosave.schedule('a.md', 'from b');
    expect(saves).toEqual([{ path: 'a.md', text: 'from a', at: team }]);
  });
});
