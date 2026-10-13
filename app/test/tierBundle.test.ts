// A Personal build carries no later tier (review 9, docs/release-tiers.md).
// The later tiers' doors were shut but their code still shipped: every room
// sat in one 2.5 MB file, the v2 to v4 roadmap in plain words inside the IPA.
// App.tsx now loads every room lazily and gates the later ones where the
// bundler folds them away; CI builds the app and runs scripts/tier-bundle.mjs
// over the result, which fails on a later tier's words or rooms and records
// what a launch loads. These pin the gates and prove that check.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FEATURE_TIER, ROOM_FEATURE } from '../src/lib/focus.js';
// @ts-expect-error: a plain .mjs script with no type declarations.
import {
  LATER_ROOM_FILES,
  LATER_TIER_WORDS,
  LAZY_LIBRARIES,
  LAZY_ROOM_FILES,
  bundleProblems,
  inspectBundle,
} from '../scripts/tier-bundle.mjs';

interface BundleReport {
  entry: string;
  entryBytes: number;
  bootBytes: number;
  bootChunks: string[];
  chunkNames: string[];
  totalJsBytes: number;
  chunks: number;
  leaks: Array<{ file: string; word: string }>;
  lazyAtLaunch: Array<{ library: string; file: string }>;
}

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

/** The later tiers' room modules, by view (App.tsx loads each lazily). */
const LATER_ROOMS: Record<string, string> = {
  stackhealth: 'StackHealthScreen',
  launch: 'LaunchScreen',
  admin: 'AdminScreen',
};

