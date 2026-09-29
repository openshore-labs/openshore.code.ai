import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
    env: { VITE_RELEASE_TIER: '4' },
  },
});
