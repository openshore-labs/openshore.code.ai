// Vault M6 on a desktop folder (tech review K3, K5, K6, K11, K13): rename guarded by
// the source's version and never replacing, folders with counts, Trash under
// `.trash/<original path>` with Restore beside a taken name, attachments and
// their capped bytes. The same folderFs code serves Electron main and the
// daemon, so these cases cover both hosts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// The attachment rules are stream A2's; until they land in this tree the
// stub throws "not built", so a small stand-in answers for it. Once the real
// module is here, it answers and the stand-in is never asked.
vi.mock('../src/harness/vault/attachments.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/harness/vault/attachments.js')>();
  const EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
  };
  const mime = (p: string) => EXT[/\.([a-z]+)$/i.exec(p)?.[1]?.toLowerCase() ?? ''];
  const is = (p: string) =>
    !!mime(p) &&
    !p.includes('\\') &&
    !p.startsWith('/') &&
    p.split('/').every((s) => s && !s.startsWith('.'));
  const match = (b: Uint8Array, m: string) =>
    m === 'image/png'
      ? b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
      : m === 'application/pdf'
        ? String.fromCharCode(...b.slice(0, 4)) === '%PDF'
        : true;
  const orFake =
    <A extends unknown[], R>(f: (...a: A) => R, fake: (...a: A) => R) =>
    (...a: A): R => {
      try {
        return f(...a);
      } catch (e) {
        if (String(e).includes('not built')) return fake(...a);
        throw e;
      }
    };
  return {
    ...real,
    isAttachmentPath: orFake(real.isAttachmentPath, is),
    attachmentMime: orFake(real.attachmentMime, mime as typeof real.attachmentMime),
    bytesMatchMime: orFake(real.bytesMatchMime, match as typeof real.bytesMatchMime),
  };
});

import {
  createVaultFolder,
  emptyVaultTrash,
  listVaultAttachments,
  listVaultFolder,
  listVaultFolders,
  listVaultTrash,
  parseReadBytesOptions,
  parseVaultRenameGuard,
  parseVaultTrashIds,
  parseVaultTrashTarget,
  readVaultBytes,
  renameVaultFile,
  renameVaultFolder,
  restoreVaultTrash,
  statVaultFile,
  trashVaultPath,
} from '../src/core/vault/folderFs.js';

let root: string;
let outside: string;

function write(rel: string, text: string | Buffer): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
async function version(rel: string): Promise<string> {
  return (await statVaultFile(root, rel))!.version;
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'osc-vault-ops-'));
  outside = mkdtempSync(join(tmpdir(), 'osc-vault-out-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('renameVaultFile (K3)', () => {
  it('moves the note, keeps its bytes and version, and makes the parents', async () => {
    write('Plan.md', 'the plan');
    const v = await version('Plan.md');
    const r = await renameVaultFile(root, 'Plan.md', 'Work/Q3/Launch plan.md', { ifMatch: v });
    expect(r).toMatchObject({ ok: true, file: { path: 'Work/Q3/Launch plan.md', size: 8 } });
    if (!r.ok) throw new Error('rename failed');
    expect(r.file.version).toBe(await version('Work/Q3/Launch plan.md'));
    // A hard link keeps the inode, mtime and size, so the token holds.
    expect(r.file.version).toBe(v);
    expect(existsSync(join(root, 'Plan.md'))).toBe(false);
    expect(read('Work/Q3/Launch plan.md')).toBe('the plan');
  });

  it('never replaces: a name taken in any case or composition is exists, with theirs', async () => {
    write('a.md', 'mine');
    write('plan.md', 'theirs');
    write('Café.md', 'decomposed');
    const v = await version('a.md');
    const taken = await renameVaultFile(root, 'a.md', 'Plan.md', { ifMatch: v });
    expect(taken).toMatchObject({ ok: false, conflict: 'exists', theirs: { text: 'theirs' } });
    const nfc = await renameVaultFile(root, 'a.md', 'Café.md', { ifMatch: v });
    expect(nfc).toMatchObject({ ok: false, conflict: 'exists' });
    expect(read('a.md')).toBe('mine');
    expect(read('plan.md')).toBe('theirs');
  });

  it('lands in the folder that is there under another case, never beside it', async () => {
    write('Work/x.md', 'x');
    write('a.md', 'a');
    const r = await renameVaultFile(root, 'a.md', 'work/a.md', { ifMatch: await version('a.md') });
    expect(r).toMatchObject({ ok: true, file: { path: 'Work/a.md' } });
    expect(readdirSync(root).sort()).toEqual(['Work']);
    expect(await createVaultFolder(root, 'work/Inner')).toEqual({ ok: true });
    expect(await listVaultFolders(root)).toEqual(['Work', 'Work/Inner']);
  });

  it('allows a case-only rename of the same note', async () => {
    write('Notes/plan.md', 'one note');
    const v = await version('Notes/plan.md');
    const r = await renameVaultFile(root, 'Notes/plan.md', 'Notes/Plan.md', { ifMatch: v });
    expect(r.ok).toBe(true);
    expect(readdirSync(join(root, 'Notes'))).toEqual(['Plan.md']);
    expect(read('Notes/Plan.md')).toBe('one note');
  });

  it('answers changed when the version moved, and missing when the note is gone', async () => {
    write('a.md', 'first');
    const stale = await version('a.md');
    write('a.md', 'second, longer');
    const r = await renameVaultFile(root, 'a.md', 'b.md', { ifMatch: stale });
    expect(r).toMatchObject({ ok: false, conflict: 'changed', theirs: { text: 'second, longer' } });
    expect(existsSync(join(root, 'b.md'))).toBe(false);
    const gone = await renameVaultFile(root, 'none.md', 'b.md', { ifMatch: stale });
    expect(gone).toEqual({ ok: false, conflict: 'missing' });
  });

  it('refuses a dirty new name, a dot folder, an escape and a linked note', async () => {
    write('a.md', 'x');
    const v = await version('a.md');
    await expect(renameVaultFile(root, 'a.md', 'bad:name.md', { ifMatch: v })).rejects.toThrow(
      /blocked/,
    );
    await expect(renameVaultFile(root, 'a.md', '.trash/a.md', { ifMatch: v })).rejects.toThrow(
      /blocked/,
    );
    await expect(renameVaultFile(root, 'a.md', '../a.md', { ifMatch: v })).rejects.toThrow();
    await expect(renameVaultFile(root, '.obsidian/a.md', 'b.md', { ifMatch: v })).rejects.toThrow(
      /blocked/,
    );
    // A link out of the vault fails the Jail; a link inside it is not moved.
    writeFileSync(join(outside, 'secret.md'), 'secret');
    symlinkSync(join(outside, 'secret.md'), join(root, 'out.md'));
    await expect(renameVaultFile(root, 'out.md', 'b.md', { ifMatch: v })).rejects.toThrow(/leaves/);
    symlinkSync(join(root, 'a.md'), join(root, 'in.md'));
    await expect(renameVaultFile(root, 'in.md', 'b.md', { ifMatch: v })).rejects.toThrow(/blocked/);
    expect(read('a.md')).toBe('x');
  });
});

