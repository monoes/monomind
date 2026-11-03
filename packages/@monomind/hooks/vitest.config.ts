import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Moves every worker off the developer's real HOME (#347).
const home = (f: string) => fileURLToPath(new URL(`../../../tests/setup/${f}`, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/._*'],
    globalSetup: [home('isolated-home.global.ts')],
    setupFiles: [home('isolated-home.setup.ts')],
    globals: true,
    // Off by default to keep the edit/test loop fast; run
    // `npm run test:coverage` (or pass --coverage) to measure.
    //
    // This previously read "Disable coverage for hooks package (uses vitest
    // v2)" — the same stale rationale the CLI carried. The package is on
    // vitest 4.x and coverage works; nobody re-tested the claim.
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
