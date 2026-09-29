// The one note file module (Vault v1, CTO F1 and F2): the version token, the
// guarded write, and the read with the torn-read guard, shared by the engine's
// vault tools, the routine scheduler, and the Electron main process. Each case
// is a way a note on a shared folder could be lost or silently replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stand-ins for the file system calls a case needs to fail or race. Each is
// off unless a test sets it, so every other call is the real one.
const stubs = vi.hoisted(() => ({
  link: undefined as undefined | ((existing: string, dest: string) => Promise<void>),
  rename: undefined as undefined | ((from: string, to: string) => Promise<void>),
  afterRead: undefined as undefined | ((path: string) => void),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    link: (existing: string, dest: string) =>
      stubs.link ? stubs.link(existing, dest) : real.link(existing, dest),
    rename: (from: string, to: string) =>
      stubs.rename ? stubs.rename(from, to) : real.rename(from, to),
    open: async (...args: Parameters<typeof real.open>) => {
      const fh = await real.open(...args);
      const hook = stubs.afterRead;
      if (hook && args[1] === 'r') {
        const readFile = fh.readFile.bind(fh);
        Object.assign(fh, {
          readFile: async (...rest: Parameters<typeof fh.readFile>) => {
            const out = await readFile(...rest);
            stubs.afterRead = undefined;
            hook(String(args[0]));
            return out;
          },
        });
      }
      return fh;
    },
  };
});

import {
  NOTE_TEMP_PATTERN,
  NotANoteError,
  noteFileHooksForTests,
  noteVersion,
  readNote,
  readNoteBytes,
  statNote,
  sweepNoteTemps,
  writeNewNoteSync,
  writeNote,
} from '../src/core/vault/noteFile.js';

let root: string;
const realPlatform = process.platform;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'osc-notefile-'));
});
afterEach(() => {
  stubs.link = undefined;
  stubs.rename = undefined;
  stubs.afterRead = undefined;
  noteFileHooksForTests.afterTemp = undefined;
  Object.defineProperty(process, 'platform', { value: realPlatform });
  rmSync(root, { recursive: true, force: true });
});

/** Every temp file under the root, however deep. */
function temps(dir = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...temps(abs));
    else if (NOTE_TEMP_PATTERN.test(entry.name)) out.push(abs);
  }
  return out;
}

function versionOf(abs: string): string {
  return noteVersion(lstatSync(abs, { bigint: true }));
}

describe('the version token', () => {
  it('is ino:mtimeNs:size from a bigint lstat, and list, stat, read, and write agree', async () => {
    const note = join(root, 'a.md');
    const wrote = await writeNote(note, 'hello', { ifAbsent: true });
    expect(wrote.ok).toBe(true);
    const st = lstatSync(note, { bigint: true });
    expect(versionOf(note)).toBe(`${st.ino}:${st.mtimeNs}:${st.size}`);
    expect(wrote.ok && wrote.version).toBe(versionOf(note));
    expect((await statNote(note))?.version).toBe(versionOf(note));
    expect((await statNote(note))?.size).toBe(5);
    const read = await readNote(note);
    expect(read).toEqual({
      text: 'hello',
      version: versionOf(note),
      updatedAt: expect.any(String),
    });
  });

  it('changes on a same-size rewrite with a new mtime', async () => {
    const note = join(root, 'a.md');
    writeFileSync(note, 'abc');
    utimesSync(note, 1_700_000_000, 1_700_000_000);
    const before = versionOf(note);
    writeFileSync(note, 'xyz');
    utimesSync(note, 1_700_000_100, 1_700_000_100);
    expect(versionOf(note)).not.toBe(before);
    expect((await statNote(note))?.version).toBe(versionOf(note));
  });

  it('changes on a rename-over with identical bytes and mtime', async () => {
    const note = join(root, 'a.md');
    writeFileSync(note, 'same');
    utimesSync(note, 1_700_000_000, 1_700_000_000);
    const before = versionOf(note);
    const other = join(root, 'other');
    writeFileSync(other, 'same');
    utimesSync(other, 1_700_000_000, 1_700_000_000);
    renameSync(other, note);
    expect(readFileSync(note, 'utf8')).toBe('same');
    expect(versionOf(note)).not.toBe(before);
  });
});

