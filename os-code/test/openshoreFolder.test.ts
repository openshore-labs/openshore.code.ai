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
  ensureOpenshoreFolder,
  moveLegacyFolder,
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

  it('keeps a README the person edited', () => {
    const home = freshHome();
    mkdirSync(openshoreRoot(home), { recursive: true });
    writeFileSync(join(openshoreRoot(home), 'README.md'), 'mine');
    ensureOpenshoreFolder(home);
    expect(readFileSync(join(openshoreRoot(home), 'README.md'), 'utf8')).toBe('mine');
  });

  it('puts scratch work under Projects, where the person can find it', () => {
    const home = freshHome();
    expect(scratchDir(home)).toBe(join(sectionDir('projects', home), 'Scratch'));
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
    expect(existsSync(join(sectionDir('projects', home), 'site', '.git'))).toBe(true);
    expect(existsSync(join(sectionDir('projects', home), 'Try OpenShore'))).toBe(true);
    expect(readFileSync(join(scratchDir(home), 'draft.txt'), 'utf8')).toBe('draft');
    // A path a session recorded under ~/OSCode still resolves, to Projects.
    expect(lstatSync(join(home, 'OSCode')).isSymbolicLink()).toBe(true);
    expect(realpathSync(join(home, 'OSCode', 'site'))).toBe(
      join(sectionDir('projects', home), 'site'),
    );
  });

  it('never overwrites a name already taken, and leaves that folder where it was', () => {
    const home = legacyHome();
    mkdirSync(join(sectionDir('projects', home), 'site'), { recursive: true });
    writeFileSync(join(sectionDir('projects', home), 'site', 'keep.txt'), 'new place');
    const move = moveLegacyFolder(home);
    expect(move.kept).toEqual([join(home, 'OSCode', 'site')]);
    expect(move.linked).toBe(false);
    expect(existsSync(join(home, 'OSCode', 'site', '.git'))).toBe(true);
    expect(readFileSync(join(sectionDir('projects', home), 'site', 'keep.txt'), 'utf8')).toBe(
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