describe('folders (K5)', () => {
  it('lists real folders, empty ones too, never dot folders or links', async () => {
    mkdirSync(join(root, 'Empty'));
    write('Work/Plans/a.md', 'a');
    write('.obsidian/app.json', '{}');
    write('.trash/Old/b.md', 'b');
    symlinkSync(outside, join(root, 'Linked'));
    expect(await listVaultFolders(root)).toEqual(['Empty', 'Work', 'Work/Plans']);
  });

  it('creates a folder with its parents, and a folded name that is taken is exists', async () => {
    expect(await createVaultFolder(root, 'Work/New')).toEqual({ ok: true });
    expect(await listVaultFolders(root)).toEqual(['Work', 'Work/New']);
    expect(await createVaultFolder(root, 'work')).toEqual({ ok: false, conflict: 'exists' });
    await expect(createVaultFolder(root, '.hidden')).rejects.toThrow(/blocked/);
    await expect(createVaultFolder(root, 'a/../../b')).rejects.toThrow(/blocked/);
    await expect(createVaultFolder(root, 'bad:name')).rejects.toThrow(/blocked/);
  });

  it('renames a folder in one move and reports every note with its new version', async () => {
    write('Work/a.md', 'a');
    write('Work/Deep/b.md', 'b');
    write('Work/img.png', PNG);
    write('Work/notes.txt', 'other');
    const r = await renameVaultFolder(root, 'Work', 'Archive/Work 2025');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('folder rename failed');
    expect(r.attachments).toBe(1);
    expect(r.moved.map((m) => [m.from, m.to])).toEqual([
      ['Work/a.md', 'Archive/Work 2025/a.md'],
      ['Work/Deep/b.md', 'Archive/Work 2025/Deep/b.md'],
    ]);
    for (const m of r.moved) expect(m.version).toBe(await version(m.to));
    expect(existsSync(join(root, 'Work'))).toBe(false);
    expect(read('Archive/Work 2025/notes.txt')).toBe('other');
  });

  it('refuses a taken destination, a missing source and a move into itself', async () => {
    write('A/a.md', 'a');
    write('B/b.md', 'b');
    expect(await renameVaultFolder(root, 'A', 'b')).toEqual({ ok: false, conflict: 'exists' });
    expect(await renameVaultFolder(root, 'Nope', 'C')).toEqual({ ok: false, conflict: 'missing' });
    await expect(renameVaultFolder(root, 'A', 'A/inner')).rejects.toThrow(/itself/);
    expect(read('B/b.md')).toBe('b');
    // A case-only rename of the same folder goes through.
    expect((await renameVaultFolder(root, 'A', 'a')).ok).toBe(true);
    expect(read('a/a.md')).toBe('a');
  });
});

