// A Personal build, built (review 9, docs/release-tiers.md). The later tiers'
// doors were shut but their code still shipped: every room sat in one 2.5 MB
// file, the v2 to v4 roadmap in plain words inside the IPA. This builds the
// web bundle the way a shipped build does (VITE_RELEASE_TIER unset), reads
// every file it emits, and fails on a later tier's words; it also records
// what a launch loads before the first room opens, so the split stays one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FEATURE_TIER, ROOM_FEATURE } from '../src/lib/focus.js';
// @ts-expect-error: a plain .mjs script with no type declarations.
import { LATER_TIER_WORDS, inspectBundle } from '../scripts/tier-bundle.mjs';

interface BundleReport {
  entry: string;
  entryBytes: number;
  bootBytes: number;
  bootChunks: string[];
  totalJsBytes: number;
  chunks: number;
  leaks: Array<{ file: string; word: string }>;
}

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

/** The later tiers' room modules, by view (App.tsx loads each lazily). */
const LATER_ROOM_FILES: Record<string, string> = {
  stackhealth: 'StackHealthScreen',
  launch: 'LaunchScreen',
  marketplace: 'MarketplaceScreen',
  admin: 'AdminScreen',
};

describe('the lazy rooms are gated where the bundler can see it', () => {
  const app = read('src', 'App.tsx');

  it('spells the build tier from import.meta.env in App.tsx itself', () => {
    expect(app).toContain('const BUILT_TIER = import.meta.env?.VITE_RELEASE_TIER?.trim();');
    expect(app).toContain(
      "const BUILT_V2 = BUILT_TIER === '2' || BUILT_TIER === '3' || BUILT_TIER === '4';",
    );
    expect(app).toContain("const BUILT_V3 = BUILT_TIER === '3' || BUILT_TIER === '4';");
    expect(app).toContain("const BUILT_V4 = BUILT_TIER === '4';");
  });

  it("holds each later room behind its own tier and focus.ts's roomOpen", () => {
    expect(Object.keys(ROOM_FEATURE).sort()).toEqual(Object.keys(LATER_ROOM_FILES).sort());
    for (const [view, file] of Object.entries(LATER_ROOM_FILES)) {
      const tier = FEATURE_TIER[ROOM_FEATURE[view]!];
      const gate = new RegExp(
        `const ${file} =\\s*BUILT_V${tier} && roomOpen\\('${view}'\\)\\s*\\?\\s*room\\(\\(\\) => import\\('\\./screens/${file}\\.js'\\)`,
      );
      expect(app, view).toMatch(gate);
    }
  });

  it('never imports a later room statically, from anywhere', () => {
    const src = join(process.cwd(), 'src');
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : /\.tsx?$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const re = new RegExp(
      `from '[./]*(screens/)?(${Object.values(LATER_ROOM_FILES).join('|')})\\.js'`,
    );
    const offenders = files(src)
      .filter((f) => re.test(readFileSync(f, 'utf8')))
      .map((f) => relative(src, f));
    expect(offenders).toEqual([]);
  });
});

describe('a Personal bundle, built', () => {
  let out = '';
  let report: BundleReport;

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'oscode-tier1-'));
    // A shipped build sets no tier; the suite's own tier (4) must not leak in,
    // nor anything that would turn the bundle into a test or dev build.
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key === 'VITE_RELEASE_TIER' || key === 'NODE_ENV' || key.startsWith('VITEST')) {
        delete env[key];
      }
    }
    execFileSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'),
        'build',
        '--outDir',
        out,
        '--emptyOutDir',
        '--logLevel',
        'error',
      ],
      { cwd: process.cwd(), env, stdio: 'ignore' },
    );
    report = inspectBundle(out) as BundleReport;
  }, 240_000);

  afterAll(() => {
    if (out) rmSync(out, { recursive: true, force: true });
  });

  it("carries none of a later tier's words", () => {
    expect(LATER_TIER_WORDS).toEqual(
      expect.arrayContaining([
        'Stack Health',
        'Launch with Codemagic',
        'Hermes Agent',
        'Manage the company account',
        'Jev',
      ]),
    );
    const found = report.leaks.map((l) => `"${l.word}" in ${l.file}`);
    expect(found, found.join('\n')).toEqual([]);
  });

  it("emits no later tier's room", () => {
    const names = readdirSync(join(out, 'assets'));
    for (const file of Object.values(LATER_ROOM_FILES)) {
      expect(
        names.filter((n) => n.startsWith(`${file}-`)),
        file,
      ).toEqual([]);
    }
  });

  it('loads the rooms on demand, and records what a launch loads', () => {
    // The v1 rooms are their own chunks, none of them loaded at launch.
    for (const roomFile of ['SettingsScreen', 'VaultScreen', 'PairScreen', 'StackScreen']) {
      expect(
        report.bootChunks.some((c) => c.includes(`/${roomFile}-`)),
        roomFile,
      ).toBe(false);
    }
    // Recorded for the build notes (before the split, one 2,560,450-byte
    // chunk was the launch). The ceilings are generous; crossing one means a
    // room or a heavy library went back into the launch path.
    console.info(
      `tier-1 bundle: entry ${report.entry} ${report.entryBytes} bytes; launch loads ` +
        `${report.bootBytes} bytes in ${report.bootChunks.length} chunks; all JavaScript ` +
        `${report.totalJsBytes} bytes in ${report.chunks} chunks`,
    );
    expect(report.entryBytes).toBeLessThan(400_000);
    expect(report.bootBytes).toBeLessThan(2_000_000);
  });
});