describe('the lazy rooms are gated where the bundler can see it', () => {
  const app = read('src', 'App.tsx');

  it('spells the build tier from import.meta.env in App.tsx itself', () => {
    expect(app).toContain('const BUILT_TIER = import.meta.env?.VITE_RELEASE_TIER?.trim();');
    expect(app).toContain(
      "const BUILT_V2 = BUILT_TIER === '2' || BUILT_TIER === '3' || BUILT_TIER === '4';",
    );
    // v3 owns no room today (the Local Library is v1 since 2026-10-11).
    expect(app).not.toContain('BUILT_V3');
    expect(app).toContain("const BUILT_V4 = BUILT_TIER === '4';");
  });

  it('loads the Local Library, a v1 room, lazily with no tier gate', () => {
    expect(app).toMatch(
      /const LocalLibraryScreen = room\(\s*\(\) => import\('\.\/screens\/LocalLibraryScreen\.js'\),\s*'LocalLibraryScreen',\s*\);/,
    );
    expect(LAZY_ROOM_FILES).toContain('LocalLibraryScreen');
  });

  it("holds each later room behind its own tier and focus.ts's roomOpen", () => {
    expect(Object.keys(ROOM_FEATURE).sort()).toEqual(Object.keys(LATER_ROOMS).sort());
    for (const [view, file] of Object.entries(LATER_ROOMS)) {
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
    const re = new RegExp(`from '[./]*(screens/)?(${Object.values(LATER_ROOMS).join('|')})\\.js'`);
    const offenders = files(src)
      .filter((f) => re.test(readFileSync(f, 'utf8')))
      .map((f) => relative(src, f));
    expect(offenders).toEqual([]);
  });
});

describe('the bundle check CI runs on the Personal build', () => {
  // CI builds the app, then runs scripts/tier-bundle.mjs over the dist it
  // made (the build itself is too heavy to run beside the rest of the suite).
  // These prove the check on a small dist laid out the way Vite writes one.
  let dist = '';
  const write = (name: string, text: string) => writeFileSync(join(dist, name), text);

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'oscode-dist-'));
    mkdirSync(join(dist, 'assets'));
    write(
      'index.html',
      '<!doctype html><script type="module" crossorigin src="./assets/index-a1.js"></script>',
    );
    write(
      'assets/index-a1.js',
      'import{a as e}from"./jsx-runtime-b2.js";const t=()=>import("./SettingsScreen-c3.js");e(t);',
    );
    write('assets/jsx-runtime-b2.js', 'export const a=(e)=>e;');
    write('assets/SettingsScreen-c3.js', 'export const SettingsScreen=()=>`Settings`;');
  });
  afterEach(() => rmSync(dist, { recursive: true, force: true }));

  it('passes a clean Personal build, and measures what a launch loads', () => {
    const report = inspectBundle(dist) as BundleReport;
    expect(report.entry).toBe('assets/index-a1.js');
    expect(report.bootChunks.sort()).toEqual(['assets/index-a1.js', 'assets/jsx-runtime-b2.js']);
    expect(report.chunks).toBe(3);
    expect(bundleProblems(report)).toEqual([]);
  });

  it("fails on a later tier's words, in any file", () => {
    expect(LATER_TIER_WORDS).toEqual([
      'Stack Health',
      'Launch with Codemagic',
      'Hermes Agent',
      'Manage the company account',
      'Jev',
    ]);
    write('assets/jsx-runtime-b2.js', 'export const a=(e)=>e,b=`Jev routed this`;');
    write(
      'index.html',
      '<title>Stack Health</title><script type="module" src="./assets/index-a1.js"></script>',
    );
    expect((bundleProblems(inspectBundle(dist)) as string[]).sort()).toEqual([
      'later-tier word "Jev" in assets/jsx-runtime-b2.js',
      'later-tier word "Stack Health" in index.html',
    ]);
    // A whole word only: a longer word that starts the same is not a leak.
    write('assets/jsx-runtime-b2.js', 'export const a=(e)=>e,b=`Jevons`;');
    write('index.html', '<script type="module" src="./assets/index-a1.js"></script>');
    expect(bundleProblems(inspectBundle(dist))).toEqual([]);
  });

  it("fails on a later tier's room, and on a room that loads at launch", () => {
    write('assets/AdminScreen-d4.js', 'export const AdminScreen=()=>null;');
    write(
      'assets/index-a1.js',
      'import"./SettingsScreen-c3.js";import{a as e}from"./jsx-runtime-b2.js";e(1);',
    );
    const problems = bundleProblems(inspectBundle(dist));
    expect(problems).toContain('later-tier room emitted: AdminScreen-d4.js');
    expect(problems.some((p: string) => p.startsWith('SettingsScreen loads at launch'))).toBe(true);
  });

  it('fails a launch that carries the code highlighter, and passes it as its own chunk', () => {
    expect(LAZY_LIBRARIES).toEqual([{ name: 'highlight.js', marker: 'highlightAuto' }]);
    write(
      'assets/jsx-runtime-b2.js',
      'export const a=(e)=>e;const h={highlightAuto(){}};const c=()=>import("./rehype-highlight-e5.js");',
    );
    write('assets/rehype-highlight-e5.js', 'export default {highlightAuto(){}};');
    expect(bundleProblems(inspectBundle(dist))).toEqual([
      'highlight.js loads at launch (assets/jsx-runtime-b2.js); it waits for its first use',
    ]);
    // Only behind a dynamic import: nothing to say.
    write(
      'assets/jsx-runtime-b2.js',
      'export const a=(e)=>e;const c=()=>import("./rehype-highlight-e5.js");',
    );
    expect(bundleProblems(inspectBundle(dist))).toEqual([]);
  });

  it('the chat loads the highlighter on first need, never with a static import', () => {
    for (const file of ['components/Markdown.tsx', 'components/CodeBlock.tsx']) {
      expect(read('src', ...file.split('/')), file).not.toMatch(
        /^import[^;]*from '(?:rehype-highlight|highlight\.js|lowlight)'/m,
      );
    }
    expect(read('src', 'lib', 'lazyHighlight.ts')).toMatch(/import\('rehype-highlight'\)/);
  });

  it('fails a launch that grows past its ceiling', () => {
    write('assets/jsx-runtime-b2.js', `export const a=(e)=>e;//${'x'.repeat(2_000_000)}`);
    expect(bundleProblems(inspectBundle(dist))).toEqual([
      expect.stringMatching(/^launch loads \d+ bytes, over 2000000$/),
    ]);
  });

  it('names the same later rooms as App.tsx, and runs in CI after the build', () => {
    expect([...LATER_ROOM_FILES].sort()).toEqual(Object.values(LATER_ROOMS).sort());
    const ci = readFileSync(join(process.cwd(), '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    const build = ci.indexOf('run: pnpm -r build');
    const check = ci.indexOf('run: pnpm --filter oscode-app check:bundle');
    expect(build).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(build);
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['check:bundle']).toBe('node scripts/tier-bundle.mjs dist');
  });
});
