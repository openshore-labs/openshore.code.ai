// The agent's on-device vault tools: reads/lists flow, writes are always-ask,
// and note paths can never escape the vault directory.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { vaultWriteTool, vaultReadTool, vaultListTool } from '../src/core/tools/vault.js';
import { NOTE_TEMP_PATTERN, noteFileHooksForTests } from '../src/core/vault/noteFile.js';
import { closeEngineVaultIndexes, engineVaultIndex } from '../src/core/vault/engineIndex.js';
import {
  vaultBacklinksTool,
  vaultLookupTool,
  vaultSearchTool,
} from '../src/core/tools/vaultFind.js';
import {
  buildToolRegistry,
  seatOffersVaultTool,
  withVaultLookupPriority,
} from '../src/core/agent/registry.js';
import { deriveProfile, type DeriveInput } from '../src/harness/profile.js';
import type { VaultPrivacy } from '../src/harness/vault/types.js';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

// A folder the walk cannot read. Tests run as root in CI, where a chmod does
// not lock anything, so readdir is made to refuse the folders named here.
const unreadable = vi.hoisted(() => new Set<string>());
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    readdir: (async (path: string, ...rest: unknown[]) => {
      if (unreadable.has(String(path))) {
        throw Object.assign(new Error(`EACCES: permission denied, scandir '${path}'`), {
          code: 'EACCES',
        });
      }
      return (real.readdir as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof real.readdir,
  };
});
import type { ToolContext } from '../src/core/tools/index.js';
import { PermissionEngine, DEFAULT_PERMISSIONS } from '../src/core/permissions/index.js';

let root: string;
// The vault tools only ever read ctx.vaultRoot, so a partial context is enough.
const ctx = () => ({ vaultRoot: root }) as unknown as ToolContext;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'osc-vault-'));
});
afterEach(async () => {
  noteFileHooksForTests.afterTemp = undefined;
  await closeEngineVaultIndexes();
  rmSync(root, { recursive: true, force: true });
});

/** A read's body: what follows the header's "---" line. */
function bodyOf(content: string): string {
  const at = content.indexOf('\n---\n');
  return at === -1 ? content : content.slice(at + 5);
}

describe('vault write/read/list', () => {
  it('creates a note as a real .md file and reports a diff', async () => {
    const out = await vaultWriteTool.execute(
      { path: 'decisions/auth', content: '# Auth\nUse PKCE.', mode: 'replace' },
      ctx(),
    );
    expect(out.ok).toBe(true);
    const abs = join(root, 'decisions/auth.md'); // .md appended, folder created
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs, 'utf8')).toBe('# Auth\nUse PKCE.');
    expect(out.diffText).toContain('Auth');
  });

  it('appends to an existing note without dropping the old body', async () => {
    await vaultWriteTool.execute({ path: 'log.md', content: 'first', mode: 'replace' }, ctx());
    await vaultWriteTool.execute({ path: 'log.md', content: 'second', mode: 'append' }, ctx());
    expect(readFileSync(join(root, 'log.md'), 'utf8')).toBe('first\nsecond');
  });

  it('reads a note, and says so when it does not exist', async () => {
    await vaultWriteTool.execute({ path: 'a.md', content: 'hello', mode: 'replace' }, ctx());
    expect(bodyOf((await vaultReadTool.execute({ path: 'a.md' }, ctx())).content)).toBe('hello');
    const missing = await vaultReadTool.execute({ path: 'nope.md' }, ctx());
    expect(missing.content).toMatch(/no vault note/i);
  });

  it('lists notes with sizes, recursively', async () => {
    await vaultWriteTool.execute({ path: 'a.md', content: 'x', mode: 'replace' }, ctx());
    await vaultWriteTool.execute({ path: 'sub/b.md', content: 'yy', mode: 'replace' }, ctx());
    const list = (await vaultListTool.execute({}, ctx())).content;
    expect(list).toContain('a.md');
    expect(list).toContain('sub/b.md');
  });

  it('refuses a path that escapes the vault', async () => {
    await expect(
      vaultWriteTool.execute({ path: '../escape.md', content: 'no', mode: 'replace' }, ctx()),
    ).rejects.toThrow();
    expect(existsSync(join(root, '..', 'escape.md'))).toBe(false);
  });

  // The app and the engine hold one rule: the vault and Obsidian hide dot
  // names, so a note named with one would land where no surface lists it.
  it('refuses a dot-led note name, and no file appears', async () => {
    await expect(
      vaultWriteTool.execute({ path: '.NET migration.md', content: 'x', mode: 'replace' }, ctx()),
    ).rejects.toThrow(
      'Note names cannot start with a dot; the vault and Obsidian hide them. Use "NET migration.md".',
    );
    expect(existsSync(join(root, '.NET migration.md'))).toBe(false);
    expect(existsSync(join(root, 'NET migration.md'))).toBe(false);
    await expect(
      vaultWriteTool.execute({ path: 'plans/.draft', content: 'x', mode: 'replace' }, ctx()),
    ).rejects.toThrow(/Use "plans\/draft\.md"/);
    expect(existsSync(join(root, 'plans'))).toBe(false);
    // vaultRead shares the rule, so the agent stays out of .obsidian/ (0.6).
    mkdirSync(join(root, '.obsidian'));
    writeFileSync(join(root, '.obsidian', 'app.md'), 'settings');
    await expect(vaultReadTool.execute({ path: '.obsidian/app.md' }, ctx())).rejects.toThrow(
      /cannot start with a dot/,
    );
  });

  // Vault M3 (H4): one new-name rule on the engine and the app. A new note
  // must be clean, and is refused with the clean name; an existing exact path
  // always updates, whatever its name holds.
  it('refuses a new note name the rule forbids, with the clean name to use', async () => {
    const cases: Array<[string, RegExp]> = [
      ['Decision: auth?', /cannot contain : \?.*Use "Decision auth\.md"/],
      ['C# notes', /cannot contain #.*Use "C notes\.md"/],
      ['Plan [draft]', /cannot contain \[ \].*Use "Plan draft\.md"/],
      ['CON', /Windows reserves.*Use "CON_\.md"/],
      ['plans./today', /cannot end in a dot or a space.*Use "plans\/today\.md"/],
    ];
    for (const [path, error] of cases) {
      await expect(
        vaultWriteTool.execute({ path, content: 'x', mode: 'replace' }, ctx()),
      ).rejects.toThrow(error);
      await expect(
        vaultWriteTool.preview!({ path, content: 'x', mode: 'replace' }, ctx()),
      ).rejects.toThrow(error);
    }
    expect(readdirSync(root)).toEqual([]);
  });

  // POSIX only: Windows cannot hold ":" or "?" in a file name (a colon names
  // an NTFS stream), so no note by this name can exist there to update.
  it.skipIf(process.platform === 'win32')(
    'an existing note with a name the rule would refuse still updates and reads',
    async () => {
      writeFileSync(join(root, 'Decision: auth?.md'), 'old');
      const nfd = 'Café.md';
      writeFileSync(join(root, nfd), 'cafe');
      const out = await vaultWriteTool.execute(
        { path: 'Decision: auth?.md', content: 'new', mode: 'replace' },
        ctx(),
      );
      expect(out.ok).toBe(true);
      expect(readFileSync(join(root, 'Decision: auth?.md'), 'utf8')).toBe('new');
      expect(
        bodyOf((await vaultReadTool.execute({ path: 'Decision: auth?' }, ctx())).content),
      ).toBe('new');
      await vaultWriteTool.execute({ path: nfd, content: 'more', mode: 'append' }, ctx());
      expect(readFileSync(join(root, nfd), 'utf8')).toBe('cafe\nmore');
      expect(readdirSync(root).sort()).toEqual(['Café.md', 'Decision: auth?.md'].sort());
    },
  );

  // On Windows the same path names a stream of a file called "Decision", never
  // a note: the write is refused with the clean name, as a new note would be,
  // and nothing at that path changes. Runs on every system as Windows.
  it('on Windows, a name the file system cannot hold is refused even where something answers', async () => {
    const realPlatform = process.platform;
    writeFileSync(join(root, 'Decision: auth?.md'), 'old');
    // "CON" opens the console on a real Windows disk, so its stand-in note is
    // made only where a disk can hold one.
    if (realPlatform !== 'win32') writeFileSync(join(root, 'CON.md'), 'old');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await expect(
        vaultWriteTool.execute(
          { path: 'Decision: auth?.md', content: 'new', mode: 'replace' },
          ctx(),
        ),
      ).rejects.toThrow(/cannot contain : \?.*Use "Decision auth\.md"/);
      await expect(
        vaultWriteTool.execute({ path: 'CON.md', content: 'new', mode: 'replace' }, ctx()),
      ).rejects.toThrow(/Windows reserves.*Use "CON_\.md"/);
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform });
    }
    expect(readFileSync(join(root, 'Decision: auth?.md'), 'utf8')).toBe('old');
    if (realPlatform !== 'win32') expect(readFileSync(join(root, 'CON.md'), 'utf8')).toBe('old');
    expect(readdirSync(root).filter((name) => NOTE_TEMP_PATTERN.test(name))).toEqual([]);
  });

  it('a new name that folds onto an existing note is refused with that note, never a twin', async () => {
    mkdirSync(join(root, 'Ideas'));
    writeFileSync(join(root, 'Ideas', 'Plan.md'), 'plan');
    writeFileSync(join(root, 'Café.md'), 'cafe');
    const probe = join(root, 'ideas', 'plan.md');
    // A case-insensitive disk already answers the other spelling as the note.
    const caseInsensitive = existsSync(probe);
    if (!caseInsensitive) {
      await expect(
        vaultWriteTool.execute({ path: 'ideas/plan', content: 'x', mode: 'replace' }, ctx()),
      ).rejects.toThrow(
        'The vault already has this note as "Ideas/Plan.md". Write to "Ideas/Plan.md" instead.',
      );
      expect(existsSync(join(root, 'ideas'))).toBe(false);
      const read = await vaultReadTool.execute({ path: 'ideas/plan' }, ctx());
      expect(read.content).toBe(
        'No vault note at ideas/plan.md. The vault has "Ideas/Plan.md"; read that path.',
      );
    }
    // NFC typed against an NFD name on disk is the same note by fold.
    const nfc = 'Café';
    if (!existsSync(join(root, `${nfc}.md`))) {
      await expect(
        vaultWriteTool.execute({ path: nfc, content: 'x', mode: 'replace' }, ctx()),
      ).rejects.toThrow(/already has this note as "Café\.md"/);
    }
    expect(readFileSync(join(root, 'Ideas', 'Plan.md'), 'utf8')).toBe('plan');
  });

  it('previews a create as a diff for the approval prompt', async () => {
    const preview = await vaultWriteTool.preview!(
      { path: 'note.md', content: 'body', mode: 'replace' },
      ctx(),
    );
    expect(preview.summary).toMatch(/Vault: Create note\.md/);
    expect(preview.detail).toContain('body');
  });
});

