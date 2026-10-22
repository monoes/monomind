import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Moves every worker off the developer's real HOME (#347).
const home = (f: string) => fileURLToPath(new URL(`../../../tests/setup/${f}`, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/._*'],
    globalSetup: [home('isolated-home.global.ts')],
    setupFiles: [home('isolated-home.setup.ts')],
    globals: true,
    // #683: beforeAll hooks build a real graph (tree-sitter, SQLite, FTS); that cost
    // scales with CPU contention, so the 5s default fails on a busy shared machine.
    testTimeout: 60000,
    hookTimeout: 60000,
    // Off by default to keep the edit/test loop fast; run
    // `npm run test:coverage` (or pass --coverage) to measure.
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**', 'src/**/*.d.ts'],
    },
  },
});