describe('writeNote with ifMatch', () => {
  it('replaces a note whose version still matches, and the new version is accepted next', async () => {
    const note = join(root, 'a.md');
    const first = await writeNote(note, 'one', { ifAbsent: true });
    if (!first.ok) throw new Error('first write failed');
    const second = await writeNote(note, 'two', { ifMatch: first.version });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(readFileSync(note, 'utf8')).toBe('two');
    expect(second.version).toBe(versionOf(note));
    const third = await writeNote(note, 'three', { ifMatch: second.version });
    expect(third.ok).toBe(true);
    expect(readFileSync(note, 'utf8')).toBe('three');
    expect(temps()).toEqual([]);
  });

  it('a mismatch conflicts with theirs and leaves the file byte for byte', async () => {
    const note = join(root, 'a.md');
    writeFileSync(note, 'mine');
    const stale = versionOf(note);
    // Another writer (Obsidian saving in place) lands first.
    writeFileSync(note, Buffer.from([0xef, 0xbb, 0xbf, 0x74, 0x68, 0x65, 0x69, 0x72, 0x73]));
    utimesSync(note, 1_700_000_100, 1_700_000_100);
    const before = readFileSync(note);
    const out = await writeNote(note, 'clobber', { ifMatch: stale });
    expect(out).toEqual({
      ok: false,
      conflict: 'changed',
      theirs: {
        text: before.toString('utf8'),
        version: versionOf(note),
        updatedAt: expect.any(String),
      },
    });
    expect(readFileSync(note).equals(before)).toBe(true);
    expect(temps()).toEqual([]);
  });

  it('on a deleted note returns missing and creates nothing', async () => {
    const note = join(root, 'a.md');
    writeFileSync(note, 'x');
    const version = versionOf(note);
    rmSync(note);
    expect(await writeNote(note, 'back', { ifMatch: version })).toEqual({
      ok: false,
      conflict: 'missing',
    });
    expect(existsSync(note)).toBe(false);
    expect(temps()).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('keeps the note mode', async () => {
    const note = join(root, 'a.md');
    writeFileSync(note, 'x');
    chmodSync(note, 0o640);
    const out = await writeNote(note, 'y', { ifMatch: versionOf(note) });
    expect(out.ok).toBe(true);
    expect(statSync(note).mode & 0o777).toBe(0o640);
  });

  it.skipIf(process.platform === 'win32')(
    'a symlinked note stays a link, and its target changes',
    async () => {
      mkdirSync(join(root, 'elsewhere'));
      const target = join(root, 'elsewhere', 'real.md');
      writeFileSync(target, 'old');
      const note = join(root, 'linked.md');
      symlinkSync(target, note);
      const read = await readNote(note);
      expect(read?.text).toBe('old');
      const out = await writeNote(note, 'new', { ifMatch: read!.version });
      expect(out.ok).toBe(true);
      expect(lstatSync(note).isSymbolicLink()).toBe(true);
      expect(readFileSync(target, 'utf8')).toBe('new');
      expect(temps()).toEqual([]);
    },
  );

  it('refuses a folder named like a note, and the folder is untouched', async () => {
    const folder = join(root, 'x.md');
    mkdirSync(join(folder, 'inside'), { recursive: true });
    await expect(writeNote(folder, 'y')).rejects.toThrow(NotANoteError);
    await expect(writeNote(folder, 'y', { ifMatch: 'any' })).rejects.toThrow(
      'x.md is a folder, not a note.',
    );
    await expect(writeNote(folder, 'y', { ifAbsent: true })).rejects.toThrow(NotANoteError);
    await expect(readNote(folder)).rejects.toThrow(NotANoteError);
    expect(await statNote(folder)).toBeNull();
    expect(statSync(folder).isDirectory()).toBe(true);
    expect(existsSync(join(folder, 'inside'))).toBe(true);
    expect(temps()).toEqual([]);
  });

  it('a crash between the temp write and the rename leaves the note whole and the temp hidden', async () => {
    const note = join(root, 'a.md');
    writeFileSync(note, 'original body');
    const before = readFileSync(note);
    noteFileHooksForTests.afterTemp = () => {
      throw new Error('power cut');
    };
    await expect(writeNote(note, 'new body', { ifMatch: versionOf(note) })).rejects.toThrow(
      'power cut',
    );
    expect(readFileSync(note).equals(before)).toBe(true);
    // One temp file, a dot name the vault list and Obsidian both skip.
    const left = temps();
    expect(left).toHaveLength(1);
    const name = left[0]!.slice(root.length + 1);
    expect(name.startsWith('.a.md.oscode-')).toBe(true);
    expect(readFileSync(left[0]!, 'utf8')).toBe('new body');
    // A save in flight is never swept; one left for over an hour is.
    expect(sweepNoteTemps(root)).toBe(0);
    expect(sweepNoteTemps(root, Date.now() + 2 * 60 * 60 * 1000)).toBe(1);
    expect(temps()).toEqual([]);
    expect(readFileSync(note).equals(before)).toBe(true);
  });

  it('a save in flight whose temp carries an old mtime is never swept (M1-6)', () => {
    // macOS saves set the temp's mtime back to the note's creation date to
    // keep it; staleness is judged by ctime, which a utimes call sets to now.
    const tmp = join(root, '.a.md.oscode-0123abcd.tmp');
    writeFileSync(tmp, 'in flight');
    utimesSync(tmp, 1_600_000_000, 1_600_000_000);
    expect(sweepNoteTemps(root)).toBe(0);
    expect(readFileSync(tmp, 'utf8')).toBe('in flight');
    expect(sweepNoteTemps(root, Date.now() + 2 * 60 * 60 * 1000)).toBe(1);
  });

  it('a failed rename takes its temp back and leaves the note alone', async () => {
    const note = join(root, 'a.md');
    writeFileSync(note, 'keep');
    stubs.rename = async () => {
      throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
    };
    await expect(writeNote(note, 'lost?', { ifMatch: versionOf(note) })).rejects.toThrow('EIO');
    expect(readFileSync(note, 'utf8')).toBe('keep');
    expect(temps()).toEqual([]);
  });

  it('on Windows, a briefly held file is retried, then given up with the note intact', async () => {
    const note = join(root, 'a.md');
    writeFileSync(note, 'v1');
    const { rename: realRename } =
      await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    let fails = 2;
    stubs.rename = async (from, to) => {
      if (fails-- > 0) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      await realRename(from, to);
    };
    expect((await writeNote(note, 'v2', { ifMatch: versionOf(note) })).ok).toBe(true);
    expect(readFileSync(note, 'utf8')).toBe('v2');

    let tries = 0;
    stubs.rename = async () => {
      tries += 1;
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    };
    await expect(writeNote(note, 'v3', { ifMatch: versionOf(note) })).rejects.toThrow('EPERM');
    expect(tries).toBe(6);
    expect(readFileSync(note, 'utf8')).toBe('v2');
    expect(temps()).toEqual([]);
  });

  it('with no guard is a plain atomic replace, creating the folder when needed', async () => {
    const note = join(root, 'deep', 'er', 'a.md');
    expect((await writeNote(note, 'one')).ok).toBe(true);
    expect((await writeNote(note, 'two')).ok).toBe(true);
    expect(readFileSync(note, 'utf8')).toBe('two');
    expect(temps()).toEqual([]);
  });
});

describe('writeNote with ifAbsent', () => {
  it('creates a new note, its folder included, whole', async () => {
    const note = join(root, 'plans', 'q3.md');
    const out = await writeNote(note, '# Q3', { ifAbsent: true });
    expect(out.ok).toBe(true);
    expect(readFileSync(note, 'utf8')).toBe('# Q3');
    expect(out.ok && out.version).toBe(versionOf(note));
    expect(temps()).toEqual([]);
  });

  it('never replaces a note that exists, and hands back theirs', async () => {
    const note = join(root, 'a.md');
    writeFileSync(note, 'theirs');
    const before = readFileSync(note);
    const out = await writeNote(note, 'mine', { ifAbsent: true });
    expect(out).toEqual({
      ok: false,
      conflict: 'exists',
      theirs: { text: 'theirs', version: versionOf(note), updatedAt: expect.any(String) },
    });
    expect(readFileSync(note).equals(before)).toBe(true);
    expect(temps()).toEqual([]);
  });

  it('falls back to an exclusive create where the volume has no hard links', async () => {
    stubs.link = async () => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    };
    const note = join(root, 'a.md');
    const out = await writeNote(note, 'made', { ifAbsent: true });
    expect(out.ok).toBe(true);
    expect(readFileSync(note, 'utf8')).toBe('made');
    expect(out.ok && out.version).toBe(versionOf(note));
    // Still never replaces.
    const again = await writeNote(note, 'other', { ifAbsent: true });
    expect(again.ok).toBe(false);
    expect(!again.ok && again.conflict).toBe('exists');
    expect(readFileSync(note, 'utf8')).toBe('made');
    expect(temps()).toEqual([]);
  });

  it('writeNewNoteSync publishes whole and never replaces', () => {
    const note = join(root, 'Crew', 'run.md');
    expect(writeNewNoteSync(note, 'first')).toEqual({ ok: true });
    expect(writeNewNoteSync(note, 'second')).toEqual({ ok: false, conflict: 'exists' });
    expect(readFileSync(note, 'utf8')).toBe('first');
    expect(temps()).toEqual([]);
  });
});

describe('reading a note', () => {
  it('returns null when nothing is there', async () => {
    expect(await readNote(join(root, 'nope.md'))).toBeNull();
    expect(await readNoteBytes(join(root, 'nope', 'deeper.md'))).toBeNull();
    expect(await statNote(join(root, 'nope.md'))).toBeNull();
  });

  // POSIX only: Windows refuses to rename over a file another handle holds
  // open (EPERM), so a replace cannot land while the read's handle is open
  // there; the in-place save below is the race Windows can have.
  it.skipIf(process.platform === 'win32')(
    'a read that races a replace returns the new bytes with their own version',
    async () => {
      const note = join(root, 'a.md');
      writeFileSync(note, 'old body');
      stubs.afterRead = () => {
        // A sync client replaces the note while the read is under way.
        const incoming = join(root, 'incoming');
        writeFileSync(incoming, 'new body!');
        renameSync(incoming, note);
      };
      const read = await readNote(note);
      expect(read?.text).toBe('new body!');
      expect(read?.version).toBe(versionOf(note));
    },
  );

  it('a read that races a save in place returns the saved bytes with their own version', async () => {
    const note = join(root, 'a.md');
    writeFileSync(note, 'old body');
    stubs.afterRead = () => {
      // An editor saves over the same file while the read is under way.
      writeFileSync(note, 'new body!');
    };
    const read = await readNote(note);
    expect(read?.text).toBe('new body!');
    expect(read?.version).toBe(versionOf(note));
  });

  it('the raw bytes are exactly what is on disk', async () => {
    const note = join(root, 'a.md');
    const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69, 0x0d, 0x0a]);
    writeFileSync(note, bytes);
    const read = await readNoteBytes(note);
    expect(read?.bytes.equals(bytes)).toBe(true);
    expect(read?.version).toBe(versionOf(note));
  });
});

// F2: Obsidian shows a note's creation date, and macOS keeps it across our
// rename when mtime is first set back to it. If this fails on the build Mac,
// drop the backdate and record the finding.
describe.skipIf(process.platform !== 'darwin')('the creation date on macOS', () => {
  it('is unchanged within 1 ms after two saves', async () => {
    const note = join(root, 'a.md');
    writeFileSync(note, 'x');
    const born = statSync(note).birthtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    expect((await writeNote(note, 'y', { ifMatch: versionOf(note) })).ok).toBe(true);
    expect((await writeNote(note, 'z', { ifMatch: versionOf(note) })).ok).toBe(true);
    expect(Math.abs(statSync(note).birthtimeMs - born)).toBeLessThanOrEqual(1);
  });
});
