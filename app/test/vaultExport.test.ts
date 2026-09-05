// BE-10: the vault export writes Documents/Vault/<path> recursively, so a note
// path that climbs out of the folder (a teammate's "../../x.md" on the team
// vault) must be skipped on the device, whatever the server let through.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const writes: string[] = [];
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    rmdir: vi.fn(async () => {}),
    writeFile: vi.fn(async (o: { path: string }) => {
      writes.push(o.path);
    }),
  },
}));
vi.mock('../src/lib/platform.js', () => ({ platform: () => 'ios' }));

import { exportVaultToFiles, isSafeExportPath } from '../src/lib/vaultExport.js';

beforeEach(() => {
  writes.length = 0;
});

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
    const count = await exportVaultToFiles([
      { path: 'a.md', text: 'A' },
      { path: '../../x.md', text: 'escape' },
      { path: 'b/c.md', text: 'C' },
    ]);
    expect(count).toBe(2);
    expect(writes).toEqual(['Vault/a.md', 'Vault/b/c.md']);
  });
});
