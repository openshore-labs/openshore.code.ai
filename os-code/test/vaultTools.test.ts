// The agent's on-device vault tools: reads/lists flow, writes are always-ask,
// and note paths can never escape the vault directory.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
