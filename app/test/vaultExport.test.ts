// The vault export (0.11). BE-10: it writes Documents/Exports/Vault/<path>
// (folder and sync plan, M2: exports live in the one OpenShore folder)
// recursively, so a note path that climbs out of the folder (a teammate's
// "../../x.md" on the team vault) must be skipped on the device, whatever the
// server let through. And it reports only what happened: the desktop, where a
// write could not reach the disk, never exports and never reports a count
// (its way out is a move to This folder); the iPhone writes against a
// manifest, so it never removes the folder, never touches a file it did not
// write (Obsidian's .obsidian/ and anything added by hand survive), removes
// only its own stale files, and says "N of M" when some notes were not read.
// A file edited in Files since the last export, or added by hand under a
// note's name, is left as it is and named, apart from the unread count.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Platform = 'ios' | 'electron' | 'web';
let on: Platform = 'ios';
const writes: string[] = [];
// Documents/..., as the Files app would show it.
const disk = new Map<string, string>();
const sealed = new Map<string, unknown>();

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    rmdir: vi.fn(async () => {}),
    writeFile: vi.fn(async (o: { path: string; data: string }) => {
      writes.push(o.path);
      disk.set(o.path, o.data);
      return { uri: o.path };
    }),
    readFile: vi.fn(async (o: { path: string }) => {
      if (!disk.has(o.path)) throw new Error('File does not exist.');
      return { data: disk.get(o.path) };
    }),
    stat: vi.fn(async (o: { path: string }) => {
      if (!disk.has(o.path)) throw new Error('File does not exist.');
      return { type: 'file', size: disk.get(o.path)!.length, uri: o.path };
    }),
    deleteFile: vi.fn(async (o: { path: string }) => {
      if (!disk.delete(o.path)) throw new Error('File does not exist.');
    }),
  },
}));
vi.mock('../src/lib/platform.js', () => ({
  platform: () => on,
  storeGetJson: async (k: string) => sealed.get(k),
  storeSetJson: async (k: string, v: unknown) => {
    sealed.set(k, JSON.parse(JSON.stringify(v)));
  },
}));

import { Filesystem } from '@capacitor/filesystem';
import {
  exportVaultToFiles,
  isSafeExportPath,
  vaultExportLine,
  vaultWayOut,
} from '../src/lib/vaultExport.js';

beforeEach(() => {
  on = 'ios';
  writes.length = 0;
  disk.clear();
  sealed.clear();
  vi.mocked(Filesystem.rmdir).mockClear();
});

const notes = (...paths: string[]) => paths.map((path) => ({ path, text: `# ${path}` }));

describe('isSafeExportPath', () => {
  it('accepts vault-relative POSIX paths', () => {
    expect(isSafeExportPath('ideas/roadmap.md')).toBe(true);
    expect(isSafeExportPath('a.md')).toBe(true);
    expect(isSafeExportPath('deep/er/still/note (conflict 2026-09-05 1200).md')).toBe(true);
  });

  it('refuses traversal, absolute paths, and odd separators', () => {
    for (const bad of [
      '../../x.md',
      'a/../x.md',
      'a/..',
      '..',
      '/etc/passwd',
      'a//b.md',
      './a.md',
      'a\\b.md',
      '',
      '   ',
    ]) {
      expect(isSafeExportPath(bad), bad).toBe(false);
    }
  });
});

