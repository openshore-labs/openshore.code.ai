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
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