// A real Obsidian vault holds thousands of notes and whatever else a person
// drops in it. One list or read must never flood the seat's context, and an odd
// entry gets a plain answer the model can act on, never a raw error.
describe('vault tools are bounded', () => {
  function seed(count: number): void {
    for (let i = 0; i < count; i++) {
      const folder = join(root, `f${i % 5}`);
      if (i < 5) mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, `note ${String(i).padStart(4, '0')}.md`), `# ${i}`);
    }
  }

  it('2,500 notes list under the cap, with a count and a way to narrow', async () => {
    seed(2500);
    const out = (await vaultListTool.execute({}, ctx())).content;
    expect(out.length).toBeLessThan(24_000);
    const lines = out.split('\n');
    expect(lines[0]).toBe('2500 notes. Showing 1 to 200.');
    expect(lines).toHaveLength(202);
    expect(lines[1]).toMatch(/^f0\/note 0000\.md \(\d+b\)$/);
    expect(lines.at(-1)).toMatch(/^2300 more\. Narrow with folder: "f0" \(500\)/);
    expect(lines.at(-1)).toMatch(/Or page on with offset 200\.$/);
  });

  it('pages on with offset, and narrows with folder', async () => {
    seed(2500);
    const next = (await vaultListTool.execute({ offset: 200 }, ctx())).content;
    expect(next.split('\n')[0]).toBe('2500 notes. Showing 201 to 400.');
    const narrowed = (await vaultListTool.execute({ folder: 'f3', offset: 400 }, ctx())).content;
    const lines = narrowed.split('\n');
    expect(lines[0]).toBe('500 notes under f3. Showing 401 to 500.');
    expect(lines).toHaveLength(101);
    expect(lines.every((l, i) => i === 0 || l.startsWith('f3/'))).toBe(true);
  });

  it('a short list carries its count and no narrowing line', async () => {
    seed(3);
    const lines = (await vaultListTool.execute({}, ctx())).content.split('\n');
    expect(lines[0]).toBe('3 notes. Showing 1 to 3.');
    expect(lines).toHaveLength(4);
  });

  // A real vault with deep folders and long titles: 200 notes at about 146
  // characters each run past the tool output cap. A page trimmed in the middle
  // while its footer said "page on with offset 200" skipped the trimmed notes
  // for good. Each page must fit whole, and following each page's own offset
  // must reach every note exactly once.
  it('long paths page whole, and paging on never skips a note', async () => {
    const folder = join(
      root,
      'Areas/Work/Clients/Acme Corporation International/Meetings and Workshops/2026',
    );
    mkdirSync(folder, { recursive: true });
    const expected: string[] = [];
    for (let i = 0; i < 260; i++) {
      const name = `${String(i).padStart(3, '0')} Quarterly planning review with product design and engineering.md`;
      writeFileSync(join(folder, name), `# ${i}`);
      expected.push(
        `Areas/Work/Clients/Acme Corporation International/Meetings and Workshops/2026/${name}`,
      );
    }
    const seen: string[] = [];
    let offset: number | undefined = 0;
    for (let pages = 0; offset !== undefined; pages++) {
      expect(pages).toBeLessThan(10);
      const out = (await vaultListTool.execute({ offset }, ctx())).content;
      expect(out.length).toBeLessThanOrEqual(24_000);
      expect(out).not.toContain('characters trimmed');
      const lines = out.split('\n');
      const first = offset + 1;
      const rows = lines.slice(1).filter((l) => l.startsWith('Areas/'));
      expect(lines[0]).toBe(`260 notes. Showing ${first} to ${offset + rows.length}.`);
      seen.push(...rows.map((l) => l.replace(/ \(\d+b\)$/, '')));
      const next = /[Pp]age on with offset (\d+)\.$/.exec(lines.at(-1)!);
      offset = next ? Number(next[1]) : undefined;
    }
    expect(seen).toEqual(expected);
  });

  it('names a smaller folder to narrow to when one folder holds every note', async () => {
    const deep = join(root, 'Areas/Work/Clients');
    mkdirSync(join(deep, 'Acme'), { recursive: true });
    mkdirSync(join(deep, 'Globex'), { recursive: true });
    for (let i = 0; i < 300; i++) {
      writeFileSync(join(deep, i % 3 ? 'Acme' : 'Globex', `note ${i}.md`), 'x');
    }
    const footer = (await vaultListTool.execute({}, ctx())).content.split('\n').at(-1)!;
    expect(footer).toContain('Narrow with folder: "Areas/Work/Clients/Acme" (200)');
    expect(footer).toContain('"Areas/Work/Clients/Globex" (100)');
  });

  // A slip in the folder name, a note passed as a folder, or a folder that
  // cannot be read is not an empty vault: telling the model so invites it to
  // write duplicates of notes that exist.
  it('a missing folder, a note, or an unreadable folder is never "the vault is empty"', async () => {
    writeFileSync(join(root, 'Home.md'), '# Home');
    mkdirSync(join(root, 'Projects'), { recursive: true });
    writeFileSync(join(root, 'Projects', 'Ideas.md'), '# Ideas');
    mkdirSync(join(root, 'Archive'), { recursive: true });

    const typo = await vaultListTool.execute({ folder: 'Project' }, ctx());
    expect(typo.ok).toBe(false);
    expect(typo.content).toBe(
      'There is no folder named "Project" in the vault. Its top folders: "Archive", "Projects".',
    );

    const note = await vaultListTool.execute({ folder: 'Home.md' }, ctx());
    expect(note.ok).toBe(false);
    expect(note.content).toBe('Home.md is a note, not a folder. Read it with vaultRead.');

    const bare = await vaultListTool.execute({ folder: 'Archive' }, ctx());
    expect(bare.ok).toBe(true);
    expect(bare.content).toBe('No notes under Archive.');

    const listed = await vaultListTool.execute({ folder: 'Projects' }, ctx());
    expect(listed.content).toContain('Projects/Ideas.md');

    // An unreadable folder says so, and so does an unreadable vault.
    unreadable.add(join(root, 'Projects'));
    unreadable.add(root);
    try {
      const locked = await vaultListTool.execute({ folder: 'Projects' }, ctx());
      expect(locked.ok).toBe(false);
      expect(locked.content).toBe('Could not read Projects (EACCES).');
      const whole = await vaultListTool.execute({}, ctx());
      expect(whole.ok).toBe(false);
      expect(whole.content).toBe('Could not read the vault (EACCES).');
    } finally {
      unreadable.clear();
    }
  });

  it('an empty vault still says so', async () => {
    expect((await vaultListTool.execute({}, ctx())).content).toBe('The vault is empty.');
    const missing = { vaultRoot: join(root, 'not-yet') } as unknown as ToolContext;
    expect((await vaultListTool.execute({}, missing)).content).toBe('The vault is empty.');
  });

  it('a folder named like a note gets a clear message, not a crash', async () => {
    mkdirSync(join(root, 'x.md', 'inside'), { recursive: true });
    const out = await vaultReadTool.execute({ path: 'x' }, ctx());
    expect(out.ok).toBe(false);
    expect(out.content).toBe(
      'x.md is a folder, not a note. List what is inside it with vaultList and folder "x.md".',
    );
  });

  it('refuses a note too large to read whole, and a binary file', async () => {
    writeFileSync(join(root, 'huge.md'), 'a'.repeat(2_500_000));
    const huge = await vaultReadTool.execute({ path: 'huge.md' }, ctx());
    expect(huge.ok).toBe(false);
    expect(huge.content).toMatch(/^huge\.md is 2\.5 MB, too large to read whole\./);
    writeFileSync(join(root, 'photo.md'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const binary = await vaultReadTool.execute({ path: 'photo.md' }, ctx());
    expect(binary.ok).toBe(false);
    expect(binary.content).toBe('photo.md looks binary; not printing it.');
  });
});

