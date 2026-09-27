// The agent's on-device vault tools: reads/lists flow, writes are always-ask,
// and note paths can never escape the vault directory.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vaultWriteTool, vaultReadTool, vaultListTool } from '../src/core/tools/vault.js';

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
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

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
    expect((await vaultReadTool.execute({ path: 'a.md' }, ctx())).content).toBe('hello');
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