describe('Trash (K6, R3)', () => {
  it('moves a note to .trash/<original path>, out of every list, and restores it', async () => {
    write('Work/Plan.md', 'the plan');
    const v = await version('Work/Plan.md');
    const r = await trashVaultPath(root, { kind: 'note', path: 'Work/Plan.md', ifMatch: v });
    expect(r).toMatchObject({
      ok: true,
      notes: 1,
      attachments: 0,
      entry: { id: 'Work/Plan.md', path: 'Work/Plan.md', kind: 'note', size: 8 },
    });
    expect(readFileSync(join(root, '.trash', 'Work', 'Plan.md'), 'utf8')).toBe('the plan');
    expect(existsSync(join(root, 'Work', 'Plan.md'))).toBe(false);
    expect((await listVaultFolder(root)).map((n) => n.path)).toEqual([]);
    expect(await listVaultFolders(root)).toEqual(['Work']);

    const listed = await listVaultTrash(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: 'Work/Plan.md', path: 'Work/Plan.md', kind: 'note' });
    expect(listed[0]!.trashedAt).toBeTruthy();

    rmSync(join(root, 'Work'), { recursive: true });
    const back = await restoreVaultTrash(root, 'Work/Plan.md');
    expect(back).toMatchObject({ ok: true, renamed: false, file: { path: 'Work/Plan.md' } });
    expect(read('Work/Plan.md')).toBe('the plan');
    expect(await listVaultTrash(root)).toEqual([]);
    expect(existsSync(join(root, '.trash', 'Work'))).toBe(false);
  });

  it('guards a note by its version', async () => {
    write('a.md', 'first');
    const stale = await version('a.md');
    write('a.md', 'second, longer');
    const r = await trashVaultPath(root, { kind: 'note', path: 'a.md', ifMatch: stale });
    expect(r).toMatchObject({ ok: false, conflict: 'changed', theirs: { text: 'second, longer' } });
    expect(read('a.md')).toBe('second, longer');
    expect(await listVaultTrash(root)).toEqual([]);
  });

  it('gives a taken Trash name " 2", and Restore lands beside a taken name as (restored)', async () => {
    write('a.md', 'one');
    await trashVaultPath(root, { kind: 'note', path: 'a.md', ifMatch: await version('a.md') });
    write('a.md', 'two');
    const second = await trashVaultPath(root, {
      kind: 'note',
      path: 'a.md',
      ifMatch: await version('a.md'),
    });
    expect(second).toMatchObject({ ok: true, entry: { id: 'a 2.md', path: 'a.md' } });
    write('a.md', 'three, in the way');
    const r = await restoreVaultTrash(root, 'a 2.md');
    expect(r).toMatchObject({ ok: true, renamed: true, file: { path: 'a (restored).md' } });
    expect(read('a (restored).md')).toBe('two');
    expect(read('a.md')).toBe('three, in the way');
    const r2 = await restoreVaultTrash(root, 'a.md');
    expect(r2).toMatchObject({ ok: true, renamed: true, file: { path: 'a (restored 2).md' } });
    expect(await restoreVaultTrash(root, 'a.md')).toEqual({ ok: false, conflict: 'missing' });
  });

  it('trashes a folder with counts and restores it whole', async () => {
    write('Work/a.md', 'a');
    write('Work/Deep/b.md', 'bb');
    write('Work/img.png', PNG);
    mkdirSync(join(root, 'Work', 'Empty'));
    const r = await trashVaultPath(root, { kind: 'folder', path: 'Work' });
    expect(r).toMatchObject({ ok: true, notes: 2, attachments: 1, entry: { kind: 'folder' } });
    if (!r.ok) throw new Error('trash failed');
    expect(r.entry.size).toBe(1 + 2 + PNG.length);
    expect(await listVaultFolders(root)).toEqual([]);
    const listed = await listVaultTrash(root);
    expect(listed.map((e) => [e.id, e.kind])).toEqual([['Work', 'folder']]);
    const back = await restoreVaultTrash(root, 'Work');
    expect(back).toMatchObject({ ok: true, renamed: false, file: { path: 'Work', version: '' } });
    expect(read('Work/Deep/b.md')).toBe('bb');
    expect(existsSync(join(root, 'Work', 'Empty'))).toBe(true);
  });

  it('lists what Obsidian put in .trash, and empties by id or all of it', async () => {
    write('.trash/From Obsidian.md', 'flat');
    write('.trash/photo.png', PNG);
    write('b.md', 'b');
    write('c.md', 'c');
    await trashVaultPath(root, { kind: 'note', path: 'b.md', ifMatch: await version('b.md') });
    await trashVaultPath(root, { kind: 'note', path: 'c.md', ifMatch: await version('c.md') });
    const ids = (await listVaultTrash(root)).map((e) => e.id).sort();
    expect(ids).toEqual(['From Obsidian.md', 'b.md', 'c.md']);

    expect(await emptyVaultTrash(root, ['b.md', 'not-there.md'])).toEqual({ removed: 1 });
    expect((await listVaultTrash(root)).map((e) => e.id).sort()).toEqual([
      'From Obsidian.md',
      'c.md',
    ]);
    expect(await emptyVaultTrash(root)).toEqual({ removed: 2 });
    expect(readdirSync(join(root, '.trash'))).toEqual([]);
    await expect(emptyVaultTrash(root, ['../b.md'])).rejects.toThrow(/blocked/);
  });

  it('never uses a .trash that is a link', async () => {
    symlinkSync(outside, join(root, '.trash'));
    write('a.md', 'a');
    await expect(
      trashVaultPath(root, { kind: 'note', path: 'a.md', ifMatch: await version('a.md') }),
    ).rejects.toThrow(/blocked/);
    expect(read('a.md')).toBe('a');
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe('attachments (K11)', () => {
  it('lists attachments from the same walk and reads their bytes', async () => {
    write('img/a.png', PNG);
    write('doc.pdf', '%PDF-1.4 tiny');
    write('notes.txt', 'not an attachment');
    write('.obsidian/icon.png', PNG);
    write('n.md', 'note');
    const list = await listVaultAttachments(root);
    expect(list.map((a) => [a.path, a.mime])).toEqual([
      ['doc.pdf', 'application/pdf'],
      ['img/a.png', 'image/png'],
    ]);
    const bytes = await readVaultBytes(root, 'img/a.png');
    expect(bytes).toMatchObject({ ok: true, mime: 'image/png', version: list[1]!.version });
    if (bytes.ok) expect(Buffer.from(bytes.bytes).equals(PNG)).toBe(true);
  });

  it('refuses, caps and checks the type', async () => {
    write('a.png', PNG);
    write('fake.png', 'not a png at all');
    write('n.md', 'note');
    writeFileSync(join(outside, 'x.png'), PNG);
    symlinkSync(join(outside, 'x.png'), join(root, 'link.png'));
    expect(await readVaultBytes(root, 'a.png', { max: 4 })).toEqual({
      ok: false,
      reason: 'too-large',
    });
    expect(await readVaultBytes(root, 'fake.png')).toEqual({ ok: false, reason: 'unsupported' });
    expect(await readVaultBytes(root, 'none.png')).toEqual({ ok: false, reason: 'absent' });
    expect(await readVaultBytes(root, 'n.md')).toEqual({ ok: false, reason: 'refused' });
    expect(await readVaultBytes(root, '../x.png')).toEqual({ ok: false, reason: 'refused' });
    expect(await readVaultBytes(root, 'link.png')).toEqual({ ok: false, reason: 'refused' });
  });
});

describe('argument checks (UI-6)', () => {
  it('validates each shape like parseVaultGuard', () => {
    expect(parseVaultRenameGuard({ ifMatch: '1:2:3' })).toEqual({ ifMatch: '1:2:3' });
    expect(() => parseVaultRenameGuard(undefined)).toThrow(/blocked/);
    expect(() => parseVaultRenameGuard({ ifAbsent: true })).toThrow(/blocked/);
    expect(parseVaultTrashTarget({ kind: 'folder', path: 'A', extra: 1 })).toEqual({
      kind: 'folder',
      path: 'A',
    });
    expect(parseVaultTrashTarget({ kind: 'note', path: 'a.md', ifMatch: 'v' })).toEqual({
      kind: 'note',
      path: 'a.md',
      ifMatch: 'v',
    });
    expect(() => parseVaultTrashTarget({ kind: 'note', path: 'a.md' })).toThrow(/blocked/);
    expect(() => parseVaultTrashTarget({ kind: 'all', path: '' })).toThrow(/blocked/);
    expect(parseVaultTrashIds(undefined)).toBeUndefined();
    expect(parseVaultTrashIds(['a.md'])).toEqual(['a.md']);
    expect(() => parseVaultTrashIds(['../a.md'])).toThrow(/blocked/);
    expect(() => parseVaultTrashIds('a.md')).toThrow(/blocked/);
    expect(parseReadBytesOptions({ max: 10 })).toEqual({ max: 10 });
    expect(parseReadBytesOptions(undefined)).toEqual({});
    expect(() => parseReadBytesOptions({ max: -1 })).toThrow(/blocked/);
  });
});