describe('vault writes are never silent', () => {
  it('vaultWrite declares alwaysAsk', () => {
    expect(vaultWriteTool.alwaysAsk).toBe(true);
    expect(vaultReadTool.alwaysAsk).toBeUndefined();
  });

  it('an always-ask tool prompts even with a session grant AND a trusted repo', () => {
    const cwd = '/repo';
    const engine = new PermissionEngine({ ...DEFAULT_PERMISSIONS, trustedRepos: [cwd] });
    engine.allowForSession('vaultWrite'); // user picked "always allow this session"
    const decision = engine.decide({
      toolName: 'vaultWrite',
      risk: 'write',
      cwd,
      alwaysAsk: true,
    });
    expect(decision.decision).toBe('ask');
  });

  it('a plain write in a trusted repo still flows (no regression)', () => {
    const cwd = '/repo';
    const engine = new PermissionEngine({ ...DEFAULT_PERMISSIONS, trustedRepos: [cwd] });
    expect(engine.decide({ toolName: 'writeFile', risk: 'write', cwd }).decision).toBe('allow');
  });
});

// Vault v1, 1.2 (CTO F5): the diff the person approved is what lands, or
// nothing does. The preview names the bytes it was built against, the loop
// hands that basis to execute, and execute refuses when the note moved.
describe('a vault write lands exactly as approved', () => {
  const CHANGED =
    'The note changed since you approved it. Read it again with vaultRead, then propose the write again.';
  const args = (content: string, mode: 'replace' | 'append' = 'replace') => ({
    path: 'log.md',
    content,
    mode,
  });
  const note = () => join(root, 'log.md');

  it('the preview names the bytes it was built against', async () => {
    // Then the hash of the exact bytes it showed (Vault M7, CTO L9).
    const after = (t: string) => `#after=sha256:${createHash('sha256').update(t).digest('hex')}`;
    expect((await vaultWriteTool.preview!(args('x'), ctx())).basis).toBe(`absent${after('x')}`);
    writeFileSync(note(), 'v1\n');
    const sha = createHash('sha256').update('v1\n').digest('hex');
    expect((await vaultWriteTool.preview!(args('x'), ctx())).basis).toBe(
      `sha256:${sha}${after('x')}`,
    );
  });

  it('an edit between preview and execute is refused, and the file is byte-identical', async () => {
    writeFileSync(note(), 'v1 line\n');
    const { basis } = await vaultWriteTool.preview!(args('agent rewrite\n'), ctx());
    writeFileSync(note(), 'v1 line\nperson added this while approval was pending\n');
    const before = readFileSync(note());
    const out = await vaultWriteTool.execute(args('agent rewrite\n'), ctx(), { basis });
    expect(out).toEqual({ ok: false, content: CHANGED });
    expect(readFileSync(note()).equals(before)).toBe(true);
  });

  it('a touch that changes only the time still writes', async () => {
    writeFileSync(note(), 'v1\n');
    const { basis } = await vaultWriteTool.preview!(args('v2\n'), ctx());
    utimesSync(note(), 1_900_000_000, 1_900_000_000);
    const out = await vaultWriteTool.execute(args('v2\n'), ctx(), { basis });
    expect(out.ok).toBe(true);
    expect(readFileSync(note(), 'utf8')).toBe('v2\n');
  });

  it('an append lands exactly the approved diff', async () => {
    writeFileSync(note(), '# Log\nfirst');
    const preview = await vaultWriteTool.preview!(args('second', 'append'), ctx());
    const out = await vaultWriteTool.execute(args('second', 'append'), ctx(), {
      basis: preview.basis,
    });
    expect(out.ok).toBe(true);
    expect(readFileSync(note(), 'utf8')).toBe('# Log\nfirst\nsecond');
    expect(out.diffText).toBe(preview.detail);
  });

  it('a note created under the same name after the preview is refused, never replaced', async () => {
    const { basis } = await vaultWriteTool.preview!(args('mine'), ctx());
    expect(basis?.startsWith('absent#after=')).toBe(true);
    writeFileSync(note(), 'theirs');
    expect(await vaultWriteTool.execute(args('mine'), ctx(), { basis })).toEqual({
      ok: false,
      content: CHANGED,
    });
    expect(readFileSync(note(), 'utf8')).toBe('theirs');
  });

  it('an edit landing during the save itself is refused, with or without a basis', async () => {
    // A new note: someone takes the name while the save is under way.
    noteFileHooksForTests.afterTemp = () => writeFileSync(note(), 'theirs');
    expect(await vaultWriteTool.execute(args('mine'), ctx())).toEqual({
      ok: false,
      content: CHANGED,
    });
    expect(readFileSync(note(), 'utf8')).toBe('theirs');
    // An existing note: Obsidian saves in place while the save is under way.
    const { basis } = await vaultWriteTool.preview!(args('mine'), ctx());
    noteFileHooksForTests.afterTemp = () => {
      writeFileSync(note(), 'theirs, edited');
      utimesSync(note(), 1_900_000_000, 1_900_000_000);
    };
    expect(await vaultWriteTool.execute(args('mine'), ctx(), { basis })).toEqual({
      ok: false,
      content: CHANGED,
    });
    expect(readFileSync(note(), 'utf8')).toBe('theirs, edited');
    const leftovers = readdirSync(root).filter((name) => NOTE_TEMP_PATTERN.test(name));
    expect(leftovers).toEqual([]);
  });

  it('leaves no temp file behind', async () => {
    await vaultWriteTool.execute({ path: 'a/b/c', content: '1', mode: 'replace' }, ctx());
    await vaultWriteTool.execute({ path: 'a/b/c', content: '2', mode: 'append' }, ctx());
    await vaultWriteTool.execute({ path: 'top', content: 'x', mode: 'replace' }, ctx());
    await vaultWriteTool.execute({ path: 'top', content: 'y', mode: 'replace' }, ctx());
    expect(readFileSync(join(root, 'a/b/c.md'), 'utf8')).toBe('1\n2');
    const all = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? all(join(dir, e.name)) : [e.name],
      );
    expect(all(root).sort()).toEqual(['c.md', 'top.md']);
  });

  it('a folder named like the note gets a plain refusal, and the folder stays', async () => {
    mkdirSync(join(root, 'x.md', 'inside'), { recursive: true });
    const out = await vaultWriteTool.execute({ path: 'x', content: 'y', mode: 'replace' }, ctx());
    expect(out).toEqual({ ok: false, content: 'x.md is a folder, not a note.' });
    expect(existsSync(join(root, 'x.md', 'inside'))).toBe(true);
  });
});

