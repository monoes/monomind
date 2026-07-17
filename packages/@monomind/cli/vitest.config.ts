import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/._*'],
    globals: true,
    testTimeout: 15000,
    server: {
      // @monoes/monobrowse resolves through the pnpm workspace symlink into
      // node_modules, so Vitest externalizes it by default and vi.mock('ws')
      // never intercepts its `import { WebSocket } from 'ws'` — CdpClient
      // ends up making a real network connection in tests. Inline it so the
      // module graph goes through Vite's transform/mock pipeline instead.
      deps: { inline: [/@monoes\/monobrowse/] },
    },
    // Disable coverage for CLI package (uses vitest v2)
    coverage: {
      enabled: false,
    },
  },
});
