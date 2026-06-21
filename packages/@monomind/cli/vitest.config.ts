import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Force workspace packages to use the CLI's installed copy of shared deps
      // so vi.mock() intercepts work across package boundaries in tests.
      '@anthropic-ai/sdk': resolve(__dirname, 'node_modules/@anthropic-ai/sdk'),
    },
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    globals: true,
    testTimeout: 15000,
    // Disable coverage for CLI package (uses vitest v2)
    coverage: {
      enabled: false,
    },
  },
});