describe('the loop hands execute what the person approved', () => {
  it('execute receives the basis the preview returned, and only after an ask', async () => {
    const calls: unknown[][] = [];
    const provider = new MockProvider('mock', [
      toolTurn('probe', {}, 'c1'),
      toolTurn('plain', {}, 'c2'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider);
    session.tools.register({
      name: 'probe',
      description: 'A write that always asks.',
      schema: z.object({}),
      risk: 'write',
      alwaysAsk: true,
      preview: async () => ({ summary: 'probe', basis: 'basis-123' }),
      execute: async (...received: unknown[]) => {
        calls.push(received);
        return { ok: true, content: 'ok' };
      },
    });
    // A write the session's defaults allow: no ask, so no approval passes.
    session.tools.register({
      name: 'plain',
      description: 'A write that flows.',
      schema: z.object({}),
      risk: 'write',
      preview: async () => ({ summary: 'plain', basis: 'never-sent' }),
      execute: async (...received: unknown[]) => {
        calls.push(received);
        return { ok: true, content: 'ok' };
      },
    });
    await session.agent.run('go');
    expect(calls).toHaveLength(2);
    expect(calls[0]![2]).toEqual({ basis: 'basis-123' });
    expect(calls[1]).toHaveLength(2);
  });

  it('a person editing the note while the approval is open keeps the edit', async () => {
    writeFileSync(join(root, 'plan.md'), 'v1\n');
    const provider = new MockProvider('mock', [
      toolTurn('vaultWrite', { path: 'plan.md', content: 'agent rewrite\n', mode: 'replace' }),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      vaultRoot: root,
      approve: () => {
        writeFileSync(join(root, 'plan.md'), 'v1\nmine\n');
        return { approve: true };
      },
    });
    await session.agent.run('go');
    expect(readFileSync(join(root, 'plan.md'), 'utf8')).toBe('v1\nmine\n');
    const end = session.events.find((e) => e.type === 'tool-end');
    expect(end?.type === 'tool-end' && end.result.content).toMatch(/changed since you approved/);
  });
});

// Vault v1, 1.6: a deny means deny, a listing never shows what a deny closes,
// and the approval sheet is told which choices take effect.
describe('vault permissions mean what they say', () => {
  it('a deny rule on vaultWrite wins over always-ask; an allow still only asks', () => {
    const deny = new PermissionEngine({
      ...DEFAULT_PERMISSIONS,
      rules: [{ tool: 'vaultWrite', decision: 'deny' }],
    });
    expect(
      deny.decide({ toolName: 'vaultWrite', risk: 'write', path: 'a.md', alwaysAsk: true })
        .decision,
    ).toBe('deny');
    // A session grant (never offered for it) cannot hide the deny either.
    deny.allowForSession('vaultWrite');
    expect(deny.decide({ toolName: 'vaultWrite', risk: 'write', alwaysAsk: true }).decision).toBe(
      'deny',
    );
    const allow = new PermissionEngine({
      ...DEFAULT_PERMISSIONS,
      rules: [{ tool: 'vaultWrite', decision: 'allow' }],
    });
    expect(allow.decide({ toolName: 'vaultWrite', risk: 'write', alwaysAsk: true }).decision).toBe(
      'ask',
    );
  });

  it('a scoped deny fences a folder, and a deny default switches vault writes off', () => {
    const fenced = new PermissionEngine({
      ...DEFAULT_PERMISSIONS,
      rules: [{ tool: 'vaultWrite', decision: 'deny', pathGlob: 'Journal/**' }],
    });
    const decide = (path: string) =>
      fenced.decide({ toolName: 'vaultWrite', risk: 'write', path, alwaysAsk: true }).decision;
    expect(decide('Journal/2026-09-27.md')).toBe('deny');
    expect(decide('Work/plan.md')).toBe('ask');
    const off = new PermissionEngine({
      ...DEFAULT_PERMISSIONS,
      defaults: { ...DEFAULT_PERMISSIONS.defaults, write: 'deny' },
    });
    expect(off.decide({ toolName: 'vaultWrite', risk: 'write', alwaysAsk: true }).decision).toBe(
      'deny',
    );
  });

  it('in the loop, a denied vaultWrite never asks and never writes', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('vaultWrite', { path: 'a.md', content: 'x', mode: 'replace' }),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      vaultRoot: root,
      configOverrides: {
        permissions: {
          defaults: { write: 'allow', shell: 'ask' },
          rules: [{ tool: 'vaultWrite', decision: 'deny' }],
        },
      },
    });
    await session.agent.run('go');
    expect(session.approvals).toEqual([]);
    expect(session.events.some((e) => e.type === 'tool-denied')).toBe(true);
    expect(existsSync(join(root, 'a.md'))).toBe(false);
  });

  function seedFenced(): void {
    writeFileSync(join(root, 'Home.md'), '# Home');
    mkdirSync(join(root, 'Private'), { recursive: true });
    writeFileSync(join(root, 'Private', 'diary.md'), 'x');
    writeFileSync(join(root, 'Private', 'secret plan.md'), 'x');
    mkdirSync(join(root, 'Work'), { recursive: true });
    writeFileSync(join(root, 'Work', 'a.md'), 'x');
  }

  it('vaultList hides the notes a deny rule closes, and the folder itself', async () => {
    seedFenced();
    const engine = new PermissionEngine({
      ...DEFAULT_PERMISSIONS,
      rules: [{ tool: 'vaultRead', decision: 'deny', pathGlob: 'Private/**' }],
    });
    const fenced = {
      vaultRoot: root,
      denies: (toolName: string, path: string) =>
        engine.decide({ toolName, risk: 'read', path }).decision === 'deny',
    } as unknown as ToolContext;
    const list = (await vaultListTool.execute({}, fenced)).content;
    expect(list).not.toContain('Private');
    expect(list.split('\n')).toEqual([
      "2 notes. Showing 1 to 2. 2 more are hidden by the person's permission rules.",
      'Home.md (6b)',
      'Work/a.md (1b)',
    ]);
    expect(await vaultListTool.execute({ folder: 'Private' }, fenced)).toEqual({
      ok: false,
      content: "Private is closed to the agent by the person's permission rules.",
    });
    const typo = await vaultListTool.execute({ folder: 'Wrk' }, fenced);
    expect(typo.content).toBe(
      'There is no folder named "Wrk" in the vault. Its top folders: "Work".',
    );
    // Unfenced, nothing is hidden.
    expect((await vaultListTool.execute({}, ctx())).content).toContain('Private/diary.md');
  });

  it("in the loop, vaultList answers from the session's own rules", async () => {
    seedFenced();
    const provider = new MockProvider('mock', [toolTurn('vaultList', {}), textTurn('done')]);
    const session = makeTestSession(provider, {
      vaultRoot: root,
      configOverrides: {
        permissions: {
          defaults: { write: 'allow', shell: 'ask' },
          rules: [{ tool: 'vaultList', decision: 'deny', pathGlob: 'Private/**' }],
        },
      },
    });
    await session.agent.run('go');
    const end = session.events.find((e) => e.type === 'tool-end');
    const content = end?.type === 'tool-end' ? end.result.content : '';
    expect(content).toContain('Work/a.md');
    expect(content).not.toContain('Private');
  });

  it('the approval request carries alwaysAsk for vaultWrite and not for other writes', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'a.txt', content: 'x' }, 'c1'),
      toolTurn('vaultWrite', { path: 'a.md', content: 'x', mode: 'replace' }, 'c2'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      vaultRoot: root,
      configOverrides: { permissions: { defaults: { write: 'ask', shell: 'ask' } } },
    });
    await session.agent.run('go');
    expect(session.approvals.map((a) => [a.toolName, a.alwaysAsk])).toEqual([
      ['writeFile', undefined],
      ['vaultWrite', true],
    ]);
    expect('alwaysAsk' in session.approvals[0]!).toBe(false);
  });
});

