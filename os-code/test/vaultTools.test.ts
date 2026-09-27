// The agent's on-device vault tools: reads/lists flow, writes are always-ask,
// and note paths can never escape the vault directory.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vaultWriteTool, vaultReadTool, vaultListTool } from '../src/core/tools/vault.js';
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
