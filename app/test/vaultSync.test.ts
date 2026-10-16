// Sync on all devices (founder, 2026-10-16): the pass that brings a device's
// working copy and the computer's together, over two in-memory storages.
import { describe, expect, it } from 'vitest';
import {
  conflictCopyPath,
  syncPass,
  type SyncLedger,
  type SyncSide,
} from '../src/lib/gitos/sync.js';
import type {
  StorageProvider,
  StoredFile,
  WriteGuard,
  WriteResult,
} from '../src/lib/gitos/providers.js';

/** A compare-and-swap storage in memory, with a Trash when asked. */
function memory(withTrash = false) {
  const files = new Map<string, StoredFile>();
  const trashed: string[] = [];
  let n = 0;
  const stamp = () => `v${++n}`;
  const meta = (f: StoredFile) => ({
    path: f.path,
    updatedAt: f.updatedAt,
    size: f.text.length,
    version: f.version,
  });
  const provider: StorageProvider = {
    id: 'local',
    label: 'mem',
    blurb: '',
    ready: true,
    compareAndSwap: true,
    async list() {
      return [...files.values()].map(meta);
    },
    async stat(_r, path) {
      const f = files.get(path);
      return f ? meta(f) : undefined;
    },
    async read(_r, path) {
      return files.get(path);
    },
    async write(_r, path, text, guard?: WriteGuard): Promise<WriteResult> {
      const cur = files.get(path);
      if (guard && 'ifAbsent' in guard && guard.ifAbsent && cur) {
        return { ok: false, conflict: 'exists', theirs: cur };
      }
      if (guard && 'ifMatch' in guard && guard.ifMatch !== undefined) {
        if (!cur) return { ok: false, conflict: 'missing' };
        if (cur.version !== guard.ifMatch) return { ok: false, conflict: 'changed', theirs: cur };
      }
      const file = { path, text, updatedAt: new Date().toISOString(), version: stamp() };
      files.set(path, file);
      return { ok: true, file };
    },
    async remove(_r, path, guard) {
      const cur = files.get(path);
      if (!cur) return { ok: false, conflict: 'missing' };
      if (guard && cur.version !== guard.ifMatch) {
        return { ok: false, conflict: 'changed', theirs: cur };
      }
      files.delete(path);
      return { ok: true };
    },
    async acquireLease(_r, holder) {
      return { holder, expiresAt: '' };
    },
    async releaseLease() {},
  };
  if (withTrash) {
    provider.trash = async (_r, target) => {
      const cur = files.get(target.path);
      if (!cur) return { ok: false, conflict: 'missing' };
      if (target.kind === 'note' && cur.version !== target.ifMatch) {
        return { ok: false, conflict: 'changed', theirs: cur };
      }
      files.delete(target.path);
      trashed.push(target.path);
      return {
        ok: true,
        entry: { id: target.path, path: target.path, kind: 'note', deletedAt: '' } as never,
        notes: 1,
        attachments: 0,
      };
    };
  }
  const configs = new Map<string, { text: string; version: string }>();
  provider.readConfig = async (_r, name) => {
    const c = configs.get(name);
    return c ? { ok: true, ...c } : { ok: false, reason: 'absent' };
  };
  provider.writeConfig = async (_r, name, text, guard) => {
    const cur = configs.get(name);
    if ('ifAbsent' in guard && guard.ifAbsent && cur) return { ok: false, conflict: 'exists' };
    if ('ifMatch' in guard && guard.ifMatch !== undefined && cur?.version !== guard.ifMatch) {
      return { ok: false, conflict: 'changed' };
    }
    const version = stamp();
    configs.set(name, { text, version });
    return { ok: true, file: { path: name, text, updatedAt: '', version } };
  };
  const side: SyncSide = { provider, resourceId: 'vault' };
  const text = (p: string) => files.get(p)?.text;
  const set = async (p: string, t: string) => {
    await provider.write('vault', p, t);
  };
  const del = (p: string) => files.delete(p);
  return { side, files, text, set, del, trashed, configs };
}

const opts = {
  conflictPath: (p: string, taken: (p: string) => boolean) =>
    conflictCopyPath(p, 'from this iPhone', '2026-10-16', taken),
};

