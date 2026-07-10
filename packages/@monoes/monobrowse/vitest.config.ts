import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    root: '.',
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**', '**/._*'],
    globals: false,
    testTimeout: 10000,
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
