import { configDefaults, defineConfig } from 'vitest/config';

// The house-style checks (CONTRIBUTING.md): a maintainer fixes these when a
// change is pulled in, so a pull request's required run leaves them out.
// OSC_TEST_SET=behavior runs everything else, =style runs only these, and
// unset runs the whole suite (main, and every maintainer's local run).
const STYLE = ['test/em-dash-policy.test.ts', 'test/progressShape.test.ts'];
const set = process.env.OSC_TEST_SET;

export default defineConfig({
  test: {
    include: set === 'style' ? STYLE : ['test/**/*.test.ts'],
    exclude: set === 'behavior' ? [...configDefaults.exclude, ...STYLE] : configDefaults.exclude,
    setupFiles: ['test/helpers/setup.ts'],
    testTimeout: 20000,
  },
});
