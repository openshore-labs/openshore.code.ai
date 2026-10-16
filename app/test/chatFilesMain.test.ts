// The desktop's chat file channels (electron/chatFilesFs.ts behind main's
// guarded osc:chatFile*): the renderer is untrusted input (UI-6), so main
// writes only `YYYY-MM/<name>.md` inside ~/OpenShore/Chats, through every
// link on the way, never through a link, capped, temp then rename. Run on a
// real folder, as main runs it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHAT_FILE_MAX_BYTES,
  listChatMonth,
  removeChatFile,
  writeChatFile,
} from '../electron/chatFilesFs.js';

let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'chatfiles-'));
  root = join(base, 'OpenShore', 'Chats');
  outside = join(base, 'elsewhere');
  mkdirSync(outside, { recursive: true });
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('writing a chat file', () => {
  it('makes the folders, writes the text, and leaves no temp file', async () => {
    await writeChatFile(root, '2026-10/hello-c1234567.md', '# Hello\n');
    expect(readFileSync(join(root, '2026-10', 'hello-c1234567.md'), 'utf8')).toBe('# Hello\n');
    expect(readdirSync(join(root, '2026-10'))).toEqual(['hello-c1234567.md']);
    await writeChatFile(root, '2026-10/hello-c1234567.md', '# Again\n');
    expect(readFileSync(join(root, '2026-10', 'hello-c1234567.md'), 'utf8')).toBe('# Again\n');
  });

  it('refuses any path that is not a month folder and one .md file', async () => {
    for (const bad of [
      '../escape.md',
      '2026-10/../../escape.md',
      join(outside, 'abs.md'),
      '/etc/passwd',
      '2026-10/notes.txt',
      '2026-10/.hidden.md',
      '2026-10/a/b.md',
      '2026-10\\win.md',
      '2026-10/nul.md',
      '2026-10/a:b.md',
      'loose.md',
      42,
      undefined,
    ]) {
      await expect(writeChatFile(root, bad, 'x'), String(bad)).rejects.toThrow(/blocked/);
    }
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses a month folder that is a link out of Chats', async () => {
    mkdirSync(root, { recursive: true });
    symlinkSync(outside, join(root, '2026-10'));
    await expect(writeChatFile(root, '2026-10/x-c1234567.md', 'x')).rejects.toThrow(/leaves/);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('never writes through a file that is a link', async () => {
    mkdirSync(join(root, '2026-10'), { recursive: true });
    const target = join(outside, 'target.md');
    writeFileSync(target, 'theirs');
    symlinkSync(target, join(root, '2026-10', 'x-c1234567.md'));
    await expect(writeChatFile(root, '2026-10/x-c1234567.md', 'mine')).rejects.toThrow();
    expect(readFileSync(target, 'utf8')).toBe('theirs');
  });

  it('caps the size and takes only text', async () => {
    await expect(
      writeChatFile(root, '2026-10/big-c1234567.md', 'x'.repeat(CHAT_FILE_MAX_BYTES + 1)),
    ).rejects.toThrow(/too large/);
    await expect(writeChatFile(root, '2026-10/n-c1234567.md', 12)).rejects.toThrow(/string/);
  });
});

describe('removing and listing', () => {
  it('removes a chat file, answers false when it is not there, and never a folder', async () => {
    expect(await removeChatFile(root, '2026-10/none-c1234567.md')).toBe(false);
    await writeChatFile(root, '2026-10/a-c1234567.md', 'a');
    expect(await removeChatFile(root, '2026-10/a-c1234567.md')).toBe(true);
    expect(existsSync(join(root, '2026-10', 'a-c1234567.md'))).toBe(false);
    mkdirSync(join(root, '2026-10', 'dir.md'));
    await expect(removeChatFile(root, '2026-10/dir.md')).rejects.toThrow(/blocked/);
    await expect(removeChatFile(root, '../x.md')).rejects.toThrow(/blocked/);
  });

  it('lists one month’s markdown files, leaving links, folders and dot files out', async () => {
    expect(await listChatMonth(root, '2026-10')).toEqual([]);
    await writeChatFile(root, '2026-10/a-c1234567.md', 'a');
    writeFileSync(join(root, '2026-10', 'other.txt'), 'x');
    writeFileSync(join(root, '2026-10', '.chat-temp.tmp'), 'x');
    symlinkSync(join(outside), join(root, '2026-10', 'link.md'));
    const listed = await listChatMonth(root, '2026-10');
    expect(listed.map((f) => f.name)).toEqual(['a-c1234567.md']);
    expect(listed[0]!.mtimeMs).toBeGreaterThan(0);
    await expect(listChatMonth(root, '../x')).rejects.toThrow(/blocked/);
    await expect(listChatMonth(root, '2026-1')).rejects.toThrow(/blocked/);
  });

  it('refuses to list a month folder that links out of Chats', async () => {
    mkdirSync(root, { recursive: true });
    symlinkSync(outside, join(root, '2026-09'));
    await expect(listChatMonth(root, '2026-09')).rejects.toThrow(/leaves/);
  });
});

describe('main wires the channels to its own folder only', () => {
  const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
  const preload = readFileSync(join(process.cwd(), 'electron', 'preload.cjs'), 'utf8');

  it('guards each channel, keeps it in lockstep with the preload, and roots it at Chats', () => {
    for (const ch of ['chatFileWrite', 'chatFileRemove', 'chatFileList']) {
      expect(preload).toContain(`${ch}: invoke('osc:${ch}')`);
    }
    expect(main).toMatch(
      /guarded\('osc:chatFileWrite', \(p: unknown, t: unknown\) =>\s+writeChatFile\(sectionDir\('chats'\), p, t\),?\s*\);/,
    );
    expect(main).toMatch(
      /guarded\('osc:chatFileRemove', \(p: unknown\) => removeChatFile\(sectionDir\('chats'\), p\)\);/,
    );
    expect(main).toMatch(
      /guarded\('osc:chatFileList', \(month: unknown\) => listChatMonth\(sectionDir\('chats'\), month\)\);/,
    );
  });
});
