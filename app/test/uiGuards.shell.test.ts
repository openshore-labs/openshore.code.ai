// The 2026-10-07 UI rules (test/support/uiGuards.ts) over the shell's own
// files: the sidebar, Chats, Projects and the project room, project notes, and
// the setup page.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOM_FILES, offences } from './support/uiGuards.js';

describe('the 2026-10-07 UI rules in the shell', () => {
  it('holds every rule in the shell files', () => {
    const found = offences(ROOM_FILES.shell);
    expect(found, found.join('\n  ')).toEqual([]);
  });

  it('heads the choose-repositories sheet with a SheetHead, not a bare h2', () => {
    const detail = readFileSync(join(process.cwd(), 'src/screens/ProjectDetailScreen.tsx'), 'utf8');
    expect(detail).not.toContain('<h2>Repositories</h2>');
    expect(detail).toContain('<SheetHead title="Choose repositories" onClose={onClose} />');
  });
});
