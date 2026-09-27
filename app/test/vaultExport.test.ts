// The vault export (0.11). BE-10: it writes Documents/Vault/<path>
// recursively, so a note path that climbs out of the folder (a teammate's
// "../../x.md" on the team vault) must be skipped on the device, whatever the
// server let through. And it reports only what happened: the desktop, where a
// write could not reach the disk, never exports and never reports a count
// (its way out is a move to This folder); the iPhone writes against a
// manifest, so it never removes the folder, never touches a file it did not
// write (Obsidian's .obsidian/ and anything added by hand survive), removes
// only its own stale files, and says "N of M" when some notes were not read.
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
    expect(writes).toEqual(['Vault/a.md', 'Vault/b/c.md']);
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
    disk.set('Vault/.obsidian/app.json', '{}');
    disk.set('Vault/written by hand.md', 'mine');
    await exportVaultToFiles(notes('a.md', 'b.md'));
    // b.md is deleted from the vault; the next export drops only its copy.
    const r = await exportVaultToFiles(notes('a.md'));
    expect(r).toMatchObject({ written: 1, total: 1, removed: 1 });
    expect(Filesystem.rmdir).not.toHaveBeenCalled();
    expect([...disk.keys()].sort()).toEqual([
      'Vault/.obsidian/app.json',
      'Vault/a.md',
      'Vault/written by hand.md',
    ]);
  });

  it('a stale file changed there since the export is kept, then and after', async () => {
    await exportVaultToFiles(notes('a.md', 'b.md'));
    disk.set('Vault/b.md', 'edited in another app');
    await exportVaultToFiles(notes('a.md'));
    expect(disk.get('Vault/b.md')).toBe('edited in another app');
    // It is no longer this device's file, so no later export removes it.
    await exportVaultToFiles(notes('a.md'));
    expect(disk.get('Vault/b.md')).toBe('edited in another app');
  });

  it('a note that could not be read keeps its file, and the count says N of M', async () => {
    await exportVaultToFiles(notes('a.md', 'b.md'));
    const r = await exportVaultToFiles(notes('a.md'), ['b.md']);
    expect(r).toMatchObject({ written: 1, total: 2, removed: 0 });
    expect(disk.get('Vault/b.md')).toBe('# b.md');
    expect(vaultExportLine(r!)).toMatch(/^1 of 2 notes exported/);
    // Once it reads again, it is still this device's to refresh or remove.
    await exportVaultToFiles(notes('a.md'));
    expect(disk.has('Vault/b.md')).toBe(false);
  });

  it('says a whole export plainly, as a one-way copy', () => {
    expect(vaultExportLine({ written: 3, total: 3, removed: 0 })).toBe(
      '3 notes exported to Files, under OpenShore / Vault. It is a copy: edits made there stay there.',
    );
    expect(vaultExportLine({ written: 0, total: 2, removed: 0 })).toMatch(/nothing was exported/);
    for (const r of [
      { written: 3, total: 3, removed: 0 },
      { written: 1, total: 2, removed: 0 },
    ]) {
      expect(vaultExportLine(r)).not.toMatch(/Obsidian/);
    }
  });
});
