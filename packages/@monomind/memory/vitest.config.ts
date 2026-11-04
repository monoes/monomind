import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/._*'],
    testTimeout: 15000,
    hookTimeout: 10000,
    globals: false,
    typecheck: { enabled: false },
    // Off by default to keep the edit/test loop fast; run
    // `npm run test:coverage` (or pass --coverage) to measure.
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'benchmarks/**'],
      // Ratchet floor, checked only when coverage runs (CI's memory leg).
      // Measured 2026-11-04: 57.27% statements, 53.01% branches,
      // 55.28% functions, 58% lines. Raise these as coverage grows.
      thresholds: {
        statements: 56,
        branches: 51,
        functions: 54,
        lines: 56,
      },
    },
  },
});
