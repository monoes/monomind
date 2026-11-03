import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Moves every worker off the developer's real HOME (#347).
const home = (f: string) => fileURLToPath(new URL(`../../../tests/setup/${f}`, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    root: '.',
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
    // '**/._*' drops the AppleDouble sidecar files the exFAT working volume
    // leaves next to every edited source file (e.g. `._ref-cache.test.ts`).
    // They are binary resource forks, not tests, and vitest would otherwise
    // try to transform them.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/._*'],
    // isolated-tmpdir first: the home setup makes its dir under tmpdir() too.
    globalSetup: ['src/__tests__/setup/isolated-tmpdir.global.ts', home('isolated-home.global.ts')],
    setupFiles: [home('isolated-home.setup.ts')],
    globals: false,
    testTimeout: 10000,
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
    typecheck: { enabled: false },
    // Off by default to keep the edit/test loop fast; run
    // `npm run test:coverage` (or pass --coverage) to measure.
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      // '**/._*' again: coverage's own `include` glob re-globs src/, and v8
      // remapping hard-errors (PARSE_ERROR) on the binary AppleDouble files.
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', '**/._*'],
    },
  },
});
