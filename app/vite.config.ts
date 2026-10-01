import { defineConfig } from 'vite';
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
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    // The suite exercises every tier's code (a Personal build only shuts the
    // later tiers' doors; their code stays). test/focus.test.ts pins what a
    // Personal build, the default with this unset, carries and hides.
    env: { ...blankViteEnv, VITE_RELEASE_TIER: '4' },
  },
});
