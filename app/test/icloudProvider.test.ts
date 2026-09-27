// The iCloud provider's seam filter (0.6, obs-9, data-15), with the native
// plugin mocked. Once Obsidian on a Mac opens the iCloud folder, it holds
// `.obsidian/` config, a `.trash/`, images, and canvases beside the notes;
// only the notes may list, or a config file opens as a blank note and
// autosaves back into Obsidian's settings. An evicted placeholder, reported
// by the plugin under its real name, still lists so a same-name create opens
// it rather than writing over the cloud copy.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  Icloud: {
    available: vi.fn(),
    list: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('../src/lib/gitos/icloudPlugin.js', () => ({ Icloud: h.Icloud }));

import { icloudProvider } from '../src/lib/gitos/icloud.js';

const at = '2026-09-01T00:00:00Z';
const file = (path: string, extra: Record<string, unknown> = {}) => ({
  path,
  updatedAt: at,
  size: 3,
  ...extra,
});

beforeEach(() => {
  for (const fn of Object.values(h.Icloud)) fn.mockReset();
  h.Icloud.list.mockResolvedValue({
    files: [
      file('.obsidian/workspace.json'),
      file('.obsidian/app.json'),
      file('.oscode/lease.json'),
      file('.trash/Old.md'),
      file('ideas/.hidden.md'),
      file('Note.md'),
      file('ideas/Plan.md'),
      file('Far.md', { size: 0, evicted: true }),
      file('attachments/pic.png'),
      file('Board.canvas'),
      file('Tasks.base'),
      file('spec.pdf'),
    ],
  });
});

describe('iCloud provider lists only notes (0.6)', () => {
  it('drops .obsidian/workspace.json and every other non-note', async () => {
    const paths = (await icloudProvider.list('vault.personal')).map((f) => f.path);
    expect(paths).toEqual(['Far.md', 'ideas/Plan.md', 'Note.md']);
    expect(paths).not.toContain('.obsidian/workspace.json');
  });

  it('keeps an evicted placeholder listed, flagged evicted', async () => {
    const far = (await icloudProvider.list('vault.personal')).find((f) => f.path === 'Far.md');
    expect(far).toMatchObject({ evicted: true, size: 0 });
    expect(await icloudProvider.stat('vault.personal', 'Far.md')).toMatchObject({ evicted: true });
  });

  it('stat finds no non-note', async () => {
    expect(await icloudProvider.stat('vault.personal', '.obsidian/workspace.json')).toBeUndefined();
    expect(await icloudProvider.stat('vault.personal', 'attachments/pic.png')).toBeUndefined();
  });

  it('the lease still rides its own file, though it never lists', async () => {
    h.Icloud.read.mockResolvedValue({ found: false });
    h.Icloud.write.mockResolvedValue({ updatedAt: at });
    const lease = await icloudProvider.acquireLease('vault.personal', 'me', 60_000);
    expect(lease.holder).toBe('me');
    expect(h.Icloud.write).toHaveBeenCalledWith(
      expect.objectContaining({ path: '.oscode/lease.json' }),
    );
  });
});