// Review M1-1: a configured vault folder that went missing (renamed, or on a
// drive that is not connected) is never recreated by the agent's tools, so a
// note never lands in a fresh empty folder beside the real vault.
describe('a vault folder that is not there', () => {
  it('vaultWrite, its preview, and vaultRead refuse and never recreate it', async () => {
    const gone = join(root, 'Drive', 'Brain');
    const at = { vaultRoot: gone } as unknown as ToolContext;
    const args = { path: 'a', content: 'x', mode: 'replace' as const };
    await expect(vaultWriteTool.preview!(args, at)).rejects.toThrow(
      'The vault folder is not there right now.',
    );
    await expect(vaultWriteTool.execute(args, at)).rejects.toThrow(
      'The vault folder is not there right now.',
    );
    await expect(vaultReadTool.execute({ path: 'a' }, at)).rejects.toThrow(
      'The vault folder is not there right now.',
    );
    expect(existsSync(gone)).toBe(false);
    expect(existsSync(join(root, 'Drive'))).toBe(false);
  });
});

// Review M1-4: a picked vault can sit inside a project workspace, where the
// coding tools could otherwise edit notes with no prompt. A write-risk tool
// whose jailed path lands inside the vault asks every time, as vaultWrite
// does: Accept edits, a trusted repo, and a session grant cannot quiet it.
describe('a vault inside the workspace', () => {
  const askWrites = { permissions: { defaults: { write: 'ask', shell: 'ask' } } };

  function workspaceWithVault(): { cwd: string; vault: string } {
    const cwd = mkdtempSync(join(tmpdir(), 'osc-ws-vault-'));
    const vault = join(cwd, 'notes');
    mkdirSync(vault);
    writeFileSync(join(vault, 'plan.md'), 'the plan\n');
    return { cwd, vault };
  }

  it('Accept edits still asks before writeFile touches a note, and lets other files flow', async () => {
    const { cwd, vault } = workspaceWithVault();
    try {
      const provider = new MockProvider('mock', [
        toolTurn('writeFile', { path: 'src/a.ts', content: 'x' }, 'c1'),
        toolTurn('writeFile', { path: 'notes/plan.md', content: 'edited\n' }, 'c2'),
        toolTurn('writeFile', { path: './notes/../notes/new.md', content: 'new\n' }, 'c3'),
        textTurn('done'),
      ]);
      const session = makeTestSession(provider, {
        cwd,
        vaultRoot: vault,
        configOverrides: askWrites,
      });
      session.agent.setMode('acceptEdits');
      await session.agent.run('edit');
      expect(session.approvals.map((a) => a.toolName)).toEqual(['writeFile', 'writeFile']);
      // Only the choices that take effect: an always-ask write offers no grant.
      expect(session.approvals.every((a) => a.alwaysAsk === true)).toBe(true);
      expect(readFileSync(join(cwd, 'src', 'a.ts'), 'utf8')).toBe('x');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('a trusted repo and a session grant still ask for a note, and a deny still wins', async () => {
    const { cwd, vault } = workspaceWithVault();
    try {
      const provider = new MockProvider('mock', [
        toolTurn('writeFile', { path: 'notes/plan.md', content: 'one\n' }, 'c1'),
        toolTurn('writeFile', { path: 'notes/plan.md', content: 'two\n' }, 'c2'),
        toolTurn('writeFile', { path: 'README.md', content: 'readme\n' }, 'c3'),
        textTurn('done'),
      ]);
      const session = makeTestSession(provider, {
        cwd,
        vaultRoot: vault,
        configOverrides: { permissions: { defaults: { write: 'ask' }, trustedRepos: [cwd] } },
        approve: () => ({ approve: true, alwaysThisSession: true }),
      });
      await session.agent.run('edit');
      // Both note writes asked; the trusted repo let README through quietly.
      expect(session.approvals.map((a) => a.toolName)).toEqual(['writeFile', 'writeFile']);
      expect(readFileSync(join(vault, 'plan.md'), 'utf8')).toBe('two\n');
      expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('readme\n');

      const denied = new MockProvider('mock', [
        toolTurn('writeFile', { path: 'notes/plan.md', content: 'three\n' }, 'c1'),
        textTurn('done'),
      ]);
      const fenced = makeTestSession(denied, {
        cwd,
        vaultRoot: vault,
        configOverrides: {
          permissions: {
            defaults: { write: 'allow' },
            rules: [{ tool: 'writeFile', pathGlob: 'notes/**', decision: 'deny' }],
          },
        },
      });
      await fenced.agent.run('edit');
      expect(fenced.approvals).toEqual([]);
      expect(readFileSync(join(vault, 'plan.md'), 'utf8')).toBe('two\n');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Vault M4 (4.5, CTO I11): tools that search first

function seed(files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
  }
}

describe('vault tools that search first', () => {
  it('a bare [[Ideas]] resolves into a subfolder, for a read and for a link', async () => {
    seed({ 'Projects/Ideas.md': '# Ideas\nShip the thing.', 'Hub.md': 'See [[Ideas]].' });
    const out = await vaultReadTool.execute({ path: 'Ideas' }, ctx());
    expect(out.content).toMatch(/^Note: Projects\/Ideas\.md \(about \d+ tokens, \d+ bytes\)/);
    expect(bodyOf(out.content)).toBe('# Ideas\nShip the thing.');
    const hub = await vaultReadTool.execute({ path: 'Hub.md' }, ctx());
    expect(hub.content).toContain('Links: [[Ideas]] -> Projects/Ideas.md');
  });

  it('a unique alias resolves, and a miss offers the closest notes by search', async () => {
    seed({
      'Notes/Roadmap.md': '---\naliases: [North Star]\n---\n# Roadmap\nQ4 plan for kubernetes.',
      'Other.md': 'unrelated',
    });
    const byAlias = await vaultReadTool.execute({ path: 'North Star' }, ctx());
    expect(byAlias.content).toMatch(/^Note: Notes\/Roadmap\.md /);
    const miss = await vaultReadTool.execute({ path: 'kubernetes' }, ctx());
    expect(miss.content).toBe(
      'No vault note at kubernetes.md yet. Closest by search: "Notes/Roadmap.md".',
    );
  });

  it('reads one section by #heading, by section, or by ^block', async () => {
    seed({
      'Plan.md':
        '# Plan\nintro\n## Goals\ngoal a\n### Sub\nsub text\n## Risks\nrisk b\n\npara one\npara two ^blk\n',
    });
    const goals = await vaultReadTool.execute({ path: 'Plan#Goals' }, ctx());
    expect(goals.content).toContain('Section: Goals\n---\n## Goals\ngoal a\n### Sub\nsub text');
    expect(goals.content).not.toContain('risk b');
    const block = await vaultReadTool.execute({ path: 'Plan', section: '^blk' }, ctx());
    expect(bodyOf(block.content)).toBe('para one\npara two ^blk');
    const none = await vaultReadTool.execute({ path: 'Plan', section: 'Nope' }, ctx());
    expect(none.content).toContain('No section "Nope" in Plan.md. Its outline:');
    expect(none.content).toContain('  ## Risks');
  });

  it('the header names properties, tags and links, resolved or not', async () => {
    seed({
      'A.md': '---\nstatus: draft\ntags: [project]\n---\nBody #idea links [[B]] and [[Missing]].',
      'B.md': 'b',
    });
    const out = (await vaultReadTool.execute({ path: 'A' }, ctx())).content;
    expect(out).toContain('Properties: status, tags');
    expect(out).toContain('Tags: #project, #idea');
    expect(out).toContain('Links: [[B]] -> B.md; [[Missing]] (unresolved)');
  });

  it('past the seat cap a read returns the outline and asks for a section', async () => {
    const long = 'x'.repeat(400);
    seed({ 'Long.md': `# One\n${long}\n## Two\n${long}\n## Three\nshort part` });
    const capped = { ...ctx(), vaultReadCapChars: () => 200 } as ToolContext;
    const out = (await vaultReadTool.execute({ path: 'Long' }, capped)).content;
    expect(out).toContain('more than this model reads at once (200). Its outline:');
    expect(out).toContain('  ## Two');
    expect(out).not.toContain(long);
    const part = await vaultReadTool.execute({ path: 'Long', section: 'Three' }, capped);
    expect(bodyOf(part.content)).toBe('## Three\nshort part');
  });

  it('search returns ranked snippets with the heading where the words fall', async () => {
    seed({
      'Infra/K8s.md':
        '---\ntags: [infra]\n---\n# Infra\nIntro text.\n## Migration\nThe kubernetes migration moves every service to kubernetes, kubernetes first.',
      'Notes/Misc.md': '# Misc\nWe once mentioned kubernetes in passing.',
      'Other.md': 'nothing relevant here',
    });
    const out = (await vaultSearchTool.execute({ query: 'kubernetes migration' }, ctx())).content;
    const lines = out.split('\n');
    expect(lines[0]).toBe('2 notes match "kubernetes migration", best first:');
    expect(lines[1]).toBe('1. Infra/K8s.md > Migration');
    expect(lines[2]).toContain('kubernetes migration moves');
    expect(lines[3]).toBe('2. Notes/Misc.md > Misc');
    expect(lines[4]).toContain('mentioned kubernetes');
    expect(out).not.toContain('Other.md');
    expect(lines.at(-1)).toMatch(/^Read one with vaultRead/);
    const inNotes = await vaultSearchTool.execute({ query: 'kubernetes', folder: 'notes' }, ctx());
    expect(inNotes.content).toContain('Notes/Misc.md');
    expect(inNotes.content).not.toContain('Infra/K8s.md');
    const tagged = await vaultSearchTool.execute({ query: 'kubernetes', tag: '#infra' }, ctx());
    expect(tagged.content).toContain('Infra/K8s.md');
    expect(tagged.content).not.toContain('Notes/Misc.md');
    const one = await vaultSearchTool.execute({ query: 'kubernetes', k: 1 }, ctx());
    expect(one.content.split('\n')[0]).toBe('1 note match "kubernetes", best first:');
  });

  it('backlinks name each linking note with the passage around its link', async () => {
    seed({
      'Projects/Ideas.md': '# Ideas',
      'Hub.md': 'The plan lives in [[Ideas]] for now.',
      'Log.md': 'Nothing links here.',
    });
    const out = (await vaultBacklinksTool.execute({ path: 'Ideas' }, ctx())).content;
    expect(out.split('\n')).toEqual([
      '1 note link to Projects/Ideas.md:',
      '- Hub.md: The plan lives in [[Ideas]] for now.',
    ]);
  });

  it('vaultLookup takes exactly one of query or path, and does what each asks', async () => {
    seed({ 'Projects/Ideas.md': '# Ideas\nShip kubernetes.' });
    expect(vaultLookupTool.schema.safeParse({}).success).toBe(false);
    expect(vaultLookupTool.schema.safeParse({ query: 'a', path: 'b' }).success).toBe(false);
    const found = await vaultLookupTool.execute({ query: 'kubernetes' }, ctx());
    expect(found.content).toContain('1. Projects/Ideas.md > Ideas');
    const read = await vaultLookupTool.execute({ path: 'Ideas' }, ctx());
    expect(bodyOf(read.content)).toBe('# Ideas\nShip kubernetes.');
  });

  it('a vaultWrite reaches the index, so search finds the note at once', async () => {
    seed({ 'Old.md': 'old note' });
    await vaultSearchTool.execute({ query: 'old' }, ctx());
    await vaultWriteTool.execute(
      { path: 'Fresh/Decision', content: 'We chose zeppelins.', mode: 'replace' },
      ctx(),
    );
    const out = (await vaultSearchTool.execute({ query: 'zeppelins' }, ctx())).content;
    expect(out).toContain('1. Fresh/Decision.md');
  });
});

// ---------------------------------------------------------------------------
// Vault M4 (4.2 tool half, CTO I5): privacy inside the tools

/** A hand-built privacy judge standing in for compileVaultPrivacy: Secret/ and
 *  an exclude mark hide, Private/, a private tag and a local-only mark keep a
 *  note on this computer. */
const privacy: VaultPrivacy = {
  visibility({ path, tags, oscode }) {
    const p = path.toLowerCase();
    if (p.startsWith('secret/') || oscode?.includes('exclude')) return 'hidden';
    const priv = tags?.some((t) => /^private(\/|$)/i.test(t));
    if (p.startsWith('private/') || priv || oscode?.includes('local-only')) return 'local-only';
    return 'open';
  },
};

function pctx(leaves?: boolean): ToolContext {
  return {
    vaultRoot: root,
    vaultPrivacy: privacy,
    ...(leaves === undefined ? {} : { seatLeavesNetwork: () => leaves }),
  } as unknown as ToolContext;
}

function seedPrivate(): void {
  seed({
    'Secret/plan.md': 'kubernetes secret plan, see [[k]]',
    'Private/diary.md': 'kubernetes diary, see [[k]]',
    'Open/k.md': 'kubernetes open [[plan]] [[diary]]',
    'Marked.md': '---\noscode: exclude\n---\nkubernetes marked',
    'Tagged.md': '---\ntags: [private]\n---\nkubernetes tagged',
  });
}

describe('vault privacy in the tools', () => {
  it('an excluded folder or mark is invisible to list, read, search and backlinks', async () => {
    seedPrivate();
    const handle = await engineVaultIndex(root);
    expect(await handle.whenReconciled(5000)).toBe(true);
    const list = (await vaultListTool.execute({}, pctx(false))).content;
    expect(list).not.toContain('Secret');
    expect(list).not.toContain('Marked.md');
    expect(list).not.toMatch(/hidden/);
    expect(list.split('\n')[0]).toBe('3 notes. Showing 1 to 3.');
    const folderList = await vaultListTool.execute({ folder: 'Nope' }, pctx(false));
    expect(folderList.content).not.toContain('"Secret"');

    for (const path of ['Secret/plan.md', 'Marked.md']) {
      const read = await vaultReadTool.execute({ path }, pctx(false));
      expect(read.content).toBe(`No vault note at ${path} yet.`);
    }
    const bare = await vaultReadTool.execute({ path: 'plan' }, pctx(false));
    expect(bare.content).toMatch(/^No vault note at plan\.md yet\./);
    expect(bare.content).not.toContain('Secret');
    const header = (await vaultReadTool.execute({ path: 'Open/k.md' }, pctx(false))).content;
    expect(header).toContain('[[plan]] (unresolved)');

    const search = (await vaultSearchTool.execute({ query: 'kubernetes' }, pctx(false))).content;
    expect(search).toContain('Open/k.md');
    expect(search).not.toContain('Secret/');
    expect(search).not.toContain('Marked.md');

    const back = await vaultBacklinksTool.execute({ path: 'Secret/plan.md' }, pctx(false));
    expect(back.content).toBe('No vault note at Secret/plan.md.');
    const intoOpen = (await vaultBacklinksTool.execute({ path: 'Open/k.md' }, pctx(false))).content;
    expect(intoOpen).not.toContain('Secret/');

    await expect(
      vaultWriteTool.execute({ path: 'Secret/new', content: 'x', mode: 'replace' }, pctx(false)),
    ).resolves.toEqual({
      ok: false,
      content:
        "Secret/ is closed to the agent by the person's vault settings. Write somewhere else.",
    });
    expect(existsSync(join(root, 'Secret/new.md'))).toBe(false);
    const marked = await vaultWriteTool.execute(
      { path: 'Marked.md', content: 'y', mode: 'append' },
      pctx(false),
    );
    expect(marked.ok).toBe(false);
  });

  it('a local-only note reaches only a local seat, and its output is flagged', async () => {
    seedPrivate();
    const local = await vaultReadTool.execute({ path: 'Private/diary.md' }, pctx(false));
    expect(local.content).toContain('kubernetes diary');
    expect(local.localOnly).toBe(true);
    for (const seat of [pctx(true), pctx(undefined)]) {
      const away = await vaultReadTool.execute({ path: 'Private/diary.md' }, seat);
      expect(away.content).toMatch(/stays on this computer/);
      expect(away.content).not.toContain('kubernetes diary');
      expect(away.localOnly).toBeUndefined();
      const byTag = await vaultReadTool.execute({ path: 'Tagged' }, seat);
      expect(byTag.content).not.toContain('kubernetes tagged');
    }
    const openRead = await vaultReadTool.execute({ path: 'Open/k.md' }, pctx(false));
    expect(openRead.localOnly).toBeUndefined();

    const away = await vaultSearchTool.execute({ query: 'kubernetes' }, pctx(true));
    expect(away.content).not.toContain('Private/diary.md');
    expect(away.content).not.toContain('Tagged.md');
    expect(away.localOnly).toBeUndefined();
    const home = await vaultSearchTool.execute({ query: 'kubernetes' }, pctx(false));
    expect(home.content).toContain('Private/diary.md');
    expect(home.content).toContain('Tagged.md');
    expect(home.localOnly).toBe(true);

    const backAway = await vaultBacklinksTool.execute({ path: 'Open/k.md' }, pctx(true));
    expect(backAway.content).toBe('No notes link to Open/k.md.');
    const backHome = await vaultBacklinksTool.execute({ path: 'Open/k.md' }, pctx(false));
    expect(backHome.content).toContain('- Private/diary.md: kubernetes diary, see [[k]]');
    expect(backHome.localOnly).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vault M4 (CTO I11): a lean seat sees the one merged vault tool

/** The loop's small-seat priority list as it stands (core/agent/loop.ts),
 *  with vaultLookup placed by the registry's helper. */
const LOOP_PRIORITY = [
  'readFile',
  'editFile',
  'writeFile',
  'grep',
  'glob',
  'searchRepo',
  'runShell',
  'todoWrite',
  'gitDiff',
  'gitStatus',
  'webFetch',
  'webSearch',
  'readTerminal',
];

/** What a seat is offered, the way the loop cuts it: the vault filter, then
 *  the priority sort, then maxToolsShown. */
function offered(input: DeriveInput): string[] {
  const profile = deriveProfile(input);
  const names = buildToolRegistry({
    stackHasVision: false,
    stackHasImageGen: false,
    stackHasSpecialists: false,
  })
    .names()
    .filter((n) => seatOffersVaultTool(n, profile.mergedVaultTool));
  const priority = withVaultLookupPriority(LOOP_PRIORITY);
  const rank = (n: string) => (priority.includes(n) ? priority.indexOf(n) : priority.length);
  const sorted = [...names].sort((a, b) => rank(a) - rank(b));
  return Number.isFinite(profile.maxToolsShown) ? sorted.slice(0, profile.maxToolsShown) : sorted;
}

describe('lean seats and the merged vault tool', () => {
  it('vaultLookup sits right after searchRepo', () => {
    const p = withVaultLookupPriority(LOOP_PRIORITY);
    expect(p[p.indexOf('searchRepo') + 1]).toBe('vaultLookup');
    expect(withVaultLookupPriority(['readFile'])).toEqual(['readFile', 'vaultLookup']);
  });

  it('a small seat sees the merged tool and none of the separate reads', () => {
    const small = offered({ model: 'qwen2.5-coder:7b', kind: 'local' });
    expect(small).toContain('vaultLookup');
    for (const n of ['vaultRead', 'vaultSearch', 'vaultBacklinks', 'vaultList']) {
      expect(small).not.toContain(n);
    }
  });

  it('a tiny seat leans on the pack; a large seat sees the separate reads', () => {
    expect(offered({ model: 'qwen2.5-coder:1.5b', kind: 'local' })).not.toContain('vaultLookup');
    const large = offered({ model: 'claude', kind: 'cloud' });
    expect(large).not.toContain('vaultLookup');
    for (const n of ['vaultRead', 'vaultSearch', 'vaultBacklinks', 'vaultList', 'vaultWrite']) {
      expect(large).toContain(n);
    }
  });
});