/** A device and a computer that agreed once on `seed`. */
async function agreed(seed: Record<string, string>, trash = false) {
  const phone = memory(trash);
  const computer = memory(trash);
  for (const [p, t] of Object.entries(seed)) await computer.set(p, t);
  const first = await syncPass(phone.side, computer.side, {}, opts);
  return { phone, computer, ledger: first.ledger };
}

describe('a sync pass', () => {
  it('brings a new device level with the computer on the first pass', async () => {
    const { phone, ledger } = await agreed({ 'Ideas.md': 'one', 'Plans/Trip.md': 'two' });
    expect(phone.text('Ideas.md')).toBe('one');
    expect(phone.text('Plans/Trip.md')).toBe('two');
    expect(Object.keys(ledger).sort()).toEqual(['Ideas.md', 'Plans/Trip.md']);
  });

  it('pushes an edit made apart on this device, and pulls one made on the computer', async () => {
    const { phone, computer, ledger } = await agreed({ 'A.md': 'a', 'B.md': 'b' });
    await phone.set('A.md', 'a from the phone');
    await computer.set('B.md', 'b from the computer');
    await phone.set('New.md', 'made offline');
    const r = await syncPass(phone.side, computer.side, ledger, opts);
    expect(r.pushed.sort()).toEqual(['A.md', 'New.md']);
    expect(r.pulled).toEqual(['B.md']);
    expect(computer.text('A.md')).toBe('a from the phone');
    expect(computer.text('New.md')).toBe('made offline');
    expect(phone.text('B.md')).toBe('b from the computer');
    // A second pass has nothing to do.
    const again = await syncPass(phone.side, computer.side, r.ledger, opts);
    expect([...again.pushed, ...again.pulled, ...again.removed]).toEqual([]);
  });

  it('carries a delete either way, to Trash where there is one', async () => {
    const { phone, computer, ledger } = await agreed({ 'A.md': 'a', 'B.md': 'b' }, true);
    phone.del('A.md');
    computer.del('B.md');
    const r = await syncPass(phone.side, computer.side, ledger, opts);
    expect(r.removed.sort()).toEqual(['A.md', 'B.md']);
    expect(computer.text('A.md')).toBeUndefined();
    expect(phone.text('B.md')).toBeUndefined();
    expect(computer.trashed).toEqual(['A.md']);
    expect(phone.trashed).toEqual(['B.md']);
    expect(r.ledger).toEqual({});
  });

  it('keeps the edit when one side deleted a note the other changed', async () => {
    const { phone, computer, ledger } = await agreed({ 'A.md': 'a', 'B.md': 'b' });
    phone.del('A.md');
    await computer.set('A.md', 'a edited on the computer');
    await phone.set('B.md', 'b edited on the phone');
    computer.del('B.md');
    const r = await syncPass(phone.side, computer.side, ledger, opts);
    expect(phone.text('A.md')).toBe('a edited on the computer');
    expect(computer.text('B.md')).toBe('b edited on the phone');
    expect(r.conflicts).toEqual([]);
  });

  it('keeps both when both changed a note: the computer keeps the note, the copy sits beside it', async () => {
    const { phone, computer, ledger } = await agreed({ 'Plans/Trip.md': 'start' });
    await phone.set('Plans/Trip.md', 'phone version');
    await computer.set('Plans/Trip.md', 'computer version');
    const r = await syncPass(phone.side, computer.side, ledger, opts);
    const copy = 'Plans/Trip (from this iPhone 2026-10-16).md';
    expect(r.conflicts).toEqual([{ path: 'Plans/Trip.md', copy }]);
    for (const side of [phone, computer]) {
      expect(side.text('Plans/Trip.md')).toBe('computer version');
      expect(side.text(copy)).toBe('phone version');
    }
    const again = await syncPass(phone.side, computer.side, r.ledger, opts);
    expect([...again.pushed, ...again.pulled, ...again.conflicts]).toEqual([]);
  });

  it('agrees without a copy when both made the same change', async () => {
    const { phone, computer, ledger } = await agreed({ 'A.md': 'a' });
    await phone.set('A.md', 'same');
    await computer.set('A.md', 'same');
    const r = await syncPass(phone.side, computer.side, ledger, opts);
    expect(r.conflicts).toEqual([]);
    expect(phone.files.size).toBe(1);
  });

  it('meets an existing vault on both sides without losing either', async () => {
    const phone = memory();
    const computer = memory();
    await phone.set('Shared.md', 'phone text');
    await phone.set('PhoneOnly.md', 'p');
    await computer.set('Shared.md', 'computer text');
    await computer.set('ComputerOnly.md', 'c');
    const r = await syncPass(phone.side, computer.side, {}, opts);
    expect(phone.text('ComputerOnly.md')).toBe('c');
    expect(computer.text('PhoneOnly.md')).toBe('p');
    expect(r.conflicts).toHaveLength(1);
    expect(phone.text('Shared.md')).toBe('computer text');
    expect(computer.text(r.conflicts[0]!.copy)).toBe('phone text');
  });

  it('leaves a note typed into during the pass for the next one, losing nothing', async () => {
    const { phone, computer, ledger } = await agreed({ 'A.md': 'a' });
    await computer.set('A.md', 'from the computer');
    // The person types on the phone the moment the pull lands.
    const write = phone.side.provider.write.bind(phone.side.provider);
    let typed = false;
    phone.side.provider.write = async (r, p, t, g) => {
      if (!typed) {
        typed = true;
        await write(r, p, 'typed just now');
      }
      return write(r, p, t, g);
    };
    const r = await syncPass(phone.side, computer.side, ledger, opts);
    expect(r.skipped.map((s) => s.path)).toEqual(['A.md']);
    expect(phone.text('A.md')).toBe('typed just now');
    // The next pass sees both changed and keeps both.
    phone.side.provider.write = write;
    const next = await syncPass(phone.side, computer.side, r.ledger, opts);
    expect(next.conflicts).toHaveLength(1);
    expect(phone.text(next.conflicts[0]!.copy)).toBe('typed just now');
    expect(computer.text('A.md')).toBe('from the computer');
  });

  it("carries the vault's settings file, so its private marks hold on every device", async () => {
    const { phone, computer, ledger } = await agreed({ 'A.md': 'a' });
    await computer.side.provider.writeConfig!('vault', 'oscode/vault', '{"localOnly":["Work"]}', {
      ifAbsent: true,
    });
    const r = await syncPass(phone.side, computer.side, ledger, opts);
    expect(phone.configs.get('oscode/vault')?.text).toBe('{"localOnly":["Work"]}');
    expect(r.pulled).toContain('.config/oscode/vault');
    // Changed on both: the computer's stands.
    await phone.side.provider.writeConfig!('vault', 'oscode/vault', 'phone', {
      ifMatch: phone.configs.get('oscode/vault')!.version,
    });
    await computer.side.provider.writeConfig!('vault', 'oscode/vault', 'computer', {
      ifMatch: computer.configs.get('oscode/vault')!.version,
    });
    await syncPass(phone.side, computer.side, r.ledger, opts);
    expect(phone.configs.get('oscode/vault')?.text).toBe('computer');
  });

  it('syncs notes only, never dot folders', async () => {
    const phone = memory();
    const computer = memory();
    await computer.set('.obsidian/app.md', 'x');
    await computer.set('Note.md', 'n');
    await syncPass(phone.side, computer.side, {}, opts);
    expect([...phone.files.keys()]).toEqual(['Note.md']);
  });

  it('keeps going past a note that fails, and tries it again next pass', async () => {
    const { phone, computer, ledger } = await agreed({ 'A.md': 'a', 'B.md': 'b' });
    await phone.set('A.md', 'a2');
    await phone.set('B.md', 'b2');
    const read = phone.side.provider.read.bind(phone.side.provider);
    phone.side.provider.read = async (r, p) => {
      if (p === 'A.md') throw new Error('disk busy');
      return read(r, p);
    };
    const r = await syncPass(phone.side, computer.side, ledger as SyncLedger, opts);
    expect(r.pushed).toEqual(['B.md']);
    expect(r.skipped).toEqual([{ path: 'A.md', reason: 'disk busy' }]);
    phone.side.provider.read = read;
    const next = await syncPass(phone.side, computer.side, r.ledger, opts);
    expect(next.pushed).toEqual(['A.md']);
    expect(computer.text('A.md')).toBe('a2');
  });
});

describe('the conflict copy name', () => {
  it('names the device and the day, and numbers a taken name', () => {
    const taken = new Set(['Ideas (from this iPad 2026-10-16).md']);
    expect(conflictCopyPath('Ideas.md', 'from this iPad', '2026-10-16', (p) => taken.has(p))).toBe(
      'Ideas (from this iPad 2026-10-16 2).md',
    );
  });
});
