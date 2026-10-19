// How you keep notes (2026-10-19): the ways each device offers, which one is
// Here now, what a row does, and that no row claims an Obsidian link or key
// that does not exist.
import { describe, expect, it } from 'vitest';
import {
  VAULT_WAY_CONNECT,
  projectVaultFolder,
  vaultProjectRowSub,
  vaultWaySummary,
  vaultWays,
  type VaultWaysState,
} from '../src/lib/vaultWays.js';
import { MEMORY_FILES } from '../src/lib/projectMemory.js';

const desk = (over: Partial<VaultWaysState> = {}): VaultWaysState => ({
  platform: 'electron',
  provider: 'files',
  defaultFolder: true,
  obsidianVault: false,
  docked: false,
  deviceNoun: 'this computer',
  ...over,
});

const phone = (over: Partial<VaultWaysState> = {}): VaultWaysState => ({
  platform: 'ios',
  provider: 'local',
  docked: false,
  deviceNoun: 'this phone',
  ...over,
});

const ids = (s: VaultWaysState) => vaultWays(s).map((w) => w.id);
const here = (s: VaultWaysState) => vaultWays(s).find((w) => w.here)?.id;
const way = (s: VaultWaysState, id: string) => vaultWays(s).find((w) => w.id === id)!;

describe('on a computer: two ways', () => {
  it("offers OpenShore's own folder (recommended) and an Obsidian vault", () => {
    expect(ids(desk())).toEqual(['openshore', 'obsidian']);
    expect(way(desk(), 'openshore').mark).toBe('recommended');
    expect(way(desk(), 'obsidian').mark).toBeUndefined();
  });

  it('marks where the vault is now', () => {
    expect(here(desk())).toBe('openshore');
    expect(here(desk({ obsidianVault: true, defaultFolder: false }))).toBe('obsidian');
    // OpenShore's folder opened in Obsidian is an Obsidian vault now.
    expect(here(desk({ obsidianVault: true }))).toBe('obsidian');
    // A plain folder the person picked is neither; the summary says so.
    expect(here(desk({ defaultFolder: false }))).toBeUndefined();
    expect(vaultWaySummary(desk({ defaultFolder: false }))).toBe('Kept in a folder you chose.');
    // The sealed store on a computer: neither, and OpenShore's folder moves it.
    expect(here(desk({ provider: 'local' }))).toBeUndefined();
    expect(way(desk({ provider: 'local' }), 'openshore').action).toBe('use-openshore-folder');
  });

  it('chooses a folder for Obsidian, never a key or a sign-in', () => {
    const o = way(desk(), 'obsidian');
    expect(o.action).toBe('choose-folder');
    expect(o.sub).toMatch(/no key/);
    expect(o.sub).toMatch(/the folder is the connection/);
  });
});

describe('on a phone: three ways, the computer first', () => {
  it('lists with your computer (recommended), Obsidian, and only on this phone (not recommended)', () => {
    const ways = vaultWays(phone());
    expect(ways.map((w) => w.id)).toEqual(['computer', 'obsidian', 'device']);
    expect(ways[0]!.mark).toBe('recommended');
    expect(ways[2]!.mark).toBe('not-recommended');
    expect(ways[2]!.title).toBe('Only on this phone');
  });

  it('not docked: notes are only on this phone, and the other two are a door to Computer', () => {
    expect(here(phone())).toBe('device');
    for (const id of ['computer', 'obsidian']) {
      expect(way(phone(), id)).toMatchObject({
        action: 'connect-computer',
        actionLabel: VAULT_WAY_CONNECT,
      });
    }
  });

  it('docked: synced or kept on the computer reads as with your computer', () => {
    expect(here(phone({ docked: true }))).toBe('computer');
    expect(here(phone({ docked: true, provider: 'hub', sync: 'one' }))).toBe('computer');
    expect(here(phone({ docked: true, sync: 'device' }))).toBe('device');
    expect(way(phone({ docked: true, sync: 'device' }), 'computer').action).toBe(
      'keep-with-computer',
    );
    expect(way(phone({ docked: true }), 'device').action).toBe('keep-on-device');
    // Obsidian only explains where to choose it once docked.
    expect(way(phone({ docked: true }), 'obsidian').action).toBe('none');
    expect(way(phone({ docked: true }), 'obsidian').sub).toMatch(/no key to enter/);
  });

  it('names a docked server as your server', () => {
    const s = phone({ docked: true, dockedServer: true });
    expect(way(s, 'computer').title).toBe('With your server');
    expect(vaultWaySummary(s)).toBe('Kept with your server.');
  });

  it('never says always on, and never names a retired word', () => {
    for (const s of [phone(), phone({ docked: true }), desk()]) {
      for (const w of vaultWays(s)) {
        expect(`${w.title} ${w.sub}`).not.toMatch(/always on|\bhub\b|Crew|Marketplace/i);
      }
    }
  });
});

describe('projects in the vault', () => {
  it('keeps each project in Projects/<project>, cleaned like its notes folder', () => {
    expect(projectVaultFolder('My App')).toBe('Projects/My App');
    expect(projectVaultFolder('a/b:c')).toBe('Projects/a b c');
    expect(projectVaultFolder('..')).toBe('Projects/Untitled project');
  });

  it("names the agent's notes on each row", () => {
    const titles = MEMORY_FILES.map((f) => f.title);
    expect(vaultProjectRowSub(titles, true)).toBe(
      'Current State · Progress · Decisions · Action Items · Skills',
    );
    expect(vaultProjectRowSub(titles, false)).toMatch(/once it has a repository/);
  });
});
