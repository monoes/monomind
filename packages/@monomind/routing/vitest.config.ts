import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// agent-slugs.test.ts reads the CLI's generated .claude/agents tree, which a
// fresh checkout does not have until the generator has run.
const home = (f: string) => fileURLToPath(new URL(`../../../tests/setup/${f}`, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: [home('claude-trees.global.ts')],
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
    exclude: ['**/._*', '**/node_modules/**'],
    testTimeout: 10000,
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