describe('exportVaultToFiles', () => {
  it('writes safe notes under the export root and skips unsafe ones, counting only what landed', async () => {
    const r = await exportVaultToFiles([
      { path: 'a.md', text: 'A' },
      { path: '../../x.md', text: 'escape' },
      { path: 'b/c.md', text: 'C' },
    ]);
    expect(r).toMatchObject({ written: 2, total: 3 });
    expect(writes).toEqual(['Exports/Vault/a.md', 'Exports/Vault/b/c.md']);
  });

  it('the desktop never exports, so it never reports a count', async () => {
    for (const p of ['electron', 'web'] as const) {
      on = p;
      expect(await exportVaultToFiles(notes('a.md'))).toBeUndefined();
    }
    expect(writes).toEqual([]);
    // Its way out is This folder (plain files Obsidian opens), never Export.
    for (const id of ['local', 'icloud', 'gdrive'] as const) {
      expect(vaultWayOut('electron', id)).toBe('folder');
    }
    expect(vaultWayOut('electron', 'files')).toBeUndefined();
    expect(vaultWayOut('web', 'local')).toBeUndefined();
    expect(vaultWayOut('ios', 'local')).toBe('export');
  });

  it('an unknown file and .obsidian/ survive an iOS re-export; only its own stale file goes', async () => {
    disk.set('Exports/Vault/.obsidian/app.json', '{}');
    disk.set('Exports/Vault/written by hand.md', 'mine');
    await exportVaultToFiles(notes('a.md', 'b.md'));
    // b.md is deleted from the vault; the next export drops only its copy.
    const r = await exportVaultToFiles(notes('a.md'));
    expect(r).toMatchObject({ written: 1, total: 1, removed: 1 });
    expect(Filesystem.rmdir).not.toHaveBeenCalled();
    expect([...disk.keys()].sort()).toEqual([
      'Exports/Vault/.obsidian/app.json',
      'Exports/Vault/a.md',
      'Exports/Vault/written by hand.md',
    ]);
  });

  it('a stale file changed there since the export is kept, then and after', async () => {
    await exportVaultToFiles(notes('a.md', 'b.md'));
    disk.set('Exports/Vault/b.md', 'edited in another app');
    await exportVaultToFiles(notes('a.md'));
    expect(disk.get('Exports/Vault/b.md')).toBe('edited in another app');
    // It is no longer this device's file, so no later export removes it.
    await exportVaultToFiles(notes('a.md'));
    expect(disk.get('Exports/Vault/b.md')).toBe('edited in another app');
  });

  it('a note that could not be read keeps its file, and the count says N of M', async () => {
    await exportVaultToFiles(notes('a.md', 'b.md'));
    const r = await exportVaultToFiles(notes('a.md'), ['b.md']);
    expect(r).toMatchObject({ written: 1, total: 2, removed: 0 });
    expect(disk.get('Exports/Vault/b.md')).toBe('# b.md');
    expect(vaultExportLine(r!)).toMatch(/^1 of 2 notes exported/);
    // Once it reads again, it is still this device's to refresh or remove.
    await exportVaultToFiles(notes('a.md'));
    expect(disk.has('Exports/Vault/b.md')).toBe(false);
  });

  // T7: an export overwrites only the copy it wrote. A file edited in Files
  // since is someone's work: it survives the re-export, and the line says so.
  it('a file edited in Files since the last export survives a re-export, and is named', async () => {
    await exportVaultToFiles([
      { path: 'ideas/Ideas.md', text: 'vault text' },
      { path: 'b.md', text: 'B' },
    ]);
    disk.set('Exports/Vault/ideas/Ideas.md', 'my edit made in Files');
    const r = await exportVaultToFiles([
      { path: 'ideas/Ideas.md', text: 'newer vault text' },
      { path: 'b.md', text: 'B2' },
    ]);
    expect(disk.get('Exports/Vault/ideas/Ideas.md')).toBe('my edit made in Files');
    expect(disk.get('Exports/Vault/b.md')).toBe('B2');
    expect(r).toMatchObject({ written: 1, total: 2, unread: 0, kept: ['ideas/Ideas.md'] });
    expect(vaultExportLine(r!)).toBe(
      '1 note exported to Files, under On My iPhone > OpenShore > Exports > Vault. It is a one-way copy: edits made there do not come back into the vault. "Ideas" there is not the copy OpenShore last wrote, so it was left as it is. Delete it in Files to export a fresh copy.',
    );
    // It is no longer ours: a later export leaves it too, and the note's
    // removal from the vault never takes it.
    await exportVaultToFiles([{ path: 'ideas/Ideas.md', text: 'newer still' }]);
    expect(disk.get('Exports/Vault/ideas/Ideas.md')).toBe('my edit made in Files');
    await exportVaultToFiles([{ path: 'b.md', text: 'B2' }]);
    expect(disk.get('Exports/Vault/ideas/Ideas.md')).toBe('my edit made in Files');
    // Deleted in Files, it exports fresh and is ours again.
    disk.delete('Exports/Vault/ideas/Ideas.md');
    const fresh = await exportVaultToFiles([{ path: 'ideas/Ideas.md', text: 'newer still' }]);
    expect(fresh).toMatchObject({ written: 1, kept: [] });
    expect(disk.get('Exports/Vault/ideas/Ideas.md')).toBe('newer still');
  });

  it("a file added by hand under a note's name is never overwritten", async () => {
    disk.set('Exports/Vault/Plan.md', 'written by hand');
    disk.set('Exports/Vault/Same.md', 'same words');
    const r = await exportVaultToFiles([
      { path: 'Plan.md', text: 'vault plan' },
      { path: 'Same.md', text: 'same words' },
      { path: 'New.md', text: 'new' },
    ]);
    expect(disk.get('Exports/Vault/Plan.md')).toBe('written by hand');
    // A file that already holds the note's exact text is the note's copy.
    expect(disk.get('Exports/Vault/Same.md')).toBe('same words');
    expect(disk.get('Exports/Vault/New.md')).toBe('new');
    expect(r).toMatchObject({ written: 2, total: 3, kept: ['Plan.md'] });
    expect(vaultExportLine(r!)).toMatch(/"Plan" there is not the copy OpenShore last wrote/);
  });

  it('unread and kept counts never mix', async () => {
    await exportVaultToFiles(notes('a.md', 'b.md', 'c.md', 'd.md'));
    disk.set('Exports/Vault/a.md', 'edited');
    disk.set('Exports/Vault/b.md', 'edited too');
    const r = await exportVaultToFiles(notes('a.md', 'b.md', 'c.md'), ['d.md']);
    expect(r).toMatchObject({ written: 1, total: 4, unread: 1, kept: ['a.md', 'b.md'] });
    const line = vaultExportLine(r!);
    expect(line).toBe(
      '1 of 4 notes exported to Files, under On My iPhone > OpenShore > Exports > Vault. One note could not be read right now; export again to bring it. 2 files there are not the copies OpenShore last wrote, so they were left as they are. Delete them in Files to export fresh copies.',
    );
    // Kept files alone never read as unread, and unread notes alone never
    // read as kept.
    const keptOnly = vaultExportLine({
      written: 1,
      total: 3,
      removed: 0,
      unread: 0,
      kept: ['a.md', 'b.md'],
    });
    expect(keptOnly).not.toMatch(/could not be read|of 3/);
    const unreadOnly = vaultExportLine({ written: 1, total: 3, removed: 0, unread: 2, kept: [] });
    expect(unreadOnly).toMatch(/^1 of 3 notes exported/);
    expect(unreadOnly).toMatch(/2 notes could not be read/);
    expect(unreadOnly).not.toMatch(/left as/);
  });

  it('says a whole export plainly, as a one-way copy', () => {
    const whole = { written: 3, total: 3, removed: 0, unread: 0, kept: [] };
    expect(vaultExportLine(whole)).toBe(
      '3 notes exported to Files, under On My iPhone > OpenShore > Exports > Vault. It is a one-way copy: edits made there do not come back into the vault.',
    );
    expect(vaultExportLine({ ...whole, written: 0, total: 2, unread: 2 })).toMatch(
      /nothing was exported/,
    );
    for (const r of [whole, { ...whole, written: 1, total: 2, unread: 1 }]) {
      expect(vaultExportLine(r)).not.toMatch(/Obsidian/);
      expect(vaultExportLine(r)).not.toMatch(/replaces these files/);
    }
  });
});

