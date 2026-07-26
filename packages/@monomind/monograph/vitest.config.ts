import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/._*'],
    globals: true,
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
