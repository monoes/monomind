import { defineConfig } from 'vitest/config';

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
