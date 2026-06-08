import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.test.ts'],
    },
    testTimeout: 10000,
    globals: true,
  },
});