// Vault M2 2.8: the team vault exports to its own folder on every platform,
// and never touches the personal export.
describe('the team export (M2 2.8)', () => {
  const org = { id: 'org-1', name: 'Acme' };

  it('on the iPhone writes Vault Team/<org>, never the personal export or its manifest', async () => {
    const { exportTeamVaultToFiles } = await import('../src/lib/vaultExport.js');
    await exportVaultToFiles(notes('mine.md'));
    const personalManifest = JSON.stringify([...sealed.entries()]);
    const personalFiles = [...disk.entries()];
    const r = await exportTeamVaultToFiles(notes('plan.md', 'ideas/next.md'), [], org);
    expect(r).toMatchObject({
      written: 2,
      total: 2,
      where: 'to Files, under On My iPhone > OpenShore > Exports > Vault Team > Acme',
    });
    expect(disk.get('Exports/Vault Team/Acme/plan.md')).toBe('# plan.md');
    expect(disk.get('Exports/Vault Team/Acme/ideas/next.md')).toBe('# ideas/next.md');
    for (const [path, text] of personalFiles) expect(disk.get(path)).toBe(text);
    // A later team export with a note gone removes only the team's own file.
    await exportTeamVaultToFiles(notes('plan.md'), [], org);
    expect(disk.has('Exports/Vault Team/Acme/ideas/next.md')).toBe(false);
    expect(disk.get('Exports/Vault/mine.md')).toBe('# mine.md');
    // And the personal export's manifest is its own.
    const personalKey = JSON.parse(personalManifest)[0][0] as string;
    expect(sealed.get(personalKey)).toEqual(JSON.parse(personalManifest)[0][1]);
    // A personal export after it never removes the team's files.
    await exportVaultToFiles(notes('mine.md'));
    expect(disk.get('Exports/Vault Team/Acme/plan.md')).toBe('# plan.md');
  });

  it('on the desktop goes through main, and says where and that Obsidian opens it', async () => {
    const { exportTeamVaultToFiles } = await import('../src/lib/vaultExport.js');
    on = 'electron';
    const calls: unknown[][] = [];
    (globalThis as { window?: unknown }).window = {
      oscode: {
        vaultTeamExport: async (...args: unknown[]) => {
          calls.push(args);
          return {
            written: 1,
            total: 1,
            removed: 0,
            unread: 0,
            kept: [],
            dir: '/home/me/OSCode/Vault Team/Acme',
            display: '~/OSCode/Vault Team/Acme',
          };
        },
      },
    };
    try {
      const r = await exportTeamVaultToFiles(notes('plan.md'), [], org);
      expect(calls).toEqual([['Acme', notes('plan.md'), []]]);
      expect(writes).toEqual([]);
      expect(vaultExportLine(r!, { where: r!.where, folder: r!.folder })).toBe(
        '1 note exported to ~/OSCode/Vault Team/Acme. It is a one-way copy: edits made there do not come back into the vault. Obsidian can open it as a vault.',
      );
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it('exports nowhere in a browser', async () => {
    const { exportTeamVaultToFiles, vaultTeamExportable } =
      await import('../src/lib/vaultExport.js');
    on = 'web';
    expect(vaultTeamExportable('web')).toBe(false);
    expect(vaultTeamExportable('ios')).toBe(true);
    expect(vaultTeamExportable('electron')).toBe(true);
    expect(await exportTeamVaultToFiles(notes('plan.md'), [], org)).toBeUndefined();
  });

  it("the org's folder name is one plain folder, the same in the app and in main", async () => {
    const { teamFolderName } = await import('../src/lib/vaultExport.js');
    const main = await import('../electron/vaultTeamExport.js');
    const cases: Array<[string, string]> = [
      ['Acme', 'Acme'],
      ['  Acme  Labs ', 'Acme Labs'],
      ['../../etc', 'etc'],
      ['a/b\\c:d*e?f"g<h>i|j', 'a b c d e f g h i j'],
      ['.hidden', 'hidden'],
      ['trailing. ', 'trailing'],
      ['', 'Team'],
      ['///', 'Team'],
      ['x'.repeat(120), 'x'.repeat(80)],
    ];
    for (const [name, folder] of cases) {
      expect(teamFolderName(name)).toBe(folder);
      expect(main.teamFolderName(name)).toBe(folder);
    }
  });
});

describe('the desktop team export writes real files (M2 2.8)', () => {
  it('writes the notes into Vault Team/<org>, keeps what it did not write, and removes only its own', async () => {
    const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } =
      await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { exportTeamVault } = await import('../electron/vaultTeamExport.js');
    const home = mkdtempSync(join(tmpdir(), 'oscode-team-export-'));
    const base = join(home, 'OSCode', 'Vault Team');
    const personal = join(home, 'OSCode', 'Vault');
    mkdirSync(personal, { recursive: true });
    writeFileSync(join(personal, 'plan.md'), 'my own plan');
    const run = (list: Array<{ path: string; text: string }>, failed: string[] = []) =>
      exportTeamVault({
        base,
        org: 'Acme',
        personal,
        home,
        notes: list,
        failed,
        platform: 'linux',
      });

    const first = run([
      { path: 'plan.md', text: 'the team plan' },
      { path: 'ideas/next.md', text: 'next' },
      { path: '../escape.md', text: 'never' },
      { path: '.obsidian/app.md', text: 'never' },
    ]);
    const root = join(base, 'Acme');
    expect(first).toMatchObject({
      written: 2,
      total: 4,
      dir: root,
      display: '~/OSCode/Vault Team/Acme',
    });
    expect(readFileSync(join(root, 'plan.md'), 'utf8')).toBe('the team plan');
    expect(readFileSync(join(root, 'ideas', 'next.md'), 'utf8')).toBe('next');
    expect(existsSync(join(base, 'escape.md'))).toBe(false);
    expect(existsSync(join(root, '.obsidian', 'app.md'))).toBe(false);
    // The personal vault is untouched.
    expect(readFileSync(join(personal, 'plan.md'), 'utf8')).toBe('my own plan');

    // Someone edits one in Obsidian; Obsidian's own folder appears.
    writeFileSync(join(root, 'ideas', 'next.md'), 'edited in Obsidian');
    mkdirSync(join(root, '.obsidian'));
    writeFileSync(join(root, '.obsidian', 'app.json'), '{}');
    const second = run([
      { path: 'plan.md', text: 'the team plan, v2' },
      { path: 'ideas/next.md', text: 'next, v2' },
    ]);
    expect(second.kept).toEqual(['ideas/next.md']);
    expect(readFileSync(join(root, 'ideas', 'next.md'), 'utf8')).toBe('edited in Obsidian');
    expect(readFileSync(join(root, 'plan.md'), 'utf8')).toBe('the team plan, v2');

    // plan.md is deleted from the team vault: its file goes, the rest stay.
    const third = run([]);
    expect(third.removed).toBe(1);
    expect(existsSync(join(root, 'plan.md'))).toBe(false);
    expect(readFileSync(join(root, 'ideas', 'next.md'), 'utf8')).toBe('edited in Obsidian');
    expect(existsSync(join(root, '.obsidian', 'app.json'))).toBe(true);
  });

  it('never writes into the personal vault folder', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { exportTeamVault } = await import('../electron/vaultTeamExport.js');
    const home = mkdtempSync(join(tmpdir(), 'oscode-team-export-'));
    const personal = join(home, 'Vault');
    expect(() =>
      exportTeamVault({
        base: personal,
        org: 'Acme',
        personal,
        home,
        notes: [{ path: 'a.md', text: 'a' }],
        failed: [],
        platform: 'linux',
      }),
    ).toThrow(/personal vault/);
  });
});
