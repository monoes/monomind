import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/._*'],
    // Was `enabled: true`, so coverage ran on every single test invocation.
    // Now opt-in like every other package: `npm run test:coverage`.
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.test.ts'],
    },
    testTimeout: 10000,
    globals: true,
  },
});
