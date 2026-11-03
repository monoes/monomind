import { defineConfig } from 'vitest/config';

// TEST LOCATION CONVENTION
//
// The root suite owns tests/** (this file). Every package under packages/**
// owns its own tests, and each packages/*/vitest.config.ts includes BOTH
// `src/**/*.test.ts` (tests beside source, incl. src/__tests__/) and
// `__tests__/**/*.test.ts` (package-level tests), so a test file in either
// place is never silently skipped. A package-level test that cannot run yet
// must be excluded explicitly, with a comment, never left out by a narrow
// include. CI's `pnpm run test:all:run` runs all of them via
// vitest.workspace.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.spec.ts',
      'tests/**/*.test.mjs',
    ],
    exclude: [
      'node_modules', 'dist', '.git', '**/._*',
      // Runs separately under `node --test` (npm run test:semantic-eval) — the
      // local MiniLM embedding model does not reliably load under vitest's
      // worker-pool sandbox, which silently skipped its semantic-quality
      // assertions instead of running them. See GH issue #32.
      'tests/memory/cognee-port-eval.test.mjs',
    ],
    // Moves every worker off the developer's real HOME (#347).
    globalSetup: ['tests/setup/isolated-home.global.ts'],
    // Clears Jev provider env so no test reaches a real decision model.
    setupFiles: [
      'tests/setup/no-jev-env.setup.ts',
      'tests/setup/isolated-home.setup.ts',
      'tests/setup/eval-timeouts.setup.ts',
    ],
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
    pool: 'threads',
    reporters: ['default'],
    server: {
      deps: {
        external: ['better-sqlite3'],
      },
    },
  },
});
