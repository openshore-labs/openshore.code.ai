// One OpenShore folder (founder, 2026-10-16): the layout, its README, and the
// one-time move from ~/OSCode, run against a scratch home.
import { describe, expect, it } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OPENSHORE_README,
  SECTIONS,
  EARLIER_READMES,
  ensureOpenshoreFolder,
  moveLegacyFolder,
  moveRenamedSections,
  openshoreRoot,
  scratchDir,
  sectionDir,
} from '../src/config/openshoreFolder.js';

const freshHome = () => realpathSync(mkdtempSync(join(tmpdir(), 'osc-folder-')));

describe('the OpenShore folder', () => {
  it('makes one folder per part of the app and a README naming each', () => {
    const home = freshHome();
    ensureOpenshoreFolder(home);
    expect(readdirSync(openshoreRoot(home)).sort()).toEqual(
      [...Object.values(SECTIONS), 'README.md'].sort(),
    );
    const readme = readFileSync(join(openshoreRoot(home), 'README.md'), 'utf8');
    for (const name of Object.values(SECTIONS)) expect(readme).toContain(`**${name}**`);
    // Machine state is named as kept apart, never placed here.
    expect(OPENSHORE_README).toContain('never here');
  });

  it('names each folder for the room that shows it', () => {
    expect(Object.values(SECTIONS)).toEqual([
      'Chats',
      'Repositories',
      'Vault',
      'Local Library',
      'Exports',
    ]);
  });

  it('replaces a README an earlier build wrote, word for word, and only that', () => {
    for (const earlier of EARLIER_READMES) {
      const home = freshHome();
      mkdirSync(openshoreRoot(home), { recursive: true });
      writeFileSync(join(openshoreRoot(home), 'README.md'), earlier);
      ensureOpenshoreFolder(home);
      expect(readFileSync(join(openshoreRoot(home), 'README.md'), 'utf8')).toBe(OPENSHORE_README);
    }
    const home = freshHome();
    mkdirSync(openshoreRoot(home), { recursive: true });
    writeFileSync(join(openshoreRoot(home), 'README.md'), `${EARLIER_READMES[1]}\nMy line.\n`);
    ensureOpenshoreFolder(home);
    expect(readFileSync(join(openshoreRoot(home), 'README.md'), 'utf8')).toContain('My line.');
  });

  it('keeps a README the person edited', () => {
    const home = freshHome();
    mkdirSync(openshoreRoot(home), { recursive: true });
    writeFileSync(join(openshoreRoot(home), 'README.md'), 'mine');
    ensureOpenshoreFolder(home);
    expect(readFileSync(join(openshoreRoot(home), 'README.md'), 'utf8')).toBe('mine');
  });

  it('puts scratch work under Repositories, where the person can find it', () => {
    const home = freshHome();
    expect(scratchDir(home)).toBe(join(sectionDir('repositories', home), 'Scratch'));
  });
});

