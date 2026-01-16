import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.spec.ts',
      'tests/**/*.test.mjs',
    ],
    exclude: ['node_modules', 'dist', '.git'],
    globals: false,
    testTimeout: 10000,
    hookTimeout: 10000,
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
    pool: 'threads',
    reporters: ['default'],
  },
});
