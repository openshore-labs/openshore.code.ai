import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The suite runs as a build with no VITE_ values set, the way GitHub's CI runs
// it. A build machine's own never reach a test: Codemagic's group carries
// VITE_SUPABASE_URL and friends for the app build, and with them every test
// met an account backend it does not have, so 27 failed on the Mac gate
// (2026-10-01). A test that needs a value sets it itself (vi.stubEnv).
const blankViteEnv = Object.fromEntries(
  Object.keys(process.env)
    .filter((key) => key.startsWith('VITE_'))
    .map((key) => [key, '']),
);

// The house-style checks (CONTRIBUTING.md): a maintainer fixes these when a
// change is pulled in, so a pull request's required run leaves them out.
// OSC_TEST_SET=behavior runs everything else, =style runs only these, and
// unset runs the whole suite (main, and every maintainer's local run).
const STYLE = [
  'test/em-dash-policy.test.ts',
  'test/uiGuards*.test.ts',
  'test/polish-standards.test.ts',
  'test/*Polish*.test.ts',
  'test/frontier-polish.test.ts',
  'test/motion*.test.ts',
  'test/spacing-elevation.test.ts',
  'test/contrast.test.ts',
  'test/reviewStaffContrast.test.ts',
  'test/copy-glossary.test.ts',
  'test/copyBlocks.test.ts',
  'test/deviceNoun.test.ts',
  'test/vaultCopy.test.ts',
];
const testSet = process.env.OSC_TEST_SET;

// One web build serves every shell: Electron loads dist/index.html, Capacitor
// copies it into the iOS app. Relative base so file:// and capacitor:// both
// resolve assets.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  test: {
    include: testSet === 'style' ? STYLE : ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude:
      testSet === 'behavior' ? [...configDefaults.exclude, ...STYLE] : configDefaults.exclude,
    environment: 'node',
    // The suite exercises every tier's code (a Personal build only shuts the
    // later tiers' doors; their code stays). test/focus.test.ts pins what a
    // Personal build, the default with this unset, carries and hides.
    env: { ...blankViteEnv, VITE_RELEASE_TIER: '4' },
  },
});