describe('the move from ~/OSCode', () => {
  const legacyHome = () => {
    const home = freshHome();
    const old = join(home, 'OSCode');
    mkdirSync(join(old, 'Vault', 'Journal'), { recursive: true });
    writeFileSync(join(old, 'Vault', 'Journal', 'today.md'), 'a note');
    mkdirSync(join(old, 'site', '.git'), { recursive: true });
    mkdirSync(join(old, 'Try OpenShore'), { recursive: true });
    mkdirSync(join(old, 'scratch'), { recursive: true });
    writeFileSync(join(old, 'scratch', 'draft.txt'), 'draft');
    return home;
  };

  it('carries the Vault, each project and scratch over, then links the old path', () => {
    const home = legacyHome();
    const move = ensureOpenshoreFolder(home);
    expect(move.kept).toEqual([]);
    expect(move.linked).toBe(true);
    expect(readFileSync(join(sectionDir('vault', home), 'Journal', 'today.md'), 'utf8')).toBe(
      'a note',
    );
    expect(existsSync(join(sectionDir('repositories', home), 'site', '.git'))).toBe(true);
    expect(existsSync(join(sectionDir('repositories', home), 'Try OpenShore'))).toBe(true);
    expect(readFileSync(join(scratchDir(home), 'draft.txt'), 'utf8')).toBe('draft');
    // A path a session recorded under ~/OSCode still resolves, to Repositories.
    expect(lstatSync(join(home, 'OSCode')).isSymbolicLink()).toBe(true);
    expect(realpathSync(join(home, 'OSCode', 'site'))).toBe(
      join(sectionDir('repositories', home), 'site'),
    );
  });

  it('never overwrites a name already taken, and leaves that folder where it was', () => {
    const home = legacyHome();
    mkdirSync(join(sectionDir('repositories', home), 'site'), { recursive: true });
    writeFileSync(join(sectionDir('repositories', home), 'site', 'keep.txt'), 'new place');
    const move = moveLegacyFolder(home);
    expect(move.kept).toEqual([join(home, 'OSCode', 'site')]);
    expect(move.linked).toBe(false);
    expect(existsSync(join(home, 'OSCode', 'site', '.git'))).toBe(true);
    expect(readFileSync(join(sectionDir('repositories', home), 'site', 'keep.txt'), 'utf8')).toBe(
      'new place',
    );
  });

  it('does nothing on a second start, or with no old folder', () => {
    const home = legacyHome();
    ensureOpenshoreFolder(home);
    expect(moveLegacyFolder(home)).toEqual({ moved: [], kept: [], linked: false });
    expect(moveLegacyFolder(freshHome())).toEqual({ moved: [], kept: [], linked: false });
  });
});

describe('the move from the first layout (Projects and Models)', () => {
  const firstLayoutHome = () => {
    const home = freshHome();
    const root = openshoreRoot(home);
    mkdirSync(join(root, 'Projects', 'site', '.git'), { recursive: true });
    mkdirSync(join(root, 'Projects', 'Scratch'), { recursive: true });
    mkdirSync(join(root, 'Models', 'comfy'), { recursive: true });
    writeFileSync(join(root, 'Models', 'comfy', 'w.bin'), 'weights');
    return home;
  };

  it('renames Projects to Repositories, leaving a link, and Models to Local Library', () => {
    const home = firstLayoutHome();
    const move = ensureOpenshoreFolder(home);
    expect(move.kept).toEqual([]);
    const root = openshoreRoot(home);
    expect(existsSync(join(sectionDir('repositories', home), 'site', '.git'))).toBe(true);
    // A repository path a project or a routine recorded still resolves.
    expect(lstatSync(join(root, 'Projects')).isSymbolicLink()).toBe(true);
    expect(realpathSync(join(root, 'Projects', 'site'))).toBe(
      join(sectionDir('repositories', home), 'site'),
    );
    expect(readFileSync(join(sectionDir('library', home), 'comfy', 'w.bin'), 'utf8')).toBe(
      'weights',
    );
    expect(existsSync(join(root, 'Models'))).toBe(false);
  });

  it('moves entry by entry into a folder already there, and keeps a taken name', () => {
    const home = firstLayoutHome();
    mkdirSync(join(sectionDir('repositories', home), 'site'), { recursive: true });
    mkdirSync(join(sectionDir('repositories', home), 'other'), { recursive: true });
    const move = moveRenamedSections(home);
    const root = openshoreRoot(home);
    expect(move.kept).toEqual([join(root, 'Projects', 'site')]);
    expect(existsSync(join(root, 'Projects', 'site', '.git'))).toBe(true);
    expect(existsSync(join(sectionDir('repositories', home), 'Scratch'))).toBe(true);
    expect(lstatSync(join(root, 'Projects')).isSymbolicLink()).toBe(false);
  });

  it('carries an old ~/OSCode into the new names, and is a no-op the second time', () => {
    const home = firstLayoutHome();
    mkdirSync(join(home, 'OSCode', 'app', '.git'), { recursive: true });
    ensureOpenshoreFolder(home);
    expect(existsSync(join(sectionDir('repositories', home), 'app', '.git'))).toBe(true);
    expect(moveRenamedSections(home)).toEqual({ moved: [], kept: [], linked: false });
  });
});
